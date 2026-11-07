import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {courseTarget,cheeseCatalog,mallCatalog,selectCourses,cheeseMedia,mallMedia,CourseSession,downloadCourse,savedCourseFile,askCourseLine,httpsMallMedia,courseListing,readCourseListing} from '../source/bili-courses.mjs';
import {allowedMedia,courseMediaAllowed} from '../source/sites.mjs';
const cheese=courseTarget('https://www.bilibili.com/cheese/play/ep123');
const mall=courseTarget('https://mall.bilibili.com/lesson/play?courseId=12&lessonId=34&itemId=56');
const entry={index:1,id:'123',cid:'456',title:'初级01-示例',expectedSeconds:120};
const cdn='https://test.bilivideo.com/video.mp4';
const mallJson=()=>({success:true,data:{courseId:12,lessonId:34,sectionCount:2,itemsName:'课程',hasBought:true,locationInfo:{sectionId:78},chapterList:[{sectionList:[{sectionId:78,lessonId:34,sectionIndex:1,sectionName:'第一节',videoTime:120000},{sectionId:79,lessonId:34,sectionIndex:2,sectionName:'第二节',videoTime:150000}]}]}});
const play=()=>({code:0,data:{arc:{cid:456},user_status:{is_login:true,has_paid:true},play_video_type:'whole',video_info:{timelength:120000,dash:{video:[{height:1080,width:1920,codecs:'avc1.640028',bandwidth:2000,base_url:cdn},{height:720,width:1280,codecs:'avc1.640028',bandwidth:1000,base_url:cdn}],audio:[{bandwidth:200,base_url:cdn}]}}}});

