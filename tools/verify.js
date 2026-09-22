// tools/verify.js — 生成「可验证性对比」证据（/verify 页面的数据源）
// 用法：node tools/verify.js --net mainnet --registry 0x.. [--html ../outputs/verify.html]
import fs from 'node:fs';
import { rpc, selector, NETS } from './arc.js';

function arg(n, d) { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; }
const net = arg('net', 'mainnet');
const registry = arg('registry', null);
const htmlOut = arg('html', null);
const PORTAL = '0xb021be536808f551b31789422fd28a6c9c6e97da';
const RIVALS = [
  { name: 'MURMUR（24 只果蝇经济体）', addr: '0x8faae5592b9acc27a79fca745c6b872adf514a5d' },
  { name: 'oBrain（全脑封进合约）', addr: '0x28f986a61e078795639f239675582a12b4cf7f01' },
];
const call = async (to, sig) => { try { return await rpc(net, 'eth_call', [{ to, data: '0x' + selector(sig).toString('hex') }, 'latest']); } catch (e) { return null; } };
const decStr = (hex) => { if (!hex || hex === '0x') return ''; try { const h = hex.slice(2); const off = parseInt(h.slice(64, 128), 16) * 2; const len = parseInt(h.slice(off, off + 64), 16); return Buffer.from(h.slice(off + 64, off + 64 + len * 2), 'hex').toString('utf8'); } catch (e) { return ''; } };

(async () => {
  const rows = [];
  for (const r of RIVALS) {
    const code = await rpc(net, 'eth_getCode', [r.addr, 'latest']);
    rows.push({ 项目: r.name, 地址: r.addr, 合约字节: (code.length - 2) / 2, 链上website: '(发射事件里为空)', 链上twitter: '(空)', 状态根承诺: '无', 确定性重放: '无' });
  }
  let ours = { 项目: 'Arc Biosphere（本项目）', 地址: registry || '(未部署)', 合约字节: 0, 链上website: '发射时填写', 链上twitter: '发射时填写', 状态根承诺: '—', 确定性重放: '—' };
  if (registry) {
    const cnt = await call(registry, 'commitCount()');
    const live = await call(registry, 'isLive()');
    const ratio = await call(registry, 'realRevenueRatioBps()');
    const code = await rpc(net, 'eth_getCode', [registry, 'latest']);
    ours = { ...ours, 合约字节: (code.length - 2) / 2, 状态根承诺: `commitCount=${BigInt(cnt || '0x0')} · isLive=${BigInt(live || '0x0') === 1n}`, 确定性重放: `realRevenueRatio=${(BigInt(ratio || '0x0') / 100n).toString()}%` };
  }
  const all = [...rows, ours];
  const cols = Object.keys(all[0]);
  const w = cols.map(c => Math.max(c.length * 2, ...all.map(r => String(r[c]).length)) + 2);
  console.log('\n== 可验证性对比（全部来自 ' + net + ' 链上实时读取，' + new Date().toISOString() + '）==\n');
  console.log(cols.map((c, i) => c.padEnd(w[i])).join(''));
  console.log(cols.map((c, i) => '─'.repeat(w[i])).join(''));
  for (const r of all) console.log(cols.map((c, i) => String(r[c]).padEnd(w[i])).join(''));
  console.log('\nArgus 发射门户（可复核竞品发射参数）：' + PORTAL);

  if (htmlOut) {
    const esc = s => String(s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    const html = `<!doctype html><meta charset=utf8><title>Verify · Arc Biosphere</title>
<style>body{background:#0b0f0c;color:#dfe7e0;font:14px/1.6 ui-monospace,Menlo,Consolas,monospace;padding:32px}
h1{font-size:20px}table{border-collapse:collapse;margin-top:16px}td,th{border:1px solid #24301f;padding:8px 12px;text-align:left}
th{background:#131a14}.ours{background:#12261a}small{color:#7d8b7d}</style>
<h1>可验证性对比 <small>· 链上实时读取 · ${new Date().toISOString()}</small></h1>
<table><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>
${all.map(r => `<tr class="${r === ours ? 'ours' : ''}">${cols.map(c => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</table>
<p><small>数据来源：Arc 主网 RPC <code>https://rpc.mainnet.arc.io</code>；竞品发射参数可用 Argus 门户 <code>${PORTAL}</code> 的 TokenCreated / FeeConfigured 事件独立复核。</small></p>`;
    fs.writeFileSync(htmlOut, html);
    console.log('\n已写出 ' + htmlOut);
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
