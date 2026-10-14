import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {isXiaoe,xiaoeAddress,channelsShare,isPlayback,allowedMedia,xiaoeProbeExpression,channelsProbeExpression,playbackProbeExpression} from '../source/sites.mjs';
import {rewritePlaylist,publicIp} from '../source/relay.mjs';
const shop='https://appfixture123.h5.xiaoeknow.com',page=shop+'/v4/course/alive/l_fixture12345?app_id=appfixture123';
const share='https://weixin.qq.com/sph/Fixture123',media='https://finder.video.qq.com/251/20302/stodownload?encfilekey=fixture';
test('Xiaoe aliases and share formats resolve to the same shop/resource',()=>{
  for(const host of ['xet.tech','xetslk.com','xetlk.com']) for(const prefix of ['s','sl']) assert.ok(isXiaoe(`https://shop.${host}/${prefix}/Fixture`));
  const params=Buffer.from(JSON.stringify({app_id:'appfixture123',resource_id:'l_fixture12345'})).toString('base64');
  assert.equal(xiaoeAddress('https://appfixture123.mp.xiaoeknow.com/?params='+encodeURIComponent(params)),page);
  assert.equal(xiaoeAddress(shop+'/content_page/'+encodeURIComponent(params)),page);
  assert.equal(xiaoeAddress(shop+'/p/t/free/v1/basic-platform/h5_basic/login/auth?redirect_url='+encodeURIComponent(page)),page);
  assert.equal(xiaoeAddress(page.replace('app_id=appfixture123','app_id=appother123')),null);
  assert.equal(xiaoeAddress(shop+'/?params='+Buffer.from(JSON.stringify({app_id:'appfixture123',h5_url:page.replace('appfixture123','appother123')})).toString('base64')),null);
  for(const bad of ['http://shop.xet.tech/s/X','https://xet.tech.evil.org/sl/X','https://user:pass@shop.xet.tech/s/X']) assert.equal(isXiaoe(bad),false);
});
test('Channels accepts only share links and official playback/media destinations',()=>{
  assert.equal(channelsShare(share),share);
  assert.equal(channelsShare('https://channels.weixin.qq.com/finder-preview/pages/sph?id=Fixture123'),share);
  for(const bad of [share+'?token=x',share+'#x',share.replace('weixin.qq.com','weixin.qq.com.evil.org'),share.replace('https:','http:')]) assert.equal(channelsShare(bad),null);
  assert.ok(isPlayback('https://channels.weixin.qq.com/finder-preview/pages/feed?token=fixture&eid=fixture'));
  assert.ok(allowedMedia('channels',media));
  for(const bad of [media.replace('finder.video.qq.com','evil.org'),media+'#x',media.replace('https:','http:'),media.replace('/251/20302/stodownload','/other')]) assert.equal(allowedMedia('channels',bad),false);
  assert.ok(allowedMedia('xiaoe','https://media.xet.tech/video.m3u8'));
  assert.equal(allowedMedia('xiaoe','https://127.0.0.1/video.m3u8'),false);
});
test('HLS nested manifests, AES keys and relative segments are rewritten',()=>{
  const inputs=[];
  const source='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/index"\n#EXT-X-KEY:METHOD=AES-128,URI="key?fixture=1"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvideo/index\n';
  const rewritten=rewritePlaylist(source,'https://media.xet.tech/folder/master.m3u8',(url,playlist)=>{inputs.push({url,playlist});return 'http://127.0.0.1:1234/fixture/'+inputs.length;});
  assert.equal(inputs.length,3);assert.equal(inputs[0].playlist,true);assert.equal(inputs[1].playlist,false);assert.equal(inputs[2].playlist,true);
  assert.equal(inputs[1].url,'https://media.xet.tech/folder/key?fixture=1');assert.equal(rewritten.includes('fixture=1'),false);
  for(const unsupported of ['#EXTM3U\n#EXT-X-DEFINE:NAME="x",VALUE="y"','#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"','#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=key']) assert.throws(()=>rewritePlaylist(unsupported,'https://media.xet.tech/x.m3u8',()=>''));
  assert.throws(()=>rewritePlaylist('#EXTM3U\nhttps://127.0.0.1/key','https://media.xet.tech/x.m3u8',url=>{if(!allowedMedia('xiaoe',url)) throw Error('refused');return url;}));
});
test('Private, loopback and reserved media addresses are refused',()=>{
  for(const value of ['127.0.0.1','10.0.0.1','169.254.1.1','192.168.1.1','172.16.1.1','100.64.1.1','::1','fe80::1','fc00::1','::ffff:127.0.0.1']) assert.equal(publicIp(value),false,value);
  // Clash/Mihomo TUN fake-ip answers (198.18.0.0/15) must stay usable.
  for(const value of ['8.8.8.8','1.1.1.1','240e::1','198.18.0.5','198.19.255.1']) assert.equal(publicIp(value),true,value);
});
async function evaluate(expression,origin,respond) {
  const calls=[];
  const context={location:{origin,href:origin},document:{title:'Fixture'},URL,AbortSignal,fetch:async(url,options)=>{calls.push({url,options});return respond(url,options);}};
  const result=await vm.runInNewContext(expression,context);return {result,calls};
}
test('Login remains on Yuanbao, only selected share is posted and no chat is created',async()=>{
  const {result,calls}=await evaluate(channelsProbeExpression(share),'https://yuanbao.tencent.com',()=>({status:401}));
  assert.equal(result.state,'login');assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/weixin/get_parse_result');assert.equal(calls[0].options.credentials,'same-origin');
  assert.deepEqual(JSON.parse(calls[0].options.body),{type:'video_channel_url',url:share,scene:1});
  const foreign=await evaluate(channelsProbeExpression(share),'https://evil.org',()=>{throw Error('should not fetch');});assert.equal(foreign.calls.length,0);
});
test('Xiaoe login is used only on exact shop origin; no cookie data is read',async()=>{
  const denied=await evaluate(xiaoeProbeExpression(page),shop,()=>({ok:true,json:async()=>({code:11302})}));assert.equal(denied.result.state,'login');assert.equal(denied.calls[0].options.credentials,'include');
  const foreign=await evaluate(xiaoeProbeExpression(page),'https://evil.org',()=>{throw Error('should not fetch');});assert.equal(foreign.calls.length,0);
});
test('Official playback API does not forward Yuanbao login',async()=>{
  const calls=[];const href='https://channels.weixin.qq.com/finder-preview/pages/feed?token=fixture&eid=fixture-id';
  const answer=await vm.runInNewContext(playbackProbeExpression,{location:{href},document:{title:'Fixture'},URL,AbortSignal,fetch:async(url,options)=>{calls.push({url,options});return {json:async()=>({errCode:0,data:{errMsg:{type:0},feedInfo:{description:'Fixture',h264VideoInfo:{videoUrl:media}}}})};}});
  assert.equal(answer.state,'ready');assert.equal(answer.mediaUrl,media);assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].url,'/finder-preview/api/feed/get_feed_info');
});

