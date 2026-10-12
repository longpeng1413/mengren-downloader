// Site rules adapted from Qiaomu Clipper (MIT). See licenses/qiaomu-clipper-LICENSE.txt.
export const shortHosts = ['xet.tech','xetslk.com','xetlk.com'];
export const shopHosts = ['xiaoeknow.com','xiaoe-tech.com','xet.citv.cn','xet.pomoho.com'];
export const mediaHosts = ['xiaoeknow.com','xet.tech','xiaoe-tech.com','xiaoecloud.com'];
export const hostIn = (host, list) => list.some(item=>host===item || host.endsWith('.'+item));
export function safeHttps(address) {
  try { const u=new URL(address); return typeof address==='string' && address.length<=12000 && u.protocol==='https:' && !u.username && !u.password && (!u.port || u.port==='443') ? u : null; } catch { return null; }
}
export function isXiaoe(address) { const u=safeHttps(address); return Boolean(u && (!u.hash || u.hash==='#wechat_redirect') && hostIn(u.hostname,[...shortHosts,...shopHosts])); }
const shopPattern=/^(app[0-9a-z]{6,24})\.(?:(h5|mp)\.(xiaoeknow\.com|xiaoe-tech\.com)|(?:(h5|mp)\.)?(xet\.citv\.cn|xet\.pomoho\.com))$/i;
const livePattern=/^l_[0-9a-z_]{8,64}$/i;
export function xiaoeAddress(address,depth=0) {
  if (depth>3) return null;
  const u=safeHttps(address), shop=u?.hostname.match(shopPattern);
  if (!u || !shop || (u.hash && u.hash!=='#wechat_redirect')) return null;
  let inner;
  try { const encoded=u.searchParams.get('params') || u.pathname.match(/^\/content_page\/([^?#]+)$/)?.[1]; if(encoded) inner=JSON.parse(Buffer.from(decodeURIComponent(encoded).replace(/ /g,'+'),'base64').toString('utf8')); } catch { }
  const app=u.searchParams.get('app_id') || inner?.app_id || shop[1];
  if (typeof app!=='string' || app.toLowerCase()!==shop[1].toLowerCase() || (inner?.app_id!==undefined && (typeof inner.app_id!=='string' || inner.app_id.toLowerCase()!==app.toLowerCase()))) return null;
  const origin=u.origin.replace('.mp.','.h5.');
  const live=u.pathname.match(/^\/(?:v[0-9]+|p)\/course\/alive\/(l_[0-9a-z_]+)\/?$/i)?.[1];
  if (live && livePattern.test(live)) return `${origin}/v4/course/alive/${live}?app_id=${app}`;
  if (/^\/(?:v[0-9]+\/auth|p\/t\/free\/v[0-9]+\/basic-platform\/h5_basic\/login\/auth)\/?$/.test(u.pathname)) {
    const next=xiaoeAddress(u.searchParams.get('redirect_url')||'',depth+1);
    if(next && new URL(next).hostname.match(shopPattern)?.[1].toLowerCase()===app.toLowerCase()) return next;
  }
  if(inner?.h5_url) {
    const next=xiaoeAddress(inner.h5_url,depth+1);
    if(next && new URL(next).hostname.match(shopPattern)?.[1].toLowerCase()===app.toLowerCase() && (!inner.resource_id || new URL(next).pathname.split('/').pop()===inner.resource_id)) return next;
  }
  if(typeof inner?.resource_id==='string' && livePattern.test(inner.resource_id)) return `${origin}/v4/course/alive/${inner.resource_id}?app_id=${app}`;
  return null;
}
export function channelsShare(address) {
  const u=safeHttps(address); if(!u || u.hash) return null;
  const id=u.hostname==='weixin.qq.com' && !u.search ? u.pathname.match(/^\/sph\/([A-Za-z0-9]{3,64})\/?$/)?.[1] : u.hostname==='channels.weixin.qq.com' && u.pathname==='/finder-preview/pages/sph' && [...u.searchParams.keys()].join(',')==='id' ? u.searchParams.get('id') : null;
  return id && /^[A-Za-z0-9]{3,64}$/.test(id) ? `https://weixin.qq.com/sph/${id}` : null;
}
export function isPlayback(address) { const u=safeHttps(address); return Boolean(u && !u.hash && u.hostname==='channels.weixin.qq.com' && u.pathname==='/finder-preview/pages/feed' && u.searchParams.get('token') && u.searchParams.get('eid')); }
export function allowedMedia(site,address) {
  const u=safeHttps(address); if(!u || u.hash) return false;
  return site==='xiaoe' ? hostIn(u.hostname,mediaHosts) : site==='channels' && u.hostname==='finder.video.qq.com' && /^\/(?:\d+\/){2}stodownload$/.test(u.pathname);
}
export function xiaoeProbeExpression(page) {
  const u=new URL(page), app=u.searchParams.get('app_id'), live=u.pathname.split('/').pop();
  return `(${async function(origin,app,live) {
    if(location.origin!==origin) return {state:'loading'};
    const request=async path=>{ const r=await fetch(path,{credentials:'include',redirect:'error',signal:AbortSignal.timeout(15000)});return r.ok ? r.json():null; };
    try {
      const lines=await request('/_alive/v3/get_lookback_list?app_id='+encodeURIComponent(app)+'&alive_id='+encodeURIComponent(live));
      if(lines?.code===11302) return {state:'login'};
      if(lines?.code!==0) return {state:'denied',code:Number(lines?.code)||0};
      const renditions=[];
      for(const line of Array.isArray(lines.data)?lines.data:[]) for(const item of Array.isArray(line?.line_sharpness)?line.line_sharpness:[]) if(typeof item?.url==='string') renditions.push({url:item.url,default:Boolean(item.default),label:String(item.name||item.sharpness_name||item.sharpness||'')});
      if(!renditions.length) return {state:'no-replay'};
      const base=await request('/_alive/v3/base_info?resource_id='+encodeURIComponent(live)+'&type=12&is_direct=1&file_tag=1').catch(()=>null);
      return {state:'ready',title:String(base?.data?.alive_info?.title||document.title||'小鹅通回放').slice(0,300),renditions};
    } catch { return {state:'loading'}; }
  }.toString()})(${JSON.stringify(u.origin)},${JSON.stringify(app)},${JSON.stringify(live)})`;
}
export function channelsProbeExpression(share) {
  return `(${async function(address) {
    if(location.origin!=='https://yuanbao.tencent.com') return {state:'loading'};
    try {
      const response=await fetch('/api/weixin/get_parse_result',{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'video_channel_url',url:address,scene:1})});
      if(response.status===401 || response.status===403) return {state:'login'};
      if(!response.ok) return {state:'unavailable'};
      const value=await response.json();
      return value?.code===0 && typeof value?.data?.playable_url==='string' ? {state:'ready',playbackUrl:value.data.playable_url} : {state:'unavailable'};
    } catch {return {state:'loading'};}
  }.toString()})(${JSON.stringify(share)})`;
}
export const playbackProbeExpression=`(${async function() {
  const u=new URL(location.href);
  if(u.origin!=='https://channels.weixin.qq.com' || u.pathname!=='/finder-preview/pages/feed') return {state:'loading'};
  try {
    const r=await fetch('/finder-preview/api/feed/get_feed_info',{method:'POST',credentials:'omit',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json'},body:JSON.stringify({baseReq:{generalToken:u.searchParams.get('token')},exportId:u.searchParams.get('eid')})});
    const data=await r.json();
    if(data?.errCode!==0 || data?.data?.errMsg?.type!==0) return {state:'unavailable'};
    const feed=data.data.feedInfo;
    return {state:'ready',title:String(feed?.description||document.title||'视频号').slice(0,300),mediaUrl:feed?.h264VideoInfo?.videoUrl};
  } catch {return {state:'loading'};}
}.toString()})()`;
