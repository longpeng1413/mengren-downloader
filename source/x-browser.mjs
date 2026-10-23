import {ensureBrowser,sleep} from './browser.mjs';
import {xAddress,allowedMedia} from './sites.mjs';

// X post videos for posts that need a login. The user signs in on x.com inside the
// dedicated Edge; we never read cookies. We only parse the post data X's own page
// loads (TweetDetail / TweetResultByRestId), keep nothing but the selected post's
// MP4 variants and a title, and download from video.twimg.com through the relay.

export const xPostId=page=>new URL(page).pathname.match(/\/status\/(\d+)/)?.[1];

// Finds the selected post in an X GraphQL response.
// ready: has video; novideo: post visible but no video; tombstone: X hides it from this viewer.
export function xPostFromResponse(json,id) {
  let post=null,tombstone=false;
  const walk=(node,depth)=>{
    if(post||!node||typeof node!=='object'||depth>80) return;
    if(Array.isArray(node)) {for(const item of node) walk(item,depth+1);return;}
    if(node.__typename==='TweetTombstone') tombstone=true;
    const candidate=node.__typename==='TweetWithVisibilityResults'?node.tweet:node;
    if(candidate&&candidate.rest_id===id&&candidate.legacy) {post=candidate;return;}
    for(const key of Object.keys(node)) walk(node[key],depth+1);
  };
  walk(json,0);
  if(!post) return tombstone?{state:'tombstone'}:null;
  const user=post.core?.user_results?.result;
  const name=String(user?.core?.name||user?.legacy?.name||'X').replace(/\s+/g,' ').trim().slice(0,60);
  let text=String(post.legacy.full_text||'').replace(/\s*https:\/\/t\.co\/\w+\s*$/,'').replace(/\s+/g,' ').trim();
  if([...text].length>50) text=[...text].slice(0,50).join('')+'…';
  const title=text?`${name} - ${text}`:name;
  const media=(post.legacy.extended_entities?.media||[]).filter(item=>['video','animated_gif'].includes(item?.type));
  if(!media.length) return {state:'novideo',title};
  return {state:'ready',title,videos:media.map(item=>({
    variants:(item.video_info?.variants||[]).filter(v=>v?.content_type==='video/mp4'&&typeof v.url==='string').map(v=>({url:v.url,bitrate:Number(v.bitrate)||0}))
  }))};
}