test('A real silent MP4 is valid, while a non-video file is rejected',async()=>{
  const {mkdtemp,writeFile,unlink,rmdir}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');const {spawn}=await import('node:child_process');
  const {validate}=await import('../source/site-download.mjs');
  const folder=await mkdtemp(join(tmpdir(),'mengren-video-test-')),video=join(folder,'silent.mp4'),bad=join(folder,'invalid.txt');
  try {
    const code=await new Promise(done=>{const child=spawn(resolve('ffmpeg.exe'),['-v','error','-f','lavfi','-i','color=c=black:s=64x64:r=1','-t','1','-an',video],{stdio:'ignore',windowsHide:true});child.on('close',done);child.on('error',()=>done(-1));});
    assert.equal(code,0);await validate(video);await assert.rejects(validate(video,{requireAudio:true}));
    await writeFile(bad,'Not a media file');await assert.rejects(validate(bad));
  } finally {await unlink(video).catch(()=>{});await unlink(bad).catch(()=>{});await rmdir(folder);}
});

test('Douyin and Bilibili normalise page/short links and reject cross-item tracks',async()=>{
  const {douyinAddress,biliAddress,browserMediaAllowed}=await import('../source/sites.mjs');
  assert.equal(douyinAddress('https://www.douyin.com/?modal_id=123456'),'https://www.douyin.com/video/123456');
  assert.equal(douyinAddress('https://v.douyin.com/Fixture/'),'https://v.douyin.com/Fixture/');
  assert.equal(biliAddress('https://m.bilibili.com/video/BV1vL411G7N7/?p=2&share_source=copy'),'https://www.bilibili.com/video/BV1vL411G7N7?p=2');
  assert.equal(biliAddress('https://b23.tv/Fixture'),'https://b23.tv/Fixture');
  assert.equal(biliAddress('https://www.bilibili.com/video/BV1vL411G7N7?p=-1'),null);
  for(const bad of ['https://douyin.com.evil.org/video/123','https://user:pass@www.douyin.com/video/123'])assert.equal(douyinAddress(bad),null);
  assert.ok(browserMediaAllowed('douyin','https://www.douyin.com/video/123','https://v1.douyinvod.com/video.mp4?__vid=123'));
  assert.equal(browserMediaAllowed('douyin','https://www.douyin.com/video/123','https://v1.douyinvod.com/video.mp4?__vid=456'),false);
  assert.ok(browserMediaAllowed('bili','https://www.bilibili.com/video/BV1vL411G7N7','https://upos.bilivideo.com/video.m4s'));
  assert.equal(browserMediaAllowed('bili','https://www.bilibili.com/video/BV1vL411G7N7','https://evil.org/video.m4s'),false);
});
test('Bilibili browser fallback honours current part, quality cap and separate audio',async()=>{
  const {biliProbeExpression}=await import('../source/sites.mjs');
  const href='https://www.bilibili.com/video/BV1vL411G7N7';
  const context={location:{href},URL,AbortSignal,document:{title:'Fixture'},window:{__INITIAL_STATE__:{videoData:{bvid:'BV1vL411G7N7',title:'Fixture',pages:[{cid:1}]}},__playinfo__:{data:{timelength:20000,dash:{video:[{height:1080,bandwidth:500,baseUrl:'https://upos.bilivideo.com/1080.m4s'},{height:720,bandwidth:300,baseUrl:'https://upos.bilivideo.com/720.m4s'}],audio:[{bandwidth:128,baseUrl:'https://upos.bilivideo.com/audio.m4s'}]}}}}};
  const info=await vm.runInNewContext(biliProbeExpression(href,'720'),context);
  assert.equal(info.state,'ready');assert.equal(info.height,720);assert.equal(info.mediaUrl,'https://upos.bilivideo.com/720.m4s');assert.equal(info.audioUrl,'https://upos.bilivideo.com/audio.m4s');
  const capped=await vm.runInNewContext(biliProbeExpression(href,'480'),context);assert.equal(capped.state,'quality-unavailable');
  context.window.__playinfo__.data.durl=[{url:'https://upos.bilivideo.com/1080.mp4'}];context.window.__playinfo__.data.quality=80;
  const noUpsize=await vm.runInNewContext(biliProbeExpression(href,'480'),context);assert.equal(noUpsize.state,'quality-unavailable');
  context.location.href=href+'?p=2';const wrong=await vm.runInNewContext(biliProbeExpression(href,'720'),context);assert.equal(wrong.state,'loading');
});