test('Course routes accept only exact official pages and decimal identifiers',()=>{
 assert.equal(cheese.kind,'cheese');assert.equal(mall.kind,'mall');
 for(const address of ['https://evil.test/cheese/play/ep123','https://mall.bilibili.com.evil.test/lesson/play?courseId=12&lessonId=34','http://www.bilibili.com/cheese/play/ep123','https://u:p@www.bilibili.com/cheese/play/ep123','https://www.bilibili.com:444/cheese/play/ep123','https://www.bilibili.com/cheese/play/ep123#x','https://mall.bilibili.com/lesson/play?courseId=12&lessonId=34&lessonId=35','https://mall.bilibili.com/lesson/play?courseId=12&lessonId=-1'])assert.equal(courseTarget(address),null,address);
 assert.equal(courseTarget('https://www.bilibili.com/video/BV1vL411G7N7'),null);
});
test('All media stays HTTPS-only; mall URLs upgrade without changing path/query',()=>{
 assert.equal(courseMediaAllowed(cdn),true);assert.equal(allowedMedia('bili-course',cdn),true);
 assert.equal(courseMediaAllowed('http://test.bilivideo.com/mallxcodeboss/a.mp4'),false);
 assert.equal(httpsMallMedia('http://test.bilivideo.com/mallxcodeboss/a.mp4?example=1'),'https://test.bilivideo.com/mallxcodeboss/a.mp4?example=1');
 assert.equal(httpsMallMedia('http://evil.test/mallxcodeboss/a.mp4'),null);
 assert.equal(allowedMedia('bili','http://test.bilivideo.com/mallxcodeboss/a.mp4'),false);
 for(const url of ['http://test.bilivideo.com/a.mp4','https://evil.test/a.mp4','http://127.0.0.1/mallxcodeboss/a.mp4','https://test.bilivideo.com:444/a.mp4','https://u:p@test.bilivideo.com/a.mp4','https://test.bilivideo.com/a.m3u8','https://test.bilivideo.com/a.key','http://test.bilivideo.cn/mallxcodeboss/a.mp4'])assert.equal(courseMediaAllowed(url),false,url);
});
test('Classroom catalog must contain requested episode and unique resources',()=>{
 const rows=[{id:'123',cid:'456',title:'1 初级01-示例'},{id:'124',cid:'457',title:'2 中级01-示例'}];
 const parsed=cheeseCatalog(rows,'测试课_哔哩哔哩_bilibili',cheese);assert.equal(parsed.entries[0].title,'初级01-示例');assert.equal(parsed.title,'测试课');assert.equal(parsed.current,1);
 assert.equal(cheeseCatalog(rows,'课',{episode:'999'}),null);assert.equal(cheeseCatalog([...rows,rows[0]],'课',cheese),null);assert.equal(cheeseCatalog([{id:'123',cid:null,title:'缺失'}],'课',cheese),null);
});
test('Mall catalog is bound to course, lesson, exact count and ordered unique sections',()=>{
 const j=mallJson();j.data.mid='PRIVATE_USER_MARKER';const catalog=mallCatalog(j,mall);assert.equal(catalog.entries.length,2);assert.equal(catalog.current,1);assert.equal(catalog.entries[0].expectedSeconds,120);assert.equal(JSON.stringify(catalog).includes('PRIVATE_USER_MARKER'),false);
 assert.equal(mallCatalog(j,{...mall,course:'99'}),null);j.data.sectionCount=3;assert.equal(mallCatalog(j,mall),null);
 const duplicate=mallJson();duplicate.data.chapterList[0].sectionList[1].sectionId=78;assert.equal(mallCatalog(duplicate,mall),null);
 const foreign=mallJson();foreign.data.chapterList[0].sectionList[1].lessonId=999;assert.equal(mallCatalog(foreign,mall),null);
});
test('Selection supports current, groups, ranges, cancellation and rejects invalid input',()=>{
 const entries=[{index:1,title:'介绍'},{index:2,title:'初级01'},{index:3,title:'初级02'},{index:4,title:'中级01'},{index:5,title:'高级01'}];
 assert.deepEqual(selectCourses('',entries,4),[4]);assert.deepEqual(selectCourses('初级',entries),[2,3]);assert.deepEqual(selectCourses('中级',entries),[4]);assert.deepEqual(selectCourses('高级',entries),[5]);assert.deepEqual(selectCourses('1,3-5',entries),[1,3,4,5]);assert.deepEqual(selectCourses('0',entries),[]);assert.deepEqual(selectCourses('全部',entries),[1,2,3,4,5]);
 for(const bad of ['6','5-2','1-9999','abc','-1'])assert.throws(()=>selectCourses(bad,entries));
});
test('Classroom resolver binds cid, paid whole playback and requested quality',()=>{
 assert.equal(cheeseMedia(play(),entry,'1080').height,1080);assert.equal(cheeseMedia(play(),entry,'720').height,720);assert.equal(cheeseMedia(play(),{...entry,cid:'999'}),null);
 assert.throws(()=>cheeseMedia(play(),entry,'480'),/画质/);assert.throws(()=>cheeseMedia(play(),entry,'bad'),/画质/);
 for(const change of [j=>j.data.user_status.has_paid=false,j=>j.data.play_video_type='preview',j=>j.data.user_status.is_login=false,j=>j.data.video_info.drm_type=1,j=>j.data.video_info.dash.video.forEach(v=>v.drm_type=1),j=>j.data.video_info.dash.audio.forEach(v=>v.base_url='https://evil.test/a.mp4')]){const j=play();change(j);assert.throws(()=>cheeseMedia(j,entry));}
});
test('Mall resolver rejects foreign sections, missing rights, previews and protected formats',()=>{
 const e={index:1,id:'78',title:'第一节',expectedSeconds:120};const j=()=>({success:true,data:{lessonId:34,sectionId:78,hasWatchRight:true,videoTime:120,videoUrl:'http://test.bilivideo.com/mallxcodeboss/a.mp4'}});
 assert.equal(mallMedia(j(),e,mall).expectedSeconds,120);assert.match(mallMedia(j(),e,mall).mediaUrl,/^https:/);assert.equal(mallMedia(j(),{...e,id:'79'},mall),null);
 for(const change of [v=>v.data.hasWatchRight=false,v=>v.data.videoTime=30,v=>v.data.encrypted=true,v=>v.data.videoUrl='https://evil.test/a.mp4']){const v=j();change(v);assert.throws(()=>mallMedia(v,e,mall));}
});
class BrowserFixture {
 constructor(){this.handlers=new Map();this.calls=[];this.closed=false;this.body=JSON.stringify(mallJson());}
 async page(url){this.calls.push(['page',url]);return {targetId:'OWN_PAGE',sessionId:'OWN_SESSION'}}
 on(name,fn){this.handlers.set(name,fn);return()=>this.handlers.delete(name)}
 async call(name,args={},session){this.calls.push([name,args,session]);if(name==='Network.getResponseBody')return {body:this.body};return {};}
 async closePages(ids){this.calls.push(['closePages',ids])}close(){this.closed=true;}
 emit(name,params,session='OWN_SESSION'){this.handlers.get(name)?.(params,session)}
}
test('Browser reads only matching API responses in its own session and cleans listeners',async()=>{
 const b=new BrowserFixture(),s=await CourseSession.open(mall,{browser:b});
 b.emit('Network.responseReceived',{requestId:'foreign',response:{status:200,url:'https://evil.test/mall-search-items/items/course/h5/detail'}});b.emit('Network.loadingFinished',{requestId:'foreign'});
 b.emit('Network.responseReceived',{requestId:'other',response:{status:200,url:'https://mall.bilibili.com/mall-search-items/items/course/h5/detail'}},'OTHER');b.emit('Network.loadingFinished',{requestId:'other'},'OTHER');await s.drain();assert.equal(s.catalog,null);
 b.emit('Network.responseReceived',{requestId:'ours',response:{status:200,url:'https://mall.bilibili.com/mall-search-items/items/course/h5/detail'}});b.emit('Network.loadingFinished',{requestId:'ours'});await s.drain();assert.equal(s.catalog.entries.length,2);
 await s.close();assert.equal(b.closed,true);assert.equal(b.handlers.size,0);assert.deepEqual(b.calls.find(c=>c[0]==='closePages')[1],['OWN_PAGE']);assert.equal(b.calls.some(c=>/Cookie|Storage/.test(c[0])),false);
});
test('Probe uses explicit selection, never downloads or persists account/media data',async()=>{
 let closed=0,resolved=[];const catalog=mallCatalog(mallJson(),mall),session={readCatalog:async()=>catalog,resolve:async e=>{resolved.push(e.id);return {mediaUrl:cdn}},close:async()=>closed++};
 const result=await downloadCourse(mall.url,'unused-output',{probe:true,episodes:'2',sessionFactory:async()=>session,notify:()=>{}});assert.deepEqual(resolved,['79']);assert.equal(result.results[0].status,'resolved');assert.equal(closed,1);
});
test('Invalid selection and cancellation close owned session without reading lessons',async()=>{
 let closed=0,resolved=0;const session={readCatalog:async()=>mallCatalog(mallJson(),mall),resolve:async()=>resolved++,close:async()=>closed++};
 await assert.rejects(()=>downloadCourse(mall.url,'unused-output',{episodes:'999',sessionFactory:async()=>session,notify:()=>{}}));assert.equal(closed,1);
 const result=await downloadCourse(mall.url,'unused-output',{episodes:'0',sessionFactory:async()=>session,notify:()=>{}});assert.equal(result.cancelled,true);assert.equal(resolved,0);assert.equal(closed,2);
});
test('Resume refuses traversal, mismatched title, size and missing files',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'mengren-course-state-'));try{
  const e={title:'第一节'};assert.equal(await savedCourseFile({title:e.title,file:'../x.mp4',validation:'ok',seconds:3},folder,e),null);
  assert.equal(await savedCourseFile({title:'另一课',file:'x.mp4',validation:'ok',seconds:3},folder,e),null);
  assert.equal(await savedCourseFile({title:e.title,file:'x.mp4',validation:'ok',seconds:3,bytes:10},folder,e),null);
  await writeFile(join(folder,'x.mp4'),'bad');assert.equal(await savedCourseFile({title:e.title,file:'x.mp4',validation:'ok',seconds:3,bytes:10},folder,e),null);
 }finally{await cleanupTestFolder(folder)}
});
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {downloadResolved} from '../source/site-download.mjs';

