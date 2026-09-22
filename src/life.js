// ============================================================================
//  BIOSPHERE — an autonomous, self-funding artificial-life economy.
//
//  THE CORE IDEA
//  --------------
//  There is NO hand-written fitness function. Fitness is "did you stay solvent".
//
//  Each organism:
//    * owns a genome that encodes a BUSINESS STRATEGY (which service niche it
//      serves, its price, quality, throughput, metabolic efficiency, fecundity,
//      and its own mutation rate — evolvability itself evolves)
//    * is denominated in USDC. Its "energy" is literally a USDC balance.
//    * pays UPKEEP every tick to stay alive (compute + complexity cost)
//    * earns REVENUE by serving x402 calls in its niche, competing for customers
//      against every other organism in that niche
//    * reproduces by paying a birth fee and splitting its balance with a mutated
//      offspring; dies the instant its balance hits zero
//
//  Selection pressure therefore comes from the MARKET, not from a designer.
//  Price levels, niche specialisation and life-history strategies are emergent.
//
//  Demand is hybrid: a seeded baseline keeps evolution running from tick zero,
//  and REAL x402 calls from external agents are injected on top — so an outside
//  payer can literally shift the direction of evolution by buying services.
//
//  Deterministic: all randomness is keccak(seed || tick || counter), so any
//  observer can replay the entire evolutionary history byte-for-byte and verify
//  the populationRoot commitment.
// ============================================================================
import { keccak256, hashConcat, toHex } from './keccak.js';

export const VERSION = 'biosphere/1';

// ------------------------------------------------------------------- niches
// Each niche is a REAL service the platform can perform. Organisms are the
// pricing / allocation layer over actual compute; revenue from a real x402 call
// is credited to whichever organism served it.
export const NICHES = [
  { id: 0, key: 'keccak',   name: 'Keccak-256 hashing',      baseDemand: 120, costFactor: 0.6, elasticity: 1.25 },
  { id: 1, key: 'pandemic', name: 'Pandemic simulation',     baseDemand: 26,  costFactor: 3.4, elasticity: 0.95 },
  { id: 2, key: 'render',   name: 'SVG / map rendering',     baseDemand: 44,  costFactor: 1.5, elasticity: 1.10 },
  { id: 3, key: 'optimize', name: 'Evolutionary optimisation', baseDemand: 18, costFactor: 4.2, elasticity: 0.85 },
  { id: 4, key: 'oracle',   name: 'Stats & telemetry feed',  baseDemand: 190, costFactor: 0.35, elasticity: 1.60 },
  { id: 5, key: 'entropy',  name: 'Verifiable randomness',   baseDemand: 70,  costFactor: 0.8, elasticity: 1.35 },
];

// ------------------------------------------------------------------ economy
export const ECON = {
  startEnergy: 0.09,        // USDC an organism is seeded with
  baseUpkeep: 0.0078,       // USDC per tick before efficiency / complexity
  complexityCost: 0.10,     // extra upkeep per unit of genome "ambition"
  efficiencyRelief: 0.45,   // max fraction of upkeep an efficient genome avoids
  birthFee: 0.020,          // USDC paid to the treasury per offspring
  congestionFee: 0.00012,   // extra birth fee per organism already alive
  reproThreshold: 0.052,    // energy required to consider reproducing
  maturityAge: 4,           // ticks before an organism may reproduce
  splitToChild: 0.62,       // fraction of post-fee energy given to the child
  platformFeeBps: 500,      // 5% of revenue to the treasury
  capacityPerSpeed: 21,     // max customers per tick at speed = 1 -> throughput is scarce
  popCap: 340,              // hard carrying capacity
  demandNoise: 0.52,        // random-walk amplitude on niche demand
  demandSeason: 0.22,       // sinusoidal seasonal amplitude
  externalGain: 1.0,        // weight of real x402 calls injected into demand
  shockChance: 0.006,       // per-niche per-tick probability of a demand shock
  shockRange: [0.12, 3.2],  // shock multipliers (bust / boom)
  shockDuration: [18, 90],  // ticks a shock persists
};

