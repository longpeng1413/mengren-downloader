import {courseTarget} from './bili-course-target.mjs';
import {basename} from 'node:path';
// Pure helpers of the window version (gui-server.mjs), kept apart so tests can load them.

export const redact=text=>String(text).replace(/https?:\/\/[^\s"<>]+/g,'[地址]');

const shareHosts=/(^|\.)(douyin\.com|iesdouyin\.com|bilibili\.com|b23\.tv|youtube\.com|youtu\.be|x\.com|twitter\.com|ximalaya\.com|xima\.tv|weixin\.qq\.com|y\.qq\.com|xet\.tech|xetslk\.com|xetlk\.com|xiaoeknow\.com|xiaoe-tech\.com)$/;
// Same rule as download.ps1: a bare link is used as is; inside share text the first
// link of a supported site is taken, with trailing Chinese punctuation removed.
export function extractLink(text) {
  const value=String(text??'').trim();
  try {const u=new URL(value);if(['http:','https:'].includes(u.protocol)&&!/\s/.test(value))return u.href;} catch {}
  for(const m of value.matchAll(/https?:\/\/[^\s<>"“”]+/g)) {
    const candidate=m[0].replace(/[。，、；;！!)\]}）】]+$/,'');
    try {if(shareHosts.test(new URL(candidate).hostname.toLowerCase()))return candidate;} catch {}
  }
  return null;
}
const hostIs=(host,list)=>list.some(d=>host===d||host.endsWith('.'+d));
// kind: video = download.ps1 (yt-dlp, with the existing browser fallbacks); qq / xmly =
// read first, then the user picks a quality or episodes.
export function classify(address) {
  let u;try{u=new URL(address);}catch{return null;}
  if(!['http:','https:'].includes(u.protocol)) return null;
  const host=u.hostname.toLowerCase();
  const course=courseTarget(address);if(course)return {kind:'course',site:course.kind==='cheese'?'B 站课堂':'B 站会员购',quality:course.kind==='cheese',note:'在专用 Edge 登录购买账号后，勾选要下载的课时。'};
  if(hostIs(host,['y.qq.com'])) return {kind:'qq',site:'QQ 音乐'};
  if(hostIs(host,['ximalaya.com'])||host==='xima.tv') return {kind:'xmly',site:'喜马拉雅'};
  if(hostIs(host,['youtube.com','youtu.be'])) return {kind:'video',site:'YouTube',quality:true};
  if(hostIs(host,['bilibili.com','b23.tv'])) return {kind:'video',site:'B 站',quality:true};
  if(hostIs(host,['x.com','twitter.com'])) return {kind:'video',site:'X',quality:true,note:'需要登录才能看的帖子，会打开下载专用 Edge 让你登录 X（只需一次）。'};
  if(hostIs(host,['douyin.com','iesdouyin.com'])) return {kind:'video',site:'抖音',note:'会打开下载专用 Edge 读取视频，下载网页提供的原始画质。'};
  if(host==='weixin.qq.com'||host==='channels.weixin.qq.com') return {kind:'video',site:'视频号',note:'分享链接会交给腾讯元宝解析（只发送这条链接），第一次需要在专用 Edge 登录元宝。'};
  if(hostIs(host,['xet.tech','xetslk.com','xetlk.com','xiaoeknow.com','xiaoe-tech.com','xet.citv.cn','xet.pomoho.com'])) return {kind:'video',site:'小鹅通',note:'会打开下载专用 Edge，第一次需要登录这个店铺；下载网站提供的原始画质。'};
  return {kind:'video',site:'其他网站',quality:true,note:'不在已验证的网站名单里，可以试试，但不保证能下载。'};
}
export const qualityLabels={best:'最高画质','1080':'1080P 及以下','720':'720P 及以下','480':'480P 及以下'};

// Turns one output line of download.ps1 / yt-dlp / our node scripts into what the window shows.
export function parseLine(raw) {
  const line=String(raw).replace(/\x1b\[[0-9;]*m/g,'').trim();
  if(!line) return null;
  let m;
  if(line.startsWith('@@mengren ')) {try{return {event:JSON.parse(line.slice(10))};}catch{return null;}}
  if((m=line.match(/^\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([\d.]+\s*[KMGT]?i?B)(?:\s+at\s+~?\s*([\d.]+\s*[KMGT]?i?B\/s))?/)))
    return {progress:{percent:Math.min(100,Number(m[1])),size:m[2].replace(/\s+/g,''),speed:m[3]?m[3].replace(/\s+/g,''):null}};
  if((m=line.match(/^\[download\] Destination: (.+)$/))) return {title:basename(m[1]).replace(/(\.f[\w-]+)?\.[A-Za-z0-9]{2,5}$/,'')};
  if((m=line.match(/^\[download\] (.+) has already been downloaded$/))) return {title:basename(m[1]).replace(/\.[A-Za-z0-9]{2,5}$/,'')};
  if((m=line.match(/^已识别：(.+)$/))) return {title:m[1].trim()};
  if((m=line.match(/^下载完成：(.+)$/))) return {saved:m[1].trim()};
  if((m=line.match(/^保存位置：(.+?)(?:（.*）)?$/))) return {folder:m[1].trim()};
  if((m=line.match(/^\[(\d+)\/(\d+)\] (.+?)：(完成|已下载过，跳过|失败，(.*))$/)))
    return {episode:{n:Number(m[1]),total:Number(m[2]),label:m[3],status:m[4]==='完成'?'ok':m[4].startsWith('已下载')?'skip':'fail',reason:m[5]||null}};
  if((m=line.match(/^未下载成功：(.+)$/))) return {failure:redact(m[1].trim())};
  if((m=line.match(/^全部处理完：(.+)$/))) return {summary:m[1].trim()};
  if((m=line.match(/^ERROR: (?:\[[^\]]+\] )?(?:[\w-]+: )?(.+)$/))) return {error:redact(m[1].trim()).slice(0,300)};
  if(/^\[|^WARNING:|^Deleting original|^\s*\d+\.\s/.test(line)) return null;
  return {note:redact(line).slice(0,300)};
}
// [1,2,3,5,8,9] -> "1-3,5,8-9" for ximalaya.mjs --select.
export function compressSelection(indexes) {
  const list=[...new Set(indexes.map(Number).filter(n=>Number.isInteger(n)&&n>0))].sort((a,b)=>a-b),parts=[];
  for(let i=0;i<list.length;) {
    let j=i;while(j+1<list.length&&list[j+1]===list[j]+1)j++;
    parts.push(i===j?String(list[i]):list[i]+'-'+list[j]);i=j+1;
  }
  return parts.join(',');
}
export const historyLimit=300;
export function addHistory(history,entry) {history.unshift(entry);history.length=Math.min(history.length,historyLimit);return history;}
export const formatBytes=n=>n>=1073741824?(n/1073741824).toFixed(2)+' GB':n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(0)+' KB':n+' B';