test('Integrated course download validates real MP4, persists metadata, then skips a repeat',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'mengren-course-integration-')),source=join(folder,'fixture.mp4');
 const generated=await new Promise((done,reject)=>{const p=spawn(join(process.cwd(),'ffmpeg.exe'),['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=128x72:rate=10','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source],{windowsHide:true});p.on('error',reject);p.on('close',done)});
 assert.equal(generated,0);const bytes=await readFile(source);
 const server=http.createServer((request,response)=>{const match=request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);const first=match?Number(match[1]):0,last=match&&match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;response.writeHead(match?206:200,{'content-type':'video/mp4','content-length':last-first+1,...(match?{'content-range':`bytes ${first}-${last}/${bytes.length}`}:{})});response.end(request.method==='HEAD'?undefined:bytes.subarray(first,last+1));});server.listen(0,'127.0.0.1');await once(server,'listening');
 let reads=0;const target=courseTarget('https://www.bilibili.com/cheese/play/ep123'),one={...entry,expectedSeconds:1};
 const sessionFactory=async()=>({readCatalog:async()=>({key:'cheese:123',title:'真实媒体测试',entries:[one],current:1}),resolve:async()=>{reads++;return {site:'bili-course',page:target.url,title:one.title,mediaUrl:cdn,expectedSeconds:1,requireAudio:true,courseOrder:1}},close:async()=>{}});
 const getUpstream=async()=>({address:cdn,response:await new Promise(done=>http.get(`http://127.0.0.1:${server.address().port}/video.mp4`,done))});
 const options={episodes:'1',notify:()=>{},sessionFactory,download:(info,url,output)=>downloadResolved(info,url,output,{relayOptions:{getUpstream}})};
 try{
  const first=await downloadCourse(target.url,folder,options);assert.equal(first.failed,0);assert.equal(first.results[0].status,'saved');
  const second=await downloadCourse(target.url,folder,options);assert.equal(second.results[0].status,'skipped');assert.equal(reads,1);
  const state=await readFile(join(folder,'真实媒体测试','.bili-course-state.json'),'utf8');assert.equal(state.includes('https://'),false);assert.equal(state.includes('mediaUrl'),false);
  const {validate}=await import('../source/site-download.mjs');await assert.rejects(()=>validate(first.results[0].file,{requireAudio:true,expectedSeconds:120}),/整节课程/);
 }finally{server.closeAllConnections();await new Promise(done=>server.close(done));await cleanupTestFolder(folder)}
});


async function cleanupTestFolder(folder) {
 const absolute=resolve(folder);if(dirname(absolute)!==resolve(tmpdir())||!basename(absolute).startsWith('mengren-course-'))throw Error('Test cleanup path outside its generated directory');
 await rm(absolute,{recursive:true,force:true});
}

test('Classroom page reader binds declared total to loaded lessons before selecting',async()=>{
 const {runInNewContext}=await import('node:vm');const b=new BrowserFixture();
 const context={location:{origin:'https://www.bilibili.com',pathname:'/cheese/play/ep123'},document:{title:'测试课程',body:{innerText:'课程目录 共2课时'},querySelectorAll:()=>[{dataset:{episodeid:'123',cid:'456'},querySelector:()=>({textContent:'1 初级01-示例'})},{dataset:{episodeid:'124',cid:'457'},querySelector:()=>({textContent:'2 中级01-示例'})}]}};
 const reader=new CourseSession(b,{targetId:'OWN_PAGE',sessionId:'OWN_SESSION'},cheese,{notify:()=>{}});reader.evaluate=async expression=>runInNewContext(expression,context);
 const catalog=await reader.readCatalog({timeout:100});assert.equal(catalog.entries.length,2);
 assert.equal(cheeseCatalog([{id:'123',cid:'456',title:'初级01'}],'课程',cheese,97),null);await reader.close();
});

test('Actual course prompt preserves a typed answer and treats EOF as cancellation',async()=>{
 const {PassThrough}=await import('node:stream');
 const input=new PassThrough(),output=new PassThrough();const answer=askCourseLine('选择：',{input,output});input.end('中级\n');assert.equal(await answer,'中级');
 const ended=new PassThrough();const empty=askCourseLine('选择：',{input:ended,output:new PassThrough()});ended.end();assert.equal(await empty,null);
});

test('GUI requires a selection before opening a browser and never prompts',async()=>{
 let opened=0;await assert.rejects(()=>downloadCourse(mall.url,'unused-output',{gui:true,sessionFactory:async()=>{opened++},ask:async()=>{throw Error('MUST NOT PROMPT')}}),/--episodes/);assert.equal(opened,0);
});
test('Course list output and cache contain only catalog metadata, scoped to the same course',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'mengren-course-list-'));let closed=0;try{
 const catalog=mallCatalog(mallJson(),mall),file=join(folder,'list.json'),events=[];
 const session={readCatalog:async()=>catalog,close:async()=>closed++};
 const result=await downloadCourse(mall.url,folder,{gui:true,list:file,notify:()=>{},emit:e=>events.push(e),sessionFactory:async()=>session,ask:async()=>{throw Error('MUST NOT PROMPT')}});
 assert.equal(result.listed,true);assert.equal(events[0].type,'course');assert.equal(events[0].tracks.length,2);assert.equal(events[0].current,1);assert.equal(events[0].tracks[0].have,false);
 const body=await readFile(file,'utf8');assert.equal(body.includes('http'),false);assert.equal(body.includes('videoUrl'),false);assert.equal(body.includes('mid'),false);assert.equal(JSON.stringify(events).includes('sectionId'),false);
 assert.equal(readCourseListing(body,mall).entries[0].id,'78');assert.throws(()=>readCourseListing(body,{...mall,course:'999'}),/不属于/);
 const bad=JSON.parse(body);bad.entries[1].index=1;assert.throws(()=>readCourseListing(JSON.stringify(bad),mall),/失效/);
 }finally{await cleanupTestFolder(folder)}assert.equal(closed,1);
});
test('Cancellation closes an owned course tab even while waiting for login',async()=>{
 const b=new BrowserFixture(),reader=new CourseSession(b,{targetId:'OWN_PAGE',sessionId:'OWN_SESSION'},cheese,{cancelled:()=>true});reader.keepOpen=true;await reader.close();assert.deepEqual(b.calls.find(c=>c[0]==='closePages')[1],['OWN_PAGE']);
});
test('GUI classify routes courses before ordinary Bilibili and leaves normal videos alone',async()=>{
 const {classify}=await import('../source/gui-core.mjs');assert.equal(classify(cheese.url).kind,'course');assert.equal(classify(mall.url).kind,'course');assert.equal(classify('https://www.bilibili.com/video/BV1vL411G7N7').kind,'video');
});

