// ============================================================================
//  Real services the organisms sell. An organism's genome decides WHO serves a
//  call and at WHAT PRICE; the work itself is genuinely performed here.
//  This is what makes the economy real instead of a number going up.
// ============================================================================
import { keccak256, hashConcat, toHex } from './keccak.js';
import { createWorld, registerStrain, tick as tickPandemic, summary as pandemicSummary } from './sim.js';

/** keccak — batch hashing. Cost scales with count. */
export function svcKeccak({ count = 64, seed = 'biosphere' } = {}) {
  const n = Math.max(1, Math.min(4096, count | 0));
  const out = [];
  for (let i = 0; i < n; i++) out.push(toHex(keccak256(new TextEncoder().encode(seed + ':' + i))));
  return { service: 'keccak', count: n, seed, first: out[0], last: out[out.length - 1], workMs: undefined, digests: out.slice(0, 16) };
}

/** entropy — verifiable randomness with a disclosed commitment. */
export function svcEntropy({ seed = null, count = 8, tag = 'draw' } = {}) {
  const s = seed || toHex(keccak256(new TextEncoder().encode('BIO_ENTROPY' + Date.now() + Math.random())));
  const commit = toHex(hashConcat('BIO_COMMIT_V1', s, tag));
  const n = Math.max(1, Math.min(256, count | 0));
  const values = [];
  for (let i = 0; i < n; i++) {
    const h = keccak256(Buffer.concat([Buffer.from(commit.slice(2), 'hex'), Buffer.from(String(i))]));
    values.push(Number(Buffer.from(h).readBigUInt64BE(0) >> 12n) / 2 ** 52);
  }
  return { service: 'entropy', seed: s, tag, commitment: commit, count: n, values, verify: 'keccak256("BIO_COMMIT_V1" || seed || tag) then keccak256(commitment || index) -> uint64 >> 12 / 2^52' };
}

/** render — deterministic SVG from a seed. */
export function svcRender({ seed = 'biosphere', cells = 64, palette = 'life' } = {}) {
  const n = Math.max(4, Math.min(4096, cells | 0));
  const base = keccak256(new TextEncoder().encode('BIO_RENDER' + seed));
  const cols = Math.ceil(Math.sqrt(n)), size = 14, W = cols * size;
  const pals = {
    life: ['#0b0e14', '#1b4332', '#2d6a4f', '#40916c', '#74c69d', '#b7e4c7'],
    heat: ['#0b0e14', '#7a6a1f', '#a8541c', '#c62828', '#ef5350', '#ffcdd2'],
    cold: ['#0b0e14', '#123a5e', '#1f6feb', '#58a6ff', '#8be9fd', '#d0f4ff'],
  };
  const p = pals[palette] || pals.life;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}"><rect width="${W}" height="${W}" fill="${p[0]}"/>`];
  for (let i = 0; i < n; i++) {
    const h = keccak256(Buffer.concat([base, Buffer.from(String(i))]));
    const x = (i % cols) * size, y = Math.floor(i / cols) * size;
    const fill = p[h[0] % p.length];
    const r = 1 + (h[1] % 6);
    parts.push(h[2] % 3 === 0
      ? `<circle cx="${x + size / 2}" cy="${y + size / 2}" r="${r}" fill="${fill}"/>`
      : `<rect x="${x + (size - r * 2) / 2}" y="${y + (size - r * 2) / 2}" width="${r * 2}" height="${r * 2}" fill="${fill}"/>`);
  }
  parts.push('</svg>');
  return { service: 'render', seed, cells: n, palette, svg: parts.join(''), bytes: parts.join('').length };
}

/** pandemic — a real run of the SEIR engine (reuses src/sim.js). */
export function svcPandemic({ days = 200, seed = null, strategy = 'stealth' } = {}) {
  const PRESETS = {
    stealth: { transmission: { air1: 1, water1: 1, insect1: 1 }, abilities: { coldResist1: 1, heatResist1: 1 } },
    lethal: { transmission: { air1: 1 }, symptoms: { coughing: 1, pneumonia: 1, haemorrhage: 1 }, abilities: { coldResist1: 1 } },
    resistant: { transmission: { air1: 1, air2: 1 }, abilities: { coldResist1: 1, heatResist1: 1, drugResist1: 1, hardening1: 1 } },
  };
  const w = createWorld({ name: 'organism-served run', seed });
  registerStrain(w, { owner: '0xBIOSPHERE', name: 'SERVED', genome: PRESETS[strategy] || PRESETS.stealth, countryId: 0 });
  tickPandemic(w, Math.max(1, Math.min(800, days | 0)));
  const s = pandemicSummary(w);
  return { service: 'pandemic', strategy, days: s.day, outcome: s.outcome, dead: s.population.dead, infected: s.population.recovered, cure: s.strains[0]?.cure, worldRoot: s.worldRoot };
}

/** optimize — a real genetic algorithm on a bounded problem. */
export function svcOptimize({ problem = 'peak', dims = 6, generations = 120, popSize = 40, seed = 'bio' } = {}) {
  const D = Math.max(1, Math.min(32, dims | 0)), G = Math.max(1, Math.min(600, generations | 0)), P = Math.max(4, Math.min(200, popSize | 0));
  // Counter-mode keccak PRNG. /256 (not /255) so rnd() can never return 1.0.
  let state = keccak256(new TextEncoder().encode('BIO_OPT' + seed));
  let pos = 32, ctr = 0n;
  const rnd = () => {
    if (pos >= 32) {
      const cb = Buffer.alloc(8); cb.writeBigUInt64BE(ctr++);
      state = keccak256(Buffer.concat([Buffer.from(state), cb]));
      pos = 0;
    }
    return state[pos++] / 256;
  };
  const fitness = problem === 'peak'
    ? (v) => v.reduce((a, x) => a + Math.exp(-((x - 0.5) ** 2) * 18), 0) / D
    : (v) => 1 / (1 + v.reduce((a, x) => a + (x - 0.5) ** 2, 0));
  let pop = Array.from({ length: P }, () => Array.from({ length: D }, () => rnd()));
  let best = { v: pop[0], f: fitness(pop[0]) };
  for (let g = 0; g < G; g++) {
    const scored = pop.map((v) => ({ v, f: fitness(v) })).sort((a, b) => b.f - a.f);
    if (scored[0].f > best.f) best = scored[0];
    const next = scored.slice(0, Math.max(2, P * 0.2 | 0)).map((x) => x.v);
    while (next.length < P) {
      const a = next[rnd() * next.length | 0], b = next[rnd() * next.length | 0];
      const cut = 1 + (rnd() * (D - 1) | 0);
      const child = [...a.slice(0, cut), ...b.slice(cut)].map((x) => rnd() < 0.08 ? Math.max(0, Math.min(1, x + (rnd() - 0.5) * 0.25)) : x);
      next.push(child);
    }
    pop = next;
  }
  return { service: 'optimize', problem, dims: D, generations: G, popSize: P, bestFitness: +best.f.toFixed(6), bestVector: best.v.map((x) => +x.toFixed(4)) };
}

export const SERVICE_IMPLS = { keccak: svcKeccak, entropy: svcEntropy, render: svcRender, pandemic: svcPandemic, optimize: svcOptimize };
