import test from 'node:test';import assert from 'node:assert/strict';
import http from 'node:http';import https from 'node:https';import tls from 'node:tls';
import {X509Certificate} from 'node:crypto';import {mkdtemp,readFile,readdir,unlink,rmdir} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {createCaptureProxy,CaptureCatalog,mediaKind} from '../source/capture-proxy.mjs';import {parseUpstream} from '../source/capture.mjs';import {downloadResolved} from '../source/site-download.mjs';
const helper=resolve('CaptureHelper.exe');
function cert(action,folder,...args){const r=spawnSync(helper,[action,folder,...args],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
async function listen(server){await new Promise(done=>server.listen(0,'127.0.0.1',done));return server.address().port;}
async function remove(folder){for(const f of await readdir(folder)){await unlink(join(folder,f));}await rmdir(folder);}
async function tlsOnce(proxyPort,upstreamPort,host,ca){
 const socket=await new Promise((done,reject)=>{const r=http.request({host:'127.0.0.1',port:proxyPort,method:'CONNECT',path:host+':'+upstreamPort,agent:false});r.on('connect',(answer,socket,head)=>{if(answer.statusCode!==200){socket.destroy();reject(Error('CONNECT fixture failed'));return;}if(head.length)socket.unshift(head);done(socket);});r.on('error',reject);r.end();});
 const secure=tls.connect({socket,servername:'localhost',ca,rejectUnauthorized:true});await new Promise((done,reject)=>{secure.once('secureConnect',done);secure.once('error',reject);});
 return await new Promise((done,reject)=>{let text='';secure.on('data',b=>text+=b.toString());secure.on('error',reject);secure.on('end',()=>done(text));secure.write('GET /video.mp4 HTTP/1.1\r\nHost: '+host+':'+upstreamPort+'\r\nConnection: close\r\n\r\n');});
}
async function throughTLS(...args){for(let i=0;i<5;i++){try{return await tlsOnce(...args);}catch(e){if(i===4||!['ECONNRESET','EPIPE'].includes(e.code))throw e;}}}
async function plainCapture(port,address){for(let i=0;i<6;i++){try{await new Promise((done,reject)=>{http.get({host:'127.0.0.1',port,path:address,agent:false,headers:{Cookie:'fixture-only'}},r=>{if(r.statusCode!==200){r.resume();reject(Error('HTTP fixture transport failed'));return;}r.resume();r.on('end',done);r.on('error',reject);}).on('error',reject);});return;}catch(e){if(i===5)throw e;await new Promise(done=>setTimeout(done,100));}}}
test('Media candidates never retain login headers and repeated ranges deduplicate',()=>{
 const c=new CaptureCatalog(),u='https://file.justkami.com/video.mp4?signature=fixture';
 c.observe(u,{statusCode:206,headers:{'content-type':'video/mp4','content-range':'bytes 0-99/1000'}},{method:'GET',headers:{cookie:'private',authorization:'private',referer:'https://m.justkami.com/course?token=private'}});
 c.observe(u,{statusCode:206,headers:{'content-type':'video/mp4'}});
 assert.equal(c.items.length,1);assert.equal(c.items[0].size,1000);assert.equal(c.items[0].referer,'https://m.justkami.com/');assert.equal(JSON.stringify(c.items).includes('private'),false);
 assert.equal(mediaKind('https://file.justkami.com/0.ts','video/mp2t'),'track');assert.equal(mediaKind('https://file.justkami.com/0.m4s','video/mp4'),'track');assert.equal(mediaKind('https://file.justkami.com/0.m3u8'),'hls');
 assert.deepEqual(parseUpstream({ProxyEnable:{value:1},ProxyServer:{value:'http=127.0.0.1:7897;https=127.0.0.1:7897'}}),{host:'127.0.0.1',port:7897});
 assert.equal(parseUpstream({ProxyEnable:{value:0}}),null);
});
test('Proxy journal restores original values and refuses external changes in an isolated registry key',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'mengren-proxy-journal-'));try{cert('selftest-proxy',folder);}finally{await remove(folder);}
});
test('HTTP/HTTPS media capture, non-media TLS tunnel and full download work without system activation',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'mengren-capture-test-')),upstreamFolder=await mkdtemp(join(tmpdir(),'mengren-origin-test-'));
 let proxy,server,secureServer;
 try{
  cert('init',folder);cert('init',upstreamFolder);const pfx=await readFile(cert('leaf',upstreamFolder,'localhost'));
  const localCA=new X509Certificate(await readFile(join(folder,'root.cer'))).toString(),originCA=new X509Certificate(await readFile(join(upstreamFolder,'root.cer'))).toString();
  const video=join(folder,'video.mp4');const ff=spawnSync(resolve('ffmpeg.exe'),['-v','error','-f','lavfi','-i','color=c=black:s=64x64:r=10','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','1','-c:v','libx264','-c:a','aac','-movflags','+faststart',video],{windowsHide:true,encoding:'utf8'});assert.equal(ff.status,0,ff.stderr);
  const bytes=await readFile(video);let hadCookie=false;
  const handler=(req,res)=>{hadCookie ||= Boolean(req.headers.cookie);if(req.url==='/fixture'){const body='#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:1.0,\nvideo.mp4\n#EXT-X-ENDLIST\n';res.writeHead(200,{'Content-Type':'application/vnd.apple.mpegurl'});res.end(body);return;}res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':bytes.length});res.end(bytes);};
  server=http.createServer(handler);secureServer=https.createServer({pfx,passphrase:''},handler);const plainPort=await listen(server),securePort=await listen(secureServer);
  proxy=await createCaptureProxy({data:folder,helper,domains:['localhost'],allowLocal:true,upstreamCA:[originCA],onDiagnostic:msg=>console.log('TEST '+msg)});
  const address='http://localhost:'+plainPort+'/video.mp4';
  await plainCapture(proxy.port,address);assert.equal(hadCookie,true);assert.equal(proxy.catalog.items.length,1);console.log('HTTP capture stage passed');
  const text=await throughTLS(proxy.port,securePort,'localhost',localCA);assert.ok(text.startsWith('HTTP/1.1 200'));assert.equal(proxy.catalog.items.length,2);console.log('HTTPS capture stage passed');
  const tunneled=await throughTLS(proxy.port,securePort,'127.0.0.1',originCA);assert.ok(tunneled.startsWith('HTTP/1.1 200'));assert.equal(proxy.catalog.items.length,2);
  hadCookie=false;
  const result=await downloadResolved({site:'capture',title:'Capture fixture',page:address,mediaUrl:address,requireAudio:true},address,folder,{relayOptions:{allowMedia:proxy.allows,getUpstream:proxy.getMedia}});
  assert.equal(hadCookie,false);const decoded=spawnSync(resolve('ffmpeg.exe'),['-v','error','-xerror','-i',result.file,'-f','null','-'],{encoding:'utf8',windowsHide:true});assert.equal(decoded.status,0,decoded.stderr);
  const playlist='http://localhost:'+plainPort+'/fixture';
  const hls=await downloadResolved({site:'capture',title:'Extensionless HLS capture fixture',page:playlist,mediaUrl:playlist,requireAudio:true},playlist,folder,{relayOptions:{allowMedia:proxy.allows,getUpstream:proxy.getMedia,playlist:true}});
  const hlsDecoded=spawnSync(resolve('ffmpeg.exe'),['-v','error','-xerror','-i',hls.file,'-f','null','-'],{encoding:'utf8',windowsHide:true});assert.equal(hlsDecoded.status,0,hlsDecoded.stderr);
  await proxy.close();proxy=await createCaptureProxy({data:folder,helper,domains:['localhost'],allowLocal:true,upstreamCA:[]});
  const refused=await throughTLS(proxy.port,securePort,'localhost',localCA);assert.ok(refused.startsWith('HTTP/1.1 502'));assert.equal(proxy.catalog.items.length,0);
 }finally{if(proxy)await proxy.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}if(secureServer){secureServer.closeAllConnections();await new Promise(done=>secureServer.close(done));}await remove(folder);await remove(upstreamFolder);}
});