// Highest bitrate first, only official MP4s, honouring the height cap like YouTube/Bilibili.
export function pickXRenditions(variants,quality='best') {
  const list=variants.filter(v=>allowedMedia('x',v.url)).map(v=>{
    const size=new URL(v.url).pathname.match(/\/(\d{2,5})x(\d{2,5})\//);
    return {url:v.url,bitrate:v.bitrate,width:size?Number(size[1]):0,height:size?Number(size[2]):0};
  });
  // GIFs (tweet_video) carry no size in the address; keep them under any cap.
  const allowed=quality==='best'?list:list.filter(v=>v.height===0||v.height<=Number(quality));
  return allowed.sort((a,b)=>b.bitrate-a.bitrate||b.height-a.height);
}

// Logged-in state from the visible page only.
export const xLoginExpression=`(${function() {
  if(!/(^|\.)(x|twitter)\.com$/.test(location.hostname)) return {state:'loading',path:''};
  const has=selector=>Boolean(document.querySelector(selector));
  // X may say a (sensitive) post is only visible in its mobile app.
  const appOnly=/仅在 ?X ?应用中可见|only (?:be )?(?:visible|available|viewable) (?:in|on) the X app/i.test((document.body&&document.body.innerText)||'');
  if(has('[data-testid="SideNav_AccountSwitcher_Button"]')||has('[data-testid="AppTabBar_Profile_Link"]')) return {state:'in',path:location.pathname,appOnly};
  // Logged-out visitors land on the onboarding page (/i/jf/onboarding/web) or see login links.
  if(location.pathname.startsWith('/i/flow/login')||location.pathname.startsWith('/i/jf/onboarding')||has('[data-testid="loginButton"]')||has('[data-testid="login"]')||has('a[href="/login"]')||has('a[href="/i/flow/login"]')||has('a[href*="mode=login"]')) return {state:'out',path:location.pathname,appOnly};
  return {state:'loading',path:location.pathname,appOnly};
}.toString()})()`;

export async function resolveX(address,{quality='best',timeout=600000,notify=()=>{},isCancelled=()=>false}={}) {
  const page=xAddress(address);if(!page) throw new Error('不是 X 帖子链接');
  const id=xPostId(page),browser=await ensureBrowser(),created=[],offs=[];
  let succeeded=false;
  try {
    const {targetId}=await browser.call('Target.createTarget',{url:'about:blank'});created.push(targetId);
    const sessionId=await browser.attach(targetId);
    const watching=new Set(),finished=[];
    offs.push(browser.on('Network.responseReceived',(params,session)=>{
      const url=params.response?.url||'';
      if(session===sessionId&&params.response?.status===200&&/^https:\/\/(?:x|twitter)\.com\/i\/api\/graphql\/[^/]+\/(?:TweetDetail|TweetResultByRestId)(?:\?|$)/.test(url)) watching.add(params.requestId);
    }));
    offs.push(browser.on('Network.loadingFinished',(params,session)=>{if(session===sessionId&&watching.delete(params.requestId))finished.push(params.requestId);}));
    await browser.call('Network.enable',{maxTotalBufferSize:30000000,maxResourceBufferSize:15000000},sessionId);
    await browser.call('Page.navigate',{url:page},sessionId);
    const deadline=Date.now()+timeout;
    let result=null,novideo=null,tombstone=false,notified=false,waitedForLogin=false,reopened=false,openedAt=Date.now(),reloaded=false;
    const reopen=async()=>{tombstone=false;novideo=null;openedAt=Date.now();reloaded=false;await browser.call('Page.navigate',{url:page},sessionId);};
    while(Date.now()<deadline&&!isCancelled()) {
      await sleep(1500);
      while(finished.length&&!result) {
        let body;try{body=await browser.call('Network.getResponseBody',{requestId:finished.shift()},sessionId);}catch{continue;}
        if(typeof body?.body!=='string'||body.body.length>15000000) continue;
        let json;try{json=JSON.parse(body.base64Encoded?Buffer.from(body.body,'base64').toString('utf8'):body.body);}catch{continue;}
        const post=xPostFromResponse(json,id);
        if(post?.state==='ready') result=post;
        else if(post?.state==='novideo') novideo=post;
        else if(post?.state==='tombstone') tombstone=true;
      }
      if(result) break;
      let view;try{view=await browser.evaluate(sessionId,xLoginExpression);}catch{continue;}
      if(view?.state==='out') {
        if(!notified){
          notify('这条帖子需要登录 X 才能看。请在弹出的下载专用 Edge 里用 X 账号和密码登录（只需第一次），登录后软件自动继续。');
          notify('想用 Google 登录的话：Google 不允许在被软件控制的浏览器里登录，请先按 Ctrl+C 中止，输入 登录X 回车，按提示登录后再粘贴这条链接。');
          notified=true;
        }
        waitedForLogin=true;continue;
      }
      if(view?.state!=='in') continue;
      // After signing in X usually lands on /home; open the post again once.
      if(waitedForLogin&&!reopened){reopened=true;await reopen();continue;}
      if(view.appOnly) throw new Error('X 只允许在手机 App 里看这条帖子（通常是敏感内容），网页版登录后也看不到，所以暂时无法下载。可以在 X 网页的“设置 - 隐私与安全 - 你看到的内容”里打开“显示可能包含敏感内容的媒体”后再试');
      if(!view.path.includes('/status/'+id)) continue;
      if(novideo) throw new Error('这条帖子里没有视频（只有图片或文字）');
      if(tombstone) throw new Error('你的 X 账号也看不到这条帖子：可能需要年龄验证、对方限制了查看范围，或帖子已删除。软件不会绕过这些限制');
      if(!reloaded&&Date.now()-openedAt>25000){reloaded=true;openedAt=Date.now();await browser.call('Page.reload',{},sessionId);}
    }
    if(!result) throw new Error(isCancelled()?'下载已取消':'等待 X 登录或读取帖子超时，请在下载专用 Edge 里确认这条帖子能正常播放后重试');
    const videos=result.videos.map(video=>({renditions:pickXRenditions(video.variants,quality)}));
    if(videos.some(video=>!video.renditions.length)) throw new Error('这条帖子的视频没有不高于所选上限的画质，请改选最高画质或其他档位');
    succeeded=true;
    return {page,title:result.title,videos};
  } finally {
    for(const off of offs) off();
    // Close the tab we opened once the video addresses are read; keep it on failure
    // so the user can finish logging in or check the post.
    if(succeeded) await browser.closePages(created);
    browser.close();
  }
}
