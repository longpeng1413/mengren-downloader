import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {extractLink,classify,parseLine,compressSelection,addHistory} from '../source/gui-core.mjs';
import {pickRelease,expectedHash,compareVersions,githubHost,connectionFor} from '../source/updater.mjs';
import {runCaptureGui,manualTitle} from '../source/capture-menu.mjs';
import {readListing} from '../source/ximalaya.mjs';
import {qqListing} from '../source/qqmusic.mjs';

test('Links are found in share text and sorted to the right downloader',()=>{
  assert.equal(extractLink('【喜马拉雅】生命的真相 https://xima.tv/1_CbQXmk 快来听吧'),'https://xima.tv/1_CbQXmk');
  assert.equal(extractLink('看看这个 https://b23.tv/AbCd12。'),'https://b23.tv/AbCd12');
  assert.equal(extractLink('https://example.com/video/1'),'https://example.com/video/1');
  assert.equal(extractLink('没有链接'),null);
  assert.equal(extractLink('https://evil.example/x 和 https://www.bilibili.com/video/BV1x'),'https://www.bilibili.com/video/BV1x');
  assert.equal(classify('https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV').kind,'qq');
  assert.equal(classify('https://www.ximalaya.com/album/123').kind,'xmly');
  assert.equal(classify('https://xima.tv/abcd').kind,'xmly');
  assert.deepEqual([classify('https://youtu.be/x').site,classify('https://youtu.be/x').quality],['YouTube',true]);
  assert.equal(classify('https://x.com/a/status/1').site,'X');
  assert.equal(classify('https://v.douyin.com/abc/').site,'抖音');
  assert.equal(classify('https://channels.weixin.qq.com/x').site,'视频号');
  assert.equal(classify('https://appabc.xet.tech/p/course').site,'小鹅通');
  assert.equal(classify('https://notyoutube.com/x').site,'其他网站');
  assert.equal(classify('ftp://x.com/a'),null);
});

test('Downloader output turns into progress, titles, files and plain failures',()=>{
  assert.deepEqual(parseLine('[download]  23.5% of  245.10MiB at    5.12MiB/s ETA 00:36').progress,{percent:23.5,size:'245.10MiB',speed:'5.12MiB/s'});
  assert.deepEqual(parseLine('[download]  12.0% of ~ 300.00MiB at 3.00MiB/s ETA 01:00 (frag 12/100)').progress,{percent:12,size:'300.00MiB',speed:'3.00MiB/s'});
  assert.equal(parseLine('[download]  45.1% of 10.30MiB at 812KiB/s').progress.speed,'812KiB/s');
  assert.equal(parseLine('[download] Destination: C:\\Temp\\.mengren-abcdef\\Me at the zoo.f395.mp4').title,'Me at the zoo');
  assert.equal(parseLine('已识别：晴天 - 周杰伦').title,'晴天 - 周杰伦');
  assert.equal(parseLine('下载完成：D:\\下载\\晴天 - 周杰伦.mp3（320k MP3）').saved,'D:\\下载\\晴天 - 周杰伦.mp3（320k MP3）');
  assert.equal(parseLine('保存位置：D:\\下载\\专辑（其中 2 集以前已经下载过，会自动跳过）').folder,'D:\\下载\\专辑');
  assert.deepEqual(parseLine('[3/50] 第 3 集 心安：完成').episode,{n:3,total:50,label:'第 3 集 心安',status:'ok',reason:null});
  assert.equal(parseLine('[4/50] 第 4 集 x：失败，你的账号只能试听这一集').episode.reason,'你的账号只能试听这一集');
  assert.equal(parseLine('[5/50] 第 5 集 x：已下载过，跳过').episode.status,'skip');
  assert.equal(parseLine('未下载成功：网站拒绝 https://cdn.example/a.mp4?sign=1').failure,'网站拒绝 [地址]');
  assert.equal(parseLine('ERROR: [youtube] abc: Sign in to confirm you’re not a bot').error,'Sign in to confirm you’re not a bot');
  assert.deepEqual(parseLine('@@mengren {"type":"qq","title":"晴天"}').event,{type:'qq',title:'晴天'});
  assert.equal(parseLine('[youtube] Extracting URL: https://x'),null);
  assert.equal(parseLine('请在下载专用 Edge 登录 https://x.com/login').note,'请在下载专用 Edge 登录 [地址]');
  assert.equal(parseLine('   '),null);
});

