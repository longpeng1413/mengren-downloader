import https from 'node:https';
import {createHash} from 'node:crypto';
import {createWriteStream,createReadStream} from 'node:fs';
import {rename,unlink,stat} from 'node:fs/promises';
import {systemProxy,proxiedConnection} from './relay.mjs';

// New versions come only from this repository's GitHub releases: the full package and
// its SHA256SUMS-full.txt. Redirects may only lead to GitHub's own download hosts.
export const repo='longpeng1413/mengren-downloader';
export const releasePage=`https://github.com/${repo}/releases`;
const agent='MengrenDownloader-Updater';
export function githubHost(host) {
  return host==='api.github.com'||host==='github.com'||host==='objects.githubusercontent.com'||host==='release-assets.githubusercontent.com'||host.endsWith('.githubusercontent.com');
}
export function compareVersions(a,b) {
  const pa=String(a).replace(/^v/,'').split('.').map(Number),pb=String(b).replace(/^v/,'').split('.').map(Number);
  for(let i=0;i<3;i++) {const d=(pa[i]||0)-(pb[i]||0);if(d)return Math.sign(d);}
  return 0;
}
export const packageName=version=>`mengren-downloader-${version}-windows-x64-full.zip`;
// Newest release above `current` that carries the full package and its checksum file.
export function pickRelease(releases,current,{preview=false}={}) {
  const usable=(Array.isArray(releases)?releases:[])
    .filter(r=>r&&!r.draft&&(!r.prerelease||preview)&&/^v\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(r.tag_name||'')&&compareVersions(r.tag_name,current)>0)
    .sort((a,b)=>compareVersions(b.tag_name,a.tag_name));
  for(const r of usable) {
    const version=r.tag_name.slice(1),assets=Array.isArray(r.assets)?r.assets:[];
    const zip=assets.find(a=>a?.name===packageName(version)),sums=assets.find(a=>a?.name==='SHA256SUMS-full.txt');
    if(!zip||!sums||!(zip.size>0)) continue;
    return {version,prerelease:Boolean(r.prerelease),notes:String(r.body||'').slice(0,4000),page:String(r.html_url||releasePage),
      zip:{name:zip.name,url:zip.browser_download_url,size:zip.size},sums:sums.browser_download_url};
  }
  return null;
}
export function expectedHash(text,name) {
  for(const line of String(text).split(/\r?\n/)) {
    const m=line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if(m&&m[2].trim()===name) return m[1].toLowerCase();
  }
  return null;
}
// With our own connection Node no longer knows the default port and would send
// "Host: github.com:80", which GitHub answers with an endless redirect.
export const connectionFor=(url,proxy)=>proxy?{createConnection:proxiedConnection(proxy,url.hostname,Number(url.port)||443),defaultPort:443}:{};
// One GET with GitHub-only redirects. Uses the Windows system proxy like a browser
// would (GitHub is often unreachable directly), and falls back to a direct connection.
function open(address,{proxy,depth=0,range=null}={}) {
  return new Promise((resolve,reject)=>{
    let url;try{url=new URL(address);}catch{return reject(new Error('更新地址无效'));}
    if(url.protocol!=='https:'||!githubHost(url.hostname)) return reject(new Error('更新地址不是 GitHub'));
    const connection=connectionFor(url,proxy);
    const request=https.get(url,{...connection,headers:{'User-Agent':agent,'Accept':'application/vnd.github+json, */*',...(range?{Range:range}:{})}},response=>{
      if([301,302,303,307,308].includes(response.statusCode)) {
        response.resume();
        if(depth>=5) return reject(new Error('更新地址跳转次数过多'));
        return open(new URL(response.headers.location||'',url).href,{proxy,depth:depth+1,range}).then(resolve,reject);
      }
      if(response.statusCode!==200&&!(range&&response.statusCode===206)) {response.resume();return reject(new Error(`GitHub 返回 ${response.statusCode}`));}
      resolve(response);
    });
    request.setTimeout(30000,()=>request.destroy(new Error('连接 GitHub 超时')));
    request.on('error',error=>reject(error));
  });
}
async function get(address,range=null) {
  const proxy=systemProxy();
  try {return await open(address,{proxy,range});}
  catch(error) {if(!proxy)throw error;return open(address,{proxy:null,range});}
}
async function text(address,limit) {
  const response=await get(address);let body='';
  for await(const chunk of response) {body+=chunk;if(body.length>limit){response.destroy();throw new Error('GitHub 返回的内容过大');}}
  return body;
}
export async function checkUpdate(current,{preview=false}={}) {
  let list;
  try {list=JSON.parse(await text(`https://api.github.com/repos/${repo}/releases?per_page=15`,3_000_000));}
  catch(error) {throw new Error('暂时连不上 GitHub（'+(error.message||'网络错误')+'）');}
  return pickRelease(list,current,{preview});
}
// Downloads the package to `file`, checking size and SHA-256 against the release's checksum file.
// A slow or shaky line may take many minutes: a dropped or stalled connection is retried
// from where it stopped, and an unfinished "file.part" is continued next time.
export async function downloadUpdate(info,file,{onProgress=()=>{},signal,attempts=5}={}) {
  const sums=await text(info.sums,20000);
  const hash=expectedHash(sums,info.zip.name);
  if(!hash) throw new Error('发布页缺少这个安装包的校验值，已停止更新');
  const part=file+'.part';
  for(let attempt=1;;attempt++) {
    try {await fetchPart(info,part,{onProgress,signal});break;}
    catch(error) {
      if(error.broken) await unlink(part).catch(()=>{});
      if(error.broken||signal?.aborted||attempt>=attempts) throw error;
      await new Promise(r=>setTimeout(r,3000*attempt));
    }
  }
  const digest=createHash('sha256');
  for await(const chunk of createReadStream(part)) digest.update(chunk);
  if(digest.digest('hex')!==hash) {await unlink(part).catch(()=>{});throw new Error('更新包校验不通过，可能被损坏或篡改，已丢弃');}
  await rename(part,file);
  onProgress(1);
  return file;
}
async function fetchPart(info,part,{onProgress,signal}) {
  const size=info.zip.size;
  let existing=(await stat(part).catch(()=>null))?.size||0;
  if(existing===size) return;
  if(existing>size) {await unlink(part);existing=0;}
  let response=await get(info.zip.url,existing?`bytes=${existing}-`:null);
  const resumed=existing>0&&response.statusCode===206&&String(response.headers['content-range']||'').startsWith(`bytes ${existing}-`);
  if(!resumed&&response.statusCode!==200) {response.destroy();response=await get(info.zip.url);}
  let received=resumed?existing:0,shown=0;
  await new Promise((resolve,reject)=>{
    const out=createWriteStream(part,{flags:resumed?'a':'w'});
    const fail=error=>{response.destroy();out.destroy();reject(error);};
    signal?.addEventListener('abort',()=>fail(new Error('更新下载已取消')),{once:true});
    response.setTimeout(60000,()=>fail(new Error('下载停住了，正在重新连接')));
    response.on('data',chunk=>{
      received+=chunk.length;
      if(received>size) return fail(Object.assign(new Error('更新包大小不对，已停止'),{broken:true}));
      if(Date.now()>shown){shown=Date.now()+500;onProgress(received/size);}
    });
    response.on('error',fail);out.on('error',fail);
    response.pipe(out);out.on('finish',resolve);
  });
  if(received!==size) throw new Error('更新包没有下载完整');
}