// -------------------------------------------------------------------- rng
export function makeRng(seedHex, tick, salt = 0) {
  const base = Buffer.from(hashConcat('BIO_RNG_V1', seedHex, BigInt(tick), BigInt(salt)));
  let block = null, idx = 4, ctr = 0n;
  const next = () => {
    if (idx >= 4) { const c = Buffer.alloc(8); c.writeBigUInt64BE(ctr++); block = Buffer.from(keccak256(Buffer.concat([base, c]))); idx = 0; }
    return Number(block.readBigUInt64BE(idx++ * 8) >> 12n) / 2 ** 52;
  };
  return {
    float: next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => Math.floor(a + (b - a + 1) * next()),
    gauss: () => { let s = 0; for (let i = 0; i < 4; i++) s += next(); return (s - 2) / 1.1547; },  // ~N(0,1)
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

// ------------------------------------------------------------------- genome
const BOUNDS = {
  price:      [0.00008, 0.02],
  quality:    [0.02, 1],
  speed:      [0.02, 1],
  efficiency: [0.02, 1],
  fecundity:  [0.05, 1],
  mutRate:    [0.004, 0.35],
  lifespan:   [18, 300],
};
const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));

export function randomGenome(rng) {
  return {
    niche: rng.int(0, NICHES.length - 1),
    price: +rng.range(0.0004, 0.004).toFixed(6),
    quality: +rng.range(0.2, 0.8).toFixed(4),
    speed: +rng.range(0.2, 0.8).toFixed(4),
    efficiency: +rng.range(0.2, 0.8).toFixed(4),
    fecundity: +rng.range(0.2, 0.8).toFixed(4),
    mutRate: +rng.range(0.03, 0.15).toFixed(4),
    lifespan: rng.int(34, 120),
  };
}

/** Mutation: gaussian jitter on continuous traits, occasional niche jump
 *  (speciation). The mutation RATE itself is a trait, so evolvability evolves. */
export function mutateGenome(g, rng, scale = 1) {
  const r = clamp(g.mutRate, BOUNDS.mutRate) * scale;
  const m = { ...g };
  for (const k of ['price', 'quality', 'speed', 'efficiency', 'fecundity', 'mutRate']) {
    if (rng.float() < 0.72) {
      const [lo, hi] = BOUNDS[k];
      const span = k === 'price' ? g.price * 0.45 : (hi - lo) * 0.16;   // price mutates multiplicatively
      m[k] = clamp(g[k] + rng.gauss() * r * 2.6 * span, BOUNDS[k]);
    }
  }
  if (rng.float() < 0.62) m.lifespan = clamp(Math.round(g.lifespan * (1 + rng.gauss() * r * 1.5)), BOUNDS.lifespan);
  if (rng.float() < r * 0.10) m.niche = rng.int(0, NICHES.length - 1);   // speciation jump
  for (const k of ['price', 'quality', 'speed', 'efficiency', 'fecundity', 'mutRate']) m[k] = +m[k].toFixed(6);
  m.lifespan = Math.round(m.lifespan);
  return m;
}

export function genomeHash(g) {
  return toHex(hashConcat('BIO_GENOME_V1',
    BigInt(g.niche), BigInt(Math.round(g.price * 1e9)), BigInt(Math.round(g.quality * 1e6)),
    BigInt(Math.round(g.speed * 1e6)), BigInt(Math.round(g.efficiency * 1e6)),
    BigInt(Math.round(g.fecundity * 1e6)), BigInt(Math.round(g.mutRate * 1e6)), BigInt(g.lifespan)));
}
/** "Ambition" — how expensive a genome is to run. Drives upkeep. */
export function complexity(g) { return (g.quality + g.speed + 1 - g.efficiency) / 3; }