test('Episode choices are sent as short ranges and history keeps 300 records',()=>{
  assert.equal(compressSelection([5,1,2,3,8,9,3]),'1-3,5,8-9');
  assert.equal(compressSelection([7]),'7');
  const list=[];for(let i=0;i<305;i++)addHistory(list,{id:i});
  assert.equal(list.length,300);assert.equal(list[0].id,304);
});

test('Updates pick the newest release with the full package, previews only for previews',()=>{
  const asset=v=>[{name:`mengren-downloader-${v}-windows-x64-full.zip`,size:10,browser_download_url:`https://github.com/x/${v}.zip`},{name:'SHA256SUMS-full.txt',size:1,browser_download_url:'https://github.com/x/sums'}];
  const releases=[
    {tag_name:'v1.1.0',prerelease:true,assets:asset('1.1.0')},
    {tag_name:'v1.0.1',draft:true,assets:asset('1.0.1')},
    {tag_name:'v1.0.0',assets:asset('1.0.0')},
    {tag_name:'v0.9.5',assets:[]},
    {tag_name:'v0.8.0',assets:asset('0.8.0')},
  ];
  assert.equal(pickRelease(releases,'0.9.0').version,'1.0.0');
  assert.equal(pickRelease(releases,'0.9.0',{preview:true}).version,'1.1.0');
  assert.equal(pickRelease(releases,'1.0.0'),null);
  assert.equal(pickRelease([{tag_name:'v2.0.0',assets:[asset('2.0.0')[0]]}],'1.0.0'),null);
  assert.equal(compareVersions('v0.10.0','0.9.9'),1);assert.equal(compareVersions('1.0.0','1.0.0'),0);
  const hash='a'.repeat(64);
  assert.equal(expectedHash(`${hash}  mengren-downloader-1.0.0-windows-x64-full.zip\n`,'mengren-downloader-1.0.0-windows-x64-full.zip'),hash);
  assert.equal(expectedHash(`${hash}  other.zip\n`,'mengren-downloader-1.0.0-windows-x64-full.zip'),null);
  // Through the proxy the request must still say Host: github.com, not github.com:80.
  const proxied=connectionFor(new URL('https://github.com/a/b'),{host:'127.0.0.1',port:7897});
  assert.equal(proxied.defaultPort,443);assert.equal(typeof proxied.createConnection,'function');
  assert.deepEqual(connectionFor(new URL('https://github.com/a/b'),null),{});
  assert.ok(githubHost('objects.githubusercontent.com'));assert.ok(!githubHost('github.com.evil.example'));assert.ok(!githubHost('evilgithub.com'));
});

test('Capture commands from the window keep the same name and selection rules',async()=>{
  const items=[{id:1,kind:'video',title:'1. 第一课'},{id:2,kind:'hls',title:''},{id:3,kind:'track',title:'音频'}];
  const catalog={items,clear(){items.length=0;}};
  const commands=[{cmd:'rename',id:2,title:'全部'},{cmd:'rename',id:2,title:'第二课'},{cmd:'order',id:2,order:13},{cmd:'download',ids:[1,2,3]},{cmd:'download',ids:[1]}];
  const events=[],downloaded=[];let release;
  const finished=new Promise(r=>release=r);
  await runCaptureGui({catalog,emit:e=>events.push(e),download:async item=>{downloaded.push(item.id);if(downloaded.length===2)release();return {file:'C:\\x\\'+item.title+'.mp4'};},
    next:async()=>commands.length?commands.shift():(await finished,null)});
  assert.deepEqual(downloaded,[1,2]);
  assert.equal(items[1].title,'第二课');assert.equal(items[1].courseOrder,13);assert.equal(items[1].orderSource,'manual');
  assert.ok(events.some(e=>e.type==='notice'&&e.text.includes('名称没有修改')));
  assert.ok(events.some(e=>e.type==='notice'&&e.text.includes('不会重复下载')));
  assert.equal(events.filter(e=>e.type==='capture-done'&&e.ok).length,2);
  assert.equal(manualTitle('下载全部'),null);assert.equal(manualTitle('https://x.com'),null);
});

