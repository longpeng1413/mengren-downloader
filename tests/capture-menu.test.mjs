import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,unlink,rmdir} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {CaptureCatalog} from '../source/capture-proxy.mjs';
import {courseResponse,extractCourseMetadata,courseTitle} from '../source/capture-course.mjs';
import {selectCapture,runCaptureMenu,describeCapture} from '../source/capture-menu.mjs';
import {videoFileName,saveCompleted} from '../source/site-download.mjs';
const allowed=url=>new URL(url).hostname==='file.justkami.com';
const response={statusCode:200,headers:{'content-type':'video/mp4'}};
const media=n=>'https://file.justkami.com/lesson-'+n+'.mp4';
function catalog(count=3){const c=new CaptureCatalog();for(let n=1;n<=count;n++)c.observe(media(n),response);return c;}
async function menu(c,inputs,download){const prompts=[],logs=[];await runCaptureMenu({catalog:c,ask:async q=>{prompts.push(q);assert.ok(inputs.length,'Unexpected extra prompt');return inputs.shift();},download,log:s=>logs.push(s)});return {prompts,logs};}
test('Explicit media associations bind course titles before or after capture, across renewed signatures',()=>{
 const c=catalog(2);
 const document={data:{courseName:'订阅专栏',lessons:[{videoName:'1. 峰级线基础画法',videoUrl:media(1)+'?token=secret'},{title:'2. 整理盘面',video:{url:media(2)}}]},user:{name:'private account',url:media(1)}};
 assert.equal(extractCourseMetadata(document,allowed).length,2);
 assert.equal(c.learn(document,allowed).length,2);
 assert.equal(c.items[0].title,'1. 峰级线基础画法');assert.equal(c.items[1].title,'2. 整理盘面');
 c.observe(media(1)+'?token=renewed',response);assert.equal(c.items.length,2);assert.equal(c.items[0].url,media(1)+'?token=renewed');
 c.items[0].title='用户更正名称';c.items[0].titleSource='manual';c.learn(document,allowed);assert.equal(c.items[0].title,'用户更正名称');
 const before=new CaptureCatalog();before.learn(document,allowed);before.observe(media(1),response);assert.equal(before.items[0].title,'1. 峰级线基础画法');
 assert.equal(courseResponse('https://m.justkami.com/video/detail','application/json'),true);assert.equal(courseResponse('https://m.justkami.com/account/video/detail','application/json'),false);assert.equal(courseResponse('https://outside.invalid/video/detail','application/json'),false);
 assert.equal(courseTitle('https://file.justkami.com/video?token=secret'),null);assert.equal(JSON.stringify([...c.names.values()]).includes('private'),false);
 c.clear();assert.equal(c.names.size,0);assert.equal(c.items.length,0);
});
test('Headers can provide a readable course filename, ambiguous parent titles do not name every lesson',()=>{
 const c=new CaptureCatalog();c.observe(media(1),{statusCode:200,headers:{...response.headers,'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('峰级线基础画法.mp4')}});assert.equal(c.items[0].title,'峰级线基础画法');
 assert.deepEqual(extractCourseMetadata({title:'专栏',lessons:[{videoUrl:media(2)}]},allowed),[]);
 assert.deepEqual(extractCourseMetadata({user:{name:'个人姓名',url:media(2)},title:'bad',videoUrl:'https://outside.invalid/video.mp4'},allowed),[]);
 // Different content identifiers on a common endpoint remain different lessons.
 c.observe('https://file.justkami.com/play?code=1&token=a',response);c.observe('https://file.justkami.com/play?code=2&token=b',response);assert.equal(c.items.length,3);
 c.observe('https://file.justkami.com/play?token=one',response);c.observe('https://file.justkami.com/play?token=two',response);assert.equal(c.items.length,5);
});
test('A permitted course response with eight explicit named media links forms a single selectable series',()=>{
 const c=new CaptureCatalog(),lessons=Array.from({length:8},(_,i)=>({videoName:'第'+(i+1)+'课',videoUrl:media(i+1)}));
 c.learn({data:{courseName:'系列',lessons}},allowed);assert.equal(c.items.length,8);assert.equal(selectCapture('全部',c.items).length,8);assert.equal(c.items.every(x=>x.source==='course-list'),true);
 c.observe(media(3),response);assert.equal(c.items.length,8);assert.equal(c.items[2].source,'playback');
});
test('Audio and HLS chunks cannot evict a captured series or consume course numbers',()=>{
 const c=catalog(8);for(let n=0;n<400;n++)c.observe('https://file.justkami.com/segment-'+n+'.ts',{statusCode:200,headers:{'content-type':'video/mp2t'}});
 assert.equal(c.items.length,8);assert.equal(c.serial,8);assert.deepEqual(selectCapture('全部',c.items).map(x=>x.id),[1,2,3,4,5,6,7,8]);
 const list=new CaptureCatalog();list.learn({videoName:'课程',videoUrl:media(1)},allowed,'https://m.justkami.com/');assert.equal(list.items[0].referer,'https://m.justkami.com/');list.observe(media(1),response,{headers:{referer:'https://m.justkami.com/video/detail?token=private'}});assert.equal(list.items[0].referer,'https://m.justkami.com/');
});
test('Selection supports whole pending list, ranges and multiple IDs, and validates before downloading',()=>{
 const c=catalog(8);c.items[2].downloaded=true;
 assert.deepEqual(selectCapture('1-8',c.items).map(x=>x.id),[1,2,3,4,5,6,7,8]);
 assert.deepEqual(selectCapture('1, 3，5、1',c.items).map(x=>x.id),[1,3,5]);assert.equal(selectCapture('全部',c.items).length,7);
 assert.throws(()=>selectCapture('1,99',c.items),/99/);assert.throws(()=>selectCapture('8-1',c.items),/范围/);assert.throws(()=>selectCapture('1-9999',c.items),/范围/);
 c.items[1].kind='track';assert.throws(()=>selectCapture('1-3',c.items),/独立片段/);assert.equal(selectCapture('全部',c.items).length,6);
});
test('Real menu requires a course name, displays numeric instructions and continues a failed queue',async()=>{
 const c=catalog(),downloads=[];c.items[1].title='第二课';c.items[2].title='第三课';
 const out=await menu(c,['列表','命名 3 第三课更正','全部','第一课',''],async item=>{downloads.push(item.title);if(item.id===2)throw Error('expired https://private.invalid/?token=secret');});
 assert.deepEqual(downloads,['第一课','第二课','第三课更正']);assert.equal(c.items[0].downloaded,true);assert.equal(c.items[1].downloaded,undefined);
 assert.ok(out.prompts.some(s=>s.includes('请输入原课程名称')));assert.ok(out.prompts.some(s=>s.includes('输入数字')));assert.ok(out.logs.some(s=>s.includes('例如 1')));assert.ok(out.logs.some(s=>s.includes('成功 2，失败 1')));assert.equal(out.logs.join('\n').includes('secret'),false);
 assert.ok(describeCapture(c.items[0]).includes('第一课'));
});
test('Unknown names cancel instead of generating timestamps; newly captured videos do not join an active batch',async()=>{
 const c=catalog(),downloads=[];
 const out=await menu(c,['1-3','',''],async item=>downloads.push(item));assert.equal(downloads.length,0);assert.ok(out.logs.some(s=>s.includes('取消 3')));
 for(const item of c.items)item.title='第'+item.id+'课';
 await menu(c,['全部',''],async item=>{downloads.push(item.id);if(item.id===1)c.observe(media(4),response);});assert.deepEqual(downloads,[1,2,3]);assert.equal(c.items[3].downloaded,undefined);
 const invalid=catalog();await menu(invalid,['1,9',''],async()=>assert.fail('Invalid selection must not start a download'));
});
test('Captured names have no hash suffix, and concurrent saves preserve existing same-name files',async()=>{
 assert.equal(videoFileName('《边缘循环》10.08',media(1),{titleOnly:true}),'《边缘循环》10.08.mp4');
 assert.equal(videoFileName('1. 峰级线基础画法',media(1),{titleOnly:true}),'1. 峰级线基础画法.mp4');assert.equal(videoFileName('CON',media(1),{titleOnly:true}),'视频 CON.mp4');
 assert.equal(videoFileName('../基础:画法? ',media(1),{titleOnly:true}),'.. 基础 画法.mp4');assert.match(videoFileName('旧平台',media(1)),/旧平台 \[[a-f0-9]{10}\]\.mp4/);
 const folder=await mkdtemp(join(tmpdir(),'mengren-course-names-'));
 try{
  const source=join(folder,'completed.mp4'),existing=join(folder,'课程.mp4');await writeFile(source,'new');await writeFile(existing,'original');
  const saved=await Promise.all([saveCompleted(source,folder,'课程.mp4'),saveCompleted(source,folder,'课程.mp4')]);
  assert.equal(new Set(saved).size,2);assert.equal(await readFile(existing,'utf8'),'original');assert.equal(saved.every(s=>/课程 \([23]\)\.mp4$/.test(s)),true);
  for(const file of saved)assert.equal(await readFile(file,'utf8'),'new');
 }finally{for(const f of await readdir(folder))await unlink(join(folder,f));await rmdir(folder);}
});