// ---------------------------------------------------------------- biosphere
export function createBiosphere({ seed = null, name = 'Biosphere', founders = 40, tickLabel = 'hour' } = {}) {
  const worldSeed = seed || toHex(keccak256(new TextEncoder().encode('BIO' + Date.now() + Math.random() + name)));
  const rng = makeRng(worldSeed, 0, 7);
  const bio = {
    meta: { id: toHex(keccak256(new TextEncoder().encode(worldSeed + name))).slice(0, 18), name, version: VERSION, seed: worldSeed, tickLabel, createdAt: Date.now(), tick: 0 },
    econ: { ...ECON },
    niches: NICHES.map((n) => ({ ...n, demand: n.baseDemand, priceIndex: 0, revenue: 0, served: 0, external: 0, shock: 1, shockLeft: 0, extShare: 0 })),
    organisms: new Map(),
    fossils: [],
    lineages: new Map(),
    treasury: { revenue: 0, birthFees: 0, upkeep: 0, platformFees: 0 },
    history: [],
    events: [],
    counters: { born: 0, died: 0, extinctions: 0, speciations: 0, generations: 0, externalCalls: 0, externalRevenue: 0,
                realRevenueUSDC: 0, subsidyUSDC: 0, subsidizedCalls: 0, baselineUnits: 0, externalUnits: 0 },
    nextId: 1,
  };
  for (let i = 0; i < founders; i++) spawn(bio, rng, { genome: randomGenome(rng), generation: 0, parent: null, energy: ECON.startEnergy });
  return bio;
}

function spawn(bio, rng, { genome, generation, parent, energy, nicheOverride }) {
  const g = nicheOverride != null ? { ...genome, niche: nicheOverride } : genome;
  const gh = genomeHash(g);
  const id = toHex(hashConcat('BIO_ORG_V1', bio.meta.seed, BigInt(bio.nextId++), gh)).slice(0, 24);
  const org = {
    id, genome: g, genomeHash: gh, generation, parent,
    bornTick: bio.meta.tick, age: 0, energy,
    served: 0, earned: 0, spent: 0, offspring: 0,
    lineage: parent ? ((bio.lineages.get(parent) || '') + '>' + id.slice(2, 8)) : id.slice(2, 8),
    alive: true,
  };
  bio.organisms.set(id, org);
  bio.lineages.set(id, org.lineage);
  bio.counters.born += 1;
  if (generation > bio.counters.generations) bio.counters.generations = generation;
  return org;
}

function kill(bio, org, cause) {
  org.alive = false;
  bio.organisms.delete(org.id);
  bio.counters.died += 1;
  bio.fossils.push({
    id: org.id, genomeHash: org.genomeHash, genome: org.genome, generation: org.generation,
    parent: org.parent, lineage: org.lineage, bornTick: org.bornTick, diedTick: bio.meta.tick,
    age: org.age, cause, served: org.served, earned: +org.earned.toFixed(6), spent: +org.spent.toFixed(6),
    offspring: org.offspring, finalEnergy: +org.energy.toFixed(6),
  });
  if (bio.fossils.length > 6000) bio.fossils.shift();
  pushEvent(bio, 'DEATH', { id: org.id, niche: org.genome.niche, generation: org.generation, age: org.age, cause, price: org.genome.price });
}

function pushEvent(bio, type, data) {
  bio.events.push({ type, tick: bio.meta.tick, ...data });
  if (bio.events.length > 6000) bio.events.splice(0, bio.events.length - 6000);
}

/** Inject REAL x402 revenue: an external agent bought a service, so credit the
 *  organism that served it and add the call to that niche's demand signal.
 *  This is how outside money steers evolution. */
