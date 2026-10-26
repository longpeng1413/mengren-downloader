import {mkdir,mkdtemp,writeFile,stat} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline';
import {safeHttps,hostIn,allowedMedia} from './sites.mjs';
import {ensureBrowser,sleep} from './browser.mjs';
import {browserAgent} from './relay.mjs';
import {run,isCancelled,removeAbandonedJobs,saveCompleted,safeStem,cleanup,ownerFile} from './site-download.mjs';
import {fetchAudio,checkAudio} from './qqmusic.mjs';

// Ximalaya albums. The track list needs a login and a page token only the site's
// own page can produce, so the album is read inside the dedicated Edge from the
// responses the page itself loads. Free tracks come from the public track info;
// tracks needing membership are played (muted) by the official web player and the
// audio address it requests is taken. Nothing is decrypted, cookies are never
// read, and anything shorter than the full episode (a preview) is refused.

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const say=text=>console.log(String(text).replace(/https?:\/\/[^\s"<>]+/g,'[地址]'));
const site='ximalaya',referer='https://www.ximalaya.com/';
const xmlyHosts=['ximalaya.com','www.ximalaya.com','m.ximalaya.com'];
// Mute every player the page starts, so reading an address never makes a sound.
const muteScript='(()=>{const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){this.muted=true;return play.apply(this,arguments);};})()';

export function xmlyTarget(address) {
  let u;try{u=safeHttps(new URL(String(address).trim().replace(/^http:/i,'https:')).href);}catch{return null;}
  if(!u) return null;
  if(u.hostname==='xima.tv') return /^\/[\w-]{4,40}\/?$/.test(u.pathname)?{short:u.href}:null;
  if(!xmlyHosts.includes(u.hostname)) return null;
  const album=u.pathname.match(/^\/(?:\d+\/)?album\/(\d{1,12})\/?$/)||u.pathname.match(/^\/gatekeeper\/podcast-share\/album\/(\d{1,12})\/?$/);
  if(album) return {album:album[1]};
  const track=u.pathname.match(/^\/(?:\d+\/)?sound\/(\d{1,12})\/?$/)||u.pathname.match(/^\/gatekeeper\/podcast-share\/(?:track|sound)\/(\d{1,12})\/?$/);
  return track?{track:track[1]}:null;
}
// App share links (xima.tv) redirect through ximalaya.com; follow only inside those hosts.
async function followShort(address) {
  let current=address;
  for(let hop=0;hop<6;hop++) {
    const response=await fetch(current,{redirect:'manual',headers:{'User-Agent':browserAgent},signal:AbortSignal.timeout(15000)});
    const next=response.headers.get('location');await response.body?.cancel();
    if(!next) break;
    current=new URL(next,current).href;
    const target=xmlyTarget(current);
    if(target&&!target.short) return target;
    let host;try{host=new URL(current).hostname;}catch{break;}
    if(!(host==='xima.tv'||hostIn(host,['ximalaya.com']))) break;
  }
  throw new Error('这条分享链接没有指向喜马拉雅专辑或单集');
}

// "全部" or empty = everything; "5", "1-50", "100-" (to the end), "3,5,8". Numbers are the album's episode numbers.
export function parseEpisodeSelection(input,indexes) {
  const all=[...new Set(indexes)].sort((a,b)=>a-b),max=all.at(-1);
  // "1 - 50" stays one range; spaces otherwise separate numbers like commas.
  const text=String(input??'').trim().replace(/\s*[-~～到至]\s*/g,'-').replace(/[，、；;\s]+/g,',');
  if(!text||['全部','全部下载','下载全部','all'].includes(text.replace(/,/g,'').toLowerCase())) return all;
  const picked=new Set();
  for(const token of text.split(',').filter(Boolean)) {
    const m=token.match(/^(\d{1,6})(?:-(\d{0,6}))?$/);
    if(!m) throw new Error(`看不懂“${token}”。请输入 全部、单集如 5、范围如 1-50、到最后如 100-，多个用逗号隔开`);
    const first=Number(m[1]),last=m[2]===undefined?first:(m[2]===''?max:Number(m[2]));
    if(first<1||last<first) throw new Error(`范围“${token}”不对：前面的数要小于等于后面的数`);
    let hit=0;for(const index of all) if(index>=first&&index<=last){picked.add(index);hit++;}
    if(!hit) throw new Error(`专辑里没有“${token}”这几集（本专辑集数范围 ${all[0]}-${max}）`);
  }
  return all.filter(index=>picked.has(index));
}
export const albumFolderName=title=>safeStem(String(title||'').split('|')[0].trim(),'喜马拉雅专辑');
export function episodeFileName(track,width,ext='m4a') {
  const number=Number.isInteger(track.index)&&track.index>0?String(track.index).padStart(width,'0')+'. ':'';
  return number+safeStem(track.title,'音频')+'.'+ext;
}
// Best plain address from the public track info (free tracks only).
export function freeAudioUrl(info) {
  if(!info||info.is_paid) return null;
  for(const key of ['play_path_64','play_path_32','play_path']) if(typeof info[key]==='string'&&allowedMedia(site,info[key])) return info[key];
  return null;
}
// Paid addresses carry the playable length; a preview is shorter than the episode.
export function looksLikePreview(address,expected) {
  const u=new URL(address);
  if(/preview/i.test(u.pathname)) return true;
  const seconds=Number(u.searchParams.get('duration'));
  return expected>0&&seconds>0&&seconds<expected-Math.max(3,expected*0.02);
}
export function trackFromList(item) {
  return {index:Number(item.index),trackId:String(item.trackId),title:String(item.title||'').trim(),duration:Number(item.duration)||0,isPaid:Boolean(item.isPaid),anchor:String(item.anchorName||'').trim()};
}

export class XmlyBrowser {
  constructor(browser,session,targetId) {
    Object.assign(this,{browser,session,targetId,watched:new Map(),finished:[],media:[],pages:new Map(),tracks:new Map(),total:0,albumTitle:''});
  }
  static async open() {
    const browser=await ensureBrowser();
    const {targetId}=await browser.call('Target.createTarget',{url:'about:blank'});
    const page=new XmlyBrowser(browser,await browser.attach(targetId),targetId),s=page.session;
    page.offs=[
      browser.on('Network.responseReceived',(p,id)=>{const u=p.response?.url||'';if(id===s&&p.response?.status===200&&/^https:\/\/(?:www\.)?ximalaya\.com\/revision\/album\/v1\/(?:getTracksList|simple)\?/.test(u))page.watched.set(p.requestId,u);}),
      browser.on('Network.loadingFinished',(p,id)=>{if(id===s&&page.watched.has(p.requestId))page.finished.push(p.requestId);}),
      browser.on('Network.requestWillBeSent',(p,id)=>{const u=p.request?.url||'';if(id===s&&allowedMedia(site,u))page.media.push(u);}),
      browser.on('Page.javascriptDialogOpening',(p,id)=>{if(id===s)browser.call('Page.handleJavaScriptDialog',{accept:false},s).catch(()=>{});}),
    ];
    await browser.call('Page.enable',{},s);
    // A background tab gets throttled by Edge (clicks and list loading stall), so bring
    // it to the front and let it behave as focused.
    await browser.call('Target.activateTarget',{targetId}).catch(()=>{});
    await browser.call('Emulation.setFocusEmulationEnabled',{enabled:true},s).catch(()=>{});
    await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:muteScript},s);
    await browser.call('Network.enable',{maxTotalBufferSize:30000000,maxResourceBufferSize:10000000},s);
    return page;
  }
  go(url) {return this.browser.call('Page.navigate',{url},this.session);}
  evaluate(expression,gesture=false) {
    return this.browser.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:gesture},this.session).then(r=>r.result?.value).catch(()=>undefined);
  }
  // Parses the album responses the page loaded; keeps only list data, nothing personal.
  async drain() {
    while(this.finished.length) {
      const id=this.finished.shift(),url=new URL(this.watched.get(id));this.watched.delete(id);
      let json;try{json=JSON.parse((await this.browser.call('Network.getResponseBody',{requestId:id},this.session)).body);}catch{continue;}
      if(url.pathname.endsWith('/simple')) {this.albumTitle=String(json?.data?.albumPageMainInfo?.albumTitle||this.albumTitle);continue;}
      // ret 407 ("高优拦截端恶意请求") means Ximalaya throttles this client; remember it so
      // the caller stops and explains instead of retrying.
      if(json?.ret!==200&&json?.ret!==401) this.blocked={ret:json?.ret,msg:String(json?.msg||'').slice(0,40)};
      const data=json?.data;if(json?.ret!==200||!Array.isArray(data?.tracks)) continue;
      this.total=Number(data.trackTotalCount)||this.total;
      for(const item of data.tracks) if(item?.trackId&&!item.isVideo) this.tracks.set(String(item.trackId),trackFromList(item));
      if(url.searchParams.get('sort')==='0') this.pages.set(Number(url.searchParams.get('pageNum')),true);
    }
  }
  loginState() {
    return this.evaluate(`location.hostname.endsWith('ximalaya.com')?fetch(location.origin+'/revision/main/getCurrentUser',{credentials:'include'}).then(r=>r.json()).then(j=>({ok:true,loggedIn:Boolean(j&&j.ret===200&&j.data&&(j.data.uid||j.data.userId)),vip:Boolean(j&&j.data&&j.data.isVip)})).catch(()=>({ok:false})):({ok:false})`);
  }
  clickText(text) {
    return this.evaluate(`(()=>{const t=${JSON.stringify(String(text))};const el=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&(e.textContent||'').trim()===t&&(!/^\\d+$/.test(t)||e.closest('[class*=pagination],[class*=Pagination],[class*=pager]')));if(!el)return false;(el.closest('a,button,li')||el).click();return true;})()`,true);
  }
  async waitPage(number,ms) {
    for(const end=Date.now()+ms;Date.now()<end&&!isCancelled();) {
      await this.drain();
      if(this.blocked) throw new Error(`喜马拉雅暂时限制了访问（${this.blocked.msg||this.blocked.ret}）。这是网站的防刷机制，请过半小时左右再试，不要连续重试`);
      if(this.pages.has(number))return true;await sleep(300);
    }
    return false;
  }
  async readAlbum(albumId,{notify,timeout}) {
    const albumUrl=`https://www.ximalaya.com/album/${albumId}`;
    await this.go(albumUrl);
    let state;for(let i=0;i<20&&!(state=await this.loginState())?.ok;i++) await sleep(1000);
    if(!state?.loggedIn) {
      notify('读取喜马拉雅专辑目录需要登录。请在弹出的下载专用 Edge 里点右上角“登录”，用手机验证码或喜马拉雅 App 扫码登录（只需第一次），登录后软件自动继续。');
      for(const end=Date.now()+timeout;!state?.loggedIn;) {
        if(isCancelled()) throw new Error('下载已取消');
        if(Date.now()>end) {this.keepOpen=true;throw new Error('等待喜马拉雅登录超时，请在下载专用 Edge 登录后重试');}
        await sleep(3000);state=await this.loginState();
      }
      await this.go(albumUrl);await sleep(3000);
    }
    if(!state.vip) notify('提示：你的喜马拉雅账号目前不是会员，会员专享的单集会因为没有权限而跳过。');
    await sleep(2500);await this.drain();
    // Sort ascending so page 1 is episode 1; this also makes the page load the list itself.
    await this.clickText('正序');
    if(!await this.waitPage(1,8000)) {await this.clickText('2');await this.waitPage(2,8000);await this.clickText('1');await this.waitPage(1,8000);}
    if(!this.total) throw new Error('没有读到专辑目录，请确认专辑链接能在网页上正常打开');
    const pageSize=30,pageCount=Math.ceil(this.total/pageSize);
    let misses=0;
    for(let number=2;number<=pageCount&&this.tracks.size<this.total;number++) {
      if(isCancelled()) throw new Error('下载已取消');
      if(this.pages.has(number)) continue;
      if(number%5===0) notify(`正在读取目录：第 ${number}/${pageCount} 页`);
      // Read at a person's pace: rapid paging gets the client blocked (ret 407).
      await sleep(1500);
      if((await this.clickText(String(number)))&&await this.waitPage(number,8000)) {misses=0;continue;}
      // The list may have fallen back to newest-first; sort ascending again and retry once.
      await this.clickText('正序');await this.waitPage(1,5000);
      if((await this.clickText(String(number)))&&await this.waitPage(number,8000)) {misses=0;continue;}
      if(++misses>=3) {notify(`连续 3 页没有读到，目录只读了 ${this.tracks.size}/${this.total} 集；请把下载专用 Edge 窗口放到前台后重试`);break;}
    }
    const tracks=[...this.tracks.values()].sort((a,b)=>a.index-b.index);
    return {title:this.albumTitle||'喜马拉雅专辑',total:this.total,tracks};
  }
  // Plays one episode muted in the official player and returns the address it requests.
  async playedAddress(track) {
    this.media.length=0;
    await this.go(`https://www.ximalaya.com/sound/${track.trackId}`);
    let clicked=false;
    for(let i=0;i<30&&!clicked&&!isCancelled();i++) {
      await sleep(500);
      clicked=await this.evaluate(`(()=>{const b=[...document.querySelectorAll('[class*="play-btn"]')].find(e=>e.offsetParent!==null);if(!b)return false;b.click();return true;})()`,true);
    }
    let found=null;
    for(const end=Date.now()+15000;clicked&&!found&&Date.now()<end&&!isCancelled();) {
      found=this.media.find(address=>{const d=Number(new URL(address).searchParams.get('duration'));return !d||!track.duration||Math.abs(d-track.duration)<=3||looksLikePreview(address,track.duration);})||null;
      if(!found) await sleep(300);
    }
    await this.go('about:blank');
    return found;
  }
  // Always close our tab: a leftover same-site tab with an open dialog can freeze the
  // shared page process and stall the next run. Keep it only while a login is pending.
  async close() {
    for(const off of this.offs||[]) off();
    if(!this.keepOpen) await this.browser.closePages([this.targetId]);
    this.browser.close();
  }
}

