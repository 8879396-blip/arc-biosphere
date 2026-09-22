// tools/commit-state.js — 把种群状态根提交上链：「还在跑，而且能证明」的引擎
// 用法：
//   node tools/commit-state.js --once --dry --registry 0x.. --state .data-bio/biosphere.json
//   ARC_PK=0x<服务器钱包私钥> node tools/commit-state.js --registry 0x.. --every 300
import fs from 'node:fs';
import { populationRoot } from '../src/life.js';
import { rpc, encodeCall, buildSend, sendRaw, waitReceipt, pkFromEnv, addressFromPriv, NETS } from './arc.js';

function arg(n, d) { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; }
const has = (n) => process.argv.includes('--' + n);
const net = arg('net', 'mainnet');
const registry = arg('registry', null);
const statePath = arg('state', '.data-bio/biosphere.json');
const url = arg('url', null);
const every = Number(arg('every', '300'));
const once = has('once');
const dry = has('dry') || !process.env.ARC_PK;
const subsidyFlag = arg('subsidy-usdc', null);
const COMMIT_SIG = 'commit(uint32,uint32,bytes32,uint64,uint64)';

async function loadState() {
  let s;
  if (url) { const r = await fetch(url); if (!r.ok) throw new Error('state url ' + r.status); s = await r.json(); }
  else { if (!fs.existsSync(statePath)) throw new Error('找不到状态文件 ' + statePath); s = JSON.parse(fs.readFileSync(statePath, 'utf8')); }
  // 持久化文件里 organisms 是数组，运行时是 Map；populationRoot() 需要 Map
  if (Array.isArray(s.organisms)) s.organisms = new Map(s.organisms.map(o => [o.id, o]));
  if (!s.meta || !s.counters) throw new Error('状态结构不对（缺 meta/counters）');
  return s;
}

function compute(bio) {
  const root = populationRoot(bio);
  const generation = Number(bio.counters.generations || 0);
  const alive = bio.organisms.size;
  const realRevenueUSDC = Number(bio.counters.externalRevenue || 0);
  const subsidyUSDC = subsidyFlag !== null ? Number(subsidyFlag) : Number(bio.counters.subsidyUSDC || 0);
  const micro = (x) => BigInt(Math.round(Number(x) * 1e6));
  const total = realRevenueUSDC + subsidyUSDC;
  const ratioBps = total > 0 ? Math.round((realRevenueUSDC / total) * 10000) : 0;
  return { root, generation, alive, realRevenueUSDC, subsidyUSDC, ratioBps, data: encodeCall(COMMIT_SIG, ['uint32', 'uint32', 'bytes32', 'uint64', 'uint64'], [generation, alive, root, micro(realRevenueUSDC), micro(subsidyUSDC)]) };
}

async function readChain() {
  if (!registry) return null;
  const cnt = BigInt(await rpc(net, 'eth_call', [{ to: registry, data: '0x' + (await import('./arc.js')).selector('commitCount()').toString('hex') }, 'latest']));
  const live = await rpc(net, 'eth_call', [{ to: registry, data: '0x' + (await import('./arc.js')).selector('isLive()').toString('hex') }, 'latest']);
  const ratio = BigInt(await rpc(net, 'eth_call', [{ to: registry, data: '0x' + (await import('./arc.js')).selector('realRevenueRatioBps()').toString('hex') }, 'latest']));
  return { commitCount: cnt.toString(), isLive: BigInt(live) === 1n, realRevenueRatioBps: ratio.toString() };
}

async function submit(c) {
  const pk = pkFromEnv();
  const tx = await buildSend({ net, pk, to: registry, data: c.data, gasLimit: 200000n });
  const hash = await sendRaw(net, tx.raw);
  const rc = await waitReceipt(net, hash);
  return { hash, status: rc.status, gasUsed: BigInt(rc.gasUsed).toString(), from: tx.from };
}

(async () => {
  if (!NETS[net]) throw new Error('unknown net');
  console.log(`== commit-state · net=${net} · registry=${registry || '(未指定，仅本地计算)'} · mode=${dry ? 'DRY' : 'LIVE'} ==`);
  const chain = await readChain().catch(e => ({ err: e.message }));
  if (chain) console.log('   链上现状:', JSON.stringify(chain));

  const tick = async () => {
    const bio = await loadState();
    const c = compute(bio);
    const line = `tick=${bio.meta.tick} gen=${c.generation} alive=${c.alive} root=${c.root.slice(0, 18)}… real=$${c.realRevenueUSDC.toFixed(4)} subsidy=$${c.subsidyUSDC.toFixed(4)} ratio=${c.ratioBps}bps`;
    if (dry) { console.log('   [dry] ' + line); console.log('         calldata ' + c.data.toString('hex').slice(0, 10) + '… (' + c.data.length + ' bytes)'); return; }
    const r = await submit(c);
    console.log(`   ✓ ${r.status === '0x1' ? 'committed' : 'REVERTED'} ${line} tx=${r.hash} gas=${r.gasUsed}`);
  };

  await tick();
  if (!once) {
    console.log(`   每 ${every}s 提交一次（Ctrl-C 停止）。按 21 gwei、~55k gas 计，单次成本 ≈ $0.0012，每天 ≈ $0.34。`);
    setInterval(() => tick().catch(e => console.log('   tick failed:', e.message)), every * 1000);
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