export function creditExternalCall(bio, nicheKey, { revenue = 0, calls = 1, buyer = null, txHash = null, subsidized = false } = {}) {
  const n = bio.niches.find((x) => x.key === nicheKey || x.id === nicheKey);
  if (!n) throw Object.assign(new Error('unknown niche ' + nicheKey), { code: 'UNKNOWN_NICHE' });
  n.external += calls;
  migrateCounters(bio);
  bio.counters.externalCalls += calls;
  bio.counters.externalRevenue += revenue;
  // Subsidised demand (operator-funded, e.g. drawn from SubsidyPool) is accounted
  // separately from real third-party revenue, so realRevenueRatio can never be faked.
  if (subsidized) { bio.counters.subsidyUSDC += revenue; bio.counters.subsidizedCalls += calls; }
  else { bio.counters.realRevenueUSDC += revenue; }

  const candidates = [...bio.organisms.values()].filter((o) => o.genome.niche === n.id && o.alive);
  if (!candidates.length) {
    bio.treasury.revenue += revenue;
    pushEvent(bio, 'EXTERNAL_CALL', { niche: n.key, calls, revenue: +revenue.toFixed(6), servedBy: null, buyer, txHash, note: 'no organism in niche; revenue to treasury' });
    return { niche: n.key, calls, revenue, servedBy: null, winnerGenome: null, distribution: [] };
  }

  // Revenue is shared by the SAME softmax + capacity rule the internal market uses.
  // Winner-take-all was tried first and it destroyed niches: a windfall to one
  // organism triggered a reproduction boom, offspring undercut each other, mean
  // price collapsed below upkeep, and the whole niche starved. Sharing by market
  // share spreads the windfall and turns it into population growth instead.
  const scored = candidates.map((o) => ({
    o,
    w: Math.pow((0.30 + o.genome.quality) * (0.30 + o.genome.speed), 1.0) / Math.pow(Math.max(1e-9, o.genome.price), n.elasticity),
    cap: Math.max(0.25, o.genome.speed * bio.econ.capacityPerSpeed * 0.25),
  }));
  const wSum = scored.reduce((a, x) => a + x.w, 0) || 1;
  let allocated = 0;
  for (const x of scored) { x.got = Math.min(calls * (x.w / wSum), x.cap); allocated += x.got; }
  if (allocated <= 0) { const each = calls / scored.length; for (const x of scored) { x.got = each; } allocated = calls; }

  const feeRate = bio.econ.platformFeeBps / 10000;
  const dist = [];
  let top = null;
  for (const x of scored) {
    const share = x.got / allocated;
    if (share <= 0) continue;
    const gross = revenue * share;
    const fee = gross * feeRate;
    x.o.energy += gross - fee; x.o.earned += gross - fee; x.o.served += x.got;
    bio.treasury.platformFees += fee;
    dist.push({ id: x.o.id, calls: +x.got.toFixed(3), usdc: +(gross - fee).toFixed(6), genomeHash: x.o.genomeHash });
    if (!top || gross > top.usdc) top = { id: x.o.id, usdc: gross, genome: x.o.genome };
  }
  dist.sort((a, b) => b.usdc - a.usdc);
  pushEvent(bio, 'EXTERNAL_CALL', { niche: n.key, calls, revenue: +revenue.toFixed(6), paidTo: dist.length, topEarner: top?.id || null, buyer, txHash });
  return { niche: n.key, calls, revenue, servedBy: top?.id || null, winnerGenome: top?.genome || null, distribution: dist.slice(0, 12) };
}

// ------------------------------------------------------------------- step
export function step(bio, ticks = 1) {
  const out = [];
  for (let i = 0; i < ticks; i++) { out.push(stepOnce(bio)); if (bio.organisms.size === 0) break; }
  bio.history.push(...out);
  if (bio.history.length > 8000) bio.history.splice(0, bio.history.length - 8000);
  return out;
}

