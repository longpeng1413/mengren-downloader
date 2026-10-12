import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns/promises';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {publicIp} from './relay.mjs';
export const captureDomains=['justkami.com','xiaoeknow.com','xiaoe-tech.com','xet.tech','xetslk.com','xetlk.com','xiaoecloud.com','douyinvod.com','bilivideo.com','bilivideo.cn','bilivideo.net','video.qq.com','aliyuncs.com','myqcloud.com','bytecdn.cn','ksyuncdn.com'];
export const hostMatches=(host,domains)=>domains.some(d=>host===d||host.endsWith('.'+d));
export function mediaKind(url,mime='') {
  const path=new URL(url).pathname.toLowerCase();mime=mime.toLowerCase().split(';')[0];
  if(/\.m3u8$/.test(path)||mime.includes('mpegurl'))return 'hls';
  if(/\.(mp4|webm|mkv|mov|flv)$/.test(path)||mime.startsWith('video/')&&!/mp2t/.test(mime))return 'video';
  if(/\.(m4a|aac|mp3|m4s|ts)$/.test(path)||mime.startsWith('audio/'))return 'track';
  return null;
}
export class CaptureCatalog {
  constructor(){this.items=[];this.serial=0;}
  observe(url,response,request={}) {
    if(![200,206].includes(response.statusCode)||!['GET','HEAD'].includes(request.method||'GET'))return null;
    const kind=mediaKind(url,response.headers['content-type']||'');if(!kind)return null;
    const previous=this.items.find(x=>x.url===url);if(previous)return null;
    const size=Number(response.headers['content-range']?.match(/\/(\d+)$/)?.[1]||response.headers['content-length'])||0;
    const referer=request.headers?.referer;let origin;try{origin=new URL(referer).origin+'/';}catch{}
    const item={id:++this.serial,url,kind,size,referer:origin,host:new URL(url).hostname};
    this.items.push(item);if(this.items.length>200)this.items.shift();return item;
  }
}
function cleanHeaders(headers) {const result={...headers};for(const key of ['proxy-authorization','proxy-connection','connection','upgrade','keep-alive','transfer-encoding'])delete result[key];return result;}
export async function createCaptureProxy({data,helper,catalog=new CaptureCatalog(),domains=captureDomains,upstream,allowLocal=false,upstreamCA,onMedia=()=>{},onDiagnostic=()=>{}}={}) {
  const sockets=new Set(),contexts=new Map();
  async function validateHost(host) {
    const addresses=await dns.lookup(host,{all:true,...(allowLocal&&host==='localhost'?{family:4}:{})});
    addresses.sort((a,b)=>a.family-b.family);
    if(!allowLocal&&addresses.some(x=>!publicIp(x.address)))throw Error('Private network target refused');
    if(!addresses.length)throw Error('Host unavailable');return addresses;
  }
  const lookup=(host,options,callback)=>{validateHost(host).then(list=>{const picked=options.family?list.filter(x=>x.family===options.family):list;if(!picked.length)throw Error('Host unavailable');options.all?callback(null,picked):callback(null,picked[0].address,picked[0].family);}).catch(()=>callback(Error('Host unavailable')));};
  async function rawTunnel(host,port) {
    await validateHost(host);
    if(!upstream)return await new Promise((done,reject)=>{const socket=net.connect({host,port,lookup});socket.setTimeout(30000,()=>socket.destroy(Error('Connect timeout')));socket.once('connect',()=>done(socket));socket.once('error',reject);});
    return await new Promise((done,reject)=>{
      const request=http.request({host:upstream.host,port:upstream.port,method:'CONNECT',path:host+':'+port,headers:{Host:host+':'+port},timeout:30000,agent:false});
      request.on('timeout',()=>request.destroy(Error('Upstream timeout')));request.on('error',reject);
      request.on('connect',(response,socket,head)=>{if(response.statusCode!==200){socket.destroy();reject(Error('Upstream proxy refused connection'));return;}if(head.length)socket.unshift(head);done(socket);});request.end();
    });
  }
  const cas=upstreamCA||[...tls.getCACertificates('default'),...tls.getCACertificates('system')];
  async function requestOnce(address,{method='GET',headers={},body}={}) {
    const u=new URL(address);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('Unsupported target');
    await validateHost(u.hostname);
    let socket,options={hostname:u.hostname,port:u.port||undefined,path:u.pathname+u.search,method,headers:cleanHeaders({...headers,host:u.host}),lookup,timeout:30000,agent:false,ca:cas};
    if(upstream&&u.protocol==='http:')options={...options,hostname:upstream.host,port:upstream.port,path:u.href,lookup:undefined};
    if(u.protocol==='https:') {
      socket=await rawTunnel(u.hostname,Number(u.port)||443);
      const secure=tls.connect({socket,servername:u.hostname,ca:cas,rejectUnauthorized:true});
      await new Promise((done,reject)=>{secure.once('secureConnect',done);secure.once('error',reject);});
      options.createConnection=()=>secure;options.agent=new https.Agent({keepAlive:false});options.agent.createConnection=()=>secure;
    }
    return await new Promise((done,reject)=>{
      const outgoing=(u.protocol==='https:'?https:http).request(options,response=>done({response,address:u.href}));
      outgoing.on('timeout',()=>outgoing.destroy(Error('Request timeout')));outgoing.on('error',error=>{onDiagnostic('UPSTREAM '+error.code);const safe=Error('Upstream read or certificate validation failed');safe.code=error.code;reject(safe);});
      if(body){body.once('error',()=>outgoing.destroy());body.pipe(outgoing);}else outgoing.end();
    });
  }
  async function requestURL(address,options={}) {
    const count=['GET','HEAD'].includes(options.method||'GET')&&!options.body?3:1;
    for(let attempt=0;attempt<count;attempt++){try{return await requestOnce(address,options);}catch(error){if(attempt+1===count||!['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE'].includes(error.code))throw error;await new Promise(done=>setTimeout(done,200*(attempt+1)));}}
  }
  async function getMedia(address,referer,range,depth=0) {
    const u=new URL(address);if(depth>5||!hostMatches(u.hostname,domains))throw Error('Media domain outside capture scope');
    const result=await requestURL(address,{headers:{'User-Agent':'Mozilla/5.0',...(referer?{Referer:referer}:{}),...(range?{Range:range}:{})}});
    const response=result.response;
    if([301,302,303,307,308].includes(response.statusCode)){const next=new URL(response.headers.location||'',u).href;response.destroy();return getMedia(next,referer,range,depth+1);}
    if(![200,206].includes(response.statusCode)){response.destroy();throw Error('Media unavailable or requires original session');}
    // Never reuse Cookie, Authorization or the application's credentials for downloads.
    if(!range&&response.statusCode===206){response.destroy();throw Error('Only a partial track is available');}
    return result;
  }
  async function forward(req,res,origin) {
    try {
      const u=new URL(req.url,origin);if(origin&&u.origin!==origin)throw Error('Target mismatch');
      const {response}=await requestURL(u.href,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req}:{})});
      const item=hostMatches(u.hostname,domains)?catalog.observe(u.href,response,req):null;if(item)onMedia(item);
      res.writeHead(response.statusCode,cleanHeaders(response.headers));response.on('error',()=>res.destroy());res.on('close',()=>response.destroy());response.pipe(res);
    }catch(error){onDiagnostic('READ '+(error.code||'FAILED'));if(!res.headersSent)res.writeHead(502,{'Content-Type':'text/plain'});res.end('Unable to read upstream. Certificate checks were retained.');}
  }
  function remember(socket){sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.on('error',()=>{});}
  const server=http.createServer((req,res)=>forward(req,res));server.on('connection',remember);
  server.on('connect',async(req,client,head)=>{
    remember(client);
    try {
      const target=new URL('https://'+req.url);if(target.username||target.password||target.pathname!=='/')throw Error('Bad CONNECT');
      const port=Number(target.port)||443;await validateHost(target.hostname);
      if(!hostMatches(target.hostname,domains)) {
        const remote=await rawTunnel(target.hostname,port);remember(remote);client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);remote.pipe(client);client.pipe(remote);remote.on('error',()=>client.destroy());client.on('close',()=>remote.destroy());return;
      }
      let context=contexts.get(target.hostname);
      if(!context){if(contexts.size>=64)throw Error('Too many media hosts');const answer=spawnSync(helper,['leaf',data,target.hostname],{encoding:'utf8',windowsHide:true});if(answer.status!==0)throw Error('Certificate creation failed');const pfx=await readFile(answer.stdout.trim());context=tls.createSecureContext({pfx,passphrase:''});contexts.set(target.hostname,context);}
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)client.unshift(head);
      const secure=new tls.TLSSocket(client,{isServer:true,secureContext:context});remember(secure);
      const inner=http.createServer((r,s)=>forward(r,s,target.origin));inner.on('clientError',()=>secure.destroy());inner.emit('connection',secure);
    }catch(error){onDiagnostic('CONNECT '+(error.code||error.message));if(!client.destroyed)client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');}
  });
  server.on('clientError',(error,socket)=>{onDiagnostic('PARSE '+error.code);socket.destroy();});server.requestTimeout=60000;server.headersTimeout=30000;
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
  return {port:server.address().port,catalog,getMedia,allows:address=>{try{const u=new URL(address);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&hostMatches(u.hostname,domains);}catch{return false;}},close:()=>new Promise(done=>{for(const s of sockets)s.destroy();server.close(done);server.closeAllConnections();})};
}