// src/recorder.js — 外部输入日志：确定性重放的唯一前提
// 引擎内部全部由 (seed, tick) 决定，是确定性的；唯一的外部性来自 x402 客户与人工干预。
// 把这些输入按 tick 顺序追加到 inputs.jsonl，任何人（包括你自己）都能重放出同一个 populationRoot。
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DIR = path.resolve(process.env.PP_DATA_DIR || '.data-bio');
export const INPUTS = path.join(DIR, 'inputs.jsonl');
export const GENESIS = path.join(DIR, 'genesis.json');

export function ensureDir() { mkdirSync(DIR, { recursive: true }); }

/** 创世参数。重放必须从这里开始，否则 root 不可能对上。 */
export function writeGenesis(bio, extra = {}) {
  ensureDir();
  const g = {
    kind: 'genesis',
    version: bio.meta.version,
    seed: bio.meta.seed,
    name: bio.meta.name,
    tickLabel: bio.meta.tickLabel,
    createdAt: bio.meta.createdAt,
    founders: bio.counters.born,          // 创世时 born == founders
    econ: bio.econ,
    niches: bio.niches.map((n) => ({ id: n.id, key: n.key, baseDemand: n.baseDemand, costFactor: n.costFactor, elasticity: n.elasticity })),
    ...extra,
  };
  writeFileSync(GENESIS, JSON.stringify(g, null, 2));
  return g;
}

export function readGenesis(file = GENESIS) {
  if (!existsSync(file)) throw new Error('缺少创世文件 ' + file);
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** 记录一次外部输入。atTick = 记录时的 bio.meta.tick（即「下一个 tick 会消费它」）。 */
export function record(bio, entry) {
  try {
    ensureDir();
    appendFileSync(INPUTS, JSON.stringify({ atTick: bio.meta.tick, ts: Date.now(), ...entry }) + '\n');
  } catch (e) { console.error('[recorder] ' + e.message); }
}

export function loadInputs(file = INPUTS) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim(); if (!t) continue;
    try { const o = JSON.parse(t); if (typeof o.atTick === 'number') out.push(o); } catch { /* skip */ }
  }
  return out.sort((a, b) => a.atTick - b.atTick || a.ts - b.ts);
}

export function rotate(maxBytes = 8 * 1024 * 1024) {
  try {
    if (!existsSync(INPUTS)) return null;
    const st = readFileSync(INPUTS);
    if (st.length < maxBytes) return null;
    const stamped = INPUTS.replace('.jsonl', '-' + Date.now() + '.jsonl');
    writeFileSync(stamped, st); writeFileSync(INPUTS, '');
    return stamped;
  } catch { return null; }
}