test('Saved album lists are checked before use and quality lists carry no addresses',()=>{
  const list=readListing(JSON.stringify({title:'专辑',total:3,tracks:[{index:1,trackId:'123',title:'一',duration:60},{index:2,trackId:'../x',title:'坏'}]}));
  assert.equal(list.tracks.length,1);assert.equal(list.tracks[0].trackId,'123');
  assert.throws(()=>readListing('{"tracks":[]}'),/已失效/);
  const listing=qqListing({title:'晴天',singers:['周杰伦'],album:'叶惠美',seconds:269,sizes:{M800:10}},[{prefix:'M800',label:'320k MP3',ext:'mp3',note:'n',url:'https://dl.stream.qqmusic.qq.com/M800x.mp3?vkey=secret'}]);
  assert.equal(JSON.stringify(listing).includes('vkey'),false);assert.equal(listing.default,'M800');
});

test('The window server answers only its own page with the per-run token',async t=>{
  const home=await mkdtemp(join(tmpdir(),'mengren-gui-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  await mkdir(join(home,'Gui'),{recursive:true});
  await writeFile(join(home,'Gui','settings.json'),JSON.stringify({saveDir:join(home,'save'),checkUpdates:false}));
  const child=spawn(process.execPath,[resolve('source/gui-server.mjs')],{env:{...process.env,MENGREN_GUI_HOME:home,MENGREN_GUI_NO_WINDOW:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  t.after(()=>child.kill());
  const first=await new Promise((done,reject)=>{child.stdout.once('data',d=>done(String(d)));setTimeout(()=>reject(new Error('server did not start')),20000);});
  assert.match(first,/^ready/);
  const {port,token}=JSON.parse(await readFile(join(home,'Gui','instance.json'),'utf8'));
  const base=`http://127.0.0.1:${port}`;
  assert.equal((await fetch(base+'/')).status,200);
  assert.equal((await fetch(base+'/api/storage')).status,401);
  assert.equal((await fetch(base+'/api/storage',{headers:{'x-mengren-token':'0'.repeat(48)}})).status,401);
  assert.equal((await fetch(base+'/source/gui-server.mjs')).status,404);
  assert.equal((await fetch(base+'/?token=wrong',{redirect:'manual'})).status,403);
  const login=await fetch(base+'/?token='+token,{redirect:'manual'});
  assert.equal(login.status,302);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  assert.equal((await fetch(base+'/api/storage',{headers:{cookie}})).status,200);
  // A second double-click asks this to decide between showing the open window and opening one.
  assert.deepEqual(await (await fetch(base+'/api/ping',{headers:{cookie}})).json(),{ok:true,windows:0});
  // Other web pages cannot drive it: a foreign Origin or a form post is refused.
  const post=(headers,body='{"what":"logs"}')=>fetch(base+'/api/clean',{method:'POST',headers:{cookie,...headers},body});
  assert.equal((await post({'content-type':'application/json',origin:'https://evil.example'})).status,403);
  assert.equal((await post({'content-type':'text/plain',origin:base})).status,403);
  assert.equal((await post({'content-type':'application/json',origin:base})).status,200);
  const answer=await (await fetch(base+'/api/recognize',{method:'POST',headers:{cookie,'content-type':'application/json',origin:base},body:JSON.stringify({text:'https://www.youtube.com/watch?v=jNQXAC9IVRw'})})).json();
  assert.equal(answer.kind,'video');assert.equal(answer.status,'done');
  const missing=await (await fetch(base+'/api/enqueue',{method:'POST',headers:{cookie,'content-type':'application/json',origin:base},body:JSON.stringify({rid:'nope'})})).json();
  assert.match(missing.error,/重新点“识别”/);
});