test('Abandoned download folders are removed only when their owner has exited',async()=>{
  const {mkdtemp,mkdir,writeFile,readdir,utimes,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {spawnSync}=await import('node:child_process');
  const {removeAbandonedJobs}=await import('../source/site-download.mjs');
  const output=await mkdtemp(join(tmpdir(),'mengren-stale-test-'));
  try {
    const exited=spawnSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{encoding:'utf8'});const deadPid=Number(exited.stdout);
    const make=async(name,owner)=>{const job=join(output,name);await mkdir(job);await writeFile(join(job,'source.part'),'partial');if(owner!==undefined)await writeFile(join(job,'.owner'),JSON.stringify({pid:owner}));return job;};
    await make('.mengren-Dead01',deadPid);await make('.mengren-Live01',process.pid);await make('.mengren-New001');
    const old=await make('.mengren-Old001');const day=new Date(Date.now()-2*86400000);await utimes(old,day,day);
    await make('.mengren-keep-user-folder',deadPid);await make('课程视频',deadPid);
    const nested=await make('.mengren-Nest01',deadPid);await mkdir(join(nested,'inner'));
    assert.equal(await removeAbandonedJobs(output),2);
    assert.deepEqual((await readdir(output)).sort(),['.mengren-Live01','.mengren-Nest01','.mengren-New001','.mengren-keep-user-folder','课程视频'].sort());
  } finally {await rm(output,{recursive:true,force:true});}
});

