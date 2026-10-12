import {courseTitle} from './capture-course.mjs';
export function describeCapture(item) {
  return '['+item.id+'] '+(item.title||'课程名读取中（可用“命名 编号 名称”补充）')+' | '+({video:'视频',hls:'分段视频',track:'音频/独立片段'}[item.kind])+' | '+(item.size?(item.size/1048576).toFixed(1)+' MiB':'大小待下载后确认')+(item.courseOrder?' | 课程序号 '+item.courseOrder+'（'+(item.orderSource==='manual'?'手动':'网站')+'）':'')+(item.source==='course-list'?' | 课程列表来源，下载时验证':'')+(item.downloaded?' | 已下载':'');
}
export const isAllCapture=input=>['全部','全部下载','下载全部'].includes(input.replace(/\s+/g,''));
function manualTitle(input){const title=courseTitle(input);if(!title)return null;const command=title.replace(/^\d+[.．、:：]\s*/, '');return isAllCapture(command)||['列表','清空','退出','序号','命名','q','l'].includes(command.toLowerCase())||/^[\d,，、 -]+$/.test(command)?null:title;}
export const captureHelp='直接输入数字下载，例如 1；批量输入 1-8 或 1,3,5；输入 全部 / 全部下载 / 下载全部，下载列表中尚未下载的视频。\n列表 查看；命名 1 课程名称 修改名称；序号 1 13 把编号1设为第13课；清空 清除候选；直接回车退出抓取并恢复网络。\n文件序号优先网站明确序号；未提供则用本次列表编号（采集顺序），不是本次下载队列中的名次。';
export function selectCapture(input,items) {
  if(isAllCapture(input))return items.filter(x=>x.kind!=='track'&&!x.downloaded);
  const tokens=input.replace(/[，、]/g,',').split(/[,\s]+/).filter(Boolean);const ids=[];
  if(!tokens.length)throw Error('请输入数字编号，例如 1；批量可输入 1-8、1,3,5 或 全部。');
  for(const token of tokens) {
    const match=token.match(/^(\d+)(?:-(\d+))?$/);if(!match)throw Error('请输入数字编号，例如 1；批量可输入 1-8、1,3,5 或 全部。');
    const first=Number(match[1]),last=Number(match[2]||match[1]);
    if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<1||last<first||last-first>=200)throw Error('编号范围无效；请先输入 列表 查看实际编号。');
    for(let id=first;id<=last;id++)if(!ids.includes(id))ids.push(id);
    if(ids.length>200)throw Error('一次最多选择 200 个编号。');
  }
  return ids.map(id=>{const item=items.find(x=>x.id===id);if(!item)throw Error('列表没有编号 '+id+'，未开始下载；请先输入 列表。');if(item.kind==='track')throw Error('编号 '+id+' 是音频或独立片段，请选择视频或分段视频。');return item;});
}
export async function runCaptureMenu({catalog,ask,download,log=console.log,shouldQuit=()=>false}) {
  log(captureHelp);
  while(!shouldQuit()) {
    const input=(await ask('抓取操作（输入数字 / 全部 / 列表；空回车退出）：')).trim();
    if(!input||input==='退出'||input.toLowerCase()==='q')break;
    if(input==='列表'||input.toLowerCase()==='l') {
      if(!catalog.items.length)log('还没有发现媒体。请在开启抓取后重新打开课程并播放。');
      else {for(const item of catalog.items)log(describeCapture(item));log(captureHelp);}continue;
    }
    if(input==='清空'){catalog.clear();log('已清空候选。可逐节打开要下载的课程，列表会累积；最后输入 全部 批量下载。');continue;}
    const numbering=input.match(/^序号\s+(\d+)\s+(\d+)$/);
    if(numbering){const item=catalog.items.find(x=>x.id===Number(numbering[1])),order=Number(numbering[2]);if(!item||order<1||order>10000){log('请用 序号 1 13；左边是列表编号，右边是原课程序号（1-10000）。');continue;}item.courseOrder=order;item.orderSource='manual';log('已更新序号：'+describeCapture(item));continue;}
    const rename=input.match(/^命名\s+(\d+)\s+(.+)$/s);
    if(rename) {
      const item=catalog.items.find(x=>x.id===Number(rename[1])),title=manualTitle(rename[2]);
      if(!item||!title){log('请用 命名 1 课程名称；编号须在列表中，名称不能为空、包含网址或使用下载/操作指令。');continue;}
      item.title=title;item.titleSource='manual';log('已命名：'+describeCapture(item));continue;
    }
    let selected;try{selected=selectCapture(input,catalog.items);}catch(error){log(error.message);continue;}
    if(!selected.length){log('没有尚未下载的完整视频。请先逐节打开课程并播放，或输入 列表 查看。');continue;}
    const missing=selected.filter(item=>!item.title);
    if(missing.length){
      log('尚未开始下载：编号 '+missing.map(item=>item.id).join('、')+' 的课程名还未读到。');
      log('等待自动名称补齐后再输入 全部；也可输入 命名 '+missing[0].id+' 原课程名称，然后重新输入下载指令。');
      log('当前仍是操作指令输入，不会把“全部”或数字当成课程名。');continue;
    }
    // Freeze candidate membership, but read each latest bound title and signed
    // address only when its turn starts. There is never a free-text name prompt.
    const queue=[...selected];let ok=0,failed=0;
    log('已加入 '+queue.length+' 节，按顺序下载；列表之外的课程不会自动补入。');
    for(let index=0;index<queue.length&&!shouldQuit();index++) {
      const item=queue[index],snapshot={...item};
      log('['+(index+1)+'/'+queue.length+'] 正在下载：'+snapshot.title);
      try{await download(snapshot);item.downloaded=true;ok++;}
      catch(error){if(shouldQuit())break;failed++;log('未保存为成功结果：'+String(error.message).replace(/https?:\/\/[^\s"<>]+/g,'[媒体地址]'));log('本节失败，继续下一节；可重新播放后重试该编号。');}
    }
    log('队列结束：成功 '+ok+'，失败 '+failed+'。输入新编号继续，或直接回车退出抓取。');
  }
}
