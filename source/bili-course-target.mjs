import {safeHttps} from './sites.mjs';
const id=value=>typeof value==='string'&&/^[1-9]\d{0,15}$/.test(value)?value:null;
export function courseTarget(address) {
  const u=safeHttps(address);if(!u||u.hash)return null;
  const ep=['www.bilibili.com','bilibili.com'].includes(u.hostname)&&u.pathname.match(/^\/cheese\/play\/ep([1-9]\d{0,15})\/?$/);
  if(ep)return {kind:'cheese',episode:ep[1],url:'https://www.bilibili.com/cheese/play/ep'+ep[1]};
  if(u.hostname!=='mall.bilibili.com'||u.pathname!=='/lesson/play')return null;
  const keys=['courseId','lessonId','itemId','sectionId'];
  if(keys.some(k=>u.searchParams.getAll(k).length>1))return null;
  const course=id(u.searchParams.get('courseId')),lesson=id(u.searchParams.get('lessonId')),item=u.searchParams.get('itemId'),section=u.searchParams.get('sectionId');
  if(!course||!lesson||(item&&!id(item))||(section&&!id(section)))return null;
  const canonical=new URL('https://mall.bilibili.com/lesson/play');canonical.searchParams.set('courseId',course);canonical.searchParams.set('lessonId',lesson);
  if(item)canonical.searchParams.set('itemId',item);if(section)canonical.searchParams.set('sectionId',section);
  return {kind:'mall',course,lesson,section:section||null,url:canonical.href};
}
