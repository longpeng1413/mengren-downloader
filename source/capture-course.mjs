// Read only course titles explicitly associated with a media address. Never infer
// the current lesson from response order or copy account fields into the catalog.
export const courseDomains=['justkami.com','xiaoeknow.com','xiaoe-tech.com','xet.tech','xetslk.com','xetlk.com'];
export function courseResponse(address,mime='',domains=courseDomains) {
  try {const u=new URL(address);return domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d))&&/json/i.test(mime)&&/course|lesson|video|resource|live|lookback|detail|share|news|product/i.test(u.pathname)&&!/login|oauth|passport|payment|account|profile|member|userinfo/i.test(u.pathname);}catch{return false;}
}
export function courseTitle(value) {
  if(typeof value!=='string'||value.length>300||/https?:\/\/|[\x00-\x08\x0e-\x1f\x7f\u001b]/i.test(value))return null;
  const title=value.replace(/[\t\r\n]+/g,' ').replace(/[\u202a-\u202e\u2066-\u2069]/g,'').trim();
  if(!title||/^(?:video|media|download|视频|抓取视频|untitled)(?:[\s_\d-]*)$/i.test(title)||/^[\da-f_-]{12,}$/i.test(title)||/^\d+$/.test(title))return null;
  return title.slice(0,180);
}
export function mediaIdentity(address) {
  const u=new URL(address);u.hash='';
  const tail=u.pathname.split('/').pop();
  const generic=/^(?:video|media|play|playback|getvideo|download|file|index|master|playlist)(?:\.[a-z0-9]+)?$/i.test(tail||'');
  const contentId=[...u.searchParams.keys()].some(key=>/^(?:code|id|video_?id|resource_?id|lesson_?id|course_?id|cid|vid)$/i.test(key)&&u.searchParams.get(key));
  // A token-only generic player endpoint can represent different lessons. Keep
  // its full identity instead of incorrectly merging their titles and queues.
  if(contentId||(!generic&&/\.(?:mp4|m3u8|webm|mkv|mov|flv)$/i.test(tail||'')))
    for(const key of [...u.searchParams.keys()])if(/^(?:.*(?:sign|token|auth|expire)|expires|policy|key-pair-id|x-amz-.*|x-oss-.*|wssecret|wstime|range|start|end)$/i.test(key))u.searchParams.delete(key);
  u.searchParams.sort();return u.href;
}
const titleKeys=['videoName','video_name','videoTitle','video_title','lessonName','lesson_name','lessonTitle','lesson_title','resourceName','resource_name','resourceTitle','resource_title','title','courseName','course_name','name','课程名称','视频名称'];
const urlKey=/^(?:url|src|video_?url|media_?url|file_?url|play_?url|video_?path|file_?path|download_?url|hls_?url|mp4_?url)$/i;
const mediaContainer=/^(?:video|media|file|playInfo|play_info|playUrls|play_urls|sources|url_info)$/i;
export function extractCourseMetadata(document,allows) {
  const entries=new Map();let visited=0;
  function addresses(object,depth=0) {
    const result=[];if(!object||typeof object!=='object'||depth>3)return result;
    for(const [key,value] of Object.entries(object)) {
      if(urlKey.test(key)&&typeof value==='string') {
        try {const u=new URL(value);if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&value.length<=12000&&allows(value))result.push(value);}catch{}
      } else if(mediaContainer.test(key)&&value&&typeof value==='object') {
        if(Array.isArray(value))for(const x of value.slice(0,50))result.push(...addresses(x,depth+1));else result.push(...addresses(value,depth+1));
      }
    }
    return result;
  }
  function walk(object,depth=0) {
    if(!object||typeof object!=='object'||depth>12||++visited>10000||entries.size>=500)return;
    if(!Array.isArray(object)) {
      const title=titleKeys.map(key=>courseTitle(object[key])).find(Boolean);
      if(title)for(const url of addresses(object))entries.set(mediaIdentity(url),{url,title});
    }
    for(const [key,value] of Object.entries(object))if(!/^(?:user|author|owner|member|profile|account|credentials|authorization|cookie)$/i.test(key)&&value&&typeof value==='object')walk(value,depth+1);
  }
  walk(document);return [...entries.values()];
}
export function responseFileTitle(headers={}) {
  const disposition=headers['content-disposition'];if(typeof disposition!=='string')return null;
  let name=disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  try {if(name)name=decodeURIComponent(name);}catch{return null;}
  name ||= disposition.match(/filename="([^"\r\n]+)"/i)?.[1]||disposition.match(/filename=([^;\r\n]+)/i)?.[1];
  if(!name||/[\\/]/.test(name))return null;
  return courseTitle(name.replace(/\.(mp4|webm|mkv|mov|flv|m3u8)$/i,''));
}
