'use strict';
// 猛人下载器窗口版的界面。所有操作都交给本机后台（source/gui-server.mjs），
// 后台通过 /api/events 实时推送队列、记录、抓取和更新状态。

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const qualities = [['best', '最高画质', '不限制清晰度'], ['1080', '1080P 及以下', ''], ['720', '720P 及以下', ''], ['480', '480P 及以下', '文件更小']];
const mb = n => n ? (n / 1048576).toFixed(1) + 'MB' : '大小未知';
const bytes = n => n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : (n || 0) + ' B';
const clock = s => { s = Math.round(s || 0); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function when(t) {
  const d = new Date(t), now = new Date(), hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  return (d.toDateString() === y.toDateString() ? '昨天 ' : `${d.getMonth() + 1}月${d.getDate()}日 `) + hm;
}

let state = { settings: {}, jobs: [], history: [], capture: { state: 'off', items: [] }, update: {} };

/* ---------- 与后台通信 ---------- */
async function call(path, body) {
  try {
    const r = await fetch('/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401 || r.status === 403) { lost(); return {}; }
    const answer = await r.json();
    if (answer.error) toast(answer.error);
    return answer;
  } catch { lost(); return {}; }
}
const post = (path, body = {}) => call(path, body);
const get = path => call(path);
let failures = 0, connected = false;
function connect() {
  const events = new EventSource('/api/events');
  events.onmessage = e => { failures = 0; connected = true; handle(JSON.parse(e.data)); };
  events.onerror = () => { if (++failures >= 3 || events.readyState === EventSource.CLOSED) { events.close(); lost(); } };
}
function lost(title, text) {
  if (title) { $('#lost-title').textContent = title; $('#lost-text').textContent = text; }
  $('#lost').hidden = false; connected = false;
}
function handle(m) {
  if (m.type === 'state') {
    state = m; applySettings(); renderVersion(); renderQueue(); renderDone(); renderCapture(); renderUpdate();
    if (m.update?.result) showUpdateResult(m.update.result);
  }
  if (m.type === 'jobs') { state.jobs = m.jobs; renderQueue(); }
  if (m.type === 'history') { state.history = m.history; renderDone(); if (!$('#page-settings').hidden) loadStorage(); }
  if (m.type === 'settings') { state.settings = m.settings; applySettings(); }
  if (m.type === 'capture') { state.capture = m.capture; renderCapture(); }
  if (m.type === 'update') { state.update = m.update; renderUpdate(); }
  if (m.type === 'toast') toast(m.text);
  if (m.type === 'recognize') onRecognize(m);
  if (m.type === 'done') finished(m);
}

/* ---------- 页面切换、提示、弹窗 ---------- */
function show(page) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === page));
  $$('.page').forEach(p => { const on = p.id === 'page-' + page; p.classList.toggle('active', on); p.hidden = !on; });
  if (page === 'settings') loadStorage();
  scrollTo({ top: 0 });
}
$$('.tab').forEach(t => t.addEventListener('click', () => show(t.dataset.page)));
function toast(text) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = text;
  $('#toasts').append(el); setTimeout(() => el.remove(), 4000);
}
function confirmBox(title, text, okText = '确定') {
  return new Promise(done => {
    $('#dialog-title').textContent = title; $('#dialog-text').textContent = text; $('#dialog-ok').textContent = okText;
    $('#dialog').hidden = false; $('#dialog-ok').focus();
    const finish = v => { $('#dialog').hidden = true; $('#dialog-ok').onclick = $('#dialog-cancel').onclick = null; done(v); };
    $('#dialog-ok').onclick = () => finish(true); $('#dialog-cancel').onclick = () => finish(false);
  });
}
function finished(m) {
  toast((m.ok ? '下载完成：' : '下载失败：') + (m.title || ''));
  if (state.settings.notify && 'Notification' in window && Notification.permission === 'granted' && (document.hidden || !document.hasFocus()))
    new Notification(m.ok ? '下载完成' : '下载失败', { body: (m.title || '') + (m.ok ? '' : '\n' + (m.reason || '')), icon: 'app.png', silent: true });
}
function askNotifyPermission() {
  if (state.settings.notify && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

/* ---------- 设置 ---------- */
function applySettings() {
  const s = state.settings, root = document.documentElement;
  if (s.theme === 'light' || s.theme === 'dark') root.dataset.theme = s.theme; else delete root.dataset.theme;
  root.classList.toggle('big', Boolean(s.big));
  $('#quality').value = s.quality || 'best'; $('#theme').value = s.theme || 'system';
  for (const key of ['big', 'clipboard', 'notify', 'checkUpdates', 'autoUpdate']) $('#' + key).checked = Boolean(s[key]);
  $('#save-path').textContent = s.saveDir || ''; $('#save-hint').textContent = s.saveDir || '';
  $('#autoUpdate').disabled = Boolean(state.devCopy);
  if (state.devCopy) $('#auto-update-note').textContent = '当前是开发目录（源码），只提示新版本，不会自动覆盖文件';
}
for (const key of ['quality', 'theme']) $('#' + key).addEventListener('change', e => post('settings', { [key]: e.target.value }));
for (const key of ['big', 'clipboard', 'notify', 'checkUpdates', 'autoUpdate']) $('#' + key).addEventListener('change', e => {
  post('settings', { [key]: e.target.checked });
  if (key === 'notify' && e.target.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
});
function renderVersion() { $$('.version').forEach(el => el.textContent = 'v' + state.version + (state.preview ? ' 预览版' : '')); }

/* ---------- 识别 ---------- */
let current = null;
const loadingText = {
  qq: '正在读取这首歌能下载的音质……用会员账号读取时会打开“下载专用 Edge”，第一次需要在里面登录 QQ 音乐。',
  xmly: '正在读取专辑目录……第一次需要在弹出的“下载专用 Edge”里登录喜马拉雅。集数多的专辑要一两分钟（为免被网站限制，会按正常速度翻页）。',
};
async function recognize(qqMode) {
  const text = $('#link').value.trim();
  if (!text) { toast('请先粘贴链接或分享文字'); $('#link').focus(); return; }
  $('#clip-hint').hidden = true;
  const box = $('#result'); box.hidden = false;
  box.innerHTML = '<div class="loading"><span class="spinner"></span>正在识别……</div>';
  $('#recognize').disabled = true;
  const r = await post('recognize', { text, qqMode });
  $('#recognize').disabled = false;
  if (!r.id) { current = null; box.innerHTML = r.error ? `<div class="alert danger">${esc(r.error)}</div>` : ''; box.hidden = !r.error; return; }
  current = r;
  if (r.status === 'done') renderResult(); else renderLoading();
}
function renderLoading() {
  $('#result').innerHTML = `<div><span class="site">${esc(current.site)}</span></div>
    <div class="loading"><span class="spinner"></span><span>${esc(loadingText[current.kind])}</span></div>
    ${current.note ? `<div class="alert warn">${esc(current.note)}</div>` : ''}
    <div class="actions">${current.kind === 'qq' && current.qqMode !== 'standard' ? '<button class="ghost" data-action="qq-mode">不想登录？改用不登录快速读取</button>' : ''}<button class="ghost" data-action="cancel-recognize">取消</button></div>`;
}
function onRecognize(m) {
  if (!current || m.id !== current.id) return;
  if (m.status === 'running') { current.note = m.note; renderLoading(); }
  if (m.status === 'done') { current.status = 'done'; current.result = m.result; renderResult(); }
  if (m.status === 'fail') {
    $('#result').innerHTML = `<div><span class="site">${esc(current.site)}</span></div><div class="alert danger">${esc(m.error)}</div><div class="actions"><button class="ghost" data-action="recognize-again">重新识别</button></div>`;
  }
  if (m.status === 'cancel') { $('#result').hidden = true; current = null; }
}
function renderResult() {
  const r = current, box = $('#result');
  let body = `<div><span class="site">${esc(r.site)}</span>`;
  if (r.kind === 'video') {
    body += `<span class="title">${esc(r.url)}</span></div><div class="meta">标题会在开始下载后显示</div>`;
    if (r.note) body += `<div class="alert warn">${esc(r.note)}</div>`;
    if (r.quality) body += `<div class="options">${qualities.map(([v, label, note]) => `<label class="option"><input type="radio" name="q" value="${v}" ${v === state.settings.quality ? 'checked' : ''}><span>${label}${note ? `<small>${note}</small>` : ''}</span></label>`).join('')}</div>`;
    body += `<div class="actions"><button class="primary" data-action="enqueue">加入下载</button></div>`;
  } else if (r.kind === 'qq') {
    const t = r.result;
    body += `<span class="title">${esc(t.title)}${t.singers?.length ? ' - ' + esc(t.singers.join('、')) : ''}</span></div><div class="meta">${esc(t.album || '')}${t.seconds ? ' · ' + clock(t.seconds) : ''}</div>`;
    body += `<p class="muted">${r.qqMode === 'standard' ? '用的是“不登录快速读取”（免费歌曲最高 128k）。' : '用的是会员账号读取。'}<button class="link" data-action="qq-mode">${r.qqMode === 'standard' ? '改用会员账号读取' : '改用不登录快速读取'}</button></p>`;
    body += `<div class="options stack">${t.formats.map(f => `<label class="option"><input type="radio" name="fmt" value="${esc(f.prefix)}" ${f.prefix === t.default ? 'checked' : ''}><span><b>${esc(f.label)}</b> · ${mb(f.size)}${f.prefix === t.default ? ' · <b>推荐</b>' : ''}<small>${esc(f.note)}</small></span></label>`).join('')}</div>`;
    body += `<p class="muted">同时保存同名 .lrc 歌词。只下载账号能完整播放的歌曲，不下载试听片段。</p><div class="actions"><button class="primary" data-action="enqueue">加入下载</button></div>`;
  } else {
    const a = r.result, paid = a.tracks.filter(t => t.isPaid).length, have = a.tracks.filter(t => t.have).length;
    body += `<span class="title">${esc(a.title.split('|')[0].trim())}</span></div>`;
    if (a.single) {
      const t = a.tracks[0];
      body += `<div class="meta">单集：${esc(t.title)}${t.duration ? ' · ' + clock(t.duration) : ''}${t.isPaid ? ' · 会员/付费' : ''}${t.have ? ' · 以前下载过' : ''}</div>`;
    } else {
      body += `<div class="meta">共 ${a.total} 集，读到 ${a.tracks.length} 集（免费 ${a.tracks.length - paid}，会员/付费 ${paid}）${have ? `，其中 ${have} 集以前下载过` : ''}</div>`;
      if (a.tracks.length < a.total) body += `<p class="muted">有几集网页没有列出，可能已下架或只在 App 里能看到。</p>`;
      body += `<div class="episodes-tools"><input type="text" id="range" placeholder="填范围，如 1-50、100-、3,5,8"><button class="small" data-sel="range">按范围选</button><button class="small" data-sel="all">全选</button><button class="small" data-sel="new">只选没下过的</button><button class="small" data-sel="none">全不选</button></div>`;
      body += `<div class="episodes">${a.tracks.map(t => `<label class="episode"><input type="checkbox" value="${t.index}" ${t.have ? '' : 'checked'}><span class="num">${String(t.index).padStart(3, '0')}</span><span>${esc(t.title)}</span><span>${t.isPaid ? '<span class="tag vip">会员</span>' : ''}${t.have ? '<span class="tag have">已下载</span>' : ''}</span><span class="len">${clock(t.duration)}</span></label>`).join('')}</div>`;
    }
    body += `<p class="muted">保存到：${esc(a.folder)}　以前下载过的会自动跳过；会员单集需要账号有权限，试听片段不会下载。</p>`;
    body += `<div class="actions"><span class="muted" id="ep-count"></span><button class="primary" data-action="enqueue">加入下载</button></div>`;
  }
  box.innerHTML = body; box.hidden = false;
  if (r.kind === 'xmly' && !r.result.single) updateEpisodeCount();
}
function updateEpisodeCount() {
  const n = $$('.episode input:checked').length;
  $('#ep-count').textContent = `已选 ${n} 集`;
  const btn = $('[data-action="enqueue"]'); btn.textContent = n ? `加入下载（${n} 集）` : '加入下载'; btn.disabled = !n;
}
function selectEpisodes(how) {
  const boxes = $$('.episode input'), tracks = current.result.tracks;
  const have = new Set(tracks.filter(t => t.have).map(t => t.index));
  if (how === 'all') boxes.forEach(b => b.checked = true);
  if (how === 'none') boxes.forEach(b => b.checked = false);
  if (how === 'new') boxes.forEach(b => b.checked = !have.has(+b.value));
  if (how === 'range') {
    const max = Math.max(...tracks.map(t => t.index));
    const text = $('#range').value.trim().replace(/\s*[-~～到至]\s*/g, '-').replace(/[，、；;\s]+/g, ',');
    const picked = new Set(); let bad = '';
    for (const t of text.split(',').filter(Boolean)) {
      const m = t.match(/^(\d+)(?:-(\d*))?$/); if (!m) { bad = t; break; }
      const a = +m[1], b = m[2] === undefined ? a : (m[2] === '' ? max : +m[2]);
      for (let i = a; i <= b; i++) picked.add(i);
    }
    if (bad || !picked.size) { toast(bad ? `看不懂“${bad}”，请填 1-50、100- 或 3,5,8` : '请先填要下载的集数范围'); return; }
    boxes.forEach(b => b.checked = picked.has(+b.value));
  }
  updateEpisodeCount();
}
async function enqueue() {
  if (!current) return;
  askNotifyPermission();
  const body = { rid: current.id };
  if (current.kind === 'video') body.quality = $('input[name=q]:checked')?.value || state.settings.quality;
  if (current.kind === 'qq') body.format = $('input[name=fmt]:checked')?.value;
  if (current.kind === 'xmly') body.episodes = $$('.episode input:checked').map(b => +b.value);
  const r = await post('enqueue', body);
  if (!r.ok) return;
  toast('已加入下载');
  lastLink = $('#link').value.trim();
  $('#result').hidden = true; $('#link').value = ''; current = null;
}

/* ---------- 队列与记录 ---------- */
function renderQueue() {
  const jobs = state.jobs || [];
  $('#queue').innerHTML = jobs.map(j => {
    const run = j.state === 'run', name = j.title || j.site + ' 下载';
    let sub = esc(j.sub);
    if (run && j.cancelled) sub = '正在取消……';
    else if (run) {
      const parts = j.parts > 1 ? `第 ${Math.min(j.parts, j.part + 1)}/${j.parts} 集 · ` : '';
      sub = j.progress != null ? `${parts}${j.progress.toFixed(1)}%${j.size ? ' · 共 ' + esc(j.size) : ''}${j.speed ? ' · ' + esc(j.speed) : ''}` : `${parts}${esc(j.note || '准备中……')}`;
    }
    const percent = run ? (j.parts > 1 ? Math.min(100, (j.part + (j.progress || 0) / 100) / j.parts * 100) : (j.progress || 0)) : 0;
    return `<li class="item">
      <div class="name"><span class="state ${run ? 'run' : 'wait'}">${run ? '下载中' : '排队中'}</span>${esc(name)}</div>
      <div class="btns"><button class="small ghost" data-cancel="${j.id}">${run ? '取消' : '移除'}</button></div>
      ${run ? `<div class="bar"><span style="width:${percent.toFixed(1)}%"></span></div>` : ''}
      <div class="sub">${sub}</div>
    </li>`;
  }).join('');
  $('#queue-empty').hidden = jobs.length > 0;
  $('#queue-count').textContent = jobs.length ? `${jobs.length} 项，一次下载一个` : '';
}
function renderDone() {
  const list = state.history || [];
  $('#done').innerHTML = list.map(d => `<li class="item">
    <div class="name"><span class="state ${d.ok ? (d.partial ? 'wait' : 'ok') : 'fail'}">${d.ok ? (d.partial ? '部分完成' : '完成') : '失败'}</span>${esc(d.title)}</div>
    <div class="btns">${d.ok ? `${d.files?.length === 1 ? `<button class="small ghost" data-file="${d.id}">打开</button>` : ''}<button class="small ghost" data-folder="${d.id}">所在文件夹</button>`
      : `${d.fix === 'login' ? '<button class="small primary" data-action="go-login">去登录</button>' : ''}${['video', 'qq', 'xmly'].includes(d.kind) ? `<button class="small ghost" data-retry="${d.id}">重试</button>` : ''}`}<button class="small ghost" data-remove="${d.id}" title="删除这条记录（不删文件）">×</button></div>
    <div class="sub">${when(d.time)} · ${esc(d.ok ? d.info : d.reason)}</div>
  </li>`).join('');
  $('#done-empty').hidden = list.length > 0;
}

/* ---------- 抓取 ---------- */
const selected = new Set(); let captureDeferred = false;
const kindName = { video: '视频', hls: '分段视频', track: '音频片段' };
const canPick = i => i.kind !== 'track' && !i.downloaded && !['wait', 'run'].includes(i.state);
function renderCapture() {
  const c = state.capture || { state: 'off', items: [] };
  const on = c.state === 'on' || c.state === 'stopping';
  $('#capture-off').hidden = on; $('#capture-running').hidden = !on;
  $('#capture-on').disabled = !$('#capture-agree').checked || c.state !== 'off';
  $('#capture-on').textContent = c.state === 'starting' ? '正在开启……' : '开启抓取';
  $('#capture-error').hidden = !c.error; $('#capture-error').textContent = c.error || '';
  $('#capture-stop').disabled = c.state === 'stopping';
  $('#capture-stop').textContent = c.state === 'stopping' ? '正在恢复网络……' : '关闭抓取并恢复网络';
  $('#capture-note').hidden = !c.note; $('#capture-note').textContent = c.note || '';
  if (!on) { selected.clear(); return; }
  // 正在改名字或序号时先不刷新表格，免得冲掉还没写完的内容
  const a = document.activeElement;
  if (a && a.closest('#cap-list') && a.type === 'text') { captureDeferred = true; return; }
  captureDeferred = false;
  const items = c.items || [];
  for (const id of [...selected]) if (!items.some(i => i.id === id && canPick(i))) selected.delete(id);
  $('#cap-list').innerHTML = items.map(i => {
    let status = i.downloaded ? '<span class="state ok">已下载</span>' : '';
    if (i.state === 'wait') status = '<span class="state wait">排队中</span>';
    if (i.state === 'run') status = `<span class="state run">下载中${c.current?.id === i.id && c.current.progress != null ? ' ' + c.current.progress.toFixed(0) + '%' : ''}</span>`;
    if (i.state === 'fail') status = `<span class="state fail">失败</span><div class="muted">${esc(i.reason)}</div>`;
    return `<tr><td><input type="checkbox" data-pick="${i.id}" ${selected.has(i.id) ? 'checked' : ''} ${canPick(i) ? '' : 'disabled'}></td>
      <td><input type="text" class="num" data-order="${i.id}" value="${i.courseOrder || i.id}" aria-label="序号"></td>
      <td><input type="text" data-name="${i.id}" value="${esc(i.title)}" placeholder="课程名还没读到，请填写" aria-label="课程名称"></td>
      <td>${kindName[i.kind] || ''}</td><td>${i.size ? bytes(i.size) : '下载后确认'}</td><td>${status}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty">还没有发现视频。现在去播放课程，播放后会出现在这里。</td></tr>';
  const pickable = items.filter(canPick);
  $('#cap-all').checked = pickable.length > 0 && pickable.every(i => selected.has(i.id));
  $('#cap-selected').textContent = items.length ? `共 ${items.length} 个，已选 ${selected.size} 个` : '';
  $('#cap-download').disabled = !selected.size;
}
$('#capture-agree').addEventListener('change', renderCapture);
$('#capture-on').addEventListener('click', () => post('capture/start'));
$('#capture-stop').addEventListener('click', async () => {
  const busy = (state.capture.items || []).some(i => ['wait', 'run'].includes(i.state));
  if (await confirmBox('关闭抓取', (busy ? '还有视频在下载，关闭会停止下载。' : '') + '关闭后会恢复原来的系统代理，并移除本机证书的信任；列表会清空。', '关闭并恢复')) post('capture/stop');
});
$('#cap-all').addEventListener('change', e => { for (const i of state.capture.items || []) if (canPick(i)) e.target.checked ? selected.add(i.id) : selected.delete(i.id); renderCapture(); });
$('#cap-list').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.pick) { t.checked ? selected.add(+t.dataset.pick) : selected.delete(+t.dataset.pick); renderCapture(); }
  if (t.dataset.order) post('capture/command', { cmd: 'order', id: +t.dataset.order, order: +t.value });
  if (t.dataset.name) post('capture/command', { cmd: 'rename', id: +t.dataset.name, title: t.value });
});
$('#cap-list').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.type === 'text') e.target.blur(); });
$('#cap-list').addEventListener('focusout', () => setTimeout(() => { if (captureDeferred) renderCapture(); }, 0));
$('#cap-download').addEventListener('click', () => { askNotifyPermission(); post('capture/command', { cmd: 'download', ids: [...selected] }); selected.clear(); renderCapture(); });
$('#cap-clear').addEventListener('click', async () => { if (await confirmBox('清空列表', '清空已发现的视频。需要的话重新播放课程，它们会再出现。', '清空')) post('capture/command', { cmd: 'clear' }); });

/* ---------- 登录管理 ---------- */
const logins = [
  { id: 'x', name: 'X（推特）', note: '下载“只给登录用户看”的帖子前登录一次。用 Google 账号登录请点“用 Google 登录”（会用普通方式打开专用 Edge，登录好后关掉那个窗口）。', google: true },
  { id: 'xmly', name: '喜马拉雅', note: '读取专辑目录需要登录；会员单集需要账号有会员。' },
  { id: 'qq', name: 'QQ 音乐', note: '用会员账号读取时需要登录，可下载更高音质。' },
  { id: 'yuanbao', name: '视频号（腾讯元宝）', note: '视频号分享链接靠腾讯元宝解析，需要登录元宝。' },
  { id: 'douyin', name: '抖音', note: '一般不用登录；遇到验证时在网页里完成即可。' },
  { id: 'bili', name: 'B 站', note: '可选；登录后能下载账号有权限的更高画质。' },
  { id: 'xiaoe', name: '小鹅通', note: '每个店铺单独登录：粘贴课程链接下载时，会在专用 Edge 里打开那个店铺，按网页提示登录即可。', none: true },
];
function renderLogins() {
  $('#login-list').innerHTML = logins.map(l => `<li class="login">
    <div class="top"><b>${esc(l.name)}</b></div>
    <span class="muted">${esc(l.note)}</span>
    <div class="btns">${l.none ? '' : `<button class="small ghost" data-login="${l.id}">打开登录页</button>`}${l.google ? '<button class="small ghost" data-google="1">用 Google 登录</button>' : ''}</div>
  </li>`).join('');
}

/* ---------- 存储 ---------- */
async function loadStorage() {
  const r = await get('storage'); if (!r.items) return;
  $('#storage').innerHTML = r.items.map(s => `<li><div><b>${esc(s.name)}</b><p class="muted">${esc(s.note)}</p></div><span class="size">${s.count !== undefined ? s.count + ' 条' : bytes(s.size)}</span><button class="small ghost" data-clean="${s.id}" ${s.busy ? 'disabled' : ''}>清理</button></li>`).join('');
}

/* ---------- 更新 ---------- */
let bannerClosedFor = '';
function renderUpdate() {
  const u = state.update || {}, v = u.version ? 'v' + u.version : '';
  let text = '', actions = '';
  if (u.state === 'available') {
    text = `发现新版本 <b>${v}</b>。`;
    actions = u.canInstall ? '<button class="link" data-action="update-download">下载并更新</button>' : `<span class="muted">${u.devCopy ? '（开发目录不自动更新）' : '（软件文件夹不能写入，请到发布页手动下载）'}</span>`;
    actions += '<button class="link" data-action="open-release">查看更新说明</button>';
  } else if (u.state === 'downloading') {
    text = `正在后台下载新版本 <b>${v}</b>：${Math.round((u.progress || 0) * 100)}%`;
  } else if (u.state === 'ready') {
    text = `新版本 <b>${v}</b> 已下载并核对好。${state.settings.autoUpdate ? '关闭软件时会自动安装。' : ''}`;
    actions = '<button class="link" data-action="update-install">立即重启并更新</button><button class="link" data-action="open-release">查看更新说明</button>';
  }
  $('#update').hidden = !text || bannerClosedFor === u.state + v;
  $('#update-text').innerHTML = text; $('#update-actions').innerHTML = actions;
  const status = { checking: '正在检查新版本……', none: '已经是最新版本。', error: '检查更新失败：' + (u.error || ''), available: `发现新版本 ${v}。`, downloading: `正在下载新版本 ${v}……`, ready: `新版本 ${v} 已准备好。` }[u.state];
  $('#update-status').textContent = status || '源码与更新：github.com/longpeng1413/mengren-downloader';
}
function showUpdateResult(r) {
  if (r.ok) toast(`已经更新到 v${r.version}`);
  else confirmBox('自动更新没有完成', `${r.message || '原因未知'}。软件还是原来的版本，可以稍后重试，或到发布页手动下载新版本。`, '知道了');
}

/* ---------- 剪贴板自动填入 ---------- */
let lastLink = '', lastClip = '';
async function checkClipboard() {
  if (!connected || !state.settings.clipboard || $('#link').value.trim()) return;
  const r = await get('clipboard');
  if (!r.link || r.link === lastClip || r.link === lastLink || $('#link').value.trim()) return;
  lastClip = r.link;
  $('#link').value = r.link; $('#clip-hint').hidden = false;
  show('download');
}
window.addEventListener('focus', () => setTimeout(checkClipboard, 150));

/* ---------- 按钮 ---------- */
$('#recognize').addEventListener('click', () => recognize());
$('#link').addEventListener('keydown', e => { if (e.key === 'Enter') recognize(); });
$('#link').addEventListener('input', () => { $('#clip-hint').hidden = true; });
$('#result').addEventListener('change', e => { if (e.target.closest('.episode')) updateEpisodeCount(); });
document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  const a = t.dataset.action;
  if (a === 'enqueue') enqueue();
  if (a === 'cancel-recognize' && current) { post('recognize/cancel', { id: current.id }); $('#result').hidden = true; current = null; }
  if (a === 'recognize-again') recognize(current?.qqMode);
  if (a === 'qq-mode' && current) { $('#link').value = current.url; recognize(current.qqMode === 'standard' ? 'best' : 'standard'); }
  if (a === 'go-login') show('logins');
  if (a === 'open-downloads') post('open-downloads');
  if (a === 'clear-history') { if (await confirmBox('清空下载记录', '只清空这里的记录，已下载的文件不会被删除。', '清空')) post('clean', { what: 'history' }); }
  if (a === 'pick-folder') { const r = await post('pick-folder'); if (r.ok) toast('保存位置已更改'); }
  if (a === 'default-folder') { await post('settings/default-folder'); toast('已恢复为系统“下载”文件夹'); }
  if (a === 'clean-all') { if (await confirmBox('一键清理', '清理中断留下的临时文件、浏览器缓存、日志和未安装的更新包。不会删除下载的文件，也不会退出登录。', '清理')) { await post('clean', { what: 'all' }); loadStorage(); toast('已清理'); } }
  if (a === 'check-update') post('update/check');
  if (a === 'update-download') post('update/download');
  if (a === 'update-install') {
    const busy = (state.jobs || []).length || state.capture.state !== 'off';
    if (busy && !await confirmBox('现在更新？', '还有下载或抓取没结束，更新会先停止它们，然后安装新版本并自动重新打开。', '停止并更新')) return;
    const r = await post('update/install');
    if (r.ok) lost('正在安装更新', '安装完成后会自动重新打开猛人下载器，这个窗口可以关掉。');
  }
  if (a === 'open-release') post('open-release');
  if (a === 'open-cli') post('open-cli');
  if (a === 'close-banner') { bannerClosedFor = (state.update?.state || '') + (state.update?.version ? 'v' + state.update.version : ''); $('#update').hidden = true; }
  if (t.dataset.sel) selectEpisodes(t.dataset.sel);
  if (t.dataset.cancel) post('job/cancel', { id: +t.dataset.cancel });
  if (t.dataset.file) post('open', { id: t.dataset.file, what: 'file' });
  if (t.dataset.folder) post('open', { id: t.dataset.folder, what: 'folder' });
  if (t.dataset.remove) post('history/remove', { id: t.dataset.remove });
  if (t.dataset.retry) {
    const r = await post('retry', { id: t.dataset.retry });
    if (r.recognizeAgain) { $('#link').value = r.recognizeAgain; show('download'); recognize(); }
    else if (r.ok) toast('已重新加入下载');
  }
  if (t.dataset.login) { const r = await post('login', { site: t.dataset.login }); if (r.ok) toast('已在下载专用 Edge 里打开登录页，登录好后回到这里就行'); }
  if (t.dataset.google) { const r = await post('login/x-google'); if (r.ok) toast('已用普通方式打开 X 登录页。登录好后关掉那个 Edge 窗口'); }
  if (t.dataset.clean) { await post('clean', { what: t.dataset.clean }); loadStorage(); toast('已清理'); }
});
// 有下载或抓取时关窗口，先让浏览器问一句（退出会停止下载、恢复网络）
window.addEventListener('beforeunload', e => {
  if (connected && ((state.jobs || []).length || (state.capture && state.capture.state !== 'off'))) { e.preventDefault(); e.returnValue = ''; }
});

$$('.page').forEach(p => p.hidden = !p.classList.contains('active'));
renderLogins();
connect();
setTimeout(checkClipboard, 800);
