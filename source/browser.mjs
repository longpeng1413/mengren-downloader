import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export class Cdp {
  constructor(socket) {
    this.socket = socket; this.serial = 0; this.pending = new Map(); this.listeners = new Map();
    socket.addEventListener('message', event => {
      let data; try { data = JSON.parse(event.data); } catch { return; }
      if (data.method) {
        for (const listener of this.listeners.get(data.method) || []) { try { listener(data.params || {}, data.sessionId); } catch { } }
        return;
      }
      const call = this.pending.get(data.id); if (!call) return;
      this.pending.delete(data.id); clearTimeout(call.timer);
      data.error ? call.reject(new Error('浏览器读取失败')) : call.resolve(data.result);
    });
    socket.addEventListener('close', () => this.fail());
    socket.addEventListener('error', () => this.fail());
  }
  fail() { for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(new Error('浏览器连接已断开')); } this.pending.clear(); }
  static async connect(url) {
    const address = new URL(url);
    if (address.protocol !== 'ws:' || address.hostname !== '127.0.0.1') throw new Error('浏览器连接不是本机地址');
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('浏览器连接超时')); }, 15000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once:true});
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('无法连接浏览器')); }, {once:true});
    });
    return new Cdp(socket);
  }
  call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      // Keep the step name on the error so a stalled step can be diagnosed.
      const timer = setTimeout(() => { this.pending.delete(id); reject(Object.assign(new Error('网页响应超时'), {method})); }, 35000);
      this.pending.set(id, {resolve,reject,timer});
      this.socket.send(JSON.stringify({id,method,params,...(sessionId ? {sessionId} : {})}));
    });
  }
  // Browser events such as Network.responseReceived; returns a function that stops listening.
  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(listener);
    return () => this.listeners.get(method)?.delete(listener);
  }
  async attach(targetId) { return (await this.call('Target.attachToTarget', {targetId,flatten:true})).sessionId; }
  async evaluate(sessionId, expression) {
    const answer = await this.call('Runtime.evaluate', {expression,awaitPromise:true,returnByValue:true}, sessionId);
    if (answer.exceptionDetails) throw new Error('网页读取暂时失败');
    return answer.result?.value;
  }
  async page(url) {
    const {targetId} = await this.call('Target.createTarget', {url});
    return {targetId, sessionId:await this.attach(targetId)};
  }
  async navigate(page,url) { await this.call('Page.navigate',{url},page.sessionId); }
  // Close tabs this download opened. The last remaining tab is blanked instead,
  // so the dedicated Edge window (and its login session) stays open for reuse.
  async closePages(targetIds) {
    for (const targetId of targetIds) {
      try {
        const {targetInfos} = await this.call('Target.getTargets');
        const pages = targetInfos.filter(t => t.type === 'page');
        if (!pages.some(t => t.targetId === targetId)) continue;
        if (pages.length > 1) await this.call('Target.closeTarget', {targetId});
        else await this.call('Page.navigate', {url:'about:blank'}, await this.attach(targetId));
      } catch { }
    }
  }
  close() { this.socket.close(); }
}
const profileDir = () => join(process.env.LOCALAPPDATA,'MengrenDownloader','BrowserProfile');
// Connects only to our own dedicated Edge (its DevToolsActivePort file); never starts one.
async function existing() {
  try {
    const [port, endpoint] = readFileSync(join(profileDir(),'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);
    if (!/^\d+$/.test(port) || +port < 1 || +port > 65535 || !endpoint?.startsWith('/devtools/browser/')) return null;
    const response = await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(1500)});
    const version = await response.json();
    if (version.webSocketDebuggerUrl !== `ws://127.0.0.1:${port}${endpoint}`) return null;
    return await Cdp.connect(version.webSocketDebuggerUrl);
  } catch { return null; }
}
// Closes the dedicated Edge we control (logins stay in its profile). Used before
// opening it normally for sites such as Google that refuse controlled browsers.
export async function closeDedicatedBrowser() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return false;
  const browser = await existing(); if (!browser) return false;
  try { await browser.call('Browser.close'); } catch { }
  browser.close(); return true;
}
export async function ensureBrowser() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw new Error('浏览器读取需要 Windows 和 Edge');
  const profile = profileDir();
  mkdirSync(profile,{recursive:true});
  const active = await existing(); if (active) return active;
  const executable = [process.env['ProgramFiles(x86)'],process.env.ProgramFiles,process.env.LOCALAPPDATA]
    .filter(Boolean).map(base => join(base,'Microsoft','Edge','Application','msedge.exe')).find(existsSync);
  if (!executable) throw new Error('未找到 Microsoft Edge，请先安装 Edge');
  const child = spawn(executable,[`--user-data-dir=${profile}`,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--new-window','about:blank'],{detached:true,stdio:'ignore',windowsHide:false});
  child.on('error',()=>{}); child.unref();
  for (let n=0;n<30;n++) { await sleep(500); const ready = await existing(); if (ready) return ready; }
  throw new Error('下载专用 Edge 窗口未能启动；请关闭该专用窗口后重试，不需要关闭日常 Edge');
}
export {sleep};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--close')) {
  console.log((await closeDedicatedBrowser()) ? '已关闭被下载器控制的专用 Edge。' : '被下载器控制的专用 Edge 没有在运行。');
}