function askLine(question) {
  return new Promise(done=>{
    const rl=readline.createInterface({input:process.stdin,output:process.stdout});let settled=false;
    const finish=value=>{if(settled)return;settled=true;rl.close();done(value);};
    rl.once('close',()=>finish(null));rl.question(question,finish);
  });
}
async function publicTrackInfo(trackId) {
  const response=await fetch(`https://m.ximalaya.com/tracks/${trackId}.json`,{headers:{'User-Agent':browserAgent},signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`喜马拉雅单集信息读取失败（${response.status}）`);
  return response.json();
}
async function exists(path) {try{return (await stat(path)).size>0;}catch{return false;}}

async function saveEpisode(track,address,albumDir,album,width) {
  const ext=new URL(address).pathname.match(/\.(m4a|mp3|aac)$/i)?.[1].toLowerCase()||'m4a';
  const job=await mkdtemp(join(albumDir,'.mengren-'));
  await writeFile(join(job,ownerFile),JSON.stringify({pid:process.pid}));
  try {
    const source=join(job,'source.'+ext);
    await fetchAudio(address,source,{site,referer});
    await checkAudio(source,track.duration);
    const tagged=join(job,'tagged.'+ext);
    const tags=['-metadata','title='+track.title,'-metadata','album='+album,...(track.anchor?['-metadata','artist='+track.anchor]:[]),...(track.index>0?['-metadata','track='+track.index]:[]),...(ext==='mp3'?['-id3v2_version','3']:[])];
    const tag=await run(join(root,'ffmpeg.exe'),['-hide_banner','-loglevel','error','-y','-i',source,'-map','0:a:0','-c','copy',...tags,tagged],{quiet:true});
    let finished=source;if(tag.code===0){try{await checkAudio(tagged,track.duration);finished=tagged;}catch{}}
    return await saveCompleted(finished,albumDir,episodeFileName(track,width,ext));
  } finally {await cleanup(job,albumDir);}
}

export async function downloadXimalaya(address,output,{probe=false,select=null,ask=askLine,timeout=600000}={}) {
  let target=xmlyTarget(address);
  if(!target) throw new Error('请粘贴喜马拉雅专辑链接、单集链接或 App 分享链接');
  if(target.short) target=await followShort(target.short);
  let page=null,album;
  try {
    if(target.album) {
      say('正在打开下载专用 Edge 读取专辑目录……');
      // A browser step that does not answer (seen while the site was throttling us) gets
      // one fresh tab before giving up.
      for(let attempt=1;;attempt++) {
        try {page=await XmlyBrowser.open();album=await page.readAlbum(target.album,{notify:say,timeout});break;}
        catch(error) {
          if(!error.method||attempt>=2||isCancelled()) throw error;
          if(page) await page.close().catch(()=>{});
          page=null;say('下载专用 Edge 一时没有响应，正在重试……');
        }
      }
    } else {
      const info=await publicTrackInfo(target.track);
      album={title:String(info.album_title||'喜马拉雅单集'),total:1,tracks:[{index:0,trackId:target.track,title:String(info.title||'音频').trim(),duration:Number(info.duration)||0,isPaid:Boolean(info.is_paid),anchor:String(info.nickname||'').trim()}]};
    }
    const tracks=album.tracks,paid=tracks.filter(t=>t.isPaid).length;
    say(`已识别：${album.title}`);
    say(`共 ${album.total} 集，读到 ${tracks.length} 集（免费 ${tracks.length-paid}，会员/付费 ${paid}）`+(tracks.length<album.total?'；有几集网页没有列出，可能已下架或仅 App 可见':''));
    if(!tracks.length) throw new Error('专辑里没有可下载的音频');
    if(probe) return {title:album.title,total:album.total,tracks:tracks.length,paid};
    const albumDir=join(resolve(output),albumFolderName(album.title));
    await mkdir(albumDir,{recursive:true});
    if(await removeAbandonedJobs(albumDir)) say('已清理上次中断留下的临时文件。');
    const width=Math.max(3,String(Math.max(...tracks.map(t=>t.index))).length);
    const already=new Set();
    for(const track of tracks) for(const ext of ['m4a','mp3','aac']) if(await exists(join(albumDir,episodeFileName(track,width,ext)))) already.add(track.trackId);
    say(`保存位置：${albumDir}`+(already.size?`（其中 ${already.size} 集以前已经下载过，会自动跳过）`:''));
    let chosen=tracks;
    if(target.album) {
      const indexes=tracks.map(t=>t.index);
      for(;;) {
        const answer=select??await ask(`请选择要下载的集数（直接回车或输入 全部 = ${tracks.length} 集；例如 1-50、100-、3,5,8）: `);
        try {const picked=new Set(parseEpisodeSelection(answer,indexes));chosen=tracks.filter(t=>picked.has(t.index));break;}
        catch(error) {if(select!=null)throw error;say(error.message);}
      }
    }
    const result={saved:[],skipped:[],failed:[]};
    for(const [position,track] of chosen.entries()) {
      if(isCancelled()) throw new Error('下载已取消');
      const label=`[${position+1}/${chosen.length}] ${track.index>0?'第 '+track.index+' 集 ':''}${track.title}`;
      if(already.has(track.trackId)) {result.skipped.push(track);say(label+'：已下载过，跳过');continue;}
      if(result.saved.length+result.failed.length) await sleep(1000); // a person's pace between episodes
      try {
        let address=null;
        if(!track.isPaid) {try{address=freeAudioUrl(await publicTrackInfo(track.trackId));}catch{}}
        if(!address) {
          if(!page) page=await XmlyBrowser.open();
          address=await page.playedAddress(track);
          if(!address) throw new Error('官方播放器没有给出这一集的音频（可能需要购买或会员已过期）');
          if(looksLikePreview(address,track.duration)) throw new Error('你的账号只能试听这一集，按规定不下载试听片段');
        }
        await saveEpisode(track,address,albumDir,album.title,width);
        result.saved.push(track);say(label+'：完成');
      } catch(error) {
        if(isCancelled()) throw new Error('下载已取消');
        result.failed.push({track,reason:error.message});say(label+'：失败，'+error.message);
      }
    }
    say(`全部处理完：成功 ${result.saved.length} 集，跳过 ${result.skipped.length} 集（以前已下载），失败 ${result.failed.length} 集。`);
    if(result.failed.length) {
      say('失败的集数：'+result.failed.map(f=>f.track.index>0?f.track.index:f.track.title).join('、')+'。可以稍后重新粘贴链接，只下这几集。');
      if(result.failed.length===chosen.length-result.skipped.length) throw new Error('这次一集都没有下载成功');
    }
    return {albumDir,...result};
  } finally {if(page) await page.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
  try {
    if(!args.includes('--url')||!args.includes('--output')||!value('--url')||!value('--output')) throw new Error('缺少链接或保存目录');
    await downloadXimalaya(value('--url'),value('--output'),{probe:args.includes('--probe'),select:args.includes('--select')?value('--select'):null});
  } catch(error) {say('未下载成功：'+(error?.message||'请重新读取链接'));process.exitCode=isCancelled()?130:1;}
}
