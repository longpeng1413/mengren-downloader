import {spawn,spawnSync} from 'node:child_process';
import {mkdir,open,unlink,readFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline';
import {createCaptureProxy} from './capture-proxy.mjs';
import {downloadResolved} from './site-download.mjs';
import {describeCapture,runCaptureMenu} from './capture-menu.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),helper=join(root,'CaptureHelper.exe');
const data=join(process.env.LOCALAPPDATA||'','MengrenDownloader','Capture');
function command(action,...args){const result=spawnSync(helper,[action,data,...args.map(String)],{encoding:'utf8',windowsHide:true});if(result.status!==0)throw Error(result.stderr.trim()||'抓取辅助模块启动失败');return result.stdout.trim();}
export function parseUpstream(backup) {
  if(!Number(backup.ProxyEnable?.value))return null;
  const text=String(backup.ProxyServer?.value||'');
  const choice=text.includes('=')?text.split(';').find(s=>s.startsWith('https='))?.slice(6)||text.split(';').find(s=>s.startsWith('http='))?.slice(5):text;
  if(!choice)return null;
  if(!/^[a-zA-Z0-9.-]+:\d+$/.test(choice))throw Error('原代理格式暂不支持，未改动设置。请先退出其他抓包代理再试。');
  const [host,port]=choice.split(':');return {host,port:Number(port)};
}
async function main(output){
  if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw Error('抓取模式需要 Windows 当前用户环境');
  console.log('\n猛人下载器：播放抓取模式（试用）');
  console.log('开启后临时修改当前用户的系统代理，并信任本机生成的抓取证书。其他电脑会生成自己的证书，不携带登录状态。');
  console.log('只解读课程及常见媒体域名，仅临时读取课程响应中的名称与媒体关联，不保存完整响应、请求正文、Cookie 或登录凭证。微信登录/聊天/支付域名只转发加密连接。');
  console.log('原代理会保存并尽量复用；退出自动恢复。遇到异常可双击“恢复网络.cmd”。其他软件中途改了代理时不会强行覆盖。');
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  let inputClosed=false;rl.once('close',()=>{inputClosed=true;});
  const ask=q=>inputClosed?Promise.resolve(''):new Promise(done=>{let settled=false;const finish=value=>{if(settled)return;settled=true;rl.removeListener('close',closed);done(value);};const closed=()=>finish('');rl.once('close',closed);rl.question(q,finish);});
  let proxy,lock,activated=false,quitting=false,lastWarning=0;
  const diagnostic=code=>{if(/CERT|TLS|SSL/.test(code)&&Date.now()>lastWarning){lastWarning=Date.now()+10000;console.log('网站证书校验未通过，该请求没有放行；若课程不能播放，请退出抓取。错误：'+code);}};
  async function cleanup(){if(quitting)return;quitting=true;rl.close();if(proxy)await proxy.close();if(activated){try{command('end',process.pid);}catch{console.log('自动恢复未完成，请关闭抓取窗口后运行“恢复网络.cmd”；原设置备份仍保留。');}}if(lock){await lock.close();await unlink(join(data,'capture.lock')).catch(()=>{});}}
  process.on('SIGINT',()=>{cleanup().then(()=>process.exit(130));});process.on('SIGTERM',()=>{cleanup().then(()=>process.exit(130));});
  try {
    if((await ask('确认上述影响后，输入 开启；其他输入返回：')).trim()!=='开启')return;
    await mkdir(data,{recursive:true});
    try{lock=await open(join(data,'capture.lock'),'wx',0o600);await lock.writeFile(JSON.stringify({pid:process.pid}));}catch{throw Error('已有抓取会话或上次未恢复。请先退出原抓取窗口，再运行“恢复网络.cmd”。');}
    command('init');
    const saved=JSON.parse(command('routing'));
    proxy=await createCaptureProxy({data,helper,upstream:parseUpstream(saved),onDiagnostic:diagnostic,onMedia:item=>console.log('\n发现 '+describeCapture(item)+'；输入 '+item.id+' 下载（也可输入 全部 批量下载）。'),onTitle:item=>console.log('\n识别课程名：'+describeCapture(item))});
    activated=true;command('proxy-on','127.0.0.1:'+proxy.port);
    command('trust');
    const guard=spawn(helper,['guard',data,String(process.pid)],{detached:true,stdio:'ignore',windowsHide:true});await new Promise((done,reject)=>{guard.once('spawn',done);guard.once('error',()=>reject(Error('后台网络恢复进程未能启动，已停止抓取')));});guard.unref();
    console.log('抓取已开启。现在去微信、小程序或网页播放你有权限观看的视频，再回到本窗口。');
    await runCaptureMenu({catalog:proxy.catalog,ask,shouldQuit:()=>quitting,download:item=>downloadResolved({site:'capture',title:item.title,page:item.referer||item.url,mediaUrl:item.url,requireAudio:true,fileNameStyle:'title',courseOrder:item.courseOrder||item.id},item.url,output,{relayOptions:{allowMedia:proxy.allows,getUpstream:proxy.getMedia,playlist:item.kind==='hls'}})});
  }finally{await cleanup();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const index=process.argv.indexOf('--output');if(index<0||!process.argv[index+1])throw Error('缺少保存目录');await main(process.argv[index+1]);}catch(error){console.log('抓取未开启或已停止：'+String(error.message).replace(/https?:\/\/[^\s"<>]+/g,'[地址]'));process.exitCode=1;}
}