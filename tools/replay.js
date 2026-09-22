// tools/replay.js — 从创世 + inputs.jsonl 确定性重放，重算 populationRoot，并与链上承诺比对
// 用法：
//   node tools/replay.js --to-tick 5000
//   node tools/replay.js --genesis .data-bio/genesis.json --inputs .data-bio/inputs.jsonl --to-tick 5000 --chain 0x<registry> --net mainnet
import fs from 'node:fs';
import { createBiosphere, step, creditExternalCall, populationRoot, honesty, migrateCounters } from '../src/life.js';
import { readGenesis, loadInputs } from '../src/recorder.js';
import { rpc, selector } from './arc.js';

function arg(n, d) { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; }
const has = (n) => process.argv.includes('--' + n);
const genesisFile = arg('genesis', null);
const inputsFile = arg('inputs', null);
const toTick = Number(arg('to-tick', '1000'));
const chain = arg('chain', null);
const net = arg('net', 'mainnet');
const json = has('json');

function applyInput(bio, e) {
  switch (e.kind) {
    case 'credit':
      creditExternalCall(bio, e.niche, { revenue: e.revenue || 0, calls: e.calls || 1, buyer: e.buyer || null, txHash: e.txHash || null, subsidized: !!e.subsidized });
      break;
    case 'demand': {           // 复刻 POST /api/bio/demand 的分块注入
      const chunks = Math.max(1, e.chunks || 1);
      for (let i = 0; i < chunks; i++) creditExternalCall(bio, e.niche, { revenue: (e.usd || 0) / chunks, calls: (e.units || 0) / chunks, buyer: e.buyer || null, txHash: e.txHash || null, subsidized: !!e.subsidized });
      break;
    }
    case 'serve':
      creditExternalCall(bio, e.niche, { revenue: e.usd || 0, calls: 1, buyer: e.buyer || null, txHash: e.txHash || null, subsidized: !!e.subsidized });
      break;
    case 'steer':
      if (e.set && typeof e.set === 'object') for (const [k, v] of Object.entries(e.set)) if (k in bio.econ) bio.econ[k] = v;
      break;
    case 'extinct': case 'shock': case 'note': break;   // 内部 RNG 决定，无需重放
    default: console.error('  [warn] 未知输入类型 ' + e.kind + ' @tick ' + e.atTick);
  }
}

async function readChainCommits(registry, last = 60) {
  const sel = (s) => '0x' + selector(s).toString('hex');
  const cnt = BigInt(await rpc(net, 'eth_call', [{ to: registry, data: sel('commitCount()') }, 'latest']));
  const out = [];
  const from = cnt > BigInt(last) ? cnt - BigInt(last) : 0n;
  for (let i = from; i < cnt; i++) {
    const data = sel('commitAt(uint256)') + i.toString(16).padStart(64, '0');
    const h = (await rpc(net, 'eth_call', [{ to: registry, data }, 'latest'])).slice(2);
    const w = (k) => h.slice(k * 64, k * 64 + 64);
    out.push({ index: Number(i), ts: Number(BigInt('0x' + w(0))), generation: Number(BigInt('0x' + w(1))), aliveCount: Number(BigInt('0x' + w(2))), populationRoot: '0x' + w(3), realRevenueMicro: Number(BigInt('0x' + w(4))), subsidyMicro: Number(BigInt('0x' + w(5))) });
  }
  return { commitCount: cnt.toString(), commits: out };
}

(async () => {
  const g = readGenesis(genesisFile || undefined);
  const inputs = loadInputs(inputsFile || undefined);
  if (!json) console.log(`== replay ==\n   genesis: seed=${g.seed.slice(0, 18)}… founders=${g.founders} version=${g.version}\n   inputs : ${inputs.length} 条外部输入\n   target : tick ${toTick}`);

  const bio = createBiosphere({ seed: g.seed, name: g.name, founders: g.founders, tickLabel: g.tickLabel });
  if (g.econ) Object.assign(bio.econ, g.econ);
  migrateCounters(bio);

  const byTick = new Map();
  for (const e of inputs) { if (!byTick.has(e.atTick)) byTick.set(e.atTick, []); byTick.get(e.atTick).push(e); }

  const t0 = Date.now();
  let applied = 0;
  while (bio.meta.tick < toTick) {
    const list = byTick.get(bio.meta.tick);
    if (list) { for (const e of list) { applyInput(bio, e); applied++; } }
    if (bio.organisms.size === 0) break;
    step(bio, 1);
  }
  const ms = Date.now() - t0;
  const root = populationRoot(bio);
  const h = honesty(bio);
  const result = {
    tick: bio.meta.tick, alive: bio.organisms.size, generations: bio.counters.generations,
    populationRoot: root, inputsApplied: applied, replayMs: ms,
    honesty: h,
  };

  if (chain) {
    const { commitCount, commits } = await readChainCommits(chain);
    const match = commits.find(c => c.populationRoot === root)
      || commits.find(c => c.generation === result.generations && c.aliveCount === result.alive);
    result.chain = {
      registry: chain, commitCount,
      exactRootMatch: !!commits.find(c => c.populationRoot === root),
      stateMatch: match ? { index: match.index, generation: match.generation, aliveCount: match.aliveCount, populationRoot: match.populationRoot, rootEqual: match.populationRoot === root } : null,
      checkedLast: commits.length,
    };
  }
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`\n   重放完成：tick=${result.tick} alive=${result.alive} gen=${result.generations} 用时 ${ms}ms，应用外部输入 ${applied} 条`);
    console.log(`   populationRoot = ${root}`);
    console.log(`   honesty: real=$${h.realRevenueUSDC} subsidy=$${h.subsidyUSDC} ratio=${h.realRevenueRatioBps}bps 模拟需求占比=${h.simulatedDemandShareBps}bps`);
    if (result.chain) {
      const c = result.chain;
      console.log(`   链上：commitCount=${c.commitCount}，比对最近 ${c.checkedLast} 条`);
      console.log(`   ${c.exactRootMatch ? '✓ 链上存在逐字节相同的 populationRoot' : (c.stateMatch ? (c.stateMatch.rootEqual ? '✓ root 一致' : '✗ 世代/存活数匹配但 root 不一致：' + c.stateMatch.populationRoot) : '— 链上最近提交里没有匹配项（可能 tick 不同，用 --to-tick 指定到已提交的 tick）')}`);
    }
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
