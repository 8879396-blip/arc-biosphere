// ============================================================================
//  BIOSPHERE SERVER — an autonomous, self-funding artificial-life economy
//  exposed as an x402 paywalled API on Arc.
//
//  The organisms are not decorations: they are the pricing and allocation layer
//  over REAL services (src/services.js). When you buy a service the revenue is
//  credited to whichever organism wins that call, so your spending steers
//  evolution. PP_AUTOTICK_MS makes the biosphere advance on its own.
//
//  node src/life-server.js
// ============================================================================
import http from 'node:http';
import { promises as fs } from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { configFromEnv, paid, json, PRICES, USDC_ARC, usdToAtomic } from './x402.js';
import * as L from './life.js';
import { SERVICE_IMPLS } from './services.js';
import { toHex, hashConcat } from './keccak.js';
import { record } from './recorder.js';
import { REGISTRY, SUBSIDY_POOL, chainSnapshot, isSubsidy, initGenesis } from './chain.js';
import { publicRoutes } from './public-routes.js';

const cfg = configFromEnv();
const PORT = Number(process.env.PORT || 4030);
const FILE = path.resolve(process.env.PP_BIO_FILE || '.data-bio/biosphere.json');
const AUTOTICK_MS = Number(process.env.PP_AUTOTICK_MS || 0);
const AUTOTICK_N = Number(process.env.PP_AUTOTICK_TICKS || 1);

// ---------------------------------------------------------------- persistence
function serialize(bio) {
  return {
    meta: bio.meta, econ: bio.econ, niches: bio.niches, treasury: bio.treasury,
    counters: bio.counters, nextId: bio.nextId,
    organisms: [...bio.organisms.values()], lineages: [...bio.lineages.entries()],
    fossils: bio.fossils.slice(-3000), history: bio.history.slice(-4000), events: bio.events.slice(-3000),
  };
}
function deserialize(o) {
  return {
    meta: o.meta, econ: { ...L.ECON, ...o.econ }, niches: o.niches, treasury: o.treasury,
    counters: o.counters, nextId: o.nextId,
    organisms: new Map(o.organisms.map((x) => [x.id, x])), lineages: new Map(o.lineages),
    fossils: o.fossils, history: o.history, events: o.events,
  };
}
async function loadBio() {
  try { return deserialize(JSON.parse(await fs.readFile(FILE, 'utf8'))); }
  catch { return L.createBiosphere({ name: process.env.PP_BIO_NAME || 'Arc Biosphere', founders: Number(process.env.PP_FOUNDERS || 40) }); }
}
const bio = await loadBio();
L.migrateCounters(bio);
const genesisInfo = initGenesis(bio);
console.log('[chain] registry=' + (REGISTRY || 'none') + ' | genesis ' + (genesisInfo.written ? 'written' : 'exists') + ' | subsidy mode: ' + (isSubsidy(null) ? 'ALL external revenue counted as subsidy (mock facilitator)' : 'third-party revenue counted as real'));
let saveTimer = null;
function saveBio() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    // 原子写：先写 .tmp 再 rename，避免看板 / x-digest / 备份读到半个 JSON
    try {
      await fs.mkdir(path.dirname(FILE), { recursive: true });
      const tmp = FILE + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(serialize(bio)));
      await fs.rename(tmp, FILE);
    }
    catch (e) { console.error('[save]', e.message); }
  }, 400);
}
if (AUTOTICK_MS > 0) {
  setInterval(() => { try { L.step(bio, AUTOTICK_N); saveBio(); } catch (e) { console.error('[autotick]', e.message); } }, AUTOTICK_MS);
}

// ---------------------------------------------------------------- helpers
const ok = (b, h) => json(b, 200, h);
const bad = (m, code, s = 400) => json({ error: m, code }, s);
async function readBody(req) { try { return JSON.parse(req.bodyRaw || '{}'); } catch { return {}; } }
const nicheByKey = (k) => L.NICHES.find((n) => n.key === k || String(n.id) === String(k));
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v)));

function seedFounder(genome, owner, name) {
  const gh = L.genomeHash(genome);
  const id = toHex(hashConcat('BIO_FOUNDER_V1', bio.meta.seed, BigInt(bio.nextId++), gh, owner || '', name || '')).slice(0, 24);
  const org = {
    id, genome, genomeHash: gh, generation: 0, parent: null,
    bornTick: bio.meta.tick, age: 0, energy: bio.econ.startEnergy * 2.2,
    served: 0, earned: 0, spent: 0, offspring: 0, lineage: id.slice(2, 8), alive: true,
    founder: true, owner, name: name || null,
  };
  bio.organisms.set(id, org); bio.lineages.set(id, org.lineage); bio.counters.born += 1;
  bio.events.push({ type: 'FOUNDER_SEEDED', tick: bio.meta.tick, id, owner, name: org.name, niche: L.NICHES[genome.niche].key, genomeHash: gh, price: genome.price });
  return id;
}

