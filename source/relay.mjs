import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import {once} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';
import {allowedMedia} from './sites.mjs';
// 198.18.0.0/15 is a benchmarking range that no LAN device uses; Clash/Mihomo/Surge
// TUN fake-ip DNS answers live there, so it is reachable rather than private.
export function publicIp(ip) {
  if(ip.includes(':')) return /^[23][0-9a-f]{0,3}:/i.test(ip);
  const p=ip.split('.').map(Number); if(p.length!==4 || p.some(n=>!Number.isInteger(n)||n<0||n>255)) return false;
  return !(p[0]===0 || p[0]===10 || p[0]===127 || p[0]>=224 || (p[0]===169&&p[1]===254) || (p[0]===172&&p[1]>=16&&p[1]<=31) || (p[0]===192&&p[1]===168) || (p[0]===100&&p[1]>=64&&p[1]<=127) || (p[0]===192&&p[1]===0));
}
function lookup(host,options,callback) {
  dns.lookup(host,{all:true},(error,addresses)=>{
    if(error || !addresses?.length || addresses.some(a=>!publicIp(a.address))) return callback(new Error('媒体域名解析不可用'));
    const list=options.family ? addresses.filter(a=>a.family===options.family) : addresses;
    if(!list.length) return callback(new Error('媒体网络不可用'));
    options.all ? callback(null,list) : callback(null,list[0].address,list[0].family);
  });
}
export async function guardedGet(site,address,referer,range,depth=0) {
  if(depth>5 || !allowedMedia(site,address)) throw new Error('媒体地址不在该网站的允许范围内');
  const url=new URL(address);
  const response=await new Promise((resolve,reject)=>{
    const request=https.get(url,{lookup,headers:{'User-Agent':'Mozilla/5.0','Referer':referer,...(range?{'Range':range}:{})}},resolve);
    request.setTimeout(30000,()=>request.destroy(new Error('媒体读取超时')));
    request.on('error',()=>reject(new Error('媒体读取失败，请刷新原页面后重试')));
  });
  if([301,302,303,307,308].includes(response.statusCode)) {
    const next=new URL(response.headers.location||'',url).href; response.destroy();
    return guardedGet(site,next,referer,range,depth+1);
  }
  if(![200,206].includes(response.statusCode)) {const code=response.statusCode;response.destroy();throw new Error(`网站拒绝媒体读取（${code}），请重新读取链接`);}
  return {response,address};
}
export function rewritePlaylist(text,base,register) {
  if(!text.trimStart().startsWith('#EXTM3U') || /#EXT-X-(?:DEFINE|CONTENT-STEERING):/.test(text)) throw new Error('暂不支持该回放清单');
  if(/#EXT-X-(?:SESSION-)?KEY:(?![^\n]*METHOD=(?:NONE|AES-128)(?:,|\s|$))/i.test(text)) throw new Error('该视频使用不支持的媒体保护格式');
  let nextPlaylist=false;
  return text.split(/\r?\n/).map(line=>{
    if(line.startsWith('#')) {
      if(/(?:^|[,:])(?:[A-Z-]*URI)=(?!")/.test(line)) throw new Error('清单地址格式不可用');
      const playlist=/^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|IMAGE-STREAM-INF|RENDITION-REPORT):/.test(line);
      line=line.replace(/((?:[A-Z-]*URI)=)"([^"\r\n]+)"/g,(_,key,value)=>`${key}"${register(new URL(value,base).href,playlist)}"`);
      if(line.startsWith('#EXT-X-STREAM-INF:')) nextPlaylist=true;
    } else if(line.trim()) { line=register(new URL(line.trim(),base).href,nextPlaylist); nextPlaylist=false; }
    return line;
  }).join('\n');
}
export async function createRelay(site,media,referer,options={}) {
  const allowed=options.allowMedia||((address)=>allowedMedia(site,address));
  if(!allowed(media)) throw new Error('未取得允许的媒体地址');
  const resources=new Map(),token=randomUUID(); let port;
  function register(address,playlist=false) {
    if(!allowed(address) || resources.size>100000) throw new Error('媒体清单含不允许的地址');
    playlist=playlist || /\.m3u8$/i.test(new URL(address).pathname);
    const path=`/${token}/${createHash('sha256').update(String(playlist)+address).digest('hex')}${playlist?'.m3u8':site!=='xiaoe'?'.mp4':''}`;
    resources.set(path,{address,playlist});return `http://127.0.0.1:${port}${path}`;
  }
  const server=http.createServer(async (request,result)=>{
    const resource=resources.get(request.url);
    if(!resource || !['GET','HEAD'].includes(request.method)) {result.writeHead(404);result.end();return;}
    const range=request.headers.range;
    if(range && !/^bytes=\d+-\d*$/.test(range)) {result.writeHead(416);result.end();return;}
    try {
      const {response,address}=await (options.getUpstream?options.getUpstream(resource.address,referer,range):guardedGet(site,resource.address,referer,range));
      if(site!=='xiaoe'&&!resource.playlist) {
        const limit=20*1024*1024*1024, expected=Number(response.headers['content-length'])||0;
        if(expected>limit) {response.destroy();throw new Error('视频超过当前大小限制');}
        const headers={'Content-Type':response.headers['content-type']||'video/mp4'};
        if(expected) headers['Content-Length']=expected;
        if(response.headers['content-range']) headers['Content-Range']=response.headers['content-range'];
        result.writeHead(response.statusCode,headers);
        if(request.method==='HEAD') {response.destroy();result.end();return;}
        let count=0;
        result.on('close',()=>response.destroy());
        for await(const chunk of response) {count+=chunk.length;if(count>limit) throw new Error('视频过大');if(!result.write(chunk)) await once(result,'drain');}
        if(expected && count!==expected) throw new Error('视频不完整');
        result.end();return;
      }
      const chunks=[];let count=0,playlist=resource.playlist;
      const max=playlist ? 4_000_000 : 128*1024*1024;
      if(Number(response.headers['content-length'])>max) {response.destroy();throw new Error('片段过大');}
      const deadline=setTimeout(()=>response.destroy(new Error('片段超时')),120000);
      try { for await(const chunk of response) {count+=chunk.length;if(count>max) {response.destroy();throw new Error('片段过大');}chunks.push(chunk);} } finally {clearTimeout(deadline);}
      if(response.headers['content-length'] && count!==Number(response.headers['content-length'])) throw new Error('媒体片段不完整');
      let body=Buffer.concat(chunks);
      const mime=String(response.headers['content-type']||'application/octet-stream');
      playlist=playlist || body.subarray(0,128).toString('utf8').replace(/^\uFEFF/,'').trimStart().startsWith('#EXTM3U') || /mpegurl/i.test(mime);
      if(playlist) body=Buffer.from(rewritePlaylist(body.toString('utf8').replace(/^\uFEFF/,''),address,register));
      const headers={'Content-Type':playlist?'application/vnd.apple.mpegurl':mime,'Content-Length':body.length};
      if(response.headers['content-range'] && !playlist) headers['Content-Range']=response.headers['content-range'];
      result.writeHead(response.statusCode,headers); result.end(request.method==='HEAD'?undefined:body);
    } catch {if(result.headersSent) {result.destroy();return;} result.writeHead(502,{'Content-Type':'text/plain'});result.end('Media unavailable; reopen the original page.');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  port=server.address().port;
  return {url:register(media,site==='xiaoe'||options.playlist===true),close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
