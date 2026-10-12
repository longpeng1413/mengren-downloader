import {courseTitle} from './capture-course.mjs';
export function describeCapture(item) {
  return '['+item.id+'] '+(item.title||'课程名未读取（下载前会提示填写）')+' | '+({video:'视频',hls:'分段视频',track:'音频/独立片段'}[item.kind])+' | '+(item.size?(item.size/1048576).toFixed(1)+' MiB':'大小待下载后确认')+(item.source==='course-list'?' | 课程列表来源，下载时验证':'')+(item.downloaded?' | 已下载':'');
}
export const captureHelp='直接输入数字下载，例如 1；批量输入 1-8 或 1,3,5；输入 全部 下载列表中尚未下载的视频。\n列表 查看；命名 1 课程名称 修改名称；清空 清除候选；直接回车退出抓取并恢复网络。';
export function selectCapture(input,items) {
  if(input==='全部'||input==='下载全部')return items.filter(x=>x.kind!=='track'&&!x.downloaded);
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
    const rename=input.match(/^命名\s+(\d+)\s+(.+)$/s);
    if(rename) {
      const item=catalog.items.find(x=>x.id===Number(rename[1])),title=courseTitle(rename[2]);
      if(!item||!title){log('请用 命名 1 课程名称；编号须在列表中，名称不能为空或包含网址。');continue;}
      item.title=title;item.titleSource='manual';log('已命名：'+describeCapture(item));continue;
    }
    let selected;try{selected=selectCapture(input,catalog.items);}catch(error){log(error.message);continue;}
    if(!selected.length){log('没有尚未下载的完整视频。请先逐节打开课程并播放，或输入 列表 查看。');continue;}
    // Freeze selection: newly observed courses never silently enter an active queue.
    const queue=selected.map(item=>({item,snapshot:{...item}}));let ok=0,failed=0,skipped=0;
    log('已加入 '+queue.length+' 节，按顺序下载；列表之外的课程不会自动补入。');
    for(let index=0;index<queue.length&&!shouldQuit();index++) {
      const {item,snapshot}=queue[index];
      snapshot.title ||= item.title;snapshot.url=item.url;
      if(!snapshot.title) {
        const title=courseTitle((await ask('编号 '+snapshot.id+' 未读到课程名。请输入原课程名称（空回车取消剩余队列）：')).trim());
        if(!title){skipped=queue.length-index;log('已取消剩余队列，没有使用时间或地址编号命名。');break;}
        snapshot.title=title;item.title=title;item.titleSource='manual';
      }
      log('['+(index+1)+'/'+queue.length+'] 正在下载：'+snapshot.title);
      try{await download(snapshot);item.downloaded=true;ok++;}
      catch(error){if(shouldQuit())break;failed++;log('未保存为成功结果：'+String(error.message).replace(/https?:\/\/[^\s"<>]+/g,'[媒体地址]'));log('本节失败，继续下一节；可重新播放后重试该编号。');}
    }
    log('队列结束：成功 '+ok+'，失败 '+failed+'，取消 '+skipped+'。输入新编号继续，或直接回车退出抓取。');
  }
}