function stepOnce(bio) {
  bio.meta.tick += 1;
  const t = bio.meta.tick;
  const rng = makeRng(bio.meta.seed, t);
  const pop = bio.organisms.size;
  let births = 0, deaths = 0, revenueTotal = 0, upkeepTotal = 0;

  // ---- 1. demand: seeded baseline + seasonality + real external calls
  for (const n of bio.niches) {
    // Demand shocks: booms and busts keep the environment moving, so adaptation
    // is never "finished". Without them the population just sits at break-even.
    if (n.shockLeft > 0) { n.shockLeft -= 1; if (n.shockLeft === 0) { pushEvent(bio, 'SHOCK_END', { niche: n.key, mult: +n.shock.toFixed(2) }); n.shock = 1; } }
    else if (rng.float() < ECON.shockChance) {
      const [lo, hi] = ECON.shockRange;
      n.shock = rng.float() < 0.5 ? rng.range(lo, 0.7) : rng.range(1.5, hi);
      n.shockLeft = rng.int(ECON.shockDuration[0], ECON.shockDuration[1]);
      pushEvent(bio, 'DEMAND_SHOCK', { niche: n.key, mult: +n.shock.toFixed(2), ticks: n.shockLeft, kind: n.shock < 1 ? 'bust' : 'boom' });
    }
    const season = 1 + ECON.demandSeason * Math.sin((t / 240) * Math.PI * 2 + n.id * 1.7);
    const drift = 1 + (rng.float() - 0.5) * 2 * ECON.demandNoise;
    const external = n.external * ECON.externalGain;
    n.external = 0;
    const d = Math.max(0.5, n.baseDemand * season * drift * n.shock + external);
    n.demand = d;
    n.extShare = d > 0 ? external / d : 0;
  }

  // ---- 2. market clearing per niche (softmax competition on value/price)
  const byNiche = new Map(bio.niches.map((n) => [n.id, []]));
  for (const o of bio.organisms.values()) (byNiche.get(o.genome.niche) || []).push(o);

  for (const n of bio.niches) {
    const orgs = byNiche.get(n.id) || [];
    n.priceIndex = orgs.length ? orgs.reduce((a, o) => a + o.genome.price, 0) / orgs.length : 0;
    if (!orgs.length) { n.served = 0; n.revenue = 0; continue; }

    const attract = orgs.map((o) => {
      const g = o.genome;
      return { o, w: Math.pow((0.30 + g.quality) * (0.30 + g.speed), 1.0) / Math.pow(Math.max(1e-9, g.price), n.elasticity) };
    });
    const wSum = attract.reduce((a, x) => a + x.w, 0) || 1;

    let served = 0, rev = 0;
    for (const { o, w } of attract) {
      const g = o.genome;
      const want = n.demand * (w / wSum);
      const capacity = Math.max(0.5, g.speed * ECON.capacityPerSpeed);
      const got = Math.min(want, capacity);
      const gross = got * g.price;
      const fee = gross * (ECON.platformFeeBps / 10000);
      o.energy += gross - fee; o.earned += gross - fee; o.served += got;
      bio.treasury.platformFees += fee;
      served += got; rev += gross;
      const extPart = gross * (n.extShare || 0);
      bio.counters.externalUnits += extPart;
      bio.counters.baselineUnits += gross - extPart;
    }
    n.served = served; n.revenue = rev;
    revenueTotal += rev;
  }

  // ---- 3. metabolism: pay upkeep or die
  const congestion = Math.max(0, pop - 120) / 220;
  for (const o of [...bio.organisms.values()]) {
    o.age += 1;
    const upkeep = ECON.baseUpkeep
      * (1 + ECON.complexityCost * 3.0 * complexity(o.genome))
      * (1 - ECON.efficiencyRelief * o.genome.efficiency)
      * (1 + 0.35 * congestion);
    o.energy -= upkeep; o.spent += upkeep;
    bio.treasury.upkeep += upkeep;
    upkeepTotal += upkeep;
    if (o.energy <= 0) { kill(bio, o, 'starvation'); deaths++; continue; }
    if (o.age > o.genome.lifespan) { kill(bio, o, 'old_age'); deaths++; }
  }

  // ---- 4. reproduction: pay a birth fee, split energy, mutate the child
  const living = [...bio.organisms.values()];
  for (const o of living) {
    if (!o.alive) continue;
    if (o.age < ECON.maturityAge) continue;
    if (bio.organisms.size >= ECON.popCap) break;
    const fee = ECON.birthFee + ECON.congestionFee * bio.organisms.size;
    const threshold = ECON.reproThreshold * (1.6 - 0.9 * o.genome.fecundity);
    if (o.energy < threshold + fee) continue;
    const attempts = o.genome.fecundity > 0.72 && o.energy > threshold * 2.2 + fee * 2 ? 2 : 1;
    for (let k = 0; k < attempts; k++) {
      if (bio.organisms.size >= ECON.popCap) break;
      if (o.energy < fee + ECON.reproThreshold * 0.35) break;
      o.energy -= fee; bio.treasury.birthFees += fee;
      const pool = o.energy * ECON.splitToChild;
      o.energy -= pool;
      const childGenome = mutateGenome(o.genome, rng);
      const child = spawn(bio, rng, { genome: childGenome, generation: o.generation + 1, parent: o.id, energy: pool });
      o.offspring += 1; births += 1;
      if (childGenome.niche !== o.genome.niche) {
        bio.counters.speciations += 1;
        pushEvent(bio, 'SPECIATION', { parent: o.id, child: child.id, from: NICHES[o.genome.niche].key, to: NICHES[childGenome.niche].key, generation: child.generation });
      }
    }
  }

  // ---- 5. niche extinction bookkeeping
  for (const n of bio.niches) {
    const alive = byNicheHas(bio, n.id);
    if (!alive && n.wasAlive) { bio.counters.extinctions += 1; pushEvent(bio, 'NICHE_EXTINCTION', { niche: n.key, tick: t }); }
    n.wasAlive = alive;
  }

  const row = snapshot(bio);
  row.births = births; row.deaths = deaths;
  row.revenue = +revenueTotal.toFixed(6); row.upkeep = +upkeepTotal.toFixed(6);
  return row;
}
const byNicheHas = (bio, id) => [...bio.organisms.values()].some((o) => o.genome.niche === id);

