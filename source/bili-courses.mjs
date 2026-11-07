import {courseTarget} from './bili-course-target.mjs';
export {courseTarget} from './bili-course-target.mjs';
import {readFile,writeFile,mkdir,stat,rename} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline';
import {ensureBrowser,sleep} from './browser.mjs';
import {courseMediaAllowed} from './sites.mjs';
import {downloadResolved,validate,safeStem,videoFileName,isCancelled,guiMode,guiEvent} from './site-download.mjs';

const say=text=>console.log(String(text).replace(/https?:\/\/[^\s"<>]+/g,'[地址]'));
const id=value=>typeof value==='string'&&/^[1-9]\d{0,15}$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):null;
const text=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,300):'';
const muteScript='(()=>{const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){this.muted=true;return play.apply(this,arguments);};})()';

export function cheeseCatalog(rows,title,target,total=rows?.length) {
  if(!Array.isArray(rows)||!rows.length||rows.length>2000||total!==rows.length)return null;
  const entries=rows.map((e,i)=>({index:i+1,id:id(e.id),cid:id(e.cid),title:text(e.title).replace(/^\d+\s+/,''),expectedSeconds:Number.isFinite(e.duration)&&e.duration>0?e.duration:0}));
  if(entries.some(e=>!e.id||!e.cid||!e.title)||new Set(entries.map(e=>e.id)).size!==entries.length||!entries.some(e=>e.id===target.episode))return null;
  return {key:'cheese:'+entries[0].id,title:text(title).replace(/_哔哩哔哩.*$/,''),entries,current:entries.find(e=>e.id===target.episode)?.index};
}
export function mallCatalog(json,target) {
  const d=json?.data;if(json?.success!==true||id(d?.courseId)!==target.course||id(d?.lessonId)!==target.lesson||!Array.isArray(d.chapterList))return null;
  const all=d.chapterList.flatMap(c=>Array.isArray(c?.sectionList)?c.sectionList:[]);if(!all.length||all.length>2000||d.sectionCount!==all.length)return null;
  const entries=all.map(e=>({index:e.sectionIndex,id:id(e.sectionId),lesson:id(e.lessonId),title:text(e.sectionName),expectedSeconds:Number(e.videoTime)/1000})).sort((a,b)=>a.index-b.index);
  if(entries.some((e,i)=>e.index!==i+1||!e.id||e.lesson!==target.lesson||!e.title||!(e.expectedSeconds>0))||new Set(entries.map(e=>e.id)).size!==entries.length)return null;
  return {key:'mall:'+target.course+':'+target.lesson,title:text(d.itemsName||d.lessonName),entries,current:entries.find(e=>e.id===(target.section||id(d.locationInfo?.sectionId)))?.index||1};
}
export function selectCourses(input,entries,current=1) {
  const raw=String(input??'').trim();if(raw==='0'||raw==='取消')return [];
  if(!raw||raw==='当前')return entries.filter(e=>e.index===current).map(e=>e.index);
  if(['全部','all','a'].includes(raw.toLowerCase()))return entries.map(e=>e.index);
  if(['初级','中级','高级'].includes(raw)) {const found=entries.filter(e=>new RegExp(raw+'\\d+').test(e.title)).map(e=>e.index);if(!found.length)throw Error('这门课没有对应的级别');return found;}
  const picked=new Set();for(const part of raw.replace(/[，、\s]+/g,',').split(',').filter(Boolean)) {
    const m=part.match(/^(\d{1,4})(?:-(\d{1,4}))?$/);if(!m)throw Error('请输入编号、范围如1-5、全部，或初级/中级/高级');
    const first=Number(m[1]),last=Number(m[2]||m[1]);if(first<1||last<first||!entries.some(e=>e.index===first)||!entries.some(e=>e.index===last))throw Error('课时编号或范围超出目录');
    for(const e of entries)if(e.index>=first&&e.index<=last)picked.add(e.index);
  }if(!picked.size)throw Error('没有选择有效课时');return [...picked].sort((a,b)=>a-b);
}
function protectedMedia(v) {return Boolean(v&&['drm_type','drmType','drm_info','drmInfo','pssh','is_drm','encrypted'].some(k=>v[k]&&v[k]!=='0'));}
export function cheeseMedia(json,entry,quality='1080') {
  const d=json?.data;if(json?.code!==0||id(d?.arc?.cid)!==entry.cid)return null;
  if(!d.user_status?.is_login)throw Error('请在专用 Edge 登录购买课程的 B 站账号');
  if(d.user_status.has_paid!==true||d.play_video_type!=='whole')throw Error('网站未授予本节完整课程权限，不下载试看');
  const v=d.video_info;if(protectedMedia(v)||!v?.dash||!(v.timelength>0))throw Error('未提供支持的普通整节音画轨道');
  const cap=quality==='best'?Infinity:Number(quality);if(![Infinity,1080,720,480].includes(cap))throw Error('画质参数无效');
  const urls=e=>[e?.base_url||e?.baseUrl,...(Array.isArray(e?.backup_url||e?.backupUrl)?(e.backup_url||e.backupUrl):[])].filter(courseMediaAllowed);
  const video=(v.dash.video||[]).filter(e=>!protectedMedia(e)&&e.height>0&&e.height<=cap&&urls(e).length).sort((a,b)=>b.height-a.height||Number(b.codecs?.startsWith('avc1'))-Number(a.codecs?.startsWith('avc1'))||b.bandwidth-a.bandwidth)[0];
  const audio=(v.dash.audio||[]).filter(e=>!protectedMedia(e)&&urls(e).length).sort((a,b)=>b.bandwidth-a.bandwidth)[0];
  if(!video||!audio)throw Error('账号未取得所选画质的普通音画轨道');
  return {site:'bili-course',page:'https://www.bilibili.com/',title:entry.title,mediaUrl:urls(video)[0],renditions:urls(video).map(url=>({url})),audioUrl:urls(audio)[0],expectedSeconds:v.timelength/1000,requireAudio:true,courseOrder:entry.index,width:video.width,height:video.height};
}
// The mall player may spell an ordinary CDN MP4 with http. Request the same
// host/path/query over HTTPS only; failures never fall back to plaintext HTTP.
export function httpsMallMedia(address) {
  let u;try{u=new URL(address);}catch{return null;}
  if(u.username||u.password||u.hash||u.port)return null;
  if(u.protocol==='http:') {
    if(!u.hostname.endsWith('.bilivideo.com')||!/^\/mallxcodeboss\/[^?#]+\.mp4$/i.test(u.pathname))return null;
    u.protocol='https:';
  }
  return courseMediaAllowed(u.href)?u.href:null;
}
export function mallMedia(json,entry,target) {
  const d=json?.data;if(json?.success!==true||id(d?.lessonId)!==target.lesson||id(d?.sectionId)!==entry.id)return null;
  if(d.hasWatchRight!==true)throw Error('网站未授予本节观看权限');
  const url=httpsMallMedia(d.videoUrl);
  if(protectedMedia(d)||!url||Math.abs(Number(d.videoTime)-entry.expectedSeconds)>3)throw Error('未提供与目录匹配的普通整节 MP4');
  return {site:'bili-course',page:'https://mall.bilibili.com/',title:entry.title,mediaUrl:url,expectedSeconds:entry.expectedSeconds,requireAudio:true,courseOrder:entry.index};
}

export class CourseSession {
  constructor(browser,page,target,{notify=say,cancelled=isCancelled}={}) {Object.assign(this,{browser,page,target,notify,cancelled,watched:new Map(),finished:[],off:[],play:null,catalog:null,durations:new Map(),keepOpen:false});}
  static async open(target,{browser,notify=say,cancelled=isCancelled}={}) {
    browser=browser||await ensureBrowser();const page=await browser.page('about:blank');const session=new CourseSession(browser,page,target,{notify,cancelled});
    try{await session.setup();return session;}catch(e){await session.close();throw e;}
  }
  async setup(){const {browser,page}=this,s=page.sessionId;
    this.off.push(browser.on('Network.responseReceived',(p,ss)=>{if(ss!==s||p.response?.status!==200)return;let u;try{u=new URL(p.response.url)}catch{return;}
      const kind=u.origin==='https://api.bilibili.com'&&u.pathname==='/pugv/view/web/season'?'cheese-catalog':u.origin==='https://api.bilibili.com'&&u.pathname==='/ogv/player/playview'?'cheese-play':u.origin==='https://mall.bilibili.com'&&u.pathname==='/mall-search-items/items/course/h5/detail'?'mall-catalog':u.origin==='https://mall.bilibili.com'&&u.pathname==='/mall-search-items/items/course/section/play/detail'?'mall-play':null;
      if(kind&&kind.startsWith(this.target.kind)&&this.watched.size<64&&!(p.response.encodedDataLength>4000000))this.watched.set(p.requestId,kind);
    }),browser.on('Network.loadingFinished',(p,ss)=>{if(ss===s&&this.watched.has(p.requestId)&&this.finished.length<64)this.finished.push(p.requestId)}),browser.on('Network.loadingFailed',(p,ss)=>{if(ss===s)this.watched.delete(p.requestId)}));
    await browser.call('Page.enable',{},s);await browser.call('Network.enable',{maxTotalBufferSize:16000000,maxResourceBufferSize:4000000},s);
    await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:muteScript},s);await browser.call('Target.activateTarget',{targetId:page.targetId}).catch(()=>{});
    await browser.call('Emulation.setFocusEmulationEnabled',{enabled:true},s).catch(()=>{});await this.go(this.target.url);
  }
  go(url){return this.browser.call('Page.navigate',{url},this.page.sessionId);}
  async evaluate(expression){const r=await this.browser.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},this.page.sessionId);if(r.exceptionDetails)throw Error('课程网页读取失败');return r.result?.value;}
  async drain(entry,quality){
    while(this.finished.length){const requestId=this.finished.shift(),kind=this.watched.get(requestId);this.watched.delete(requestId);let j;
      try{const r=await this.browser.call('Network.getResponseBody',{requestId},this.page.sessionId);if(r.base64Encoded||r.body.length>4000000)continue;j=JSON.parse(r.body);}catch{continue;}
      if(kind==='cheese-catalog'){const d=j?.data;if(j?.code===0&&Array.isArray(d?.episodes)&&d.episodes.length===d.ep_count&&d.episodes.length<=2000&&d.episodes.some(e=>id(e.id)===this.target.episode))this.durations=new Map(d.episodes.filter(e=>id(e.id)&&Number.isFinite(e.duration)&&e.duration>0).map(e=>[id(e.id),e.duration]));}
      else if(kind==='mall-catalog')this.catalog=mallCatalog(j,this.target)||this.catalog;
      else if(entry){const info=kind==='cheese-play'?cheeseMedia(j,entry,quality):kind==='mall-play'?mallMedia(j,entry,this.target):null;if(info)this.play=info;}
    }
  }
  async readCatalog({timeout=300000}={}) {
    this.notify('请在下载专用 Edge 中登录购买课程的账号，软件会自动读取目录。');
    for(const end=Date.now()+timeout;Date.now()<end&&!this.cancelled();){
      await this.drain();
      if(this.target.kind==='cheese'){
        try{const value=await this.evaluate(`(()=>{if(location.origin!=='https://www.bilibili.com'||!location.pathname.startsWith('/cheese/play/'))return null;return {title:document.title,total:Number(document.body.innerText.match(/共\\s*(\\d+)\\s*课时/)?.[1])||0,rows:[...document.querySelectorAll('li[data-episodeid][data-cid]')].slice(0,2001).map(e=>({id:e.dataset.episodeid,cid:e.dataset.cid,title:e.querySelector('[class$="item-title"]')?.textContent?.trim()}))}})()`);if(value)this.catalog=cheeseCatalog(value.rows.map(e=>({...e,duration:this.durations.get(e.id)||0})),value.title,this.target,value.total);}catch{}
      }
      if(this.catalog)return this.catalog;await sleep(1000);
    }this.keepOpen=true;throw Error(this.cancelled()?'下载已取消':'读取课程目录超时，请在专用 Edge 确认登录和课程页面后重试');
  }
  async resolve(entry,{quality='1080',timeout=60000}={}) {
    this.play=null;this.finished.length=0;this.watched.clear();
    if(this.target.kind==='cheese')await this.go('https://www.bilibili.com/cheese/play/ep'+entry.id);
    else {
      const selected=await this.evaluate(`document.querySelector('[class*="_sectionPlayName_"]')?.textContent?.trim()`);
      if(selected===entry.title){await this.browser.call('Page.reload',{},this.page.sessionId);await sleep(2500);}
      const clicked=await this.evaluate(`(()=>{if(location.origin!=='https://mall.bilibili.com'||new URL(location.href).searchParams.get('courseId')!==${JSON.stringify(this.target.course)})return false;const names=[...document.querySelectorAll('[class*="_sectionName_"]')];const e=names[${entry.index-1}];if(names.length!==${this.catalog.entries.length}||e?.textContent.trim()!==${JSON.stringify(entry.title)})return false;e.click();return true})()`);
      if(!clicked)throw Error('本节没有出现在原课程目录中，请保持课程标签页打开');
    }
    let loginNotified=false;for(const end=Date.now()+timeout;Date.now()<end&&!this.cancelled();){try{await this.drain(entry,quality)}catch(e){if(!/^请在专用 Edge 登录/.test(e.message))throw e;if(!loginNotified){this.notify(e.message+'，登录后请在网页点一次当前课时，程序会继续。');loginNotified=true;this.keepOpen=true;}}if(this.play){this.keepOpen=false;await this.evaluate(`document.querySelector('video')?.pause()`).catch(()=>{});return this.play;}await sleep(500);}
    throw Error(this.cancelled()?'下载已取消':'没有收到该节的完整播放信息，请确认账号权限及正常播放后重试');
  }
  async close(){for(const off of this.off)off();if(!this.keepOpen||this.cancelled())await this.browser.closePages([this.page.targetId]);this.browser.close();}
}
export function askCourseLine(prompt,{input=process.stdin,output=process.stdout}={}){return new Promise(resolve=>{const rl=readline.createInterface({input,output});rl.question(prompt,answer=>{resolve(answer);rl.close()});rl.on('close',()=>resolve(null))});}
export async function savedCourseFile(record,folder,entry) {
  if(!record||record.title!==entry.title||typeof record.file!=='string'||basename(record.file)!==record.file||!record.validation||!(record.seconds>0))return null;
  if(entry.lesson&&entry.expectedSeconds>0&&Math.abs(record.seconds-entry.expectedSeconds)>3)return null;
  const file=join(folder,record.file);try{if((await stat(file)).size!==record.bytes)return null;await validate(file,{requireAudio:true,expectedSeconds:record.seconds});return file;}catch{return null;}
}
export function courseListing(catalog,target) {
  return {version:1,kind:target.kind,key:catalog.key,title:catalog.title,current:catalog.current,entries:catalog.entries.map(e=>({index:e.index,id:e.id,...(e.cid?{cid:e.cid}:{lesson:e.lesson}),title:e.title,expectedSeconds:e.expectedSeconds}))};
}
export function readCourseListing(serialized,target) {
  const data=JSON.parse(serialized),entries=data?.entries;
  if(data.version!==1||data.kind!==target.kind||!Array.isArray(entries)||!entries.length||entries.length>2000||entries.some((e,i)=>e.index!==i+1||!id(e.id)||!text(e.title)||!Number.isFinite(e.expectedSeconds)||e.expectedSeconds<0)||new Set(entries.map(e=>e.id)).size!==entries.length)throw Error('保存的课程目录已失效，请重新识别');
  if(target.kind==='cheese'?(data.key!=='cheese:'+entries[0].id||!entries.some(e=>e.id===target.episode)||entries.some(e=>!id(e.cid))):(data.key!=='mall:'+target.course+':'+target.lesson||entries.some(e=>e.lesson!==target.lesson||!(e.expectedSeconds>0))))throw Error('保存的目录不属于这个课程链接');
  return {key:data.key,title:text(data.title),current:entries.some(e=>e.index===data.current)?data.current:1,entries:entries.map(e=>({index:e.index,id:e.id,title:text(e.title),expectedSeconds:e.expectedSeconds,...(target.kind==='cheese'?{cid:e.cid}:{lesson:e.lesson})}))};
}
async function readState(file) {
  try{const d=JSON.parse(await readFile(file,'utf8'));if(d?.version===1&&d.completed&&typeof d.completed==='object'&&!Array.isArray(d.completed))return d;}catch{}
  return {version:1,completed:{}};
}
export async function downloadCourse(address,output,{quality='1080',episodes=null,probe=false,list=null,tracksFile=null,gui=guiMode,emit=guiEvent,ask=askCourseLine,sessionFactory=CourseSession.open,notify=say,timeout=300000,download=downloadResolved}={}) {
  const target=courseTarget(address);if(!target)throw Error('不是支持的 B 站课堂或会员购课程链接');
  if(gui&&!list&&!probe&&episodes===null)throw Error('窗口模式请先识别课程并选择课时（--episodes），不会等待命令行输入');
  const saved=tracksFile?readCourseListing(await readFile(tracksFile,'utf8'),target):null;
  const session=await sessionFactory(target,{notify});
  try{
    const catalog=await session.readCatalog({timeout}),folder=join(resolve(output),safeStem(catalog.title,'B站课程'));
    if(saved&&(catalog.key!==saved.key||catalog.entries.length!==saved.entries.length||catalog.entries.some((e,i)=>e.id!==saved.entries[i].id||e.title!==saved.entries[i].title)))throw Error('课程目录已变化，请重新识别再下载');
    const stateFile=join(folder,'.bili-course-state.json'),state=await readState(stateFile);
    notify('课程：'+catalog.title+'，共 '+catalog.entries.length+' 节');
    if(list){
      const tracks=[];for(const e of catalog.entries){if(isCancelled())throw Error('下载已取消');tracks.push({index:e.index,title:e.title,duration:e.expectedSeconds,have:Boolean(await savedCourseFile(state.completed[catalog.key+':'+e.id],folder,e))});}
      await writeFile(list,JSON.stringify(courseListing(catalog,target)));emit({type:'course',kind:target.kind,title:catalog.title,total:tracks.length,current:catalog.current,folder,tracks});return {listed:true};
    }
    if(!gui)for(const e of catalog.entries)notify(`${e.index}. ${e.title}`);
    let selected;if(probe)selected=selectCourses(episodes??'当前',catalog.entries,catalog.current);else if(episodes!==null)selected=selectCourses(episodes,catalog.entries,catalog.current);else{
      for(;;){const answer=await ask('选择编号、范围1-5、全部、初级/中级/高级；直接回车下载当前课时；0取消：');if(answer===null)return {cancelled:true};try{selected=selectCourses(answer,catalog.entries,catalog.current);break}catch(e){notify(e.message)}}
    }
    if(!selected.length)return {cancelled:true};if(target.kind==='mall')notify('会员购按网页提供的原始画质保存，不转码放大。');
    if(!probe)await mkdir(folder,{recursive:true});notify('保存位置：'+folder);
    const results=[];for(const index of selected){if(isCancelled())throw Error('下载已取消');const entry=catalog.entries.find(e=>e.index===index),key=catalog.key+':'+entry.id;const order=results.length+1;notify(`[${order}/${selected.length}] ${entry.title}`);
      try{
        if(!probe){const existing=await savedCourseFile(state.completed[key],folder,entry);if(existing){notify(`[${order}/${selected.length}] ${entry.title}：已下载过，跳过`);results.push({index,status:'skipped',file:existing});continue;}}
        const info=await session.resolve(entry,{quality,timeout});if(probe){notify('整节播放信息读取成功');results.push({index,status:'resolved'});continue;}
        const result=await download(info,target.url,folder),file=result.file;
        state.completed[key]={title:entry.title,file:basename(file),bytes:(await stat(file)).size,seconds:info.expectedSeconds,validation:'duration/audio-video/head-tail-decode'};
        const pending=stateFile+'.pending';await writeFile(pending,JSON.stringify(state,null,2));await rename(pending,stateFile);results.push({index,status:'saved',file});notify(`[${order}/${selected.length}] ${entry.title}：完成`);
      }catch(e){if(isCancelled())throw Error('下载已取消');notify(`[${order}/${selected.length}] ${entry.title}：失败，`+(e.message||'读取失败'));results.push({index,status:'failed'});if(/浏览器|标签页|连接.*断/.test(e.message||''))break;}
      await sleep(1500);
    }
    const failed=results.filter(e=>e.status==='failed').length;notify(`全部处理完：成功 ${results.filter(e=>e.status==='saved').length}，跳过 ${results.filter(e=>e.status==='skipped').length}，失败 ${failed}`);
    return {results,failed,incomplete:results.length!==selected.length};
  }finally{await session.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1];
  try{if(!args.includes('--url')||!args.includes('--output'))throw Error('缺少链接或下载目录');const result=await downloadCourse(get('--url'),get('--output'),{quality:args.includes('--quality')?get('--quality'):'1080',episodes:args.includes('--episodes')?get('--episodes'):null,probe:args.includes('--probe'),list:args.includes('--list')?get('--list'):null,tracksFile:args.includes('--tracks-file')?get('--tracks-file'):null});process.exitCode=result.failed||result.incomplete?1:0;}catch(e){say('未完成：'+(e.message||'读取失败'));process.exitCode=isCancelled()?130:1;}
}
