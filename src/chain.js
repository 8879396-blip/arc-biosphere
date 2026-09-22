// src/chain.js — 链上承诺读取 + 补贴判定 + 创世文件（从 life-server 拆出来，保持服务器文件精简）
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { configFromEnv } from './x402.js';
import { writeGenesis, GENESIS } from './recorder.js';
import { rpc as arcRpc, selector as arcSelector } from '../tools/arc.js';

const cfg = configFromEnv();
export const REGISTRY = process.env.PP_REGISTRY || null;
export const CHAIN_NET = process.env.PP_CHAIN_NET || 'mainnet';
export const SUBSIDY_POOL = process.env.PP_SUBSIDY_POOL || null;

// 谁的钱算「补贴」：运营方钱包，或 mock facilitator。
// mock 模式没有真钱流动，一律记为补贴，绝不冒充真实收入 ——
// 这是链上 realRevenueRatio 可信的前提。
const SUBSIDY_WALLETS = (process.env.PP_SUBSIDY_WALLETS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
export function isSubsidy(payer) {
  if (cfg.facilitatorMode === 'mock') return true;
  return !!(payer && SUBSIDY_WALLETS.includes(String(payer).toLowerCase()));
}

/** 创世文件：确定性重放的起点。已存在则绝不覆盖。 */
export function initGenesis(bio) {
  if (existsSync(GENESIS)) return { written: false, path: GENESIS };
  const fresh = bio.meta.tick === 0;
  const extra = fresh
    ? { note: 'written at genesis; replay needs this exact seed + founders + econ' }
    : { note: 'world was already running when the recorder was added; founders inferred from the earliest history row',
        foundersInferred: bio.history.length ? bio.history[0].population : null };
  const g = writeGenesis(bio, extra);
  if (!fresh && extra.foundersInferred != null) { g.founders = extra.foundersInferred; }
  return { written: true, path: GENESIS, founders: g.founders, fresh };
}

let _cache = { at: 0, data: null };
/** 读 BiosphereRegistry 的公开状态（20 秒缓存，避免打爆 RPC） */
export async function chainSnapshot() {
  if (!REGISTRY) return { configured: false, hint: 'set PP_REGISTRY=0x<registry> to enable on-chain proof' };
  if (Date.now() - _cache.at < 20000 && _cache.data) return _cache.data;
  const sel = (x) => '0x' + arcSelector(x).toString('hex');
  const call = async (d) => { try { return await arcRpc(CHAIN_NET, 'eth_call', [{ to: REGISTRY, data: d }, 'latest']); } catch { return null; } };
  const [cnt, live, ratio, head, gap, latestHex] = await Promise.all([
    call(sel('commitCount()')), call(sel('isLive()')), call(sel('realRevenueRatioBps()')),
    call(sel('head()')), call(sel('secondsSinceLastCommit()')), call(sel('latest()')),
  ]);
  let latest = null;
  if (latestHex && latestHex.length >= 2 + 64 * 6) {
    const h = latestHex.slice(2), w = (k) => h.slice(k * 64, k * 64 + 64);
    latest = {
      ts: Number(BigInt('0x' + w(0))), generation: Number(BigInt('0x' + w(1))),
      aliveCount: Number(BigInt('0x' + w(2))), populationRoot: '0x' + w(3),
      realRevenueMicro: Number(BigInt('0x' + w(4))), subsidyMicro: Number(BigInt('0x' + w(5))),
    };
  }
  _cache = { at: Date.now(), data: {
    configured: true, net: CHAIN_NET, registry: REGISTRY,
    commitCount: cnt ? BigInt(cnt).toString() : null,
    isLive: live ? BigInt(live) === 1n : null,
    realRevenueRatioBps: ratio ? Number(BigInt(ratio)) : null,
    head: head && head !== '0x' ? head : null,
    secondsSinceLastCommit: gap ? Number(BigInt(gap)) : null,
    latest,
    explorer: 'https://explorer.arc.io/address/' + REGISTRY,
  } };
  return _cache.data;
}