// ------------------------------------------------------------------ output
export function snapshot(bio) {
  const orgs = [...bio.organisms.values()];
  const byNiche = {};
  for (const n of bio.niches) {
    const list = orgs.filter((o) => o.genome.niche === n.id);
    if (!list.length) { byNiche[n.key] = { population: 0, demand: +n.demand.toFixed(1), shock: +n.shock.toFixed(2), meanPrice: 0, meanQuality: 0, meanSpeed: 0, meanEfficiency: 0, revenue: 0 }; continue; }
    const mean = (f) => list.reduce((a, o) => a + f(o.genome), 0) / list.length;
    byNiche[n.key] = {
      population: list.length, demand: +n.demand.toFixed(1), shock: +n.shock.toFixed(2),
      meanPrice: +mean((g) => g.price).toFixed(6), meanQuality: +mean((g) => g.quality).toFixed(3),
      meanSpeed: +mean((g) => g.speed).toFixed(3), meanEfficiency: +mean((g) => g.efficiency).toFixed(3),
      meanMutRate: +mean((g) => g.mutRate).toFixed(4), revenue: +n.revenue.toFixed(6),
    };
  }
  const mean = (f) => orgs.length ? orgs.reduce((a, o) => a + f(o), 0) / orgs.length : 0;
  return {
    tick: bio.meta.tick, population: orgs.length,
    maxGeneration: orgs.length ? Math.max(...orgs.map((o) => o.generation)) : 0,
    meanEnergy: +mean((o) => o.energy).toFixed(5), totalEnergy: +orgs.reduce((a, o) => a + o.energy, 0).toFixed(4),
    meanAge: +mean((o) => o.age).toFixed(1), meanLifespan: +mean((o) => o.genome.lifespan).toFixed(0),
    meanMutRate: +mean((o) => o.genome.mutRate).toFixed(4),
    treasury: { revenue: +bio.treasury.revenue.toFixed(4), birthFees: +bio.treasury.birthFees.toFixed(4), upkeep: +bio.treasury.upkeep.toFixed(4), platformFees: +bio.treasury.platformFees.toFixed(4) },
    niches: byNiche,
  };
}

/** keccak commitment over every living organism. Chain-storeable per epoch so
 *  anyone can prove the operator did not silently edit the population. */
export function populationRoot(bio) {
  const ids = [...bio.organisms.keys()].sort();
  const parts = ['BIO_ROOT_V1', bio.meta.seed, BigInt(bio.meta.tick), BigInt(ids.length)];
  for (const id of ids) {
    const o = bio.organisms.get(id);
    parts.push(o.genomeHash, BigInt(Math.round(o.energy * 1e9)), BigInt(o.generation), BigInt(o.age));
  }
  return toHex(hashConcat(...parts));
}

/** Fill in counters that were added after a world had already been persisted. */
export function migrateCounters(bio) {
  const c = bio.counters || (bio.counters = {});
  const d = { born: 0, died: 0, extinctions: 0, speciations: 0, generations: 0, externalCalls: 0,
              externalRevenue: 0, realRevenueUSDC: 0, subsidyUSDC: 0, subsidizedCalls: 0,
              baselineUnits: 0, externalUnits: 0 };
  for (const k of Object.keys(d)) if (c[k] === undefined) c[k] = d[k];
  if (!c.realRevenueUSDC && !c.subsidyUSDC && c.externalRevenue) c.realRevenueUSDC = c.externalRevenue;
  for (const n of bio.niches) if (n.extShare === undefined) n.extShare = 0;
  return bio;
}

/** The honesty ledger. How much of this economy is paid for by outsiders, how much is
 *  still operator subsidy, and how much of served demand is simulated baseline.
 *  These are the numbers committed on-chain by BiosphereRegistry. */
