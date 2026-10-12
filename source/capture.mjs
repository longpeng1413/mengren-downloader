import {spawn,spawnSync} from 'node:child_process';
import {mkdir,open,unlink,readFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline';
import {createCaptureProxy} from './capture-proxy.mjs';
import {downloadResolved} from './site-download.mjs';
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
function describe(item){return '['+item.id+'] '+({video:'视频',hls:'分段视频',track:'音频/独立片段'}[item.kind])+' | '+item.host+' | '+(item.size?(item.size/1048576).toFixed(1)+' MiB':'大小待下载后确认');}
async function main(output){
  if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw Error('抓取模式需要 Windows 当前用户环境');
  console.log('\n猛人下载器：播放抓取模式（试用）');
  console.log('开启后临时修改当前用户的系统代理，并信任本机生成的抓取证书。其他电脑会生成自己的证书，不携带登录状态。');
  console.log('只解读课程及常见媒体域名，不保存请求正文、Cookie 或登录凭证。微信登录/聊天/支付域名只转发加密连接。');
  console.log('原代理会保存并尽量复用；退出自动恢复。遇到异常可双击“恢复网络.cmd”。其他软件中途改了代理时不会强行覆盖。');
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  const ask=q=>new Promise(done=>{let settled=false;const finish=value=>{if(settled)return;settled=true;rl.removeListener('close',closed);done(value);};const closed=()=>finish('');rl.once('close',closed);rl.question(q,finish);});
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
    proxy=await createCaptureProxy({data,helper,upstream:parseUpstream(saved),onDiagnostic:diagnostic,onMedia:item=>console.log('\n发现 '+describe(item))});
    activated=true;command('proxy-on','127.0.0.1:'+proxy.port);
    command('trust');
    const guard=spawn(helper,['guard',data,String(process.pid)],{detached:true,stdio:'ignore',windowsHide:true});await new Promise((done,reject)=>{guard.once('spawn',done);guard.once('error',()=>reject(Error('后台网络恢复进程未能启动，已停止抓取')));});guard.unref();
    console.log('抓取已开启。现在去微信、小程序或网页播放你有权限观看的视频，再回到本窗口。');
    console.log('输入 列表 查看；输入编号下载；输入 清空 清空本次候选；直接回车返回并恢复网络。');
    while(!quitting){const input=(await ask('抓取操作：')).trim();if(!input||input==='退出'||input.toLowerCase()==='q')break;
      if(input==='列表'||input.toLowerCase()==='l'){if(!proxy.catalog.items.length)console.log('还没有发现媒体。请播放视频；若仍无记录，先退出抓取、重新打开对应课程页面再试。');else for(const x of proxy.catalog.items)console.log(describe(x));continue;}
      if(input==='清空'){proxy.catalog.items.length=0;console.log('已清空候选，请只播放要下载的那一个视频。');continue;}
      const item=proxy.catalog.items.find(x=>String(x.id)===input);if(!item){console.log('请输入候选编号、列表、清空，或直接回车返回。');continue;}
      if(item.kind==='track'){console.log('这是音频或独立片段，不作为完整视频下载；请寻找视频或分段视频清单。');continue;}
      try{const title='抓取视频 '+new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);await downloadResolved({site:'capture',title,page:item.referer||item.url,mediaUrl:item.url,requireAudio:true},item.url,output,{relayOptions:{allowMedia:proxy.allows,getUpstream:proxy.getMedia}});}catch(error){console.log('未保存为成功结果：'+String(error.message).replace(/https?:\/\/[^\s"<>]+/g,'[媒体地址]'));console.log('可重新播放后选新编号；受保护、仅片段、独立音轨或必须携带登录凭证的地址暂不保证。');}
    }
  }finally{await cleanup();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const index=process.argv.indexOf('--output');if(index<0||!process.argv[index+1])throw Error('缺少保存目录');await main(process.argv[index+1]);}catch(error){console.log('抓取未开启或已停止：'+String(error.message).replace(/https?:\/\/[^\s"<>]+/g,'[地址]'));process.exitCode=1;}
}