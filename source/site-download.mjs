import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,readdir,unlink,rmdir,link,copyFile,writeFile,stat} from 'node:fs/promises';
import {dirname,join,basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {constants} from 'node:fs';
import {resolveSource} from './source-resolver.mjs';
import {xAddress} from './sites.mjs';
import {createRelay} from './relay.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const message=text=>console.log(String(text).replace(/https?:\/\/[^\s"<>]+/g,'[媒体地址]'));
let child,cancelled=false;
process.on('SIGINT',()=>{cancelled=true;child?.kill('SIGINT');process.exitCode=130;});
export const isCancelled=()=>cancelled;
// The window version (gui-server.mjs) runs these scripts without a console: it reads
// "@@mengren {json}" lines for structured results and sends a "cancel" line instead of Ctrl+C.
export const guiMode=process.env.MENGREN_GUI==='1';
export const guiEvent=value=>console.log('@@mengren '+JSON.stringify(value));
export const guiCommands=[];
if(guiMode) {
  let pending='';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data',text=>{
    const lines=(pending+text).split(/\r?\n/);pending=lines.pop();
    for(const line of lines.map(l=>l.trim()).filter(Boolean)) {
      if(line==='cancel') process.emit('SIGINT');
      else {try{guiCommands.push(JSON.parse(line));}catch{}}
    }
  });
  process.stdin.on('error',()=>{});
  // Listening must not keep a finished download alive.
  process.stdin.unref?.();
}
export async function run(executable,args,{quiet=false}={}) {
  return new Promise((resolve,reject)=>{
    let text='',pending='',nextProgress=0;
    const emit=line=>{
      if(/^\[(?:generic|info|hlsnative)\]/.test(line)||line.startsWith('[download] Destination:')) return;
      if(line.startsWith('[download]') && !/^\[download\] 100% of/.test(line)){if(Date.now()<nextProgress)return;nextProgress=Date.now()+1000;}
      message(line);
    };
    child=spawn(executable,args,{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});
    const receive=data=>{
      const value=data.toString('utf8');text=(text+value).slice(-500000);pending+=value;
      const lines=pending.split(/\r?\n/);pending=lines.pop();
      if(!quiet) for(const line of lines) emit(line);
    };
    child.stdout.on('data',receive);child.stderr.on('data',receive);
    child.on('error',()=>reject(new Error('无法启动项目内下载或合并组件')));
    child.on('close',code=>{child=null;if(!quiet&&pending)emit(pending);resolve({code,text});});
  });
}
export async function validate(file,{requireAudio=false,expectedSeconds=0}={}) {
  const answer=await run(join(root,'ffmpeg.exe'),['-hide_banner','-i',file],{quiet:true});
  if(requireAudio&&!/Stream .*Audio:/.test(answer.text)) throw new Error('抓到的是独立视频轨道，尚未匹配音轨，未保存为完整视频');
  if(!/Stream .*Video:/.test(answer.text)) throw new Error('文件缺少视频轨道，未作为完整视频保存');
  const duration=answer.text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if(!duration || Number(duration[1])*3600+Number(duration[2])*60+Number(duration[3])<=0) throw new Error('文件播放时长无效');
  const seconds=Number(duration[1])*3600+Number(duration[2])*60+Number(duration[3]);
  if(expectedSeconds>0&&Math.abs(seconds-expectedSeconds)>3)throw new Error('文件时长与整节课程不一致，未作为完整课程保存');
  return {seconds};
}
// Preserve source timestamps when checking variable-frame-rate course material.
export async function validateCourseDecode(file,seconds) {
  for(const offset of [0,Math.max(0,seconds-8)]) {
    const answer=await run(join(root,'ffmpeg.exe'),['-hide_banner','-loglevel','error','-ss',String(offset),'-i',file,'-t','4','-fps_mode','passthrough','-enc_time_base','demux','-f','null','-'],{quiet:true});
    if(answer.code!==0||answer.text.trim())throw new Error('课程文件首尾解码检查失败，未保存');
  }
}
export async function cleanup(job,output) {
  if(dirname(job)!==output || !basename(job).startsWith('.mengren-')) throw new Error('临时目录范围校验失败');
  for(const file of await readdir(job)) {
    if(file.includes('/')||file.includes('\\')) throw new Error('临时文件名称无效');
    await unlink(join(job,file)).catch(()=>{});
  }
  await rmdir(job).catch(()=>{});
}
export const ownerFile='.owner';
function running(pid) {try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}}
// Closing the window mid-download kills this process before cleanup. Remove such
// leftovers next time: only our own .mengren-XXXXXX folders whose owner process has
// exited, or legacy folders without an owner record that are a day old.
export async function removeAbandonedJobs(output,{now=Date.now()}={}) {
  let entries;try{entries=await readdir(output,{withFileTypes:true});}catch{return 0;}
  let removed=0;
  for(const entry of entries) {
    if(!entry.isDirectory()||!/^\.mengren-[A-Za-z0-9]{6}$/.test(entry.name)) continue;
    const job=join(output,entry.name);
    try {
      let pid;try{pid=JSON.parse(await readFile(join(job,ownerFile),'utf8')).pid;}catch{}
      if(Number.isInteger(pid)?running(pid):now-(await stat(job)).mtimeMs<86400000) continue;
      if((await readdir(job,{withFileTypes:true})).some(item=>!item.isFile())) continue;
      await cleanup(job,output);removed++;
    } catch { }
  }
  return removed;
}
export function safeStem(text,fallback='视频') {
  let name=String(text||fallback).replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').trim().slice(0,110).replace(/[. ]+$/,'');
  if(!name || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name=fallback+' '+name;
  return name;
}
// File names are the plain title; saveCompleted adds (2) instead of overwriting.
export function videoFileName(title,{order}={}) {
  let name=safeStem(title);
  let prefix='';if(Number.isInteger(order)&&order>0){prefix=String(order).padStart(2,'0')+'. ';name=name.replace(new RegExp('^0*'+order+'[.．、]\\s*(?![0-9])'),'');}
  return prefix+name+'.mp4';
}
export async function saveCompleted(source,output,name) {
  // Same-filesystem hard linking publishes the validated file without copying a
  // large video or replacing an existing user file. FAT/exotic filesystems fall back.
  const ext=name.match(/\.[A-Za-z0-9]{1,5}$/)?.[0]||'',stem=name.slice(0,name.length-ext.length);
  for(let index=1;index<=10000;index++) {
    const target=join(output,index===1?name:stem+' ('+index+')'+ext);
    try {
      try{await link(source,target);}catch(error){if(!['EPERM','ENOSYS','ENOTSUP','EOPNOTSUPP','EXDEV','EINVAL'].includes(error.code))throw error;await copyFile(source,target,constants.COPYFILE_EXCL);}
      return target;
    }catch(error){if(error.code!=='EEXIST')throw error;}
  }
  throw Error('同名视频过多，请更改课程名称或保存目录');
}
export async function downloadSite(address,output,{probe=false,quality='best',timeout}={}) {
  if(xAddress(address)) return downloadX(address,output,{probe,quality,timeout});
  const info=await resolveSource(address,{timeout,notify:message,isCancelled:()=>cancelled,quality});
  return downloadResolved(info,address,output,{probe});
}
// X posts that need a login: read the post in the dedicated Edge, then save every
// video of it. Titles get " #1", " #2" like yt-dlp's names for the public path.
async function downloadX(address,output,{probe,quality,timeout}) {
  const {resolveX}=await import('./x-browser.mjs');
  const post=await resolveX(address,{quality,timeout,notify:message,isCancelled:()=>cancelled});
  const many=post.videos.length>1;
  if(probe) {
    message('已识别：'+post.title);
    post.videos.forEach((video,index)=>message(`${many?'第 '+(index+1)+' 段：':''}可下载 ${video.renditions.map(r=>r.height?r.width+'x'+r.height:'未知尺寸').join('、')}`));
    message('视频来源验证成功。');
    return {site:'x',title:post.title,videos:post.videos.length};
  }
  const files=[];
  for(const [index,video] of post.videos.entries()) {
    if(cancelled) throw new Error('下载已取消');
    const title=many?`${post.title} #${index+1}`:post.title;
    files.push((await downloadResolved({site:'x',page:post.page,title,mediaUrl:video.renditions[0].url,renditions:video.renditions},address,output)).file);
  }
  if(many) message(`这条帖子有 ${files.length} 段视频，已全部保存。`);
  return {site:'x',title:post.title,files};
}
export async function downloadResolved(info,address,output,{probe=false,relayOptions={}}={}) {
  message('已识别：'+info.title);
  message(info.site==='bili-course'?'将下载账号获准的完整课程，保留网站提供的音画并核对时长。':info.site==='bili'?'将下载当前账号可获取的 B 站画质并合并音画。':info.site==='x'?'将按所选画质上限下载 X 网页提供的视频。':'将下载网站提供的原始视频；当前平台入口不承诺可切换分辨率。');
  const outputPath=resolve(output);message('保存位置：'+outputPath);
  if(!probe) {await mkdir(outputPath,{recursive:true});if(await removeAbandonedJobs(outputPath))message('已清理上次中断留下的临时文件。');}
  const job=probe?null:await mkdtemp(join(outputPath,'.mengren-'));
  if(job) await writeFile(join(job,ownerFile),JSON.stringify({pid:process.pid}));
  const choices=info.renditions||[{url:info.mediaUrl}];let lastError;
  try {
    for(const rendition of choices.slice(0,4)) {
      if(cancelled) throw new Error('下载已取消');
      const relay=await createRelay(info.site,rendition.url,info.site==='channels'?'https://channels.weixin.qq.com/':new URL(info.page).origin+'/',relayOptions);
      try {
        const args=['--proxy','','--ignore-config','--no-plugin-dirs','--no-playlist','--no-warnings','--encoding','utf-8','--match-filter','!is_live','--progress-delta','1','--socket-timeout','30','--retries','3','--fragment-retries','3','--abort-on-unavailable-fragments','--concurrent-fragments','6','--hls-prefer-native','--fixup','never','--format','best'];
        if(probe) args.push('--simulate','--print','__MENGREN_SOURCE_OK__ %(duration)s');
        else args.push('--newline','--no-continue','--force-overwrites','--output',join(job,'source.%(ext)s'));
        args.push('--',relay.url);
        const result=await run(join(root,'yt-dlp.exe'),args,{quiet:probe});
        if(result.code!==0) throw new Error('当前线路读取失败');
        if(probe) {if(!result.text.includes('__MENGREN_SOURCE_OK__'))throw new Error('当前来源不是可下载的已结束视频');message('视频来源验证成功。');return {site:info.site,title:info.title};}
        const files=(await readdir(job)).filter(name=>/^source\.(?:mp4|mkv|webm|ts|mov|m4v)$/.test(name));
        if(files.length!==1) throw new Error('下载未生成完整视频文件');
        const source=join(job,files[0]);
        // A captured lesson may be sound only (an audio course). Keep it as m4a and say so,
        // instead of failing with "no video track".
        if(info.site==='capture') {
          const probe=await run(join(root,'ffmpeg.exe'),['-hide_banner','-i',source],{quiet:true});
          if(/Stream .*Audio:/.test(probe.text)&&!/Stream .*Video:/.test(probe.text)) {
            const sound=join(job,'completed.m4a');
            const remux=await run(join(root,'ffmpeg.exe'),['-hide_banner','-loglevel','error','-y','-i',source,'-map','0:a:0','-c','copy','-movflags','+faststart',sound],{quiet:true});
            const length=(await run(join(root,'ffmpeg.exe'),['-hide_banner','-i',sound],{quiet:true})).text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
            if(remux.code!==0||!length||Number(length[1])*3600+Number(length[2])*60+Number(length[3])<=0) throw new Error('下载到的文件只有声音，而且音频保存失败');
            const target=await saveCompleted(sound,outputPath,videoFileName(info.title,{order:info.courseOrder}).replace(/\.mp4$/,'.m4a'));
            message('下载完成：'+target);message('下载到的文件只有声音、没有画面，已保存为 m4a 音频。如果原课程是有画面的视频，说明画面被加密或单独传输，软件下载不了画面。');
            return {site:info.site,title:info.title,file:target,audioOnly:true};
          }
        }
        await validate(source);
        let soundPath;
        if(info.audioUrl) {
          const soundRelay=await createRelay(info.site,info.audioUrl,new URL(info.page).origin+'/',relayOptions);
          try {
            const soundArgs=['--proxy','','--ignore-config','--no-plugin-dirs','--no-playlist','--no-warnings','--encoding','utf-8','--socket-timeout','30','--retries','3','--no-continue','--output',join(job,'sound.%(ext)s'),'--',soundRelay.url];
            const soundResult=await run(join(root,'yt-dlp.exe'),soundArgs);
            if(soundResult.code!==0)throw new Error('独立音轨下载失败');
            const soundFiles=(await readdir(job)).filter(name=>/^sound\.(?:mp4|m4a|mkv|webm|aac)$/.test(name));
            if(soundFiles.length!==1)throw new Error('独立音轨文件不完整');soundPath=join(job,soundFiles[0]);
          } finally {await soundRelay.close();}
        }
        const merged=join(job,'completed.mp4');
        message('正在合并为本地 MP4 文件……');
        const mux=await run(join(root,'ffmpeg.exe'),['-hide_banner','-loglevel','error','-y','-i',source,...(soundPath?['-i',soundPath]:[]),'-map','0:v:0','-map',soundPath?'1:a:0':'0:a:0?','-c','copy','-movflags','+faststart',merged],{quiet:true});
        if(mux.code!==0) throw new Error('MP4 合并失败，没有保存为成功结果');
        await validate(merged,{requireAudio:Boolean(info.requireAudio),expectedSeconds:info.expectedSeconds||0});
        if(info.site==='bili-course') await validateCourseDecode(merged,info.expectedSeconds);
        const target=await saveCompleted(merged,outputPath,videoFileName(info.title,{order:['capture','bili-course'].includes(info.site)?info.courseOrder:undefined}));
        message('下载完成：'+target);return {site:info.site,title:info.title,file:target};
      } catch(error) {
        if(cancelled) throw new Error('下载已取消');
        lastError=error;
        if(job) for(const file of await readdir(job)) if(file!==ownerFile) await unlink(join(job,file)).catch(()=>{});
        if(choices.length>1) message(info.site==='x'?'这个画质下载未成功，改试下一档。':'这条回放线路未成功，正在尝试下一条网站提供的线路。');
      } finally {await relay.close();}
    }
    throw new Error(lastError?.message || '没有可用视频线路');
  } finally {if(job) await cleanup(job,outputPath);}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
  try {
    const address=value('--url'),output=value('--output');
    if(!args.includes('--url') || !args.includes('--output') || !address || !output) throw new Error('缺少链接或保存目录');
    await downloadSite(address,output,{probe:args.includes('--probe'),quality:args.includes('--quality')?value('--quality'):'best'});
  } catch(error) {message('未下载成功：'+(error?.message||'请重新读取链接'));message('请确认专用 Edge 登录、课程权限和当前链接后重试；临时播放地址未写入日志。');process.exitCode=cancelled?130:1;}
}