export function honesty(bio) {
  migrateCounters(bio);
  const c = bio.counters;
  const moneyTotal = c.realRevenueUSDC + c.subsidyUSDC;
  const unitsTotal = c.baselineUnits + c.externalUnits;
  return {
    realRevenueUSDC: +c.realRevenueUSDC.toFixed(6),
    subsidyUSDC: +c.subsidyUSDC.toFixed(6),
    externalCalls: c.externalCalls,
    subsidizedCalls: c.subsidizedCalls,
    realRevenueRatioBps: moneyTotal > 0 ? Math.round((c.realRevenueUSDC / moneyTotal) * 10000) : 0,
    simulatedDemandShareBps: unitsTotal > 0 ? Math.round((c.baselineUnits / unitsTotal) * 10000) : 10000,
    note: 'realRevenueRatioBps counts money only. simulatedDemandShareBps is the share of served demand that came from the seeded baseline (no money moved); it starts at 100% and must fall as real x402 demand arrives.',
  };
}

export function state(bio) {
  const snap = snapshot(bio);
  return {
    ...snap,
    id: bio.meta.id, name: bio.meta.name, version: bio.meta.version, tickLabel: bio.meta.tickLabel,
    counters: bio.counters,
    populationRoot: populationRoot(bio),
    topLineages: topLineages(bio, 8),
  };
}

export function topLineages(bio, n = 8) {
  return [...bio.organisms.values()]
    .sort((a, b) => b.energy - a.energy).slice(0, n)
    .map((o) => ({ id: o.id, lineage: o.lineage, generation: o.generation, energy: +o.energy.toFixed(5), age: o.age, offspring: o.offspring, niche: NICHES[o.genome.niche].key, genome: o.genome, genomeHash: o.genomeHash }));
}

export function listOrganisms(bio, { niche, sort = 'energy', limit = 50 } = {}) {
  let arr = [...bio.organisms.values()];
  if (niche != null) { const id = typeof niche === 'number' ? niche : NICHES.findIndex((x) => x.key === niche); arr = arr.filter((o) => o.genome.niche === id); }
  const cmp = { energy: (a, b) => b.energy - a.energy, age: (a, b) => b.age - a.age, generation: (a, b) => b.generation - a.generation, served: (a, b) => b.served - a.served, earned: (a, b) => b.earned - a.earned, price: (a, b) => a.genome.price - b.genome.price };
  arr.sort(cmp[sort] || cmp.energy);
  return arr.slice(0, limit).map((o) => ({
    id: o.id, generation: o.generation, age: o.age, parent: o.parent, lineage: o.lineage,
    energy: +o.energy.toFixed(6), served: +o.served.toFixed(1), earned: +o.earned.toFixed(6), spent: +o.spent.toFixed(6),
    offspring: o.offspring, niche: NICHES[o.genome.niche].key, genome: o.genome, genomeHash: o.genomeHash,
    upkeepPerTick: +upkeepOf(o.genome, bio.organisms.size).toFixed(6),
    breakEvenCalls: +(upkeepOf(o.genome, bio.organisms.size) / Math.max(1e-9, o.genome.price)).toFixed(1),
  }));
}
export function upkeepOf(g, pop = 0) {
  const congestion = Math.max(0, pop - 120) / 220;
  return ECON.baseUpkeep * (1 + ECON.complexityCost * 3.0 * complexity(g)) * (1 - ECON.efficiencyRelief * g.efficiency) * (1 + 0.35 * congestion);
}

export function lineageTree(bio, id, depth = 6) {
  const node = (oid, d) => {
    const live = bio.organisms.get(oid);
    const rec = live || bio.fossils.find((f) => f.id === oid);
    if (!rec) return { id: oid, missing: true };
    const g = live ? live.generation : rec.generation;
    const kids = [...bio.organisms.values()].filter((o) => o.parent === oid)
      .concat(bio.fossils.filter((f) => f.parent === oid));
    return {
      id: oid, alive: !!live, generation: g,
      niche: NICHES[(live ? live.genome : rec.genome).niche].key,
      energy: live ? +live.energy.toFixed(5) : null, age: live ? live.age : rec.age,
      diedTick: live ? null : rec.diedTick, cause: live ? null : rec.cause,
      offspring: (live ? live.offspring : rec.offspring) || 0,
      genomeHash: live ? live.genomeHash : rec.genomeHash,
      children: d > 0 ? kids.slice(0, 4).map((k) => node(k.id, d - 1)) : [],
    };
  };
  return node(id, depth);
}
