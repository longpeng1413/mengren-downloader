import {mkdir,mkdtemp,open,readdir,unlink,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomInt} from 'node:crypto';
import readline from 'node:readline';
import {safeHttps,hostIn,allowedMedia} from './sites.mjs';
import {ensureBrowser,sleep} from './browser.mjs';
import {guardedGet} from './relay.mjs';
import {run,isCancelled,removeAbandonedJobs,saveCompleted,safeStem,cleanup,ownerFile} from './site-download.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const say=text=>console.log(String(text).replace(/https?:\/\/[^\s"<>]+/g,'[媒体地址]'));
const api='https://u.y.qq.com/cgi-bin/musicu.fcg',agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
// Best first. Only plain files the account is granted; encrypted downloads (ekey) are skipped.
export const qqFormats=[
  {prefix:'F000',ext:'flac',label:'无损 FLAC',size:'size_flac',note:'音质最好；老人机和不少 MP3 播放器不支持'},
  {prefix:'M800',ext:'mp3',label:'320k MP3',size:'size_320mp3',note:'几乎所有手机和播放器都能放'},
  {prefix:'M500',ext:'mp3',label:'128k MP3',size:'size_128mp3',note:'几乎所有手机和播放器都能放，更省空间'},
  {prefix:'C400',ext:'m4a',label:'96k M4A',size:'size_96aac',note:'部分老人机不支持'},
  {prefix:'C200',ext:'m4a',label:'48k M4A',size:'size_48aac',note:'部分老人机不支持，音质较差'},
];
// Default to the best MP3: it plays on almost every phone, including basic ones.
export const defaultFormat=list=>Math.max(0,list.findIndex(f=>f.ext==='mp3'));
export function formatMenu(list,sizes={}) {
  const best=defaultFormat(list);
  return list.map((f,i)=>{
    const bytes=Number(sizes[f.prefix])||0,size=bytes?(bytes/1048576).toFixed(1)+'MB':'大小未知';
    return `  ${i+1}. ${f.label.padEnd(9)} ${size.padStart(8)}  ${f.note}${i===best?'  ← 默认':''}`;
  });
}
export async function chooseFormat(list,sizes,ask) {
  const best=defaultFormat(list);
  say('这首歌可下载的音质：');for(const line of formatMenu(list,sizes)) say(line);
  for(;;) {
    const answer=await ask(`请选择 1-${list.length}，直接回车选 ${best+1}（${list[best].label}）: `);
    if(answer===null||!String(answer).trim()) return list[best];
    const n=Number(String(answer).trim());
    if(Number.isInteger(n)&&n>=1&&n<=list.length) return list[n-1];
    say(`请输入 1 到 ${list.length} 之间的数字；直接回车选 ${list[best].label}。`);
  }
}
function askLine(question) {
  return new Promise(done=>{
    const rl=readline.createInterface({input:process.stdin,output:process.stdout});let settled=false;
    const finish=value=>{if(settled)return;settled=true;rl.close();done(value);};
    rl.once('close',()=>finish(null));rl.question(question,finish);
  });
}
const midPattern=/^[0-9A-Za-z]{10,20}$/,mediaPattern=/^[0-9A-Za-z]{8,32}$/;
export function qqSong(address) {
  let u;try{u=safeHttps(new URL(String(address).trim().replace(/^http:/i,'https:')).href);}catch{return null;}
  if(!u||u.hash&&u.hash!=='#'||!hostIn(u.hostname,['y.qq.com'])) return null;
  let mid=u.pathname.match(/^\/n\/ryqq(?:_v2)?\/songDetail\/([0-9A-Za-z]+)\/?$/)?.[1]||u.pathname.match(/^\/n\/yqq\/song\/([0-9A-Za-z]+)\.html$/)?.[1];
  if(!mid&&u.pathname==='/v8/playsong.html') {
    mid=u.searchParams.get('songmid');const id=u.searchParams.get('songid');
    if(!mid&&id) return /^\d{1,12}$/.test(id)?{songId:id}:null;
  }
  if(mid) return midPattern.test(mid)?{mid}:null;
  if(/^c\d*\.y\.qq\.com$/.test(u.hostname)&&u.pathname==='/base/fcgi-bin/u'&&/^[0-9A-Za-z]{4,40}$/.test(u.searchParams.get('__')||'')) return {short:u.href};
  return null;
}
// App share links are short redirects; follow them only inside y.qq.com until a single song appears.
async function followShort(address) {
  let current=address;
  for(let hop=0;hop<6;hop++) {
    const response=await fetch(current,{redirect:'manual',headers:{'User-Agent':agent},signal:AbortSignal.timeout(15000)});
    const next=response.headers.get('location');await response.body?.cancel();
    if(!next) break;
    current=new URL(next,current).href;
    const song=qqSong(current);
    if(song&&!song.short) return song;
    let u;try{u=new URL(current);}catch{break;}
    if(!hostIn(u.hostname,['y.qq.com'])) break;
  }
  throw new Error('这条分享链接没有指向 QQ 音乐单曲；目前只支持单曲，不支持歌单和专辑');
}
export const guid=()=>String(randomInt(1e9,1e10));
const request=body=>({comm:{cv:0,ct:24,format:'json'},...body});
export const detailPayload=song=>request({info:{module:'music.pf_song_detail_svr',method:'get_song_detail_yqq',param:song.mid?{song_mid:song.mid,song_type:0}:{song_id:Number(song.songId),song_type:0}}});
export const lyricPayload=mid=>request({req_2:{module:'music.musichallSong.PlayLyricInfo',method:'GetPlayLyricInfo',param:{songMID:mid}}});
export function vkeyPayload(mid,media,id=guid()) {
  const files=qqFormats.map(f=>f.prefix+media+'.'+f.ext);
  return request({req_1:{module:'vkey.GetVkeyServer',method:'CgiGetVkey',param:{guid:id,songmid:files.map(()=>mid),songtype:files.map(()=>0),loginflag:1,platform:'20',filename:files}}});
}
export function trackInfo(data,song) {
  const t=data?.info?.data?.track_info;
  if(data?.code!==0||data?.info?.code!==0||!t||!midPattern.test(t.mid||'')||!mediaPattern.test(t.file?.media_mid||'')) return null;
  if(song.mid&&t.mid!==song.mid||song.songId&&String(t.id)!==String(song.songId)) return null;
  const text=(value,limit)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,limit);
  const sizes=Object.fromEntries(qqFormats.map(f=>[f.prefix,Number(t.file[f.size])||0]));
  return {mid:t.mid,media:t.file.media_mid,title:text(t.title,200)||'QQ音乐',singers:(Array.isArray(t.singer)?t.singer:[]).map(s=>text(s?.name,80)).filter(Boolean).slice(0,6),album:text(t.album?.title,200),seconds:Number.isFinite(Number(t.interval))?Number(t.interval):0,sizes};
}
export function playableFormats(data,mid,media) {
  const items=data?.req_1?.code===0&&Array.isArray(data.req_1.data?.midurlinfo)?data.req_1.data.midurlinfo:[];
  const found=[];
  for(const format of qqFormats) {
    const file=format.prefix+media+'.'+format.ext,item=items.find(i=>i?.songmid===mid&&i?.filename===file);
    if(!item||typeof item.purl!=='string'||!item.purl||item.ekey) continue;
    const url='https://dl.stream.qqmusic.qq.com/'+item.purl.replace(/^\/+/,'');
    if(safeHttps(url)?.pathname!=='/'+file||!allowedMedia('qqmusic',url)) continue;
    found.push({...format,url});
  }
  return found;
}
export function lyricText(data) {
  const encoded=data?.req_2?.code===0?data.req_2.data?.lyric:null;
  if(typeof encoded!=='string'||!encoded||encoded.length>1_500_000) return null;
  const text=Buffer.from(encoded,'base64').toString('utf8').replace(/^\uFEFF/,'')
    .replace(/&#(\d{1,6});/g,(_,n)=>String.fromCodePoint(Math.min(Number(n),0x10FFFF))).replace(/&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  return /^\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/m.test(text)?text.replace(/\r?\n/g,'\r\n'):null;
}
export function audioFileName(track,ext) {
  return safeStem(track.title+(track.singers.length?' - '+track.singers.join('、'):''),'歌曲')+'.'+ext;
}
// Runs inside the dedicated Edge on y.qq.com: the browser attaches its own login, the
// program never sees cookies. Only file names, play addresses and a logged-in flag return.
export function qqBrowserExpression(payload) {
  return `(${async function(payload) {
    if(location.hostname!=='y.qq.com') return {state:'loading'};
    const box=document.querySelector('.mod_top_login');if(!box) return {state:'loading'};
    const loggedOut=[...box.querySelectorAll('a')].some(a=>a.textContent.trim()==='登录'&&a.offsetParent!==null);
    try {
      const response=await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg',{method:'POST',credentials:'include',signal:AbortSignal.timeout(20000),body:JSON.stringify(payload)});
      const value=await response.json(),list=value?.req_1?.data?.midurlinfo;
      const items=(Array.isArray(list)?list:[]).map(i=>({songmid:String(i?.songmid||''),filename:String(i?.filename||''),purl:String(i?.purl||''),ekey:Boolean(i?.ekey)}));
      return {state:'ready',loggedIn:!loggedOut,data:{req_1:{code:value?.req_1?.code,data:{midurlinfo:items}}}};
    } catch {return {state:'loading'};}
  }.toString()})(${JSON.stringify(payload)})`;
}
async function call(payload) {
  const response=await fetch(api,{method:'POST',headers:{'User-Agent':agent},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`QQ 音乐暂时无法访问（${response.status}），请稍后重试`);
  return response.json();
}
async function browserFormats(track,{timeout}) {
  const browser=await ensureBrowser(),deadline=Date.now()+timeout;
  const page=await browser.page('https://y.qq.com/n/ryqq_v2/songDetail/'+track.mid);
  let succeeded=false,notified=false;
  try {
    while(Date.now()<deadline&&!isCancelled()) {
      await sleep(2500);
      let answer;try{answer=await browser.evaluate(page.sessionId,qqBrowserExpression(vkeyPayload(track.mid,track.media)));}catch{continue;}
      if(answer?.state!=='ready') continue;
      if(!answer.loggedIn) {
        if(!notified){say('请在下载专用 Edge 的 QQ 音乐网页右上角点“登录”，用 QQ 或微信扫码登录；登录后自动继续。不想登录可按 Ctrl+C 中止，再选“普通音质”。');notified=true;}
        continue;
      }
      const list=playableFormats(answer.data,track.mid,track.media);
      if(!list.length) throw new Error('当前账号读取不到这首歌的完整音频：可能需要有效会员、单曲或数字专辑购买，也可能网页端不提供。软件不会下载试听片段或加密文件');
      succeeded=true;return list;
    }
    throw new Error(isCancelled()?'下载已取消':'等待 QQ 音乐登录超时，请在下载专用 Edge 登录后重试');
  } finally {
    if(succeeded) await browser.closePages([page.targetId]);
    browser.close();
  }
}
// QQ Music limits each connection to about playback speed, so fetch 1 MiB ranges over a
// few connections. Every range goes through the relay's host/IP checks and must return
// exactly the requested bytes of the same total size.
export async function fetchAudio(url,file,{workers=4,chunk=1048576,get=guardedGet}={}) {
  const referer='https://y.qq.com/',first=await get('qqmusic',url,referer,'bytes=0-0');
  const total=Number(first.response.headers['content-range']?.match(/^bytes 0-0\/(\d+)$/)?.[1]);first.response.destroy();
  if(!(total>0)||total>4*1024**3) throw new Error('音频服务器没有返回有效的文件大小');
  const handle=await open(file,'w'),started=Date.now(),mib=(total/1048576).toFixed(2);
  let next=0,received=0,shown=0,failed=null;
  const report=final=>{
    if(!final&&Date.now()<shown) return;shown=Date.now()+1000;
    const speed=received/Math.max(.001,(Date.now()-started)/1000)/1024;
    say(`[download] ${(received/total*100).toFixed(1).padStart(5)}% of ${mib}MiB at ${speed.toFixed(0)}KiB/s`);
  };
  const worker=async()=>{
    while(!failed&&next<total) {
      if(isCancelled()) throw new Error('下载已取消');
      const from=next,to=Math.min(total,from+chunk)-1;next=to+1;
      for(let attempt=1;;attempt++) {
        let written=0;
        try {
          const {response}=await get('qqmusic',url,referer,`bytes=${from}-${to}`);
          if(response.statusCode!==206||response.headers['content-range']!==`bytes ${from}-${to}/${total}`) {response.destroy();throw new Error('音频分段不完整');}
          for await(const data of response) {
            if(failed||isCancelled()) {response.destroy();throw failed||new Error('下载已取消');}
            if(from+written+data.length>to+1) {response.destroy();throw new Error('音频分段超出范围');}
            await handle.write(data,0,data.length,from+written);written+=data.length;received+=data.length;report(false);
          }
          if(written!==to-from+1) throw new Error('音频分段不完整');
          break;
        } catch(error) {
          received-=written;
          if(attempt>=3||failed||isCancelled()) throw error;
        }
      }
    }
  };
  try {await Promise.all(Array.from({length:workers},()=>worker().catch(error=>{failed??=error;throw error;})));}
  finally {await handle.close();}
  report(true);
  return total;
}
// Decodes the whole file: encrypted or broken files fail, and the decoded length must
// match the song length so a preview clip is never saved as the full song.
export async function checkAudio(file,expected) {
  const answer=await run(join(root,'ffmpeg.exe'),['-hide_banner','-i',file,'-map','0:a:0','-f','null','-'],{quiet:true});
  if(answer.code!==0||!/Stream .*Audio:/.test(answer.text)) throw new Error('音频文件无法正常解码，未保存');
  const times=[...answer.text.matchAll(/time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)],last=times.at(-1);
  const seconds=last?Number(last[1])*3600+Number(last[2])*60+Number(last[3]):0;
  if(!(seconds>0)) throw new Error('音频播放时长无效，未保存');
  if(expected>0&&seconds<expected-Math.max(3,expected*0.02)) throw new Error(`只取得 ${Math.round(seconds)} 秒的片段（整首约 ${expected} 秒），不作为完整歌曲保存`);
  return seconds;
}
export async function downloadQQ(address,output,{quality='best',probe=false,timeout=600000,format=null,ask=askLine}={}) {
  let song=qqSong(address);
  if(!song) throw new Error('请粘贴 QQ 音乐单曲链接（网页歌曲页或 App 分享链接）');
  if(song.short) song=await followShort(song.short);
  const track=trackInfo(await call(detailPayload(song)),song);
  if(!track) throw new Error('QQ 音乐没有返回这首歌的信息，请确认链接是单曲且仍可打开');
  say('已识别：'+track.title+(track.singers.length?' - '+track.singers.join('、'):''));
  let lyric=null;try{lyric=lyricText(await call(lyricPayload(track.mid)));}catch{}
  let choices=[];
  if(quality==='standard') {
    choices=playableFormats(await call(vkeyPayload(track.mid,track.media)),track.mid,track.media);
    if(!choices.length) say('这首歌不登录读取不到，改用下载专用 Edge 中登录的 QQ 音乐账号读取。');
  }
  if(!choices.length) {
    say('将打开下载专用 Edge 读取 QQ 音乐；首次使用请在网页上正常登录，之后会复用登录直到过期。');
    choices=await browserFormats(track,{timeout});
  }
  if(probe) {say('可下载音质：'+choices.map(c=>c.label).join('、'));say('歌曲来源验证成功。');return {title:track.title,formats:choices.map(c=>c.label)};}
  let choice;
  if(format) {choice=choices.find(c=>c.prefix===format);if(!choice) throw new Error('这首歌没有所选音质，可下载：'+choices.map(c=>c.label).join('、'));}
  else choice=await chooseFormat(choices,track.sizes,ask);
  if(isCancelled()) throw new Error('下载已取消');
  const outputPath=resolve(output);await mkdir(outputPath,{recursive:true});
  if(await removeAbandonedJobs(outputPath)) say('已清理上次中断留下的临时文件。');
  say('保存位置：'+outputPath);
  const job=await mkdtemp(join(outputPath,'.mengren-'));
  await writeFile(join(job,ownerFile),JSON.stringify({pid:process.pid}));
  try {
    say('正在下载：'+choice.label);
    const source=join(job,'source.'+choice.ext);
    await fetchAudio(choice.url,source);
    await checkAudio(source,track.seconds);
    const tagged=join(job,'tagged.'+choice.ext);
    const tags=['-metadata','title='+track.title,'-metadata','artist='+track.singers.join('/'),...(track.album?['-metadata','album='+track.album]:[]),...(choice.ext==='mp3'?['-id3v2_version','3']:[])];
    const tag=await run(join(root,'ffmpeg.exe'),['-hide_banner','-loglevel','error','-y','-i',source,'-map','0:a:0','-c','copy',...tags,tagged],{quiet:true});
    let finished=source;
    if(tag.code===0) {try{await checkAudio(tagged,track.seconds);finished=tagged;}catch{}}
    const target=await saveCompleted(finished,outputPath,audioFileName(track,choice.ext));
    say('下载完成：'+target+'（'+choice.label+'）');
    if(lyric) {
      const lrc=target.replace(/\.[A-Za-z0-9]+$/,'.lrc');
      try{await writeFile(lrc,'\uFEFF'+lyric,{flag:'wx'});say('歌词已保存：'+lrc);}catch(error){say(error.code==='EEXIST'?'同名歌词文件已存在，未覆盖。':'歌词未能保存，歌曲不受影响。');}
    } else say('这首歌没有可用的滚动歌词，只保存了音频。');
    return {title:track.title,file:target,format:choice.label};
  } catch(error) {
    if(isCancelled()) throw new Error('下载已取消');
    throw new Error(error?.message+'；可重新粘贴链接重试，或换一个音质');
  } finally {await cleanup(job,outputPath);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
  try {
    if(!args.includes('--url')||!args.includes('--output')||!value('--url')||!value('--output')) throw new Error('缺少链接或保存目录');
    await downloadQQ(value('--url'),value('--output'),{probe:args.includes('--probe'),quality:args.includes('--quality')&&value('--quality')==='standard'?'standard':'best',format:args.includes('--format')?value('--format'):null});
  } catch(error) {say('未下载成功：'+(error?.message||'请重新读取链接'));process.exitCode=isCancelled()?130:1;}
}
