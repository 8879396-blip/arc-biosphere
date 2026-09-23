// tools/cdp-shot.mjs — 真·无头浏览器截图（Chrome DevTools Protocol，零 npm 依赖）
// 为什么需要它：Chrome headless 在 Windows 上窗口宽度有 ~500px 下限，
// --window-size=390 截出来的「手机图」其实是 500px 布局被裁掉右边。
// CDP 的 Emulation.setDeviceMetricsOverride 才能拿到真实的移动视口。
// 用法：
//   node tools/cdp-shot.mjs --url http://127.0.0.1:4030/dashboard --w 390 --h 844 --dsf 2 --mobile --out ../shots/mobile.png
//   node tools/cdp-shot.mjs --url http://127.0.0.1:4030/verify --w 1440 --h 900 --out ../shots/verify.png
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function arg(n, d) { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; }
const has = (n) => process.argv.includes('--' + n);
const url = arg('url', null);
const W = Number(arg('w', '390')), H = Number(arg('h', '844'));
const DSF = Number(arg('dsf', '2'));
const mobile = has('mobile');
const out = path.resolve(arg('out', '../shots/cdp.png'));
const waitMs = Number(arg('wait', '7000'));
const fold = has('fold');   // 只截当前视口（看首屏用），默认截整页
const PORT = Number(arg('port', '9333'));
if (!url) { console.error('need --url'); process.exit(1); }

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const bin = candidates.find(p => fs.existsSync(p));
if (!bin) { console.error('no chrome/edge found'); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
const chrome = spawn(bin, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function httpJson(u, opts) { const r = await fetch(u, opts); return r.json(); }

let wsUrl = null;
for (let i = 0; i < 60; i++) {
  try { const v = await httpJson('http://127.0.0.1:' + PORT + '/json/version'); wsUrl = v.webSocketDebuggerUrl; break; }
  catch { await sleep(400); }
}
if (!wsUrl) { chrome.kill(); console.error('chrome did not expose CDP'); process.exit(1); }

const ws = new WebSocket(wsUrl);
let msgId = 0; const pending = new Map(); const events = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  else if (m.method) events.push(m);
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DSF, mobile }, sessionId);
if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true }, sessionId).catch(() => {});
await send('Page.enable', {}, sessionId);
await send('Page.navigate', { url }, sessionId);
const t0 = Date.now();
while (Date.now() - t0 < waitMs) {
  if (events.some(e => e.method === 'Page.loadEventFired')) { await sleep(2500); break; }
  await sleep(300);
}
await sleep(1500); // 让 5s 轮询与 rAF 画几帧
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !fold }, sessionId);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
const b = fs.readFileSync(out);
console.log('saved ' + out + '  ' + b.readUInt32BE(16) + 'x' + b.readUInt32BE(20) + '  dsf=' + DSF + '  mobile=' + mobile);
await send('Target.closeTarget', { targetId }).catch(() => {});
ws.close(); chrome.kill();
// Chrome 退出后 profile 目录可能仍被占用，重试几次；失败就留给系统清理
for (let i = 0; i < 5; i++) {
  try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(600); }
}
process.exit(0);