test('Finished downloads close only the tabs they opened and keep the Edge window',async()=>{
  const {Cdp}=await import('../source/browser.mjs');
  let pages=[{targetId:'user',type:'page'},{targetId:'a',type:'page'},{targetId:'b',type:'page'}];const calls=[];
  const fake=Object.create(Cdp.prototype);
  fake.call=async(method,params,sessionId)=>{calls.push([method,params?.targetId||params?.url,sessionId]);if(method==='Target.getTargets')return {targetInfos:pages};if(method==='Target.closeTarget')pages=pages.filter(p=>p.targetId!==params.targetId);if(method==='Target.attachToTarget')return {sessionId:'s-'+params.targetId};return {};};
  await fake.closePages(['a','b','gone']);
  assert.deepEqual(pages.map(p=>p.targetId),['user']);
  pages=[{targetId:'only',type:'page'}];calls.length=0;await fake.closePages(['only']);
  assert.deepEqual(pages.map(p=>p.targetId),['only']);assert.ok(calls.some(([m,u,s])=>m==='Page.navigate'&&u==='about:blank'&&s==='s-only'));
});

test('QQ Music accepts single-song pages and share links only',async()=>{
  const {qqSong}=await import('../source/qqmusic.mjs');
  for(const link of ['https://y.qq.com/n/ryqq/songDetail/004Ti8rT003TaZ','https://y.qq.com/n/ryqq_v2/songDetail/004Ti8rT003TaZ?ADTAG=x','http://y.qq.com/n/yqq/song/004Ti8rT003TaZ.html','https://i.y.qq.com/v8/playsong.html?songmid=004Ti8rT003TaZ&ADTAG=share'])
    assert.deepEqual(qqSong(link),{mid:'004Ti8rT003TaZ'},link);
  assert.deepEqual(qqSong('https://i.y.qq.com/v8/playsong.html?songid=102065756'),{songId:'102065756'});
  assert.deepEqual(qqSong('https://c6.y.qq.com/base/fcgi-bin/u?__=Fixture12'),{short:'https://c6.y.qq.com/base/fcgi-bin/u?__=Fixture12'});
  for(const bad of ['https://y.qq.com.evil.org/n/ryqq/songDetail/004Ti8rT003TaZ','https://user:pass@y.qq.com/n/ryqq/songDetail/004Ti8rT003TaZ','https://y.qq.com/n/ryqq/playlist/123','https://y.qq.com/n/ryqq/songDetail/bad!','https://i.y.qq.com/v8/playsong.html?songid=x1'])
    assert.equal(qqSong(bad),null,bad);
});
test('QQ Music keeps only plain full-song files on official audio servers, best first',async()=>{
  const {playableFormats,trackInfo}=await import('../source/qqmusic.mjs');
  const mid='004Ti8rT003TaZ',media='0013Waho393WaG',item=(filename,purl,extra={})=>({songmid:mid,filename,purl,...extra});
  const data={req_1:{code:0,data:{midurlinfo:[
    item('F000'+media+'.flac','F000'+media+'.flac?vkey=x',{ekey:'encrypted'}),
    item('M800'+media+'.mp3',''),
    item('C400'+media+'.m4a','C400'+media+'.m4a?vkey=x'),
    item('M500'+media+'.mp3','M500'+media+'.mp3?vkey=x'),
    {songmid:'other',filename:'C200'+media+'.m4a',purl:'C200'+media+'.m4a?vkey=x'}]}}};
  const list=playableFormats(data,mid,media);
  assert.deepEqual(list.map(f=>f.label),['128k MP3','96k M4A']);
  assert.ok(list.every(f=>new URL(f.url).hostname==='dl.stream.qqmusic.qq.com'));
  assert.deepEqual(playableFormats({req_1:{code:0,data:{midurlinfo:[item('M500'+media+'.mp3','/evil.org/M500'+media+'.mp3')]}}},mid,media),[]);
  assert.deepEqual(playableFormats({req_1:{code:1000,data:{midurlinfo:[item('M500'+media+'.mp3','M500'+media+'.mp3?x')]}}},mid,media),[]);
  assert.ok(allowedMedia('qqmusic','https://ws.stream.qqmusic.qq.com/M500'+media+'.mp3?vkey=x'));
  for(const bad of ['https://evil.org/M500'+media+'.mp3','https://dl.stream.qqmusic.qq.com/RS02'+media+'.mp3','https://dl.stream.qqmusic.qq.com/O600'+media+'.mflac','http://dl.stream.qqmusic.qq.com/M500'+media+'.mp3'])
    assert.equal(allowedMedia('qqmusic',bad),false,bad);
  const detail={code:0,info:{code:0,data:{track_info:{mid,id:1,title:' 歌名 ',interval:281,singer:[{name:'甲'},{name:'乙'}],album:{title:'专辑'},file:{media_mid:media,size_320mp3:10792943}}}}};
  assert.deepEqual(trackInfo(detail,{mid}),{mid,media,title:'歌名',singers:['甲','乙'],album:'专辑',seconds:281,sizes:{F000:0,M800:10792943,M500:0,C400:0,C200:0}});
  assert.equal(trackInfo(detail,{mid:'0039MnYb0qxYhV'}),null);
});
test('QQ Music browser read uses the page login without touching cookies or storage',async()=>{
  const {qqBrowserExpression,vkeyPayload}=await import('../source/qqmusic.mjs');
  const payload=vkeyPayload('004Ti8rT003TaZ','0013Waho393WaG','1234567890'),expression=qqBrowserExpression(payload);
  assert.doesNotMatch(expression,/cookie|localStorage|sessionStorage|uin/i);
  const run=(hostname,loggedOut)=>{const calls=[];const link={textContent:'登录',offsetParent:loggedOut?{}:null};
    const context={location:{hostname},AbortSignal,document:{querySelector:()=>({querySelectorAll:()=>[link]})},fetch:async(url,options)=>{calls.push({url,options});return {json:async()=>({req_1:{code:0,data:{midurlinfo:[{songmid:'004Ti8rT003TaZ',filename:'x',purl:'x',ekey:'secret',vkey:'secret'}]}}})};}};
    return vm.runInNewContext(expression,context).then(result=>({result,calls}));};
  const out=await run('y.qq.com',true);assert.equal(out.result.loggedIn,false);
  const ok=await run('y.qq.com',false);assert.equal(ok.result.loggedIn,true);
  assert.equal(ok.calls[0].url,'https://u.y.qq.com/cgi-bin/musicu.fcg');assert.equal(ok.calls[0].options.credentials,'include');
  assert.deepEqual(JSON.parse(ok.calls[0].options.body),payload);
  assert.deepEqual(Object.keys(ok.result.data.req_1.data.midurlinfo[0]).sort(),['ekey','filename','purl','songmid']);assert.equal(ok.result.data.req_1.data.midurlinfo[0].ekey,true);
  const foreign=await run('evil.org',false);assert.equal(foreign.result.state,'loading');assert.equal(foreign.calls.length,0);
});
test('QQ Music lyrics, file names and duplicate audio files',async()=>{
  const {lyricText,audioFileName}=await import('../source/qqmusic.mjs');
  const {saveCompleted}=await import('../source/site-download.mjs');
  const encode=text=>Buffer.from(text).toString('base64');
  assert.equal(lyricText({req_2:{code:0,data:{lyric:encode('[ti:x]\n[00:01.27]It&apos;s &amp; ok&#58;')}}}),"[ti:x]\r\n[00:01.27]It's & ok:");
  assert.equal(lyricText({req_2:{code:0,data:{lyric:encode('此歌曲为没有填词的纯音乐，请您欣赏')}}}),null);
  assert.equal(audioFileName({title:'A/B: C?',singers:['甲','乙']},'mp3'),'A B  C  - 甲、乙.mp3');
  const {mkdtemp,writeFile,readdir,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const folder=await mkdtemp(join(tmpdir(),'mengren-audio-test-'));
  try {
    const source=join(folder,'source.mp3');await writeFile(source,'fixture');await writeFile(join(folder,'歌 - 手.mp3'),'existing');
    assert.equal(await saveCompleted(source,folder,'歌 - 手.mp3'),join(folder,'歌 - 手 (2).mp3'));
    assert.ok((await readdir(folder)).includes('歌 - 手.mp3'));
  } finally {await rm(folder,{recursive:true,force:true});}
});
test('A preview clip is never accepted as the full song',async()=>{
  const {checkAudio}=await import('../source/qqmusic.mjs');
  const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');const {spawn}=await import('node:child_process');
  const folder=await mkdtemp(join(tmpdir(),'mengren-audio-test-')),clip=join(folder,'clip.mp3');
  try {
    const code=await new Promise(done=>{const child=spawn(resolve('ffmpeg.exe'),['-v','error','-f','lavfi','-i','sine=frequency=440:duration=6','-c:a','libmp3lame','-b:a','64k',clip],{stdio:'ignore',windowsHide:true});child.on('close',done);child.on('error',()=>done(-1));});
    assert.equal(code,0);
    assert.ok(Math.abs(await checkAudio(clip,6)-6)<0.5);
    await assert.rejects(checkAudio(clip,60),/片段/);
  } finally {await rm(folder,{recursive:true,force:true});}
});
test('QQ Music ranged download reassembles exact bytes, retries a bad range and rejects wrong ranges',async()=>{
  const {fetchAudio}=await import('../source/qqmusic.mjs');
  const {Readable}=await import('node:stream');const {mkdtemp,readFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const body=Buffer.from(Array.from({length:10000},(_,i)=>i*7%251));let flaky=true;
  const server=(lie=false)=>async(site,url,referer,range)=>{
    assert.equal(site,'qqmusic');assert.equal(referer,'https://y.qq.com/');
    const [from,to]=range.match(/^bytes=(\d+)-(\d+)$/).slice(1).map(Number);
    if(from===3000&&flaky){flaky=false;return {response:Object.assign(Readable.from([body.subarray(from,from+5)]),{statusCode:206,headers:{'content-range':`bytes ${from}-${to}/${body.length}`}})};}
    return {response:Object.assign(Readable.from([body.subarray(from,to+1)]),{statusCode:206,headers:{'content-range':`bytes ${lie&&from?from+1:from}-${to}/${body.length}`}})};
  };
  const folder=await mkdtemp(join(tmpdir(),'mengren-audio-test-'));
  try {
    const file=join(folder,'a.mp3');
    assert.equal(await fetchAudio('https://dl.stream.qqmusic.qq.com/x',file,{workers:3,chunk:1000,get:server()}),body.length);
    assert.ok((await readFile(file)).equals(body));assert.equal(flaky,false);
    await assert.rejects(fetchAudio('https://dl.stream.qqmusic.qq.com/x',join(folder,'b.mp3'),{workers:2,chunk:1000,get:server(true)}),/不完整/);
  } finally {await rm(folder,{recursive:true,force:true});}
});
test('QQ Music lists every quality with size and lets the user pick; Enter picks the best MP3',async()=>{
  const {qqFormats,formatMenu,chooseFormat,defaultFormat}=await import('../source/qqmusic.mjs');
  const all=qqFormats.map(f=>({...f,url:'x'})),sizes={F000:55397039,M800:10792943,M500:4317292,C400:0,C200:1642440};
  const menu=formatMenu(all,sizes);
  assert.equal(menu.length,5);assert.match(menu[0],/无损 FLAC.*52\.8MB.*不支持/);assert.match(menu[1],/320k MP3.*10\.3MB.*← 默认/);assert.match(menu[3],/大小未知/);
  assert.equal(defaultFormat(all),1);assert.equal(defaultFormat(all.filter(f=>f.ext!=='mp3')),0);
  const answers=list=>{const queue=[...list];return async()=>queue.length?queue.shift():null;};
  const log=console.log;console.log=()=>{};
  try {
    assert.equal((await chooseFormat(all,sizes,answers(['']))).prefix,'M800');
    assert.equal((await chooseFormat(all,sizes,answers(['9','abc',' 3 ']))).prefix,'M500');
    assert.equal((await chooseFormat(all,sizes,answers(['1']))).prefix,'F000');
    assert.equal((await chooseFormat(all,sizes,answers([]))).prefix,'M800');
  } finally {console.log=log;}
});