test('GUI command exits promptly without stdin selection instead of hanging',async()=>{
 const result=await new Promise((done,reject)=>{
  const child=spawn(process.execPath,[join(process.cwd(),'source/bili-courses.mjs'),'--url',cheese.url,'--output','unused-output'],{env:{...process.env,MENGREN_GUI:'1'},windowsHide:true,stdio:['pipe','pipe','pipe']});let text='';const timer=setTimeout(()=>{child.kill();reject(Error('GUI worker waited for stdin'))},5000);child.stdout.on('data',d=>text+=d);child.stderr.on('data',d=>text+=d);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);done({code,text})});
 });assert.equal(result.code,1);assert.match(result.text,/--episodes/);
});
test('Classroom duration metadata is projected only from the requested course response',async()=>{
 const b=new BrowserFixture();b.body=JSON.stringify({code:0,data:{ep_count:2,episodes:[{id:123,duration:120,mid:'PRIVATE'},{id:124,duration:150}]}});const reader=await CourseSession.open(cheese,{browser:b});
 b.emit('Network.responseReceived',{requestId:'catalog',response:{status:200,url:'https://api.bilibili.com/pugv/view/web/season'}});b.emit('Network.loadingFinished',{requestId:'catalog'});await reader.drain();assert.equal(reader.durations.get('123'),120);assert.equal(reader.durations.has('PRIVATE'),false);
 const catalog=cheeseCatalog([{id:'123',cid:'456',title:'1 课时',duration:120}],'课',cheese,1);assert.equal(catalog.entries[0].expectedSeconds,120);await reader.close();
});
