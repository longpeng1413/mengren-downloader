import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {existsSync,readFileSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {readFile,writeFile,readdir,stat,rm,unlink,rename,appendFile,mkdir,copyFile} from 'node:fs/promises';
import {join,resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {version,preview} from './version.mjs';
import {checkUpdate,downloadUpdate,releasePage,compareVersions,packageName} from './updater.mjs';
import {extractLink,classify,parseLine,compressSelection,addHistory,redact,qualityLabels} from './gui-core.mjs';
import {removeAbandonedJobs} from './site-download.mjs';

// The window version: a local web page shown in an Edge app window, served only on
// 127.0.0.1 with a random per-run token. Downloads still run through download.ps1 and
// the existing node scripts (one at a time); this file queues them and shows progress.

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const base=join(process.env.LOCALAPPDATA||root,'MengrenDownloader');
// Tests point the window's own data at a temporary folder and skip opening Edge.
const home=process.env.MENGREN_GUI_HOME||base,headless=process.env.MENGREN_GUI_NO_WINDOW==='1';
const dirs={gui:join(home,'Gui'),logs:join(home,'Gui','logs'),lists:join(home,'Gui','lists'),updates:join(home,'Updates'),app:join(home,'AppWindow'),browser:join(base,'BrowserProfile')};
const files={settings:join(dirs.gui,'settings.json'),history:join(dirs.gui,'history.json'),instance:join(dirs.gui,'instance.json'),log:join(dirs.logs,'gui.log'),updateResult:join(dirs.updates,'result.json')};
const powershell=join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const node=process.execPath;
// A git checkout is a developer copy: it may check for updates but never overwrites itself.
const devCopy=existsSync(join(root,'.git'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
process.stdout.on('error',()=>{});process.stderr.on('error',()=>{});

/* ---------- files, log ---------- */
function readJson(file,fallback) {try{return JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return fallback;}}
async function writeJson(file,value) {const part=file+'.'+process.pid+'.tmp';await writeFile(part,JSON.stringify(value));await rename(part,file);}
let logChain=Promise.resolve();
// gui.log plus three older copies, 2 MB each; addresses are replaced by [地址].
function log(text) {
  logChain=logChain.then(async()=>{
    const size=(await stat(files.log).catch(()=>null))?.size||0;
    if(size>2*1048576) {
      await unlink(files.log+'.3').catch(()=>{});
      for(const n of [2,1]) await rename(files.log+'.'+n,files.log+'.'+(n+1)).catch(()=>{});
      await rename(files.log,files.log+'.1').catch(()=>{});
    }
    const now=new Date(),local=new Date(now-now.getTimezoneOffset()*60000).toISOString().slice(0,19).replace('T',' ');
    await appendFile(files.log,local+' '+redact(text)+'\r\n');
  }).catch(()=>{});
}

/* ---------- settings, history ---------- */
function downloadsFolder() {
  const out=spawnSync('reg',['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders','/v','{374DE290-123F-4565-9164-39C4925E467B}'],{encoding:'utf8',windowsHide:true}).stdout||'';
  const value=out.match(/REG_(?:EXPAND_)?SZ\s+(.+)/)?.[1]?.trim();
  const expanded=value?.replace(/%([^%]+)%/g,(_,name)=>process.env[name]??'');
  return expanded&&isAbsolute(expanded)?expanded:join(process.env.USERPROFILE||root,'Downloads');
}
const defaults={saveDir:'',quality:'best',theme:'system',big:false,clipboard:true,notify:true,checkUpdates:true,autoUpdate:true};
const settings={...defaults,...readJson(files.settings,{})};
if(!settings.saveDir||!isAbsolute(settings.saveDir)) settings.saveDir=downloadsFolder();
const history=(()=>{const list=readJson(files.history,[]);return Array.isArray(list)?list.slice(0,300):[];})();
const saveSettings=()=>writeJson(files.settings,settings).catch(()=>{});
const saveHistory=()=>writeJson(files.history,history).catch(()=>{});
function applySettings(patch) {
  const choices={quality:Object.keys(qualityLabels),theme:['system','light','dark']};
  for(const [key,value] of Object.entries(patch||{})) {
    if(choices[key]) {if(choices[key].includes(value))settings[key]=value;}
    else if(['big','clipboard','notify','checkUpdates','autoUpdate'].includes(key)&&typeof value==='boolean') settings[key]=value;
  }
  saveSettings();
}

/* ---------- live updates to the window (server-sent events) ---------- */
const clients=new Set();
let leaveTimer=null;
function broadcast(data) {const text='data: '+JSON.stringify(data)+'\n\n';for(const c of clients)c.write(text);}
const toast=text=>broadcast({type:'toast',text});
let jobsTimer=null;
function jobsChanged() {jobsTimer??=setTimeout(()=>{jobsTimer=null;broadcast({type:'jobs',jobs:jobsView()});},250);}
const historyChanged=()=>{saveHistory();broadcast({type:'history',history});};
function snapshot() {
  return {type:'state',version,preview,devCopy,settings,jobs:jobsView(),history,capture:captureView(),update:updateView(),
    recognition:[...recognitions.values()].filter(r=>r.status==='running').map(r=>({id:r.id,status:r.status,note:r.note}))};
}

/* ---------- child processes ---------- */
function killTree(pid) {if(pid)spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true});}
function start(command,args,onLine) {
  const child=spawn(command,args,{cwd:root,env:{...process.env,MENGREN_GUI:'1'},stdio:['pipe','pipe','pipe'],windowsHide:true});
  let pending='';
  const receive=data=>{const lines=(pending+data.toString('utf8')).split(/\r?\n|\r/);pending=lines.pop();for(const l of lines)onLine(l);};
  child.stdout.on('data',receive);child.stderr.on('data',receive);child.stdin.on('error',()=>{});
  child.done=new Promise(done=>{child.on('error',()=>done(1));child.on('close',code=>{if(pending)onLine(pending);done(code);});});
  return child;
}
const nodeScript=(name,args,onLine)=>start(node,[join(root,'source',name),...args],onLine);
// Node scripts stop cleanly on a "cancel" line; anything still running is ended after a pause.
async function stopChild(child,{gentle=true,wait=8000}={}) {
  if(!child||child.exitCode!==null) return;
  if(gentle) {try{child.stdin.write('cancel\n');}catch{}}
  const timer=setTimeout(()=>killTree(child.pid),gentle?wait:0);
  await child.done;clearTimeout(timer);
}

/* ---------- reading a link ---------- */
const recognitions=new Map();
async function recognize({text,qqMode}) {
  const url=extractLink(text);
  if(!url) return {error:'没有找到链接。请粘贴以 http 开头的链接，或 App 里“分享 → 复制链接”得到的整段文字。'};
  const info=classify(url);
  if(!info) return {error:'这不是网页链接。'};
  for(const r of recognitions.values()) if(r.status==='running') cancelRecognition(r.id);
  for(const [id,r] of recognitions) if(Date.now()-r.created>6*3600000) recognitions.delete(id);
  const id=randomUUID(),rec={id,url,...info,created:Date.now(),status:'done'};
  recognitions.set(id,rec);
  if(info.kind==='video') return {id,url,...info,status:'done'};
  rec.status='running';rec.note='';
  const onLine=line=>{
    const p=parseLine(line);if(!p)return;
    if(p.event?.type===info.kind) rec.result=p.event;
    else if(p.failure) rec.failure=p.failure;
    else if(p.note&&!p.note.startsWith('@@')) {rec.note=p.note;broadcast({type:'recognize',id,status:'running',note:p.note});}
  };
  if(info.kind==='qq') {
    rec.qqMode=qqMode==='standard'?'standard':'best';
    rec.child=nodeScript('qqmusic.mjs',['--url',url,'--output',settings.saveDir,'--quality',rec.qqMode,'--list'],onLine);
  } else {
    await mkdir(dirs.lists,{recursive:true});
    rec.listFile=join(dirs.lists,id+'.json');
    rec.child=nodeScript('ximalaya.mjs',['--url',url,'--output',settings.saveDir,'--list',rec.listFile],onLine);
  }
  rec.child.done.then(code=>{
    rec.child=null;
    if(rec.status==='cancel') {broadcast({type:'recognize',id,status:'cancel'});return;}
    if(code===0&&rec.result) {rec.status='done';broadcast({type:'recognize',id,status:'done',result:rec.result});}
    else {rec.status='fail';broadcast({type:'recognize',id,status:'fail',error:rec.failure||rec.note||'读取失败，请稍后重试'});}
  });
  return {id,url,...info,status:'running',qqMode:rec.qqMode};
}
function cancelRecognition(id) {
  const rec=recognitions.get(id);if(!rec?.child)return;
  rec.status='cancel';stopChild(rec.child,{wait:5000});
  if(rec.listFile) unlink(rec.listFile).catch(()=>{});
}

/* ---------- the download queue: one at a time ---------- */
const jobs=[];let jobSerial=0;
function jobsView() {
  return jobs.map(({child,log:_,...j})=>j);
}
function addJob(spec) {
  const job={id:++jobSerial,state:'wait',progress:null,speed:null,size:null,part:0,parts:spec.parts||1,files:[],folder:null,note:'',okCount:0,skipCount:0,failCount:0,log:[],...spec};
  jobs.push(job);jobsChanged();pump();
  return job;
}
function enqueue({rid,quality,format,episodes}) {
  const rec=recognitions.get(rid);
  if(!rec||rec.status!=='done') return {error:'识别结果已过期，请重新点“识别”。'};
  const common={kind:rec.kind,site:rec.site,url:rec.url};
  if(rec.kind==='video') {
    const q=qualityLabels[quality]?quality:settings.quality;
    addJob({...common,title:'',quality:q,sub:rec.site+(rec.quality?' · '+qualityLabels[q]:'')});
  } else if(rec.kind==='qq') {
    const f=rec.result.formats.find(x=>x.prefix===format)||rec.result.formats.find(x=>x.prefix===rec.result.default);
    if(!f) return {error:'没有可下载的音质。'};
    addJob({...common,title:rec.result.title+(rec.result.singers?.length?' - '+rec.result.singers.join('、'):''),fixedTitle:true,format:f.prefix,qqMode:rec.qqMode,sub:'QQ 音乐 · '+f.label});
  } else {
    const valid=new Set(rec.result.tracks.map(t=>t.index));
    const picked=rec.result.single?[]:(Array.isArray(episodes)?episodes:[]).map(Number).filter(n=>valid.has(n));
    if(!rec.result.single&&!picked.length) return {error:'请至少选一集。'};
    addJob({...common,title:rec.result.title.split('|')[0].trim(),fixedTitle:true,listFile:rec.listFile,select:rec.result.single?null:compressSelection(picked),parts:rec.result.single?1:picked.length,sub:'喜马拉雅 · '+(rec.result.single?'单集':picked.length+' 集'),folder:rec.result.folder});
  }
  recognitions.delete(rid);
  return {ok:true};
}
function retry(historyId) {
  const h=history.find(x=>x.id===historyId);
  if(!h||!h.url) return {error:'这条记录不能重试。'};
  if(h.kind==='xmly') return {recognizeAgain:h.url};
  if(h.kind==='video') addJob({kind:'video',site:h.site,url:h.url,title:'',quality:h.quality||settings.quality,sub:h.sub||h.site});
  else if(h.kind==='qq') addJob({kind:'qq',site:h.site,url:h.url,title:h.title,fixedTitle:true,format:h.format,qqMode:h.qqMode||'best',sub:h.sub});
  else return {error:'这条记录不能重试。'};
  return {ok:true};
}
function commandFor(job) {
  if(job.kind==='video') return [powershell,['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'download.ps1'),'-Url',job.url,'-Quality',job.quality,'-OutputDirectory',settings.saveDir]];
  if(job.kind==='qq') return [node,[join(root,'source','qqmusic.mjs'),'--url',job.url,'--output',settings.saveDir,'--quality',job.qqMode,'--format',job.format]];
  return [node,[join(root,'source','ximalaya.mjs'),'--url',job.url,'--output',settings.saveDir,'--tracks-file',job.listFile,...(job.select?['--select',job.select]:[])]];
}
function onJobLine(job,line) {
  const p=parseLine(line);
  if(!line.startsWith('@@mengren ')&&line.trim()&&!(p?.progress&&p.progress.percent<100)) {log(`[任务${job.id}] ${line}`);job.log.push(redact(line).slice(0,300));if(job.log.length>40)job.log.shift();}
  if(!p) return;
  if(p.progress) Object.assign(job,{progress:p.progress.percent,size:p.progress.size,speed:p.progress.speed});
  if(p.title&&!job.fixedTitle) job.title=p.title;
  if(p.saved) {let file=p.saved;if(!existsSync(file))file=file.replace(/（[^（）]*）$/,'');job.files.push(file);}
  if(p.folder) job.folder=p.folder;
  if(p.episode) {
    job.part=p.episode.n;job.parts=p.episode.total;// part = episodes finished so farjob.progress=null;job.speed=null;
    if(p.episode.status==='ok')job.okCount++;else if(p.episode.status==='skip')job.skipCount++;else job.failCount++;
  }
  if(p.failure) job.failure=p.failure;
  if(p.error) job.error=p.error;
  if(p.summary) job.summary=p.summary;
  if(p.note) job.note=p.note;
  jobsChanged();
}
let pumping=false;
async function pump() {
  if(pumping||shuttingDown) return;
  const job=jobs.find(j=>j.state==='wait');if(!job) return;
  pumping=true;
  try {
    job.state='run';job.started=Date.now();jobsChanged();
    await mkdir(settings.saveDir,{recursive:true}).catch(()=>{});
    log(`[任务${job.id}] 开始：${job.site} ${job.url}`);
    const [command,args]=commandFor(job);
    job.child=start(command,args,line=>onJobLine(job,line));
    const code=await job.child.done;
    job.child=null;jobs.splice(jobs.indexOf(job),1);
    if(job.listFile) unlink(job.listFile).catch(()=>{});
    if(job.cancelled) {
      log(`[任务${job.id}] 已取消`);
      // A stopped download.ps1 leaves its own temporary folder; its owner has exited now.
      await removeAbandonedJobs(settings.saveDir).catch(()=>{});
      if(job.folder) await removeAbandonedJobs(job.folder).catch(()=>{});
    } else finishJob(job,code);
  } finally {pumping=false;jobsChanged();}
  pump();
}
function finishJob(job,code) {
  const ok=code===0;
  const reason=ok?null:(job.failure||job.error||job.note||'下载没有完成');
  let info=job.sub;
  if(job.kind==='xmly'&&job.summary) info=job.summary;
  else if(job.files.length>1) info+=` · ${job.files.length} 个文件`;
  const entry={id:randomUUID(),time:Date.now(),kind:job.kind,site:job.site,url:job.url,title:job.title||job.site+' 下载',sub:job.sub,
    quality:job.quality,format:job.format,qqMode:job.qqMode,ok,info,reason,files:job.files.slice(0,50),
    folder:job.folder||(job.files[0]?dirname(job.files[0]):null),fix:!ok&&/登录/.test(reason||'')?'login':null,partial:ok&&job.failCount>0};
  log(`[任务${job.id}] ${ok?'完成':'失败：'+reason}`);
  addHistory(history,entry);historyChanged();
  broadcast({type:'done',ok,title:entry.title,reason});
}
function cancelJob(id) {
  const job=jobs.find(j=>j.id===id);if(!job) return;
  if(job.state==='wait') {jobs.splice(jobs.indexOf(job),1);if(job.listFile)unlink(job.listFile).catch(()=>{});jobsChanged();return;}
  job.cancelled=true;job.note='正在取消……';jobsChanged();
  // download.ps1 has no cancel line; its yt-dlp/ffmpeg/node children end with it.
  stopChild(job.child,{gentle:job.kind!=='video'});
}

/* ---------- playback capture ---------- */
const capture={state:'off',items:[],current:null,note:'',error:''};
const captureView=()=>({state:capture.state,items:capture.items,current:capture.current,note:capture.note,error:capture.error});
const captureChanged=()=>broadcast({type:'capture',capture:captureView()});
function startCapture() {
  if(capture.state!=='off') return;
  Object.assign(capture,{state:'starting',items:[],current:null,note:'',error:''});captureChanged();
  log('[抓取] 开启');
  capture.child=nodeScript('capture.mjs',['--output',settings.saveDir],line=>{
    if(line.trim()&&!line.startsWith('@@mengren ')) log('[抓取] '+line);
    const p=parseLine(line);if(!p) return;
    const e=p.event;
    if(e?.type==='capture-on') capture.state='on';
    else if(e?.type==='capture') capture.items=Array.isArray(e.items)?e.items:[];
    else if(e?.type==='capture-start') capture.current={id:e.id,progress:null,speed:null};
    else if(e?.type==='capture-done') {
      capture.current=null;
      addHistory(history,{id:randomUUID(),time:Date.now(),kind:'capture',site:'抓取',title:e.title||'抓取的视频',ok:Boolean(e.ok),info:'播放抓取',reason:e.ok?null:e.reason,files:e.file?[e.file]:[],folder:e.file?dirname(e.file):settings.saveDir});
      historyChanged();broadcast({type:'done',ok:Boolean(e.ok),title:e.title,reason:e.reason});
    }
    else if(e?.type==='notice') toast(e.text);
    else if(p.progress&&capture.current) Object.assign(capture.current,{progress:p.progress.percent,speed:p.progress.speed});
    else if(p.note) capture.note=p.note;
    captureChanged();
  });
  capture.child.done.then(code=>{
    const wasStopping=capture.state==='stopping';
    log('[抓取] 已结束，退出码 '+code);
    Object.assign(capture,{state:'off',items:[],current:null,child:null,error:!wasStopping&&code!==0?(capture.note||'抓取没有开启成功'):''});
    captureChanged();
    if(wasStopping) toast('抓取已关闭，网络设置已恢复。');
  });
}
function captureCommand(body) {
  if(capture.state!=='on'||!capture.child) return;
  const cmd={cmd:String(body.cmd||'')};
  if(!['rename','order','clear','download'].includes(cmd.cmd)) return;
  if(body.id!==undefined) cmd.id=Number(body.id);
  if(cmd.cmd==='rename') cmd.title=String(body.title??'').slice(0,200);
  if(cmd.cmd==='order') cmd.order=Number(body.order);
  if(cmd.cmd==='download') cmd.ids=(Array.isArray(body.ids)?body.ids:[]).slice(0,200).map(Number).filter(Number.isInteger);
  try{capture.child.stdin.write(JSON.stringify(cmd)+'\n');}catch{}
}
// Stopping restores the proxy and certificate trust; the helper's guard does the same
// if this process were killed.
async function stopCapture() {
  if(!capture.child) return;
  capture.state='stopping';captureChanged();
  await stopChild(capture.child,{wait:20000});
}

/* ---------- logins in the dedicated Edge ---------- */
const loginPages={x:'https://x.com/i/flow/login',xmly:'https://www.ximalaya.com/',qq:'https://y.qq.com/',yuanbao:'https://yuanbao.tencent.com/',douyin:'https://www.douyin.com/',bili:'https://passport.bilibili.com/login'};
async function openLogin(site) {
  const url=loginPages[site];if(!url) return {error:'不支持的网站'};
  const {ensureBrowser}=await import('./browser.mjs');
  const browser=await ensureBrowser();
  try {
    const {targetId}=await browser.call('Target.createTarget',{url:'about:blank'});
    const session=await browser.attach(targetId);
    await browser.call('Page.enable',{},session);
    await browser.call('Page.navigate',{url},session);
    await browser.call('Target.activateTarget',{targetId}).catch(()=>{});
  } finally {browser.close();}
  return {ok:true};
}
let xLogin=null;
// Google refuses sign-in in a browser under remote control, so X is opened in the same
// dedicated profile without control (the CLI's 登录X).
function openXGoogleLogin() {
  if(xLogin) return {error:'X 登录窗口已经打开了。'};
  const q=s=>"'"+s.replace(/'/g,"''")+"'";
  const script=`[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); . ${q(join(root,'source','download-helpers.ps1'))}; Invoke-MengrenXLogin ${q(root)}`;
  xLogin=start(powershell,['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],()=>{});
  xLogin.done.then(code=>{xLogin=null;toast(code===0?'X 登录窗口已关闭。现在可以下载需要登录的 X 帖子了。':'X 登录窗口没有打开成功，请关掉所有“下载专用 Edge”窗口后再试。');});
  return {ok:true};
}

/* ---------- Windows helpers ---------- */
function runPowerShell(script,env={}) {
  return new Promise(done=>{
    const child=spawn(powershell,['-NoLogo','-NoProfile','-STA','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from('[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);'+script,'utf16le').toString('base64')],{env:{...process.env,...env},windowsHide:true});
    let out='';child.stdout.on('data',d=>out+=d.toString('utf8'));child.on('close',()=>done(out.trim()));child.on('error',()=>done(''));
  });
}
async function pickFolder() {
  const picked=await runPowerShell(`Add-Type -AssemblyName System.Windows.Forms
$owner=New-Object System.Windows.Forms.Form -Property @{TopMost=$true;ShowInTaskbar=$false;StartPosition='CenterScreen';Width=1;Height=1;Opacity=0}
$owner.Show();$owner.Activate()
$dialog=New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description='选择下载保存位置';$dialog.SelectedPath=$env:MENGREN_DIR;$dialog.ShowNewFolderButton=$true
if($dialog.ShowDialog($owner) -eq 'OK'){[Console]::Out.Write($dialog.SelectedPath)}
$owner.Close()`,{MENGREN_DIR:settings.saveDir});
  if(!picked) return {cancelled:true};
  if(!isAbsolute(picked)||!(await stat(picked).catch(()=>null))?.isDirectory()) return {error:'这个文件夹不能用。'};
  const probe=join(picked,'.mengren-write-test-'+process.pid);
  try{await writeFile(probe,'');await unlink(probe);}catch{return {error:'这个文件夹没有写入权限，请换一个。'};}
  settings.saveDir=picked;saveSettings();broadcast({type:'settings',settings});
  return {ok:true};
}
async function readClipboard() {
  const text=await runPowerShell('Get-Clipboard -Raw');
  const link=extractLink(text.slice(0,20000));
  const info=link&&classify(link);
  return info&&info.site!=='其他网站'?{link,site:info.site}:{};
}
const openPath=(target,select=false)=>spawn('explorer.exe',[select?`/select,"${target}"`:`"${target}"`],{windowsVerbatimArguments:true,detached:true,stdio:'ignore'}).unref();
const openUrl=url=>spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,stdio:'ignore',windowsHide:true}).unref();
function openRecord(id,what) {
  const h=history.find(x=>x.id===id);if(!h) return {error:'找不到这条记录。'};
  const file=(h.files||[]).find(f=>existsSync(f));
  if(what==='file'&&file) {openPath(file);return {ok:true};}
  if(file) {openPath(file,true);return {ok:true};}
  if(h.folder&&existsSync(h.folder)) {openPath(h.folder);return {ok:true};}
  return {error:'文件已经不在原来的位置了（可能被移动或删除）。'};
}

/* ---------- storage and cleanup ---------- */
function browserRunning(profile) {
  const lock=join(profile,'lockfile');if(!existsSync(lock)) return false;
  try{closeSync(openSync(lock,'r+'));return false;}catch(error){return ['EBUSY','EPERM','EACCES'].includes(error.code);}
}
const cacheDirs=['Default/Cache','Default/Code Cache','Default/GPUCache','Default/DawnCache','Default/DawnGraphiteCache','Default/DawnWebGPUCache','Default/Service Worker/CacheStorage','Default/Service Worker/ScriptCache','GrShaderCache','GraphiteDawnCache','ShaderCache'];
async function size(path,budget={n:200000}) {
  const s=await stat(path).catch(()=>null);if(!s) return 0;
  if(!s.isDirectory()) return s.size;
  let total=0;
  for(const e of await readdir(path,{withFileTypes:true}).catch(()=>[])) {if(--budget.n<0)break;if(!e.isSymbolicLink())total+=await size(join(path,e.name),budget);}
  return total;
}
function running(pid) {try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}
function jobFolders() {return [...new Set([settings.saveDir,...history.slice(0,60).map(h=>h.folder).filter(Boolean)])].filter(d=>existsSync(d));}
async function abandonedSize() {
  let total=0;
  for(const dir of jobFolders()) for(const e of await readdir(dir,{withFileTypes:true}).catch(()=>[])) {
    if(!e.isDirectory()||!/^\.mengren-[A-Za-z0-9]{6}$/.test(e.name)) continue;
    const pid=readJson(join(dir,e.name,'.owner'),{}).pid;
    if(Number.isInteger(pid)&&running(pid)) continue;
    total+=await size(join(dir,e.name));
  }
  return total;
}
async function storage() {
  const edgeBusy=browserRunning(dirs.browser);
  let edge=0;for(const d of cacheDirs) edge+=await size(join(dirs.browser,d));
  return [
    {id:'jobs',name:'中断留下的临时文件',note:'下载中途关掉软件留下的；正在下载的不算',size:await abandonedSize()},
    {id:'edge',name:'下载专用浏览器的缓存',note:edgeBusy?'专用 Edge 正开着，关掉它之后才能清理':'网页图片、脚本等缓存，不含登录',size:edge,busy:edgeBusy},
    {id:'logs',name:'运行日志',note:'每个最多 2MB，最多保留 4 个',size:await size(dirs.logs)},
    {id:'updates',name:'更新安装包',note:'下载好、还没安装的新版本',size:await size(dirs.updates)},
    {id:'history',name:'下载记录',note:'只清记录，不删下载的文件',count:history.length},
  ];
}
async function clean(what) {
  if(what==='jobs'||what==='all') for(const dir of jobFolders()) await removeAbandonedJobs(dir).catch(()=>{});
  if((what==='edge'||what==='all')&&!browserRunning(dirs.browser)) for(const d of cacheDirs) await rm(join(dirs.browser,d),{recursive:true,force:true}).catch(()=>{});
  if(what==='logs'||what==='all') {for(const n of [1,2,3]) await unlink(files.log+'.'+n).catch(()=>{});await writeFile(files.log,'').catch(()=>{});}
  if(what==='updates'||what==='all') {
    if(!update.applying) {await rm(dirs.updates,{recursive:true,force:true}).catch(()=>{});if(update.state==='ready'){update.state='available';updateChanged();}}
  }
  if(what==='history') {history.length=0;historyChanged();}
}
// Runs at every start: nothing here belongs to a running download.
async function startupCleanup() {
  await rm(dirs.lists,{recursive:true,force:true}).catch(()=>{});
  for(const dir of jobFolders()) await removeAbandonedJobs(dir).catch(()=>{});
  await rm(join(dirs.updates,'staging'),{recursive:true,force:true}).catch(()=>{});
  for(const name of await readdir(dirs.updates).catch(()=>[])) {
    // Older packages go; an unfinished download of a newer one stays to be continued.
    const v=name.match(/^mengren-downloader-(\d+\.\d+\.\d+)-windows-x64-full\.zip(?:\.part)?$/)?.[1];
    if(name!=='result.json'&&(!v||compareVersions(v,version)<=0)) await rm(join(dirs.updates,name),{recursive:true,force:true}).catch(()=>{});
  }
  if(!browserRunning(dirs.app)) for(const d of cacheDirs) await rm(join(dirs.app,d),{recursive:true,force:true}).catch(()=>{});
}

/* ---------- updates ---------- */
const update={state:'idle',info:null,progress:0,error:'',file:null,applying:false,result:null};
const updateView=()=>({state:update.state,version:update.info?.version||null,notes:update.info?.notes||'',page:update.info?.page||releasePage,progress:update.progress,error:update.error,result:update.result,canInstall:canInstall(),devCopy});
const updateChanged=()=>broadcast({type:'update',update:updateView()});
let writable=null;
function canInstall() {
  if(devCopy) return false;
  if(writable===null) {const probe=join(root,'.mengren-write-test-'+process.pid);try{closeSync(openSync(probe,'w'));unlinkSync(probe);writable=true;}catch{writable=false;}}
  return writable;
}
async function checkNow() {
  if(['checking','downloading'].includes(update.state)||update.applying) return;
  update.state='checking';update.error='';updateChanged();
  try {
    const info=await checkUpdate(version,{preview});
    if(!info) {update.state='none';update.info=null;}
    else {
      update.info=info;update.file=join(dirs.updates,packageName(info.version));
      update.state=existsSync(update.file)?'ready':'available';
    }
  } catch(error) {update.state='error';update.error=error.message;}
  log('[更新] 检查结果：'+update.state+(update.info?' v'+update.info.version:'')+(update.error?' '+update.error:''));
  updateChanged();
  if(update.state==='available'&&settings.autoUpdate&&canInstall()) downloadNow();
}
let updateShown=0;
async function downloadNow() {
  if(update.state!=='available'||!canInstall()) return;
  update.state='downloading';update.progress=0;updateChanged();
  try {
    await mkdir(dirs.updates,{recursive:true});
    await downloadUpdate(update.info,update.file,{onProgress:p=>{update.progress=p;if(Date.now()>updateShown){updateShown=Date.now()+700;updateChanged();}}});
    update.state='ready';log('[更新] 已下载并校验 v'+update.info.version);
  } catch(error) {update.state='error';update.error=error.message;log('[更新] 下载失败：'+error.message);}
  updateChanged();
}
// The installer waits for this process to exit, copies the new files over the program
// folder and, when asked, opens the new version.
async function applyUpdate(restart) {
  if(update.state!=='ready'||!canInstall()||update.applying||!existsSync(update.file)) return false;
  const script=join(dirs.updates,'apply-update.ps1');
  await copyFile(join(root,'source','apply-update.ps1'),script);
  await unlink(files.updateResult).catch(()=>{});
  const ok=await startOutside(powershell,['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-Zip',update.file,'-Root',root,'-WaitPid',String(process.pid),'-Result',files.updateResult,'-Version',update.info.version,...(restart?['-Restart']:[])],{hidden:true});
  if(!ok) {log('[更新] 安装程序没有启动');return false;}
  update.applying=true;log('[更新] 开始安装 v'+update.info.version);
  return true;
}
// Starts a program that must keep running after this process exits (the installer, the
// console version). Node's own detached start gives console programs no console, which
// made PowerShell quit or hang, so Windows' Start-Process launches it instead.
async function startOutside(file,args,{hidden=false}={}) {
  const quoted=args.map(a=>'"'+String(a).replace(/\\+$/,'')+'"');
  const script=`$a=$env:MENGREN_ARGS|ConvertFrom-Json; Start-Process -FilePath $env:MENGREN_FILE -WorkingDirectory $env:MENGREN_ROOT${hidden?' -WindowStyle Hidden':''}${args.length?' -ArgumentList $a':''}`;
  const child=spawn(powershell,['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-Command',script],{env:{...process.env,MENGREN_ARGS:JSON.stringify(quoted),MENGREN_FILE:file,MENGREN_ROOT:root},stdio:'ignore',windowsHide:true});
  return new Promise(done=>{child.on('error',()=>done(false));child.on('close',code=>done(code===0));});
}

/* ---------- window and lifetime ---------- */
let shuttingDown=false;
async function shutdown(why) {
  if(shuttingDown) return;shuttingDown=true;
  log('[退出] '+why);
  for(const r of recognitions.values()) if(r.child) killTree(r.child.pid);
  const runningJob=jobs.find(j=>j.child);
  jobs.length=0;
  if(runningJob) {runningJob.cancelled=true;await stopChild(runningJob.child,{gentle:runningJob.kind!=='video',wait:6000});}
  if(xLogin) killTree(xLogin.pid);
  if(capture.child) await stopCapture();
  await rm(dirs.lists,{recursive:true,force:true}).catch(()=>{});
  for(const dir of jobFolders()) await removeAbandonedJobs(dir).catch(()=>{});
  if(settings.autoUpdate&&update.state==='ready') await applyUpdate(false).catch(()=>{});
  if(readJson(files.instance,{}).pid===process.pid) await unlink(files.instance).catch(()=>{});
  await logChain;
  process.exit(0);
}
function findEdge() {
  return [process.env['ProgramFiles(x86)'],process.env.ProgramFiles,process.env.LOCALAPPDATA].filter(Boolean)
    .map(b=>join(b,'Microsoft','Edge','Application','msedge.exe')).find(existsSync);
}
// A separate small profile keeps this window apart from the user's own Edge and from the
// dedicated download browser.
function openWindow(port,token) {
  if(headless) return;
  const url=`http://127.0.0.1:${port}/?token=${token}`,edge=findEdge();
  if(edge) spawn(edge,['--app='+url,'--user-data-dir='+dirs.app,'--no-first-run','--no-default-browser-check','--window-size=1100,860','--disable-features=Translate'],{detached:true,stdio:'ignore'}).unref();
  else openUrl(url);
}
async function existingInstance() {
  const info=readJson(files.instance,null);
  if(!info?.port||!info.token||!running(info.pid)) return null;
  try {
    const r=await fetch(`http://127.0.0.1:${info.port}/api/ping`,{headers:{'x-mengren-token':info.token},signal:AbortSignal.timeout(2000)});
    return r.ok?info:null;
  } catch {return null;}
}

/* ---------- HTTP ---------- */
const staticFiles={'/':['source/ui/index.html','text/html; charset=utf-8'],'/app.js':['source/ui/app.js','text/javascript; charset=utf-8'],'/style.css':['source/ui/style.css','text/css; charset=utf-8'],'/app.png':['assets/app.png','image/png']};
const security={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store',
  'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"};
function json(res,code,value) {res.writeHead(code,{...security,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
function sameToken(a,b) {const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);}
async function body(req) {
  let text='';
  for await(const chunk of req) {text+=chunk;if(text.length>65536)throw new Error('请求过大');}
  return text?JSON.parse(text):{};
}
function createServer(token) {
  return http.createServer(async(req,res)=>{
    const port=req.socket.localPort,origin=`http://127.0.0.1:${port}`;
    try {
      if(req.headers.host!==`127.0.0.1:${port}`) return json(res,403,{error:'forbidden'});
      const url=new URL(req.url,origin);
      if(url.pathname==='/'&&url.searchParams.has('token')) {
        if(!sameToken(url.searchParams.get('token'),token)) return json(res,403,{error:'forbidden'});
        res.writeHead(302,{...security,'Set-Cookie':`mengren=${token}; HttpOnly; SameSite=Strict; Path=/`,Location:'/'});return res.end();
      }
      if(!url.pathname.startsWith('/api/')) {
        const item=staticFiles[url.pathname];if(!item) return json(res,404,{error:'not found'});
        res.writeHead(200,{...security,'Content-Type':item[1]});return res.end(await readFile(join(root,item[0])));
      }
      const cookie=(req.headers.cookie||'').match(/(?:^|;\s*)mengren=([0-9a-f]+)/)?.[1];
      if(!sameToken(cookie,token)&&!sameToken(req.headers['x-mengren-token'],token)) return json(res,401,{error:'unauthorized'});
      const route=req.method+' '+url.pathname;
      if(route==='GET /api/ping') return json(res,200,{ok:true});
      if(route==='GET /api/events') {
        res.writeHead(200,{...security,'Content-Type':'text/event-stream; charset=utf-8',Connection:'keep-alive'});
        res.write('data: '+JSON.stringify(snapshot())+'\n\n');
        clients.add(res);clearTimeout(leaveTimer);
        const beat=setInterval(()=>res.write(': keep\n\n'),20000);
        req.on('close',()=>{clearInterval(beat);clients.delete(res);if(!clients.size){clearTimeout(leaveTimer);leaveTimer=setTimeout(()=>{if(!clients.size)shutdown('窗口已关闭');},8000);}});
        return;
      }
      if(route==='GET /api/storage') return json(res,200,{items:await storage(),saveDir:settings.saveDir});
      if(route==='GET /api/clipboard') return json(res,200,settings.clipboard?await readClipboard():{});
      if(req.method!=='POST') return json(res,404,{error:'not found'});
      if(req.headers.origin!==origin||!/^application\/json/.test(req.headers['content-type']||'')) return json(res,403,{error:'forbidden'});
      const b=await body(req);
      switch(url.pathname) {
        case '/api/recognize': return json(res,200,await recognize(b));
        case '/api/recognize/cancel': cancelRecognition(String(b.id));return json(res,200,{ok:true});
        case '/api/enqueue': return json(res,200,enqueue(b));
        case '/api/retry': return json(res,200,retry(String(b.id)));
        case '/api/job/cancel': cancelJob(Number(b.id));return json(res,200,{ok:true});
        case '/api/history/remove': {const i=history.findIndex(h=>h.id===b.id);if(i>=0){history.splice(i,1);historyChanged();}return json(res,200,{ok:true});}
        case '/api/open': return json(res,200,openRecord(String(b.id),b.what==='file'?'file':'folder'));
        case '/api/open-downloads': await mkdir(settings.saveDir,{recursive:true}).catch(()=>{});openPath(settings.saveDir);return json(res,200,{ok:true});
        case '/api/settings': applySettings(b);broadcast({type:'settings',settings});
          if(b.checkUpdates===true&&update.state==='idle') checkNow();
          if(b.autoUpdate===true&&update.state==='available') downloadNow();
          return json(res,200,{ok:true});
        case '/api/settings/default-folder': settings.saveDir=downloadsFolder();saveSettings();broadcast({type:'settings',settings});return json(res,200,{ok:true});
        case '/api/pick-folder': return json(res,200,await pickFolder());
        case '/api/clean': await clean(String(b.what));return json(res,200,{items:await storage()});
        case '/api/login': return json(res,200,await openLogin(String(b.site)).catch(e=>({error:e.message})));
        case '/api/login/x-google': return json(res,200,openXGoogleLogin());
        case '/api/capture/start': startCapture();return json(res,200,{ok:true});
        case '/api/capture/command': captureCommand(b);return json(res,200,{ok:true});
        case '/api/capture/stop': stopCapture();return json(res,200,{ok:true});
        case '/api/update/check': checkNow();return json(res,200,{ok:true});
        case '/api/update/download': downloadNow();return json(res,200,{ok:true});
        case '/api/update/install': {
          if(!await applyUpdate(true)) return json(res,200,{error:'现在不能安装更新。'});
          json(res,200,{ok:true});setTimeout(()=>shutdown('安装更新'),300);return;
        }
        case '/api/open-release': openUrl(update.info?.page||releasePage);return json(res,200,{ok:true});
        case '/api/open-cli': {
          const cli=join(root,'猛人下载器-命令行版.exe');
          if(!existsSync(cli)) return json(res,200,{error:'找不到命令行版程序。'});
          return json(res,200,await startOutside(cli,[])?{ok:true}:{error:'命令行版没有打开成功。'});
        }
      }
      return json(res,404,{error:'not found'});
    } catch(error) {
      log('[服务] '+error.message);
      if(!res.headersSent) json(res,500,{error:'软件内部出错：'+redact(error.message)});
    }
  });
}
async function listen(server) {
  // A fixed port keeps permissions such as notifications remembered between runs.
  for(const port of [47380,47381,47382,47383,47384,0]) {
    const ok=await new Promise(done=>{server.once('error',()=>done(false));server.listen(port,'127.0.0.1',()=>done(true));});
    if(ok) return server.address().port;
  }
  throw new Error('本机端口都被占用了');
}

async function main() {
  for(const d of [dirs.gui,dirs.logs]) await mkdir(d,{recursive:true});
  const other=await existingInstance();
  if(other) {openWindow(other.port,other.token);process.stdout.write('ready\n');return;}
  if(existsSync(join(dirs.updates,'staging'))&&Date.now()-(await stat(join(dirs.updates,'staging'))).mtimeMs<120000) {
    process.stdout.write('error 正在安装更新，请过半分钟再打开。\n');process.exitCode=2;return;
  }
  const token=randomBytes(24).toString('hex'),server=createServer(token),port=await listen(server);
  await writeJson(files.instance,{pid:process.pid,port,token});
  const result=readJson(files.updateResult,null);
  log(`[启动] v${version} 端口 ${port}${devCopy?'（开发目录）':''}`);
  if(result) {update.result=result;log(`[更新] 上次安装 v${result.version}：${result.ok?'成功':'没有完成，'+result.message}`);await unlink(files.updateResult).catch(()=>{});}
  await startupCleanup();
  openWindow(port,token);
  process.stdout.write('ready\n');
  // If the window never connects (Edge failed to open), do not linger in the background.
  leaveTimer=setTimeout(()=>{if(!clients.size)shutdown('窗口没有打开');},90000);
  if(settings.checkUpdates&&!headless) setTimeout(checkNow,4000);
  setInterval(()=>{if(settings.checkUpdates&&['idle','none','error'].includes(update.state))checkNow();},6*3600000).unref();
}
process.on('uncaughtException',error=>log('[错误] '+(error?.stack||error)));
process.on('unhandledRejection',error=>log('[错误] '+(error?.stack||error)));
main().catch(error=>{process.stdout.write('error '+error.message+'\n');process.exitCode=1;});
