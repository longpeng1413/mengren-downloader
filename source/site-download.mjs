import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,readdir,unlink,rmdir,rename,access} from 'node:fs/promises';
import {dirname,join,basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {resolveSource} from './source-resolver.mjs';
import {createRelay} from './relay.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const message=text=>console.log(String(text).replace(/https?:\/\/[^\s"<>]+/g,'[媒体地址]'));
let child,cancelled=false;
process.on('SIGINT',()=>{cancelled=true;child?.kill('SIGINT');process.exitCode=130;});
async function run(executable,args,{quiet=false}={}) {
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
export async function validate(file,{requireAudio=false}={}) {
  const answer=await run(join(root,'ffmpeg.exe'),['-hide_banner','-i',file],{quiet:true});
  if(requireAudio&&!/Stream .*Audio:/.test(answer.text)) throw new Error('抓到的是独立视频轨道，尚未匹配音轨，未保存为完整视频');
  if(!/Stream .*Video:/.test(answer.text)) throw new Error('文件缺少视频轨道，未作为完整视频保存');
  const duration=answer.text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if(!duration || Number(duration[1])*3600+Number(duration[2])*60+Number(duration[3])<=0) throw new Error('文件播放时长无效');
}
async function cleanup(job,output) {
  if(dirname(job)!==output || !basename(job).startsWith('.mengren-')) throw new Error('临时目录范围校验失败');
  for(const file of await readdir(job)) {
    if(file.includes('/')||file.includes('\\')) throw new Error('临时文件名称无效');
    await unlink(join(job,file)).catch(()=>{});
  }
  await rmdir(job).catch(()=>{});
}
function fileName(title,address) {
  let name=String(title||'视频').replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/[. ]+$/,'').trim().slice(0,110);
  if(!name || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name='视频 '+name;
  return name+' ['+createHash('sha256').update(address).digest('hex').slice(0,10)+'].mp4';
}
export async function downloadSite(address,output,{probe=false,quality='best',timeout}={}) {
  const info=await resolveSource(address,{timeout,notify:message,isCancelled:()=>cancelled,quality});
  return downloadResolved(info,address,output,{probe});
}
export async function downloadResolved(info,address,output,{probe=false,relayOptions={}}={}) {
  message('已识别：'+info.title);
  message(info.site==='bili'?'将下载当前账号可获取的 B 站画质并合并音画。':'将下载网站提供的原始视频；当前平台入口不承诺可切换分辨率。');
  const outputPath=resolve(output);message('保存位置：'+outputPath);if(!probe) await mkdir(outputPath,{recursive:true});
  const job=probe?null:await mkdtemp(join(outputPath,'.mengren-'));
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
        const source=join(job,files[0]);await validate(source);
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
        await validate(merged,{requireAudio:Boolean(info.requireAudio)});
        let target=join(outputPath,fileName(info.title,address));
        try {await access(target);target=target.replace(/\.mp4$/,`-${Date.now()}.mp4`);} catch { }
        await rename(merged,target);message('下载完成：'+target);return {site:info.site,title:info.title,file:target};
      } catch(error) {
        if(cancelled) throw new Error('下载已取消');
        lastError=error;
        if(job) for(const file of await readdir(job)) await unlink(join(job,file)).catch(()=>{});
        if(choices.length>1) message('这条回放线路未成功，正在尝试下一条网站提供的线路。');
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