function nicheChart(key) {
  const n = nicheByKey(key);
  if (!n) return null;
  const rows = bio.history.filter((h) => h.niches && h.niches[key]);
  const W = 720, H = 300, P = 46;
  const prices = rows.map((r) => r.niches[key].meanPrice || 0);
  const pops = rows.map((r) => r.niches[key].population || 0);
  const quals = rows.map((r) => r.niches[key].meanQuality || 0);
  const maxP = Math.max(1e-9, ...prices), maxPop = Math.max(1, ...pops);
  const poly = (arr, max, color, dash) => arr.length < 2 ? '' :
    `<polyline points="${arr.map((v, i) => `${(P + (i / (arr.length - 1)) * (W - P - 12)).toFixed(1)},${(H - P - (v / max) * (H - P - 24)).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.8"${dash ? ' stroke-dasharray="4 3"' : ''}/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#0b0e14"/>` +
    `<text x="14" y="22" fill="#8be9fd" font-family="monospace" font-size="14">NICHE "${key}" — ${n.name} · ${rows.length} ticks of evolution</text>` +
    `<line x1="${P}" y1="${H - P}" x2="${W - 12}" y2="${H - P}" stroke="#2a3441"/><line x1="${P}" y1="12" x2="${P}" y2="${H - P}" stroke="#2a3441"/>` +
    poly(prices, maxP, '#ff79c6') + poly(pops, maxPop, '#50fa7b', 1) + poly(quals, 1, '#8be9fd', 1) +
    `<text x="${P}" y="${H - 26}" fill="#ff79c6" font-family="monospace" font-size="11">— mean price (max $${maxP.toFixed(6)})</text>` +
    `<text x="${P + 250}" y="${H - 26}" fill="#50fa7b" font-family="monospace" font-size="11">-- population (max ${maxPop})</text>` +
    `<text x="${P + 468}" y="${H - 26}" fill="#8be9fd" font-family="monospace" font-size="11">-- quality</text>` +
    `<text x="${P}" y="${H - 8}" fill="#6272a4" font-family="monospace" font-size="10">base demand ${n.baseDemand} · elasticity ${n.elasticity} · cost factor ${n.costFactor} · shock ${n.shock.toFixed(2)}x</text></svg>`;
}

// ---------------------------------------------------------------- free routes
const FREE = {
  'GET /': () => ({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: homeHtml() }),

  // 公开看板 / 可验证性对比页 / 前端页面（免费，无需 x402）
  ...publicRoutes({ bio, L, cfg, ok, chainSnapshot, REGISTRY, SUBSIDY_POOL }),

  'GET /api/bio/meta': () => ok({
    name: bio.meta.name, version: L.VERSION, x402Version: 2, tick: bio.meta.tick, tickLabel: bio.meta.tickLabel,
    population: bio.organisms.size, generations: bio.counters.generations,
    network: cfg.net, facilitatorMode: cfg.facilitatorMode, sellerAddress: cfg.sellerAddress,
    autotick: AUTOTICK_MS > 0 ? { enabled: true, everyMs: AUTOTICK_MS, ticksPerCycle: AUTOTICK_N } : { enabled: false },
    usdc: { asset: USDC_ARC, decimals: 6 },
    treasury: bio.treasury, counters: bio.counters,
    external: { calls: bio.counters.externalCalls, revenueUSDC: +bio.counters.externalRevenue.toFixed(4) },
    honesty: L.honesty(bio),
    chain: { registry: REGISTRY, subsidyPool: SUBSIDY_POOL },
    populationRoot: L.populationRoot(bio),
    docs: { spec: '/api/bio/spec', prices: '/api/bio/prices', llms: '/llms-full.txt', aiJson: '/.well-known/ai.json', openapi: '/openapi.yaml' },
  }),

  'GET /api/bio/prices': () => ok({
    asset: 'USDC', network: cfg.net.caip2, decimals: 6,
    routes: Object.entries(PRICES).filter(([k]) => k.includes('/api/bio/')).map(([k, v]) => ({
      route: k, priceUSD: v.usd, atomicUSDC: usdToAtomic(v.usd),
      model: v.upto ? 'upto (ceiling; declare your own amount)' : 'exact',
      ...(v.minUsd ? { minUSD: v.minUsd } : {}), ...(v.perTick ? { perExtraTickUSD: v.perTick } : {}), ...(v.perDay ? { perExtraDayUSD: v.perDay } : {}),
      description: v.desc,
    })),
  }),

  'GET /api/bio/spec': () => ok({
    name: bio.meta.name, version: L.VERSION,
    thesis: 'There is NO hand-written fitness function. Fitness is "did you stay solvent". Every organism holds a USDC balance, pays upkeep each tick, and must earn revenue by competing for x402 customers in its niche. Insolvent organisms die. Solvent ones pay a birth fee and split their balance with a mutated offspring. Price levels, niche specialisation and life-history traits are emergent — nobody designed them.',
    genome: {
      niche: 'integer 0..5 — which service market it competes in (can jump on mutation = speciation)',
      price: 'USDC per served call [0.00008 .. 0.02], mutates multiplicatively',
      quality: '[0.02 .. 1] customer attraction',
      speed: '[0.02 .. 1] customer attraction AND capacity ceiling (speed * ' + bio.econ.capacityPerSpeed + ' calls/tick)',
      efficiency: '[0.02 .. 1] cuts upkeep by up to 45%',
      fecundity: '[0.05 .. 1] lowers the reproduction threshold, can yield 2 offspring',
      mutRate: '[0.004 .. 0.35] EVOLVABILITY ITSELF EVOLVES',
      lifespan: 'ticks [18 .. 300]',
    },
    economics: bio.econ,
    niches: L.NICHES,
    marketClearing: 'attractiveness_i = (0.30+quality_i)*(0.30+speed_i) / price_i^elasticity ; share_i = w_i/sum(w) ; customers_i = min(demand_n*share_i, speed_i*' + bio.econ.capacityPerSpeed + ') ; revenue_i = customers_i * price_i * (1 - ' + (bio.econ.platformFeeBps / 10000) + ')',
    upkeep: 'baseUpkeep * (1 + ' + (bio.econ.complexityCost * 3).toFixed(2) + ' * complexity) * (1 - ' + bio.econ.efficiencyRelief + ' * efficiency) * (1 + 0.35*congestion) ; complexity = (quality + speed + 1 - efficiency)/3',
    reproduction: 'age >= ' + bio.econ.maturityAge + ' and energy >= birthFee(0.020 + 0.00012*pop) + reproThreshold*(1.6 - 0.9*fecundity); child gets ' + Math.round(bio.econ.splitToChild * 100) + '% of post-fee energy; genome mutated at rate = parent mutRate',
    death: 'energy <= 0 (starvation) or age > lifespan (old age)',
    environment: 'demand = baseDemand * season(sin, period 240) * noise(+-52%) * shock + externalX402Calls. Shocks: ' + (bio.econ.shockChance * 100) + '%/niche/tick chance of a ' + bio.econ.shockRange[0] + 'x-0.7x bust or 1.5x-' + bio.econ.shockRange[1] + 'x boom lasting ' + bio.econ.shockDuration[0] + '-' + bio.econ.shockDuration[1] + ' ticks.',
    verification: {
      determinism: 'rng = keccak("BIO_RNG_V1" || worldSeed || tick || salt), counter mode. Identical seed + identical external-call sequence replays byte-for-byte.',
      populationRoot: 'keccak256 over every living organism (genomeHash, energy*1e9, generation, age), sorted by id. Chain-storeable per epoch.',
      genomeHash: 'keccak256 over the quantised genome. Lineage is provable.',
      note: 'Original Keccak padding (0x01..0x80), NOT NIST SHA3-256 — verified against standard test vectors, so Solidity recomputes it byte-for-byte.',
    },
    howToSteerEvolution: [
      '1. GET /api/bio/spec (free) — read the genome schema and the market-clearing formula.',
      '2. POST /api/bio/serve/{niche} with an upto payment — you buy a REAL service and the revenue is credited to the organism that wins the call. Sustained buying raises that niche population and shifts its evolved traits.',
      '3. POST /api/bio/demand — inject demand into a niche without buying anything (pure selection pressure).',
      '4. POST /api/bio/seed — release your own hand-designed genome as a founder and see if it survives.',
      '5. GET /api/bio/state and /api/bio/history to observe what your spending did.',
    ],
    honesty: 'Baseline niche demand is currently SIMULATED — an operator subsidy that keeps evolution running before real traffic exists. Value created by simulated demand is not backed by revenue. /api/bio/serve and /api/bio/demand are the real-money paths; the roadmap is to decay the subsidy to zero as real demand arrives.',
  }),

  'GET /llms.txt': () => ({ status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body:
`# ${bio.meta.name}

> An autonomous artificial-life economy on Arc. Organisms hold USDC balances, pay upkeep to
> stay alive, and earn revenue by competing for x402 customers. No fitness function —
> fitness is solvency. They evolve, reproduce and die with no human in the loop.

- Full documentation: /llms-full.txt
- Machine-readable spec: GET /api/bio/spec
- Pricing: GET /api/bio/prices
- Network config: GET /api/bio/meta
- Service discovery: /.well-known/ai.json
- OpenAPI: /openapi.yaml

## Steer the evolution
POST /api/bio/serve/{niche}  buy a real service; revenue credits the winning organism
POST /api/bio/demand         inject USDC demand into a niche
POST /api/bio/seed           release your own genome as a founder
POST /api/bio/tick?ticks=N   advance the biosphere yourself
` }),

  'GET /llms-full.txt': () => ({ status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: llmsFull() }),
  'GET /openapi.yaml': () => ({ status: 200, headers: { 'Content-Type': 'text/yaml; charset=utf-8' }, body: openapiYaml() }),

  'GET /.well-known/ai.json': () => ok({
    name: bio.meta.name, kind: 'x402-resource-server + autonomous-agent-economy', version: L.VERSION,
    description: 'Self-evolving artificial-life economy. Organisms earn USDC via x402 to pay for their own existence and reproduce. Fitness is solvency.',
    payment: { protocol: 'x402', version: 2, network: cfg.net.caip2, asset: USDC_ARC, assetDecimals: 6, schemes: ['exact', 'upto'], settlement: 'Circle Gateway batched (gasless)' },
    chain: { chainId: cfg.net.chainId, rpc: cfg.net.rpc, explorer: cfg.net.explorer, gasToken: 'USDC (18 decimals native)' },
    endpoints: { spec: '/api/bio/spec', prices: '/api/bio/prices', meta: '/api/bio/meta', state: '/api/bio/state', serve: '/api/bio/serve/{niche}', demand: '/api/bio/demand', seed: '/api/bio/seed' },
    live: { tick: bio.meta.tick, population: bio.organisms.size, generations: bio.counters.generations, externalCalls: bio.counters.externalCalls, externalRevenueUSDC: +bio.counters.externalRevenue.toFixed(4), populationRoot: L.populationRoot(bio) },
  }),
};

// ---------------------------------------------------------------- paid routes
const PAID = {
  'POST /api/bio/tick': paid(cfg, 'POST /api/bio/tick', async (ctx) => {
    const b = await readBody(ctx.req);
    const n = Math.max(1, Math.min(500, Number(b.ticks ?? ctx.query.get('ticks') ?? 1) | 0));
    const rows = L.step(bio, n);
    saveBio();
    return ok({ ticksAdvanced: rows.length, latest: rows[rows.length - 1] || null, state: L.state(bio), payment: ctx.payment });
  }),

  'GET /api/bio/state': paid(cfg, 'GET /api/bio/state', async (ctx) => ok({ ...L.state(bio), payment: ctx.payment })),

  'GET /api/bio/organisms': paid(cfg, 'GET /api/bio/organisms', async (ctx) => {
    const q = ctx.query;
    const list = L.listOrganisms(bio, { niche: q.get('niche') || undefined, sort: q.get('sort') || 'energy', limit: Math.min(400, Number(q.get('limit') || 60)) });
    return ok({ tick: bio.meta.tick, total: bio.organisms.size, returned: list.length, organisms: list, payment: ctx.payment });
  }),

  'GET /api/bio/organism/:id': paid(cfg, 'GET /api/bio/organism/:id', async (ctx) => {
    const o = bio.organisms.get(ctx.params.id);
    if (!o) {
      const f = bio.fossils.find((x) => x.id === ctx.params.id);
      return f ? ok({ extinct: true, fossil: f, payment: ctx.payment }) : bad('unknown organism', 'UNKNOWN_ORGANISM', 404);
    }
    const up = L.upkeepOf(o.genome, bio.organisms.size);
    return ok({
      id: o.id, alive: true, generation: o.generation, age: o.age, parent: o.parent, lineage: o.lineage,
      founder: !!o.founder, owner: o.owner || null, name: o.name || null,
      energy: +o.energy.toFixed(6), served: +o.served.toFixed(1), earned: +o.earned.toFixed(6),
      spent: +o.spent.toFixed(6), offspring: o.offspring,
      niche: L.NICHES[o.genome.niche].key, genome: o.genome, genomeHash: o.genomeHash,
      economics: {
        upkeepPerTick: +up.toFixed(6),
        breakEvenCallsPerTick: +(up / Math.max(1e-9, o.genome.price)).toFixed(2),
        capacityPerTick: +(o.genome.speed * bio.econ.capacityPerSpeed).toFixed(1),
        ticksUntilStarvation: o.energy > 0 ? Math.floor(o.energy / Math.max(1e-12, up)) : 0,
        lifetimePnlUSDC: +(o.earned - o.spent).toFixed(6),
      },
      payment: ctx.payment,
    });
  }),

  'GET /api/bio/lineage/:id': paid(cfg, 'GET /api/bio/lineage/:id', async (ctx) => {
    const d = Math.min(8, Number(ctx.query.get('depth') || 4));
    return ok({ root: ctx.params.id, depth: d, tree: L.lineageTree(bio, ctx.params.id, d), payment: ctx.payment });
  }),

  'GET /api/bio/fossils': paid(cfg, 'GET /api/bio/fossils', async (ctx) => {
    const cause = ctx.query.get('cause');
    let f = bio.fossils;
    if (cause) f = f.filter((x) => x.cause === cause);
    const causes = {};
    for (const x of bio.fossils) causes[x.cause] = (causes[x.cause] || 0) + 1;
    const limit = Math.min(1000, Number(ctx.query.get('limit') || 100));
    const ages = bio.fossils.map((x) => x.age).sort((a, b) => a - b);
    return ok({
      total: bio.fossils.length, causes,
      ageAtDeath: ages.length ? { p10: ages[Math.floor(ages.length * 0.1)], median: ages[Math.floor(ages.length / 2)], p90: ages[Math.floor(ages.length * 0.9)] } : null,
      returned: Math.min(limit, f.length), fossils: f.slice(-limit).reverse(), payment: ctx.payment,
    });
  }),

  'GET /api/bio/history': paid(cfg, 'GET /api/bio/history', async (ctx) => {
    const from = Number(ctx.query.get('from') ?? 0), to = Number(ctx.query.get('to') ?? 1e12);
    const stride = Math.max(1, Number(ctx.query.get('stride') || 1));
    const rows = bio.history.filter((r) => r.tick >= from && r.tick <= to).filter((_, i) => i % stride === 0);
    return ok({ count: rows.length, stride, rows, payment: ctx.payment });
  }),

  'GET /api/bio/events': paid(cfg, 'GET /api/bio/events', async (ctx) => {
    const types = ctx.query.get('types') ? ctx.query.get('types').split(',') : null;
    let e = bio.events;
    if (types) e = e.filter((x) => types.includes(x.type));
    return ok({ total: e.length, events: e.slice(-Math.min(500, Number(ctx.query.get('limit') || 120))).reverse(), payment: ctx.payment });
  }),

  'GET /api/bio/niche/:key/chart.svg': paid(cfg, 'GET /api/bio/niche/:key/chart.svg', async (ctx) => {
    const svg = nicheChart(ctx.params.key);
    if (!svg) return bad('unknown niche: ' + ctx.params.key + ' (valid: ' + L.NICHES.map((n) => n.key).join(', ') + ')', 'UNKNOWN_NICHE', 404);
    return { status: 200, headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' }, body: svg };
  }),

  // ---- release YOUR genome as a founder
  'POST /api/bio/seed': paid(cfg, 'POST /api/bio/seed', async (ctx) => {
    const b = await readBody(ctx.req);
    if (bio.organisms.size >= bio.econ.popCap) return bad('biosphere at carrying capacity (' + bio.econ.popCap + ')', 'POP_CAP', 409);
    const g = b.genome || {};
    for (const k of ['price', 'quality', 'speed', 'efficiency', 'fecundity', 'mutRate', 'lifespan', 'niche']) {
      if (g[k] != null && (typeof g[k] !== 'number' || !isFinite(g[k]))) return bad('genome.' + k + ' must be a finite number', 'BAD_GENOME');
    }
    const rng = L.makeRng(bio.meta.seed, bio.meta.tick, 99);
    const genome = {
      niche: Math.max(0, Math.min(L.NICHES.length - 1, Math.round(g.niche ?? rng.int(0, L.NICHES.length - 1)))),
      price: +clampN(g.price ?? 0.0012, 0.00008, 0.02).toFixed(6),
      quality: +clampN(g.quality ?? 0.7, 0.02, 1).toFixed(4),
      speed: +clampN(g.speed ?? 0.7, 0.02, 1).toFixed(4),
      efficiency: +clampN(g.efficiency ?? 0.6, 0.02, 1).toFixed(4),
      fecundity: +clampN(g.fecundity ?? 0.5, 0.05, 1).toFixed(4),
      mutRate: +clampN(g.mutRate ?? 0.08, 0.004, 0.35).toFixed(4),
      lifespan: Math.round(clampN(g.lifespan ?? 90, 18, 300)),
    };
    const before = bio.organisms.size;
    const id = seedFounder(genome, b.owner || ctx.payer || null, b.name);
    saveBio();
    const o = bio.organisms.get(id);
    const up = L.upkeepOf(genome, bio.organisms.size);
    return ok({
      organismId: id, owner: o.owner, name: o.name, niche: L.NICHES[genome.niche].key,
      genome, genomeHash: o.genomeHash, generation: 0, energy: +o.energy.toFixed(6),
      economics: { upkeepPerTick: +up.toFixed(6), breakEvenCallsPerTick: +(up / Math.max(1e-9, genome.price)).toFixed(2), ticksUntilStarvation: Math.floor(o.energy / Math.max(1e-12, up)) },
      populationBefore: before, populationAfter: bio.organisms.size,
      warning: 'Founders get 2.2x starting energy but face organisms that have already adapted. Most hand-designed genomes die within a few hundred ticks — that is the point.',
      receipt: { populationRoot: L.populationRoot(bio), tick: bio.meta.tick }, payment: ctx.payment,
    });
  }),

  // ---- inject raw demand: pure selection pressure, no service performed
  'POST /api/bio/demand': paid(cfg, 'POST /api/bio/demand', async (ctx) => {
    const b = await readBody(ctx.req);
    const n = nicheByKey(b.niche);
    if (!n) return bad('unknown niche: ' + b.niche + ' (valid: ' + L.NICHES.map((x) => x.key).join(', ') + ')', 'UNKNOWN_NICHE');
    const usd = ctx.payment?.usd ?? 0;
    if (usd <= 0) return bad('zero-value payment', 'ZERO_PAYMENT');
    // 1 USDC = 250 units of niche demand for the next tick, and the money is
    // credited to the organism that wins each notional call.
    const units = Math.max(1, Math.round(usd * 250));
    const chunks = Math.min(units, 400);
    let routed = null;
    for (let i = 0; i < chunks; i++) {
      routed = L.creditExternalCall(bio, n.key, { revenue: usd / chunks, calls: units / chunks, buyer: ctx.payer, txHash: ctx.payment?.transaction, subsidized: isSubsidy(ctx.payer) });
    }
    record(bio, { kind: 'demand', niche: n.key, usd, units, chunks, buyer: ctx.payer || null, txHash: ctx.payment?.transaction || null, subsidized: isSubsidy(ctx.payer) });
    saveBio();
    const orgs = [...bio.organisms.values()].filter((o) => o.genome.niche === n.id);
    return ok({
      niche: n.key, injectedUSDC: +usd.toFixed(6), demandUnits: units,
      servedBy: routed?.servedBy || null, winnerGenome: routed?.winnerGenome || null,
      nichePopulation: orgs.length,
      note: 'Demand was queued for the next tick AND the USDC was credited to the winning organism. Sustained injection reshapes the population — see /api/bio/history.',
      populationRoot: L.populationRoot(bio), payment: ctx.payment,
    });
  }),

  // ---- buy a REAL service; revenue credits the organism that wins the call
  'POST /api/bio/serve/:niche': paid(cfg, 'POST /api/bio/serve/:niche', async (ctx) => {
    const n = nicheByKey(ctx.params.niche);
    if (!n) return bad('unknown niche: ' + ctx.params.niche + ' (valid: ' + L.NICHES.map((x) => x.key).join(', ') + ')', 'UNKNOWN_NICHE', 404);
    const b = await readBody(ctx.req);
    const usd = ctx.payment?.usd ?? 0;
    if (usd <= 0) return bad('zero-value payment', 'ZERO_PAYMENT');
    const impl = SERVICE_IMPLS[n.key];
    if (!impl) return bad('niche has no service implementation yet: ' + n.key, 'NO_IMPL', 501);
    const t0 = Date.now();
    let result;
    try { result = impl(b.params || {}); } catch (e) { return bad('service failed: ' + e.message, 'SERVICE_FAILED', 500); }
    const ms = Date.now() - t0;
    const sub = isSubsidy(ctx.payer);
    const routed = L.creditExternalCall(bio, n.key, { revenue: usd, calls: 1, buyer: ctx.payer, txHash: ctx.payment?.transaction, subsidized: sub });
    record(bio, { kind: 'serve', niche: n.key, usd, buyer: ctx.payer || null, txHash: ctx.payment?.transaction || null, subsidized: sub, computeMs: ms });
    saveBio();
    return ok({
      niche: n.key, service: n.name, pricePaidUSDC: +usd.toFixed(6), computeMs: ms,
      servedBy: routed.servedBy,
      winner: routed.winnerGenome ? { genome: routed.winnerGenome, genomeHash: L.genomeHash(routed.winnerGenome) } : null,
      result,
      effect: 'The USDC you paid is now this organism energy. It is more likely to survive this tick and more likely to reproduce — your purchase steered the gene pool.',
      populationRoot: L.populationRoot(bio), payment: ctx.payment,
    });
  }),
};

// ---------------------------------------------------------------- router
function match(method, pathname) {
  for (const table of [FREE, PAID]) {
    for (const pattern of Object.keys(table)) {
      const sp = pattern.indexOf(' ');
      const m = pattern.slice(0, sp), p = pattern.slice(sp + 1);
      if (m !== method) continue;
      const pp = p.split('/'), ap = pathname.split('/');
      if (pp.length !== ap.length) continue;
      const params = {}; let good = true;
      for (let i = 0; i < pp.length; i++) {
        if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(ap[i]);
        else if (pp[i] !== ap[i]) { good = false; break; }
      }
      if (good) return { handler: table[pattern], params };
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const send = (o) => {
    const headers = {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED,PAYMENT-RESPONSE,X-Price-USD,X-Price-Model,X-Price-Min-USD',
      ...(o.headers || {}),
    };
    let body = typeof o.body === 'string' ? o.body : JSON.stringify(o.body, null, 2);
    if (req.method === 'HEAD') body = '';   // HEAD 不回 body
    // gzip：看板每 5 秒轮询一次 /api/bio/public，压缩后下行少 ~85%
    if (body.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      const gz = zlib.gzipSync(Buffer.from(body), { level: 6 });
      if (gz.length < Buffer.byteLength(body)) {
        headers['Content-Encoding'] = 'gzip';
        headers['Vary'] = 'Accept-Encoding';
        body = gz;
      }
    }
    res.writeHead(o.status || 200, headers);
    res.end(body);
  };
  if (req.method === 'OPTIONS') return send({ status: 204, body: '' });
  try {
    let raw = ''; for await (const ch of req) raw += ch; req.bodyRaw = raw;
    const m = match(req.method === 'HEAD' ? 'GET' : req.method, u.pathname);
    if (!m) return send(json({ error: 'not found', path: u.pathname, hint: 'GET /api/bio/meta for routes; GET /api/bio/spec for the model' }, 404));
    send(await m.handler({ req, params: m.params, query: u.searchParams, url: req.url, headers: req.headers }));
  } catch (e) { send(json({ error: e.message, code: e.code || 'INTERNAL' }, e.status || 500)); }
});

// ---------------------------------------------------------------- docs
function llmsFull() {
  const s = L.state(bio);
  const pt = Object.entries(PRICES).filter(([k]) => k.includes('/api/bio/'))
    .map(([k, v]) => '  ' + k.padEnd(42) + (v.upto ? 'upto $' + v.usd + ' (ceiling)' : '$' + v.usd).padEnd(22) + v.desc).join('\n');
  const nicheTbl = L.NICHES.map((n) => '  ' + n.key.padEnd(10) + ' ' + n.name.padEnd(30) + ' baseDemand ' + String(n.baseDemand).padStart(4) + '  elasticity ' + n.elasticity + '  costFactor ' + n.costFactor).join('\n');
  const evolved = L.NICHES.map((n) => { const x = s.niches[n.key] || {}; return '  ' + n.key.padEnd(10) + ' pop ' + String(x.population || 0).padStart(4) + '  price ' + (x.meanPrice ? '$' + x.meanPrice.toFixed(6) : '   —    ') + '  quality ' + (x.meanQuality || 0).toFixed(3) + '  speed ' + (x.meanSpeed || 0).toFixed(3) + '  efficiency ' + (x.meanEfficiency || 0).toFixed(3) + '  mutRate ' + (x.meanMutRate || 0).toFixed(4); }).join('\n');
  return `# ${bio.meta.name} — full agent documentation

> An autonomous artificial-life economy on Arc (Circle L1, chainId ${cfg.net.chainId}, USDC gas),
> sold per-call over x402. Organisms hold real USDC balances, pay upkeep every tick to stay
> alive, and earn revenue by competing for customers in a service niche. Insolvent organisms
> die. Solvent ones pay a birth fee and split their balance with a mutated offspring.
>
> THERE IS NO FITNESS FUNCTION. Fitness is solvency. Pricing, specialisation and life history
> are emergent — nobody designed them.

version ${L.VERSION} · tick ${s.tick} · population ${s.population} · max generation ${s.maxGeneration}
born ${bio.counters.born} · died ${bio.counters.died} · speciations ${bio.counters.speciations} · niche extinctions ${bio.counters.extinctions}
external x402 calls ${bio.counters.externalCalls} · external revenue $${bio.counters.externalRevenue.toFixed(4)}
autotick ${AUTOTICK_MS > 0 ? 'ON (' + AUTOTICK_N + ' tick / ' + AUTOTICK_MS + ' ms)' : 'OFF — customers must pay POST /api/bio/tick to advance time'}

## 1. Paying (x402 v2)

Call any paid route without a payment-signature header -> HTTP 402 + base64 PAYMENT-REQUIRED.
Sign an EIP-3009 transferWithAuthorization on Arc USDC and retry with the header. Two schemes:
  * exact — fixed price per call
  * upto  — the price is a CEILING and you declare the actual amount
            (used by /api/bio/serve/:niche and /api/bio/demand, so you choose how much
             selection pressure to buy)

Easiest path:
    npm i @circle-fin/x402-batching
    import { GatewayClient } from "@circle-fin/x402-batching/client";
    const c = new GatewayClient({ chain: "${cfg.net.gatewayClientChain}", privateKey: PK });
    await c.deposit("1.00");
    await c.pay("http://host:${PORT}/api/bio/serve/keccak");

## 2. Pricing

Asset: USDC on Arc, ERC-20 view ${USDC_ARC}, 6 decimals. (Arc native USDC is 18 decimals — never mix.)

${pt}

## 3. Free routes

  GET /api/bio/spec    complete machine-readable spec (genome, formulas, playbook)
  GET /api/bio/prices  pricing table with atomic amounts and scheme per route
  GET /api/bio/meta    network, facilitator mode, treasury, autotick, populationRoot
  GET /llms.txt  /llms-full.txt  /openapi.yaml  /.well-known/ai.json

## 4. Niches (real services, actually executed)

${nicheTbl}

  /api/bio/serve/keccak    -> keccak256 batch hashing
  /api/bio/serve/entropy   -> verifiable randomness with a disclosed commitment
  /api/bio/serve/render    -> deterministic SVG
  /api/bio/serve/pandemic  -> a real SEIR pandemic simulation run
  /api/bio/serve/optimize  -> a real genetic algorithm
  /api/bio/serve/oracle    -> biosphere telemetry feed

## 5. Market clearing (per tick, per niche)

  attractiveness_i = (0.30 + quality_i) * (0.30 + speed_i) / price_i^elasticity
  share_i          = attractiveness_i / sum(attractiveness)
  customers_i      = min(demand_n * share_i, speed_i * ${bio.econ.capacityPerSpeed})
  revenue_i        = customers_i * price_i * (1 - ${bio.econ.platformFeeBps / 10000})

  upkeep_i         = ${bio.econ.baseUpkeep} * (1 + ${(bio.econ.complexityCost * 3).toFixed(2)} * complexity_i) * (1 - ${bio.econ.efficiencyRelief} * efficiency_i) * (1 + 0.35 * congestion)
  complexity_i     = (quality + speed + 1 - efficiency) / 3

  reproduce iff    age >= ${bio.econ.maturityAge} AND energy >= ${bio.econ.birthFee} + ${bio.econ.congestionFee}*pop + ${bio.econ.reproThreshold}*(1.6 - 0.9*fecundity)
  child gets       ${Math.round(bio.econ.splitToChild * 100)}% of post-fee energy, genome mutated at rate = parent mutRate
  death iff        energy <= 0 (starvation) OR age > lifespan (old age)

  demand_n(t)      = baseDemand * season * noise + externalX402Calls

## 6. Current evolved state

${evolved}

  treasury ${JSON.stringify(s.treasury)}
  populationRoot ${s.populationRoot}

## 7. Steer the evolution

  POST /api/bio/serve/{niche}   buy a REAL service; your USDC becomes that organism's energy
  POST /api/bio/demand          inject demand into a niche (pure selection pressure)
  POST /api/bio/seed            release your own genome as a founder — will it survive?
  POST /api/bio/tick?ticks=N    advance the biosphere yourself
  GET  /api/bio/history         observe what your spending did
  GET  /api/bio/fossils         the fossil record: cause, age, lifetime P&L

Measured response to a sustained $80 injection into one niche over 500 ticks:
that niche's population +82% while the global population halved; its mean quality
0.733 -> 0.992 and speed 0.706 -> 0.985; its mean price collapsed 16x as organisms
raced for share; generation depth accelerated 26 -> 92; two other niches went extinct.
Outside money redirects evolution.

## 8. Observed evolutionary dynamics (3000 ticks, seeded, no external demand)

  * 66 generations, 3747 born / 3657 died, 30% of deaths by starvation
  * mean mutation rate evolved 0.097 -> 0.140: a VOLATILE environment selects for
    HIGHER evolvability (bet hedging). With a stable environment it evolves DOWN.
  * emergent price ladder tracks demand and cost, undesigned:
      low-demand high-value niches -> high price; high-volume commodity niches -> low price
  * the high-volume niche evolved efficiency to 0.95+ (margin is the only lever there)
  * per-capita revenue converges to exactly break-even: competition drives economic
    profit to zero, which is the correct result
  * 3 niche extinctions and 43 speciation events (organisms jump niches to escape competition)

## 9. Verification

  rng            = keccak("BIO_RNG_V1" || seed || tick || salt), counter mode, 4 floats per permutation
  genomeHash     = keccak("BIO_GENOME_V1" || quantised genome)
  populationRoot = keccak("BIO_ROOT_V1" || seed || tick || count || (genomeHash, energy*1e9, generation, age) for every organism sorted by id)

All keccak-256 with ORIGINAL Keccak padding (0x01..0x80), not NIST SHA3-256, verified against
standard test vectors — so a Solidity contract recomputes them byte-for-byte. Store
populationRoot per epoch on Arc and anyone can prove the operator never edited the population.

## 10. Honesty

Baseline niche demand is SIMULATED: an operator subsidy that keeps evolution running before
real traffic exists. Value created by simulated demand is not backed by revenue.
/api/bio/serve and /api/bio/demand are the real-money paths. The roadmap is to decay the
subsidy toward zero as real demand arrives. In mock facilitator mode no real USDC moves at all.
`;
}

function openapiYaml() {
  const lines = ['openapi: 3.0.3',
    'info:', '  title: ' + bio.meta.name, '  version: "' + L.VERSION + '"',
    '  description: Autonomous artificial-life economy sold per-call over x402 on Arc.',
    'servers:', '  - url: http://localhost:' + PORT, 'paths:'];
  for (const k of Object.keys(PRICES)) {
    if (!k.includes('/api/bio/')) continue;
    const sp = k.indexOf(' '), m = k.slice(0, sp).toLowerCase(), p = k.slice(sp + 1), v = PRICES[k];
    lines.push('  ' + p.replace(/:(\w+)/g, '{$1}') + ':');
    lines.push('    ' + m + ':');
    lines.push('      summary: ' + v.desc);
    lines.push('      x-price-usd: ' + v.usd);
    lines.push('      x-price-model: ' + (v.upto ? 'upto' : 'exact'));
    const names = (p.match(/:(\w+)/g) || []).map((x) => x.slice(1));
    if (names.length) { lines.push('      parameters:'); for (const n of names) lines.push('        - { name: ' + n + ', in: path, required: true, schema: { type: string } }'); }
    lines.push("      responses:");
    lines.push("        '200': { description: ok }");
    lines.push("        '402': { description: Payment Required, headers: { PAYMENT-REQUIRED: { schema: { type: string } } } }");
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- home page
function homeHtml() {
  const s = L.state(bio);
  const rows = L.NICHES.map((n) => {
    const x = s.niches[n.key] || {};
    return '<tr><td><code>' + n.key + '</code></td><td>' + n.name + '</td><td>' + (x.population || 0) + '</td><td>' +
      (x.meanPrice ? '$' + x.meanPrice.toFixed(6) : '—') + '</td><td>' + (x.meanQuality || 0).toFixed(3) + '</td><td>' +
      (x.meanSpeed || 0).toFixed(3) + '</td><td>' + (x.meanEfficiency || 0).toFixed(3) + '</td><td>' + (x.meanMutRate || 0).toFixed(4) + '</td><td>' + n.baseDemand + '</td></tr>';
  }).join('\n');
  const priceRows = Object.entries(PRICES).filter(([k]) => k.includes('/api/bio/')).map(([k, v]) =>
    '<tr><td><code>' + k + '</code></td><td>' + (v.upto ? 'upto ≤$' + v.usd : '$' + v.usd) + '</td><td>' + v.desc + '</td></tr>').join('\n');
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${bio.meta.name}</title><style>
:root{color-scheme:dark}body{margin:0 auto;background:#0b0e14;color:#e6edf3;font:15px/1.7 ui-monospace,Menlo,monospace;padding:32px;max-width:1000px}
h1{color:#50fa7b;font-size:27px;margin:0 0 6px}h2{color:#bd93f9;font-size:17px;margin:26px 0 8px;border-bottom:1px solid #21262d;padding-bottom:5px}
.sub{color:#8b949e;margin-bottom:20px}code{background:#161b22;padding:1px 5px;border-radius:4px;color:#ffa657}a{color:#79c0ff}
table{border-collapse:collapse;width:100%;font-size:12.5px}td,th{border:1px solid #21262d;padding:5px 8px;text-align:left}th{color:#8be9fd;background:#161b22}
.card{background:#11151c;border:1px solid #21262d;border-radius:9px;padding:16px 18px;margin:12px 0}
.badge{display:inline-block;background:#1f6feb22;border:1px solid #1f6feb;color:#79c0ff;border-radius:99px;padding:1px 10px;font-size:12px;margin:0 6px 6px 0}
.big{font-size:21px;color:#50fa7b}.warn{color:#ffa657}
</style></head><body>
<h1>${bio.meta.name}</h1>
<div class="sub">自主进化 · 自主繁衍 · 自我运营的人工生命经济体 — x402 微支付 · Arc (Circle L1, USDC gas)</div>
<div><span class="badge">x402 v2</span><span class="badge">exact + upto</span><span class="badge">零依赖 Node</span><span class="badge">keccak 可验证</span><span class="badge">无 fitness function</span></div>

<div class="card"><b>没有适应度函数。适应度就是「你还活着吗」。</b><br><br>
每个生命体持有一个 <b>USDC 余额</b>。每 tick 支付代谢成本；靠在自己的生态位里<b>竞争 x402 客户</b>赚取收入。
余额归零即死亡。有余量的支付出生费，把余额分给一个<b>基因突变的后代</b>。<br><br>
定价水平、生态位特化、寿命策略、甚至<b>突变率本身</b> —— 全部涌现，没有任何人设计过。</div>

<h2>当前状态（tick ${s.tick}）</h2>
<div class="card"><span class="big">${s.population}</span> 存活 · <span class="big">${s.maxGeneration}</span> 最深世代 ·
<span class="big">${bio.counters.born}</span> 出生 · <span class="big">${bio.counters.died}</span> 死亡 ·
${bio.counters.speciations} 物种形成 · ${bio.counters.extinctions} 生态位灭绝<br>
外部真实 x402 调用 <b>${bio.counters.externalCalls}</b> 次，注入 <b>$${bio.counters.externalRevenue.toFixed(4)}</b> USDC<br>
自我运营：<b>${AUTOTICK_MS > 0 ? '开启，每 ' + AUTOTICK_MS + 'ms 自主推进 ' + AUTOTICK_N + ' tick（无客户也在进化）' : '关闭 —— 需客户付费 POST /api/bio/tick 才推进'}</b><br>
<span style="color:#6272a4">populationRoot <code>${s.populationRoot}</code></span></div>

<h2>涌现出的市场（各生态位平均基因组）</h2>
<table><tr><th>niche</th><th>服务</th><th>种群</th><th>均价</th><th>quality</th><th>speed</th><th>efficiency</th><th>mutRate</th><th>基线需求</th></tr>
${rows}</table>

<h2>付费端点</h2><table><tr><th>路由</th><th>价格</th><th>说明</th></tr>
${priceRows}</table>

<h2>怎么改变演化方向</h2>
<div class="card"><b>1.</b> <code>POST /api/bio/serve/{niche}</code> — 买一个<b>真实执行的服务</b>（keccak 批量哈希 / 疫情模拟 / SVG 渲染 / 遗传算法 / 可验证随机 / 遥测源）。你付的 USDC 直接变成中标生命体的能量 → 它更可能存活并繁衍。<br>
<b>2.</b> <code>POST /api/bio/demand</code> — 用 <code>upto</code> scheme 自报金额，把需求注入某生态位（纯选择压力，不执行服务）。<br>
<b>3.</b> <code>POST /api/bio/seed</code> — 释放你自己设计的基因组当创始人，看它活不活得下来。<br><br>
<span class="warn">实测：向一个生态位持续注入 $80 真实需求 500 tick 后 —— 该生态位种群 +82%（全球种群却减半）、quality 0.733→0.992、speed 0.706→0.985、均价崩塌 16×、世代深度 26→92，另有两个生态位灭绝。</span></div>

<h2>已观测到的演化规律（3000 tick，纯种子驱动，无外部需求）</h2>
<div class="card">· 66 个世代，3747 出生 / 3657 死亡，<b>30% 死于饥饿</b><br>
· 平均<b>突变率从 0.097 演化到 0.140</b> —— 波动环境选择更高的可演化性（bet hedging）；稳定环境下则会下降<br>
· <b>涌现的价格阶梯</b>：低需求高价值生态位演化出高价，高流量商品位演化出低价，无人设计<br>
· 高流量生态位把 efficiency 推到 0.95+（那里只有降本一条路）<br>
· 个体收入<b>精确收敛到盈亏平衡点</b> —— 竞争把经济利润压到零<br>
· 3 次生态位灭绝、43 次物种形成（个体跳转生态位以逃避竞争）</div>

<h2>免费发现层</h2><table>
<tr><td><a href="/api/bio/spec">/api/bio/spec</a></td><td>完整机读规范：基因组 schema、市场出清公式、经济参数、Agent 操作手册</td></tr>
<tr><td><a href="/api/bio/prices">/api/bio/prices</a></td><td>价格表（含 atomic USDC 与 scheme）</td></tr>
<tr><td><a href="/api/bio/meta">/api/bio/meta</a></td><td>网络 / facilitator / 国库 / 自我运营状态 / populationRoot</td></tr>
<tr><td><a href="/llms-full.txt">/llms-full.txt</a></td><td>给 AI Agent 的完整说明书（含当前演化状态）</td></tr>
<tr><td><a href="/openapi.yaml">/openapi.yaml</a></td><td>OpenAPI 3.0</td></tr>
<tr><td><a href="/.well-known/ai.json">/.well-known/ai.json</a></td><td>服务发现</td></tr></table>

<h2 class="warn">诚实声明</h2>
<div class="card">生态位的<b>基线需求目前是模拟的</b> —— 这是运营方补贴，用来在真实流量到来前维持演化。模拟需求创造的价值没有收入支撑。
<code>/api/bio/serve</code> 和 <code>/api/bio/demand</code> 才是真实资金路径；路线图是随真实需求增长把补贴衰减到零。<br><br>
<code>PP_FACILITATOR=mock</code>（默认）下<b>不发生任何真实转账</b>。上主网前必须切到 <code>gateway</code> 模式并在 Arc Testnet 全流程验证。</div>
</body></html>`;
}

// ---------------------------------------------------------------- boot
await fs.mkdir(path.dirname(FILE), { recursive: true });
server.listen(PORT, () => {
  console.log('');
  console.log('  ' + bio.meta.name + ' — autonomous life economy');
  console.log('  ----------------------------------------------------------');
  console.log('  http://localhost:' + PORT);
  console.log('  tick         : ' + bio.meta.tick);
  console.log('  population   : ' + bio.organisms.size + '   max generation: ' + bio.counters.generations);
  console.log('  born / died  : ' + bio.counters.born + ' / ' + bio.counters.died + '   fossils: ' + bio.fossils.length);
  console.log('  speciations  : ' + bio.counters.speciations + '   niche extinctions: ' + bio.counters.extinctions);
  console.log('  external     : ' + bio.counters.externalCalls + ' real calls, $' + bio.counters.externalRevenue.toFixed(4) + ' injected');
  console.log('  network      : ' + cfg.net.name + ' (' + cfg.net.caip2 + ')');
  console.log('  facilitator  : ' + cfg.facilitatorMode + (cfg.facilitatorMode === 'mock' ? '  <-- LOCAL ONLY, no real USDC moves' : ''));
  console.log('  autotick     : ' + (AUTOTICK_MS > 0 ? 'ON — ' + AUTOTICK_N + ' tick / ' + AUTOTICK_MS + ' ms (evolves with no customers)' : 'OFF — customers must pay POST /api/bio/tick'));
  console.log('  ----------------------------------------------------------');
  console.log('  watch: node client/watch.js      steer: node client/steer.js');
  console.log('');
});
