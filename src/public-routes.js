// src/public-routes.js — 免费公开端点：看板数据 / 可验证性对比页 / 前端页面
import path from 'node:path';
import { promises as fsp, existsSync } from 'node:fs';
import { rpc as arcRpc, selector as arcSelector } from '../tools/arc.js';
import { loadInputs, GENESIS, INPUTS } from './recorder.js';
import { ogHtml } from './og.js';

// 同赛道项目（推文 @something_labs 2026-09-22 盘点）。这里只放**可链上核查**的事实。
const RIVALS = [
  { name: 'MURMUR', claim: '24 只独立果蝇形成的独立经济体 + x402', addr: '0x8faae5592b9acc27a79fca745c6b872adf514a5d', chain: 'Arc' },
  { name: 'oBrain', claim: '雌性 BANC v888 全脑封进合约（约 16.9 万神经元）', addr: '0x28f986a61e078795639f239675582a12b4cf7f01', chain: 'Arc' },
];
const USDC_ARC_ADDR = '0x3600000000000000000000000000000000000000';
const escAttr = (x) => String(x == null ? '' : x).replace(/["&<>]/g, (m) => ({ '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));

async function probe(addr) {
  const call = async (to, data) => { try { return await arcRpc('mainnet', 'eth_call', [{ to, data }, 'latest']); } catch { return null; } };
  const code = await arcRpc('mainnet', 'eth_getCode', [addr, 'latest']).catch(() => '0x');
  const balHex = await call(USDC_ARC_ADDR, '0x' + arcSelector('balanceOf(address)').toString('hex') + addr.slice(2).padStart(64, '0'));
  return { bytes: code ? (code.length - 2) / 2 : 0, usdc: balHex ? Number(BigInt(balHex)) / 1e6 : null };
}

/** 生态位表：活体 bio.niches（demand / priceIndex / shock）+ snapshot 的统计均值。
 *  注意 snapshot() 返回的字段名是 niches（不是 byNiche）。 */
function nicheRows(bio, snap) {
  const stats = (snap && snap.niches) || {};
  const out = {};
  for (const n of bio.niches) {
    const s = stats[n.key] || {};
    out[n.key] = {
      population: s.population ?? 0,
      demand: +n.demand.toFixed(1),
      priceIndex: +n.priceIndex.toFixed(6),
      shock: +n.shock.toFixed(2),
      shockLeft: n.shockLeft || 0,
      revenue: +n.revenue.toFixed(4),
      meanQuality: s.meanQuality ?? 0,
      meanSpeed: s.meanSpeed ?? 0,
      meanMutRate: s.meanMutRate ?? 0,
    };
  }
  return out;
}

/** Map 的迭代顺序 = 插入顺序，直接 slice(0,N) 永远只返回最老的 N 个个体。
 *  均匀采样才能反映真实种群结构（新生个体也要出现在看板上）。 */
function sampleOrganisms(bio, max) {
  const all = [...bio.organisms.values()];
  if (all.length <= max) return all;
  const stepf = all.length / max, out = [];
  for (let i = 0; i < max; i++) out.push(all[Math.floor(i * stepf)]);
  return out;
}

export function publicRoutes({ bio, L, cfg, ok, chainSnapshot, REGISTRY, SUBSIDY_POOL }) {
  const dashboardData = async () => {
    const h = L.honesty(bio);
    const snap = L.snapshot(bio);
    const inputs = existsSync(INPUTS) ? loadInputs(INPUTS).length : 0;
    return {
      name: bio.meta.name, version: L.VERSION, seed: bio.meta.seed,
      tick: bio.meta.tick, tickLabel: bio.meta.tickLabel,
      alive: bio.organisms.size, generations: bio.counters.generations,
      born: bio.counters.born, died: bio.counters.died,
      speciations: bio.counters.speciations, extinctions: bio.counters.extinctions,
      populationRoot: L.populationRoot(bio),
      honesty: h, treasury: bio.treasury,
      niches: nicheRows(bio, snap),
      history: bio.history.slice(-360).map(r => ({ tick: r.tick, population: r.population, meanEnergy: r.meanEnergy, meanMutRate: r.meanMutRate, revenue: r.revenue, births: r.births, deaths: r.deaths })),
      organisms: sampleOrganisms(bio, 400).map(o => ({
        id: o.id, niche: o.genome.niche, e: +o.energy.toFixed(5), g: o.generation,
        q: o.genome.quality, age: o.age,
        p: o.parent || null, lin: (o.lineage || '').split('>')[0] || o.id.slice(0, 6),
      })),
      organismsTotal: bio.organisms.size,
      chain: await chainSnapshot(),
      recorder: { genesis: existsSync(GENESIS), inputsLogged: inputs, inputsFile: 'inputs.jsonl',
                  replay: 'node tools/replay.js --to-tick ' + bio.meta.tick + (REGISTRY ? ' --chain ' + REGISTRY : '') },
      contracts: { registry: REGISTRY, subsidyPool: SUBSIDY_POOL, usdc: USDC_ARC_ADDR },
      network: { caip2: cfg.net.caip2, facilitator: cfg.facilitatorMode, seller: cfg.sellerAddress },
      endpoints: { meta: '/api/bio/meta', prices: '/api/bio/prices', spec: '/api/bio/spec', verify: '/verify', llms: '/llms-full.txt', openapi: '/openapi.yaml', aiJson: '/.well-known/ai.json' },
    };
  };

  const verifyHtml = async () => {
    const d = await dashboardData();
    const rivals = [];
    for (const r of RIVALS) { const p = await probe(r.addr); rivals.push({ ...r, ...p }); }
    const c = d.chain || {};
    const rootMatch = c.latest && c.latest.populationRoot === d.populationRoot;
    const esc = (x) => String(x ?? '—').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    const row = (cells, cls = '') => '<tr class="' + cls + '">' + cells.map(x => '<td>' + x + '</td>').join('') + '</tr>';
    return `<!doctype html><html lang=zh><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Verify · ${esc(d.name)}</title><style>
body{background:#0a0e0b;color:#dfe7e0;font:14px/1.65 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;margin:0;padding:28px}
h1{font-size:19px;margin:0 0 4px}h2{font-size:14px;color:#9fd7a8;margin:26px 0 8px;text-transform:uppercase;letter-spacing:.08em}
small,.muted{color:#7d8b7d}table{border-collapse:collapse;width:100%;margin-top:6px}td,th{border:1px solid #22301f;padding:7px 10px;text-align:left;vertical-align:top}
th{background:#111a13;color:#9fd7a8;font-weight:600}.ours{background:#12261a}.ok{color:#7ee08a}.bad{color:#ff8f8f}.warn{color:#ffd479}
code{background:#111a13;padding:1px 5px;border-radius:3px}a{color:#8be9fd}.card{border:1px solid #22301f;background:#0d130f;padding:12px 14px;border-radius:6px;margin-top:8px}
.pill{display:inline-block;padding:1px 8px;border:1px solid #2b3d2c;border-radius:99px;font-size:12px}</style>
<h1>${esc(d.name)} · 可验证性对比</h1>
<div class=muted>链上实时读取 · Arc mainnet · ${new Date().toISOString()} · 数据源 <code>rpc.mainnet.arc.io</code></div>

<h2>1 · 我们的链上承诺</h2>
<div class=card>
<div>Registry: <code>${esc(c.registry || '未配置（设 PP_REGISTRY）')}</code> ${c.explorer ? '· <a href="' + esc(c.explorer) + '">explorer</a>' : ''}</div>
<div>commitCount = <b>${esc(c.commitCount)}</b> · isLive = <b class="${c.isLive ? 'ok' : 'bad'}">${esc(c.isLive)}</b> · 距上次提交 ${esc(c.secondsSinceLastCommit)}s</div>
<div>链上 realRevenueRatio = <b>${c.realRevenueRatioBps == null ? '—' : (c.realRevenueRatioBps / 100).toFixed(2) + '%'}</b> · 链上最新 root <code>${esc(c.latest ? c.latest.populationRoot.slice(0, 26) + '…' : '—')}</code></div>
<div>服务器当前 root <code>${esc(d.populationRoot.slice(0, 26))}…</code> →
  ${c.latest ? (rootMatch ? '<b class=ok>一致 ✓</b>' : '<span class=warn>不同 tick（链上是上一次提交的快照）</span>') : '<span class=warn>尚无提交</span>'}</div>
<div>本地实况：tick ${esc(d.tick)} · 存活 ${esc(d.alive)} · 世代 ${esc(d.generations)} · 已记录外部输入 ${esc(d.recorder.inputsLogged)} 条</div>
</div>

<h2>2 · 诚实账本（不粉饰）</h2>
<div class=card>
<div>真实第三方 x402 收入：<b class=ok>$${esc(d.honesty.realRevenueUSDC)}</b> · 运营方补贴：<b class=warn>$${esc(d.honesty.subsidyUSDC)}</b> · realRevenueRatio = <b>${esc((d.honesty.realRevenueRatioBps / 100).toFixed(2))}%</b></div>
<div>模拟基线需求占已服务需求：<b class=${d.honesty.simulatedDemandShareBps > 5000 ? 'bad' : 'ok'}>${esc((d.honesty.simulatedDemandShareBps / 100).toFixed(2))}%</b></div>
<div class=muted>补贴池退坡：每日可领上限 = baseCap × (1 − ratio)²，ratio=100% 时自动归零；领取必须附带链上最新 populationRoot，过期即 revert。</div>
</div>

<h2>3 · 同赛道对比</h2>
<table><tr><th>项目</th><th>宣称</th><th>合约字节</th><th>合约内 USDC</th><th>状态根承诺</th><th>确定性重放</th><th>链上社交登记</th></tr>
${rivals.map(r => row([esc(r.name), esc(r.claim), esc(r.bytes), r.usdc == null ? '—' : '$' + r.usdc.toFixed(2), '<span class=bad>无</span>', '<span class=bad>无</span>', '<span class=bad>website/twitter/telegram 三项为空</span>'])).join('')}
${row(['<b>' + esc(d.name) + '</b>', '自主进化/繁衍/运营的生命经济体，fitness = solvency', '—', '—', '<span class=ok>有 · commitCount=' + esc(c.commitCount) + ' · isLive=' + esc(c.isLive) + '</span>', '<span class=ok>genesis + inputs.jsonl 可重放</span>', '<span class=ok>发射时三项全填</span>'], 'ours')}
</table>
<div class=muted>竞品事实的复核方式：Argus 发射门户 <code>0xb021be536808f551b31789422fd28a6c9c6e97da</code> 的
<code>TokenCreated</code> / <code>FeeConfigured</code> 事件（topic0 <code>0x1d891723…</code> / <code>0xabe14607…</code>）。</div>

<h2>4 · 自己验</h2>
<div class=card><code>${esc(d.recorder.replay)}</code><div class=muted>重放出的 populationRoot 与链上承诺逐字节相同 = 运营方没有偷偷改种群。</div></div>
</body></html>`;
  };

  return {
    'GET /api/bio/public': async () => ok(await dashboardData()),
    'GET /verify': async () => ({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body: await verifyHtml() }),
    'GET /og.html': async () => ({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body: ogHtml(await dashboardData()) }),
    'GET /dashboard': async () => {
      try {
        const file = path.resolve(process.env.PP_WEB_DIR || 'web', 'index.html');
        let html = await fsp.readFile(file, 'utf8');
        const d = await dashboardData();
        const pub = String(process.env.PP_PUBLIC_URL || '').replace(/\/$/, '');
        const hh = d.honesty || {};
        const desc = 'Autonomous artificial-life economy on Arc. tick ' + d.tick + ' / ' + d.alive + ' alive / gen ' + d.generations +
          ' / real x402 revenue ' + (hh.realRevenueUSDC || 0) + ' USDC / operator subsidy ' + (hh.subsidyUSDC || 0) +
          ' USDC / simulated demand share ' + (((hh.simulatedDemandShareBps || 0) / 100).toFixed(1)) + '%. Population root on-chain; deterministic replay.';
        html = html.split('__OG_URL__').join(pub ? pub + '/dashboard' : '')
          .split('__OG_IMAGE__').join(pub ? pub + '/og.png' : '')
          .split('__OG_DESC__').join(escAttr(desc));
        return { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body: html };
      } catch (e) { return { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'dashboard missing: ' + e.message }; }
    },
  };
}
