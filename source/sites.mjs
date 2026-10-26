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
  if(site==='douyin')return hostIn(u.hostname,['douyinvod.com']);
  if(site==='bili')return hostIn(u.hostname,['bilivideo.com','bilivideo.cn','bilivideo.net','hdslb.com']);
  // Ximalaya audio comes from its own CDN (aod.cos.tx.xmcdn.com, a.xmcdn.com …); audio files only.
  if(site==='ximalaya')return hostIn(u.hostname,['xmcdn.com'])&&/\.(?:m4a|mp3|aac)$/i.test(u.pathname);
  // X serves post videos as plain MP4 from video.twimg.com only.
  if(site==='x')return u.hostname==='video.twimg.com'&&/^\/(?:ext_tw_video|amplify_video|tweet_video)\/[^?#]+\.mp4$/.test(u.pathname);
  // Only plain (unencrypted) full-song files from QQ Music's own audio servers.
  if(site==='qqmusic')return hostIn(u.hostname,['stream.qqmusic.qq.com'])&&/^\/(?:F000|M800|M500|C400|C200)[0-9A-Za-z]{8,32}\.(?:flac|mp3|m4a)$/.test(u.pathname);
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

export function douyinAddress(address) {
  const u=safeHttps(address);if(!u||u.hash||!['www.douyin.com','douyin.com','v.douyin.com','www.iesdouyin.com'].includes(u.hostname))return null;
  if(u.hostname==='v.douyin.com'&&/^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname))return u.href;
  const id=u.pathname.match(/^\/(?:video|share\/video)\/(\d+)\/?$/)?.[1] || (u.pathname==='/'?u.searchParams.get('modal_id')||u.searchParams.get('vid'):null);
  return id&&/^\d+$/.test(id)?`https://www.douyin.com/video/${id}`:null;
}
export function biliAddress(address) {
  const u=safeHttps(address);if(!u||u.hash||!['www.bilibili.com','m.bilibili.com','bilibili.com','b23.tv'].includes(u.hostname))return null;
  if(u.hostname==='b23.tv'&&/^\/[A-Za-z0-9]+\/?$/.test(u.pathname))return u.href;
  const id=u.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10}|av\d+)\/?$/)?.[1];if(!id)return null;
  const part=u.searchParams.get('p');if(part&&!/^[1-9]\d{0,3}$/.test(part))return null;
  return `https://www.bilibili.com/video/${id}${part?'?p='+part:''}`;
}
// One X post: x.com / twitter.com / mobile, with or without /video/N; returns https://x.com/<user>/status/<id>.
export function xAddress(address) {
  const u=safeHttps(address);
  if(!u||u.hash||!['x.com','www.x.com','mobile.x.com','twitter.com','www.twitter.com','mobile.twitter.com'].includes(u.hostname))return null;
  const m=u.pathname.match(/^\/(?:([A-Za-z0-9_]{1,15})\/status|i\/web\/status|i\/status)\/(\d{5,25})(?:\/(?:video|photo)\/\d{1,2})?\/?$/);
  return m?`https://x.com/${m[1]||'i'}/status/${m[2]}`:null;
}
export function browserMediaAllowed(site,page,address) {
  const u=safeHttps(address);if(!u||u.hash)return false;
  if(site==='douyin') {
    const wanted=douyinAddress(page)?.match(/\/video\/(\d+)$/)?.[1];
    return Boolean(wanted&&hostIn(u.hostname,['douyinvod.com'])&&(!u.searchParams.has('__vid')||u.searchParams.get('__vid')===wanted));
  }
  return site==='bili'&&Boolean(biliAddress(page))&&hostIn(u.hostname,['bilivideo.com','bilivideo.cn','bilivideo.net','hdslb.com']);
}
export function douyinProbeExpression(page) {
  return `(${async function(expected) {
    const url=new URL(location.href),id=url.pathname.match(/^\/video\/(\d+)/)?.[1]||url.searchParams.get('modal_id')||url.searchParams.get('vid');
    if(!['www.douyin.com','douyin.com'].includes(url.hostname)||'https://www.douyin.com/video/'+id!==expected)return {state:'loading'};
    const videos=[...document.querySelectorAll('video')].filter(v=>{const r=v.getBoundingClientRect(),style=getComputedStyle(v);return r.width>0&&r.height>0&&style.visibility!=='hidden'&&style.display!=='none'&&Number.isFinite(v.duration)&&v.duration>0;});
    const video=videos.find(v=>!v.paused)||videos[0];if(!video)return {state:'loading'};
    const allowed=address=>{try{const u=new URL(address);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&(u.hostname==='douyinvod.com'||u.hostname.endsWith('.douyinvod.com'))&&(!u.searchParams.has('__vid')||u.searchParams.get('__vid')===id);}catch{return false;}};
    const title=(document.querySelector('h1')?.textContent||document.title||'抖音视频').trim().slice(0,300);
    if(allowed(video.currentSrc))return {state:'ready',title,mediaUrl:video.currentSrc,seconds:video.duration};
    if(!video.currentSrc.startsWith('blob:'))return {state:'loading'};
    const navigation=performance.getEntriesByType('navigation')[0];if(!navigation)return {state:'loading'};
    const opened=new URL(navigation.name);if(opened.pathname!==url.pathname||opened.searchParams.get('modal_id')!==url.searchParams.get('modal_id'))return {state:'loading'};
    const names=[...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(allowed))];
    const measure=address=>new Promise(resolve=>{const element=document.createElement('video');element.preload='metadata';element.muted=true;const finish=value=>{clearTimeout(timer);element.onloadedmetadata=null;element.onerror=null;element.removeAttribute('src');element.load();resolve(value);};const timer=setTimeout(()=>finish(NaN),5000);element.onloadedmetadata=()=>finish(element.duration);element.onerror=()=>finish(NaN);element.src=address;});
    const candidates=names.filter(name=>new URL(name).searchParams.get('mime_type')==='video_mp4'&&!/\/media-(?:audio|video)-/.test(new URL(name).pathname));
    for(const candidate of candidates.slice(-6).reverse()){const duration=await measure(candidate);if(Number.isFinite(duration)&&Math.abs(duration-video.duration)<=Math.max(.5,video.duration*.005))return {state:'ready',title,mediaUrl:candidate,seconds:video.duration};}
    const unique=list=>[...new Map(list.map(name=>[new URL(name).pathname.replace(/^\/[0-9a-f]{32}\/[0-9a-f]+(?=\/)/,''),name])).values()];
    const picture=unique(names.filter(name=>new URL(name).pathname.includes('/media-video-'))),audio=unique(names.filter(name=>new URL(name).pathname.includes('/media-audio-')));
    if(picture.length!==1||audio.length!==1||!new URL(picture[0]).searchParams.get('l')||new URL(picture[0]).searchParams.get('l')!==new URL(audio[0]).searchParams.get('l'))return {state:'loading'};
    const lengths=await Promise.all([measure(picture[0]),measure(audio[0])]);
    if(lengths.some(n=>!Number.isFinite(n)||Math.abs(n-video.duration)>Math.max(.5,video.duration*.005)))return {state:'loading'};
    return {state:'ready',title,mediaUrl:picture[0],audioUrl:audio[0],seconds:video.duration};
  }.toString()})(${JSON.stringify(page)})`;
}
export function biliProbeExpression(page,quality='best') {
  return `(${async function(expected,quality) {
    const u=new URL(location.href),wanted=new URL(expected);
    if(!['www.bilibili.com','bilibili.com'].includes(u.hostname)||u.pathname.replace(/\/$/,'')!==wanted.pathname.replace(/\/$/,'')||(u.searchParams.get('p')||'1')!==(wanted.searchParams.get('p')||'1'))return {state:'loading'};
    const state=window.__INITIAL_STATE__,part=Number(wanted.searchParams.get('p')||1),data=state?.videoData;
    if(!data||data.bvid!==wanted.pathname.split('/').pop()&&'av'+data.aid!==wanted.pathname.split('/').pop())return {state:'loading'};
    const cid=data.pages?.[part-1]?.cid;if(!cid)return {state:'unavailable'};
    let info=window.__playinfo__?.data;
    // Read only this page's selected cid using the official first-party API.
    if(!info || part!==1) {
      try {const response=await fetch('https://api.bilibili.com/x/player/playurl?bvid='+encodeURIComponent(data.bvid)+'&cid='+cid+'&qn=127&fnval=4048&fourk=1',{credentials:'include',signal:AbortSignal.timeout(20000)});const result=await response.json();if(result.code===0)info=result.data;}catch{}
    }
    if(!info)return {state:'loading'};
    const videos=(info.dash?.video||[]).filter(v=>typeof(v.baseUrl||v.base_url)==='string'&&(quality==='best'||v.height<=Number(quality))).sort((a,b)=>b.height-a.height||b.bandwidth-a.bandwidth);
    const audios=(info.dash?.audio||[]).sort((a,b)=>b.bandwidth-a.bandwidth);
    const selected=videos[0],sound=audios[0];
    if(selected)return {state:'ready',title:data.title||document.title,mediaUrl:selected.baseUrl||selected.base_url,...(sound?{audioUrl:sound.baseUrl||sound.base_url}:{}),seconds:Number(info.timelength)/1000,height:selected.height};
    const heights={16:360,32:480,64:720,74:720,80:1080,112:1080,116:1080,120:2160,125:2160,126:2160,127:4320};
    if(info.durl?.length===1&&(quality==='best'||heights[info.quality]&&heights[info.quality]<=Number(quality)))return {state:'ready',title:data.title||document.title,mediaUrl:info.durl[0].url,seconds:Number(info.timelength)/1000};
    if(info.dash?.video?.length||info.durl?.length)return {state:'quality-unavailable'};
    return {state:'loading'};
  }.toString()})(${JSON.stringify(page)},${JSON.stringify(quality)})`;
}
