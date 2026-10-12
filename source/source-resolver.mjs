import {ensureBrowser,sleep} from './browser.mjs';
import {isXiaoe,xiaoeAddress,channelsShare,isPlayback,allowedMedia,xiaoeProbeExpression,channelsProbeExpression,playbackProbeExpression} from './sites.mjs';
export async function resolveSource(address,{timeout=600000,notify=()=>{},isCancelled=()=>false}={}) {
  const share=channelsShare(address),site=isXiaoe(address)?'xiaoe':share?'channels':null;
  if(!site) throw new Error('不是受支持的小鹅通或视频号链接');
  const browser=await ensureBrowser(), deadline=Date.now()+timeout;
  try {
    if(site==='xiaoe') {
      let page=await browser.page(address);let canonical=xiaoeAddress(address),loginOpened=false,contextChosen=false;
      while(Date.now()<deadline && !isCancelled()) {
        await sleep(2000);
        let current;try {current=await browser.evaluate(page.sessionId,'location.href');} catch {continue;}
        if(!canonical) canonical=xiaoeAddress(current);
        if(!canonical) continue;
        if(!contextChosen) {
          const origin=new URL(canonical).origin;
          const {targetInfos}=await browser.call('Target.getTargets');
          const own=targetInfos.find(t=>t.type==='page' && t.url.startsWith(origin+'/') && !t.url.includes('/auth'));
          page=own?{targetId:own.targetId,sessionId:await browser.attach(own.targetId)}:await browser.page(origin+'/p/decorate/personal_center');
          contextChosen=true;await sleep(2000);
        }
        let answer;try {answer=await browser.evaluate(page.sessionId,xiaoeProbeExpression(canonical));} catch {continue;}
        if(answer?.state==='login') {
          if(!loginOpened) {
            const origin=new URL(canonical).origin;
            await browser.navigate(page,origin+'/p/t/free/v1/basic-platform/h5_basic/login/auth?redirect_url='+encodeURIComponent(origin+'/p/decorate/personal_center'));
            loginOpened=true;notify('请在下载专用 Edge 的小鹅通原网站完成登录，若有访问密码请自行输入；完成后自动继续。');
          }
          continue;
        }
        if(answer?.state==='denied') throw new Error('小鹅通尚未允许读取此回放，请在原页面确认登录、访问密码和课程权限后重试');
        if(answer?.state==='no-replay') throw new Error('此页面没有可下载的已结束回放；直播中内容暂不支持');
        if(answer?.state==='ready') {
          const renditions=answer.renditions.filter(item=>allowedMedia(site,item.url)&&/\.m3u8$/i.test(new URL(item.url).pathname)).sort((a,b)=>Number(b.default)-Number(a.default));
          if(!renditions.length) throw new Error('小鹅通没有返回允许的回放地址');
          return {site,page:canonical,title:answer.title,mediaUrl:renditions[0].url,renditions};
        }
      }
    } else {
      const {targetInfos}=await browser.call('Target.getTargets');
      const existing=targetInfos.find(t=>t.type==='page' && t.url.startsWith('https://yuanbao.tencent.com/'));
      const page=existing?{targetId:existing.targetId,sessionId:await browser.attach(existing.targetId)}:await browser.page('https://yuanbao.tencent.com/');
      let loginNotified=false,playback;
      while(Date.now()<deadline && !isCancelled()) {
        await sleep(4000);
        if(!playback) {
          let answer;try {answer=await browser.evaluate(page.sessionId,channelsProbeExpression(share));} catch {continue;}
          if(answer?.state==='login') {if(!loginNotified){notify('请在下载专用 Edge 的腾讯元宝原网站登录；登录后自动继续，不会发送聊天消息。');loginNotified=true;}continue;}
          if(answer?.state==='unavailable') throw new Error('元宝暂未返回可播放视频号地址，该链接可能暂不支持；请在元宝确认登录后重试');
          if(answer?.state!=='ready') continue;
          if(!isPlayback(answer.playbackUrl)) throw new Error('元宝返回的播放地址不符合腾讯官方域名要求');
          playback=await browser.page(answer.playbackUrl);await sleep(3000);
        }
        let info;try {info=await browser.evaluate(playback.sessionId,playbackProbeExpression);} catch {continue;}
        if(info?.state==='unavailable') throw new Error('腾讯官方播放页暂时不能读取此视频，请重新读取分享链接');
        if(info?.state==='ready') {
          if(!allowedMedia(site,info.mediaUrl)) throw new Error('视频号媒体地址不符合腾讯官方域名要求');
          return {site,page:share,title:info.title,mediaUrl:info.mediaUrl};
        }
      }
    }
    if(isCancelled()) throw new Error('下载已取消');
    throw new Error('等待网站登录或播放器超时，请完成原网站登录后重新打开下载器');
  } finally {browser.close();}
}
