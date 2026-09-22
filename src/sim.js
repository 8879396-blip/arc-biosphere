// ============================================================================
//  PANDEMIC PROTOCOL — deterministic multi-strain SEIR pandemic engine
//  Plague Inc.-style: agents evolve a pathogen against a researching humanity.
//
//  Invariants
//   * PURE + SEEDED.  rng = keccak(worldSeed || day || counter). Identical inputs
//     give byte-identical outputs, so any client can re-verify a receipt.
//   * MULTI-STRAIN.   Several agents release strains into ONE shared world.
//     Susceptibles are a shared pool -> strains compete (competitive exclusion).
//   * CHAIN-READY.    worldRoot() is a keccak256 commitment an on-chain contract
//     can store per epoch so anyone can prove the server did not tamper.
//
//  Units: populations in MILLIONS (float). Hashed values are quantised first.
//  Epidemiology: frequency-dependent SEIR, R0 = beta/gamma.
// ============================================================================
import { keccak256, hashConcat, toHex } from './keccak.js';

export const VERSION = 'pp-sim/1';

// ---------------------------------------------------------------- countries
export const COUNTRIES = [
  { id: 0,  name: 'China',         pop: 1412, density: 0.55, wealth: 0.62, climate: 'temperate', openness: 0.62, land: [1,7,12], sea: [3,7],   air: [2,4,6,9] },
  { id: 1,  name: 'India',         pop: 1408, density: 0.78, wealth: 0.38, climate: 'hot',       openness: 0.58, land: [0,12],  sea: [14,5], air: [2,6,9] },
  { id: 2,  name: 'United States', pop: 333,  density: 0.22, wealth: 0.95, climate: 'temperate', openness: 0.88, land: [8,16],   sea: [4,7],    air: [0,3,5,6,9,15,18] },
  { id: 3,  name: 'Indonesia',     pop: 275,  density: 0.60, wealth: 0.42, climate: 'humid',     openness: 0.55, land: [],       sea: [0,1,13], air: [2,6] },
  { id: 4,  name: 'Brazil',        pop: 215,  density: 0.30, wealth: 0.50, climate: 'humid',     openness: 0.55, land: [17],   sea: [5,19],   air: [0,2,8,9] },
  { id: 5,  name: 'Nigeria',       pop: 218,  density: 0.48, wealth: 0.22, climate: 'hot',       openness: 0.40, land: [10],   sea: [4,15],   air: [1,2,9] },
  { id: 6,  name: 'Russia',        pop: 144,  density: 0.10, wealth: 0.58, climate: 'cold',      openness: 0.35, land: [0,7,18], sea: [],      air: [1,2,3] },
  { id: 7,  name: 'Japan',         pop: 125,  density: 0.72, wealth: 0.90, climate: 'temperate', openness: 0.60, land: [],     sea: [0,2],    air: [0,1,6] },
  { id: 8,  name: 'Mexico',        pop: 128,  density: 0.35, wealth: 0.48, climate: 'hot',       openness: 0.62, land: [2,4],  sea: [],       air: [2,4,5] },
  { id: 9,  name: 'Egypt',         pop: 110,  density: 0.55, wealth: 0.30, climate: 'arid',      openness: 0.45, land: [5,14], sea: [15],     air: [0,1,4,10] },
  { id: 10, name: 'Germany',       pop: 83,   density: 0.62, wealth: 0.93, climate: 'cold',      openness: 0.80, land: [11,12,18], sea: [13], air: [2,9,15] },
  { id: 11, name: 'United Kingdom',pop: 67,   density: 0.68, wealth: 0.91, climate: 'cold',      openness: 0.82, land: [],     sea: [10,12],  air: [2,10,12] },
  { id: 12, name: 'France',        pop: 68,   density: 0.52, wealth: 0.90, climate: 'temperate', openness: 0.80, land: [10,0,1], sea: [11],   air: [2,10,11] },
  { id: 13, name: 'Australia',     pop: 26,   density: 0.05, wealth: 0.94, climate: 'arid',      openness: 0.45, land: [],     sea: [3,14],   air: [2,7] },
  { id: 14, name: 'Saudi Arabia',  pop: 36,   density: 0.20, wealth: 0.78, climate: 'arid',      openness: 0.65, land: [9,1],  sea: [5,13],   air: [2,9,10] },
  { id: 15, name: 'South Africa',  pop: 60,   density: 0.28, wealth: 0.42, climate: 'temperate', openness: 0.42, land: [],     sea: [5,9],    air: [2,5,10] },
  { id: 16, name: 'Canada',        pop: 39,   density: 0.04, wealth: 0.92, climate: 'cold',      openness: 0.60, land: [2],    sea: [11],     air: [2,10] },
  { id: 17, name: 'Argentina',     pop: 46,   density: 0.09, wealth: 0.55, climate: 'temperate', openness: 0.42, land: [4],    sea: [19],     air: [4,9] },
  { id: 18, name: 'Turkey',        pop: 85,   density: 0.45, wealth: 0.56, climate: 'temperate', openness: 0.58, land: [6,10], sea: [9],      air: [2,10,14] },
  { id: 19, name: 'Iceland',       pop: 0.4,  density: 0.02, wealth: 0.96, climate: 'cold',      openness: 0.25, land: [],     sea: [4],      air: [11] },
];
export const WORLD_POP0 = COUNTRIES.reduce((s, c) => s + c.pop, 0);

// ---------------------------------------------------------------- genome
// DNA buys binary nodes. This is the strategy surface: severity buys spread but
// triggers detection; lethality kills hosts before they transmit; abilities buy
// time against the cure.
export const MUTATION_TREE = {
  transmission: {
    air1:       { cost: 4,  desc: 'Airborne 1 - aerosol spread' },
    air2:       { cost: 8,  req: 'air1',       desc: 'Airborne 2 - long range aerosol' },
    water1:     { cost: 4,  desc: 'Waterborne 1 - water supply' },
    water2:     { cost: 8,  req: 'water1',     desc: 'Waterborne 2 - survives purification' },
    blood1:     { cost: 5,  desc: 'Bloodborne 1 - direct contact' },
    insect1:    { cost: 5,  desc: 'Insect vector - hot/humid climates' },
    rodent1:    { cost: 5,  desc: 'Rodent vector - dense poor cities' },
    livestock1: { cost: 5,  desc: 'Livestock vector - rural amplification' },
  },
  symptoms: {
    coughing:        { cost: 3,  desc: '+R0, +severity (visible)' },
    sneezing:        { cost: 6,  req: 'coughing',  desc: '++R0, ++severity' },
    rash:            { cost: 2,  desc: '+severity' },
    sweating:        { cost: 2,  desc: '+R0 in hot climates' },
    nausea:          { cost: 2,  desc: '+severity' },
    vomiting:        { cost: 4,  req: 'nausea',    desc: '+R0 via water' },
    diarrhoea:       { cost: 4,  desc: '+water transmission' },
    pneumonia:       { cost: 7,  req: 'coughing',  desc: '+CFR, +cold survival' },
    pulmonaryOedema: { cost: 10, req: 'pneumonia', desc: '++CFR' },
    haemorrhage:     { cost: 9,  desc: '+CFR, +blood transmission' },
    organFailure:    { cost: 12, req: 'haemorrhage', desc: '+++CFR' },
    necrosis:        { cost: 14, req: 'organFailure', desc: '++++CFR' },
    insanity:        { cost: 6,  desc: '+severity, slows coordination' },
    seizures:        { cost: 7,  desc: '+CFR' },
    coma:            { cost: 8,  req: 'seizures',  desc: '+CFR, -detection (hidden)' },
    paralysis:       { cost: 7,  desc: '+CFR, -mobility' },
    tumours:         { cost: 8,  desc: '+CFR, +mutation rate' },
  },
  abilities: {
    coldResist1: { cost: 5,  desc: 'Survive cold climates' },
    coldResist2: { cost: 9,  req: 'coldResist1', desc: 'Full cold tolerance' },
    heatResist1: { cost: 5,  desc: 'Survive hot/arid climates' },
    heatResist2: { cost: 9,  req: 'heatResist1', desc: 'Full heat tolerance' },
    drugResist1: { cost: 7,  desc: '-20% cure speed' },
    drugResist2: { cost: 12, req: 'drugResist1', desc: '-20% cure speed' },
    hardening1:  { cost: 6,  desc: '-15% cure speed' },
    hardening2:  { cost: 11, req: 'hardening1',  desc: '-15% cure speed' },
    hardening3:  { cost: 16, req: 'hardening2',  desc: '-15% cure speed' },
    reshuffle1:  { cost: 6,  desc: 'Knock cure progress back 10%' },
    reshuffle2:  { cost: 12, req: 'reshuffle1',  desc: 'Knock cure progress back 20%' },
    stabiliser1: { cost: 5,  desc: '-50% random mutation rate (stay stealthy)' },
  },
};

export function emptyGenome() {
  const g = { transmission: {}, symptoms: {}, abilities: {} };
  for (const cat of Object.keys(MUTATION_TREE)) for (const k of Object.keys(MUTATION_TREE[cat])) g[cat][k] = 0;
  return g;
}
function canonicalGenome(g) {
  const out = {};
  for (const cat of Object.keys(MUTATION_TREE).sort()) {
    out[cat] = {};
    for (const k of Object.keys(MUTATION_TREE[cat]).sort()) out[cat][k] = g?.[cat]?.[k] ? 1 : 0;
  }
  return out;
}
export function genomeHash(g) { return toHex(hashConcat('PP_GENOME_V1', JSON.stringify(canonicalGenome(g)))); }

const has = (g, c, k) => (g?.[c]?.[k] ? 1 : 0);

/** Derived phenotype. Pure function of the genome, so an agent can compute it
 *  locally before spending DNA and verify our numbers. */
export function phenotype(g) {
  let R0 = 1.15;
  R0 += has(g,'transmission','air1')*0.35 + has(g,'transmission','air2')*0.55;
  R0 += has(g,'transmission','water1')*0.25 + has(g,'transmission','water2')*0.45;
  R0 += has(g,'transmission','blood1')*0.20;
  R0 += has(g,'transmission','insect1')*0.20 + has(g,'transmission','rodent1')*0.20 + has(g,'transmission','livestock1')*0.18;
  R0 += has(g,'symptoms','coughing')*0.30 + has(g,'symptoms','sneezing')*0.50;
  R0 += has(g,'symptoms','sweating')*0.10 + has(g,'symptoms','vomiting')*0.12 + has(g,'symptoms','diarrhoea')*0.15;

  let severity = 0.02;
  for (const k of Object.keys(MUTATION_TREE.symptoms)) severity += has(g,'symptoms',k) * 0.055;
  severity -= has(g,'symptoms','coma') * 0.09;               // coma hides patients

  let cfr = 0.002;
  cfr += has(g,'symptoms','pneumonia')*0.020 + has(g,'symptoms','pulmonaryOedema')*0.060;
  cfr += has(g,'symptoms','haemorrhage')*0.050 + has(g,'symptoms','organFailure')*0.120 + has(g,'symptoms','necrosis')*0.250;
  cfr += has(g,'symptoms','seizures')*0.020 + has(g,'symptoms','coma')*0.040 + has(g,'symptoms','paralysis')*0.030;
  cfr += has(g,'symptoms','tumours')*0.050;

  const cureResist = Math.min(0.85,
    has(g,'abilities','drugResist1')*0.20 + has(g,'abilities','drugResist2')*0.20 +
    has(g,'abilities','hardening1')*0.15 + has(g,'abilities','hardening2')*0.15 + has(g,'abilities','hardening3')*0.15);

  const incubationDays = Math.max(1.5, 9 - has(g,'symptoms','coughing')*1.5 - has(g,'symptoms','sneezing')*1.0 - has(g,'transmission','air1')*1.0);
  const infectiousDays = 7 + has(g,'symptoms','paralysis')*4;
  const mutationRate = Math.max(0.001, 0.008 + has(g,'symptoms','tumours')*0.010 - has(g,'abilities','stabiliser1')*0.004);

  return {
    R0: Math.min(4.8, R0),
    severity: Math.min(0.95, Math.max(0, severity)),
    cfr: Math.min(0.90, cfr),
    cureResist, incubationDays, infectiousDays, mutationRate,
    coldResist: Math.min(1, has(g,'abilities','coldResist1')*0.45 + has(g,'abilities','coldResist2')*0.45),
    heatResist: Math.min(1, has(g,'abilities','heatResist1')*0.45 + has(g,'abilities','heatResist2')*0.45),
    reshuffle: has(g,'abilities','reshuffle1')*0.10 + has(g,'abilities','reshuffle2')*0.20,
  };
}

// ---------------------------------------------------------------- rng
/** Deterministic counter-mode PRNG keyed by keccak. 4 floats per permutation. */
export function makeRng(seedHex, day, salt = 0) {
  const base = Buffer.from(hashConcat('PP_RNG_V1', seedHex, BigInt(day), BigInt(salt)));
  let block = null, idx = 4, ctr = 0n;
  return function rng() {
    if (idx >= 4) {
      const c = Buffer.alloc(8); c.writeBigUInt64BE(ctr++);
      block = Buffer.from(keccak256(Buffer.concat([base, c])));
      idx = 0;
    }
    return Number(block.readBigUInt64BE(idx++ * 8) >> 12n) / 2 ** 52;
  };
}

// ---------------------------------------------------------------- world
export function createWorld({ seed = null, id = null, name = 'Untitled Outbreak' } = {}) {
  const worldSeed = seed || toHex(keccak256(new TextEncoder().encode('PP_WORLD' + Date.now() + Math.random() + name)));
  return {
    meta: {
      id: id || worldSeed.slice(0, 18), name, version: VERSION, seed: worldSeed,
      createdAt: Date.now(), day: 0, ended: false, outcome: null,
      initialPopulation: WORLD_POP0, seedPeople: 0.002,      // ~2,000 people
    },
    countries: COUNTRIES.map((c) => ({
      ...c, S: c.pop, strains: {},
      alert: 0, closure: 0, lockdown: 0, detected: false,
      firstInfectedDay: null, closedDay: null,
    })),
    strains: {}, telemetry: [], events: [],
  };
}

function fillGenome(partial) {
  const g = emptyGenome();
  for (const cat of Object.keys(g)) {
    if (!partial?.[cat]) continue;
    for (const k of Object.keys(g[cat])) if (partial[cat][k]) g[cat][k] = 1;
  }
  return g;
}

export function registerStrain(world, { owner, name, genome = null, countryId = 0, paid = '0' }) {
  if (world.meta.ended) throw Object.assign(new Error('world ended'), { code: 'WORLD_ENDED' });
  if (!(countryId >= 0 && countryId < world.countries.length)) throw Object.assign(new Error('bad countryId'), { code: 'BAD_COUNTRY' });
  const g = genome ? fillGenome(genome) : emptyGenome();
  const strainId = toHex(hashConcat('PP_STRAIN_V1', world.meta.seed, owner, name, BigInt(world.meta.day), genomeHash(g))).slice(0, 22);
  world.strains[strainId] = {
    id: strainId, owner, name: name || 'Unnamed strain',
    genome: g, genomeHash: genomeHash(g), phenotype: phenotype(g),
    releasedDay: world.meta.day, originCountry: countryId,
    dna: 4, totalDnaEarned: 4, mutations: 0,
    cure: 0, cureComplete: false, curedDay: null,
    alive: true, extinctDay: null, paid,
    stats: { infections: 0, deaths: 0, recoveries: 0, peakInfected: 0, countriesReached: 1 },
  };
  const c = world.countries[countryId];
  const seeded = Math.min(c.S, world.meta.seedPeople);
  c.S -= seeded;
  c.strains[strainId] = { E: seeded * 0.5, I: seeded * 0.5, R: 0, D: 0 };
  pushEvent(world, 'RELEASE', { strainId, country: c.name, day: world.meta.day, owner });
  return strainId;
}

export function mutate(world, strainId, category, node) {
  const s = world.strains[strainId];
  if (!s) throw Object.assign(new Error('unknown strain'), { code: 'UNKNOWN_STRAIN' });
  if (!s.alive) throw Object.assign(new Error('strain extinct'), { code: 'STRAIN_EXTINCT' });
  const spec = MUTATION_TREE[category]?.[node];
  if (!spec) throw Object.assign(new Error('unknown mutation'), { code: 'UNKNOWN_MUTATION' });
  if (s.genome[category][node]) throw Object.assign(new Error('already owned'), { code: 'ALREADY_OWNED' });
  if (spec.req) {
    const reqCat = Object.keys(MUTATION_TREE).find((c) => MUTATION_TREE[c][spec.req]);
    if (!s.genome[reqCat]?.[spec.req]) throw Object.assign(new Error('missing prerequisite: ' + spec.req), { code: 'MISSING_REQ' });
  }
  if (s.dna < spec.cost) throw Object.assign(new Error(`need ${spec.cost} DNA, have ${s.dna.toFixed(1)}`), { code: 'NOT_ENOUGH_DNA' });

  s.dna -= spec.cost;
  s.genome[category][node] = 1;
  s.mutations += 1;
  const before = s.genomeHash;
  s.genomeHash = genomeHash(s.genome);
  s.phenotype = phenotype(s.genome);

  if (node.startsWith('reshuffle') && s.phenotype.reshuffle > 0) {
    const c0 = s.cure;
    s.cure = Math.max(0, s.cure * (1 - s.phenotype.reshuffle));
    pushEvent(world, 'RESHUFFLE', { strainId, cureBefore: +c0.toFixed(2), cureAfter: +s.cure.toFixed(2), day: world.meta.day });
  }
  pushEvent(world, 'MUTATION', { strainId, category, node, cost: spec.cost, genomeHashBefore: before, genomeHashAfter: s.genomeHash, day: world.meta.day });
  return { strainId, category, node, cost: spec.cost, dnaLeft: +s.dna.toFixed(2), genomeHash: s.genomeHash, phenotype: roundPheno(s.phenotype) };
}

/** The only nodes free random mutation may grant. Everything else costs DNA. */
export const MINOR_SYMPTOMS = ['rash', 'nausea', 'sweating', 'coughing', 'diarrhoea', 'insanity'];

/** Spend DNA to remove a node (Plague Inc. "devolve"): shed severity/lethality
 *  to stay under the radar while you keep spreading. */
export function devolve(world, strainId, category, node) {
  const s = world.strains[strainId];
  if (!s) throw Object.assign(new Error('unknown strain'), { code: 'UNKNOWN_STRAIN' });
  if (!s.alive) throw Object.assign(new Error('strain extinct'), { code: 'STRAIN_EXTINCT' });
  if (!MUTATION_TREE[category]?.[node]) throw Object.assign(new Error('unknown mutation'), { code: 'UNKNOWN_MUTATION' });
  if (!s.genome[category][node]) throw Object.assign(new Error('not owned'), { code: 'NOT_OWNED' });
  // Blocking devolve: cannot drop a prerequisite something else depends on.
  for (const cat of Object.keys(MUTATION_TREE)) {
    for (const n of Object.keys(MUTATION_TREE[cat])) {
      if (MUTATION_TREE[cat][n].req === node && s.genome[cat][n]) {
        throw Object.assign(new Error(`blocked: ${n} requires ${node}`), { code: 'REQ_HELD' });
      }
    }
  }
  const cost = DEVOLVE_COST;
  if (s.dna < cost) throw Object.assign(new Error(`need ${cost} DNA to devolve, have ${s.dna.toFixed(1)}`), { code: 'NOT_ENOUGH_DNA' });
  s.dna -= cost;
  s.genome[category][node] = 0;
  const before = s.genomeHash;
  s.genomeHash = genomeHash(s.genome); s.phenotype = phenotype(s.genome);
  pushEvent(world, 'DEVOLVE', { strainId, category, node, cost, genomeHashBefore: before, genomeHashAfter: s.genomeHash, day: world.meta.day });
  return { strainId, category, node, cost, dnaLeft: +s.dna.toFixed(2), genomeHash: s.genomeHash, phenotype: roundPheno(s.phenotype) };
}
export const DEVOLVE_COST = 3;

function pushEvent(world, type, data) {
  world.events.push({ type, ...data });
  if (world.events.length > 5000) world.events.splice(0, world.events.length - 5000);
}

// ---------------------------------------------------------------- physics
function climatePenalty(climate, ph) {
  if (climate === 'cold') return 0.20 + 0.80 * ph.coldResist;
  if (climate === 'hot' || climate === 'arid') return 0.20 + 0.80 * ph.heatResist;
  if (climate === 'humid') return 0.90 + 0.10 * ph.heatResist;
  return 1;
}
/** beta = R0 * gamma * environment, so R0 stays interpretable. */
function betaOf(ph, country, cState) {
  const gamma = 1 / ph.infectiousDays;
  return ph.R0 * gamma * climatePenalty(country.climate, ph) * (0.65 + country.density * 0.70) * (1 - 0.60 * cState.lockdown);
}

export function tick(world, days = 1) {
  if (world.meta.ended) return { days: 0, events: [], rows: [], note: 'world already ended' };
  const evMark = world.events.length, rows = [];
  for (let i = 0; i < days; i++) {
    if (world.meta.ended) break;
    stepDay(world);
    rows.push(snapshotRow(world));
    if (checkEnd(world)) break;
  }
  world.telemetry.push(...rows);
  if (world.telemetry.length > 5000) world.telemetry.splice(0, world.telemetry.length - 5000);
  return { days: rows.length, events: world.events.slice(evMark), rows };
}

function stepDay(world) {
  world.meta.day += 1;
  const day = world.meta.day;
  const rng = makeRng(world.meta.seed, day);
  const strainIds = Object.keys(world.strains).filter((s) => world.strains[s].alive);

  // ---- within-country dynamics; strains compete for one shared S pool
  for (const c of world.countries) {
    let alive = c.S;
    for (const s of strainIds) { const k = c.strains[s]; if (k) alive += k.E + k.I + k.R; }
    if (alive <= 0) continue;

    const lambdas = {}; let totalLambda = 0;
    for (const s of strainIds) {
      const k = c.strains[s]; if (!k || k.I <= 0) continue;
      const ph = world.strains[s].phenotype;
      lambdas[s] = betaOf(ph, c, c) * (k.I / alive);
      totalLambda += lambdas[s];
    }

    if (totalLambda > 0 && c.S > 0) {
      let newE = c.S * (1 - Math.exp(-totalLambda));
      if (newE > c.S) newE = c.S;
      c.S -= newE;
      for (const s of Object.keys(lambdas)) {
        const share = newE * (lambdas[s] / totalLambda);
        if (!c.strains[s]) c.strains[s] = { E: 0, I: 0, R: 0, D: 0 };
        c.strains[s].E += share;
        const st = world.strains[s];
        st.stats.infections += share;
        // DNA scales with log of absolute new infections (people)
        st.dna = Math.min(120, st.dna + Math.log10(1 + share * 1e6) * 0.04);
        st.totalDnaEarned += Math.log10(1 + share * 1e6) * 0.04;
        if (c.firstInfectedDay === null) c.firstInfectedDay = day;
        if (!c.detected && rng() < Math.min(0.5, (c.strains[s].I * 1e6 / 2e5) * st.phenotype.severity * 0.9)) {
          c.detected = true;
          pushEvent(world, 'DETECTED', { country: c.name, strainId: s, day });
        }
      }
    }

    // E -> I -> R / D
    for (const s of strainIds) {
      const k = c.strains[s]; if (!k) continue;
      const st = world.strains[s], ph = st.phenotype;
      const toI = k.E * Math.min(1, 1 / ph.incubationDays);
      k.E -= toI; k.I += toI;
      const gamma = Math.min(0.9, 1 / ph.infectiousDays);
      const died = k.I * gamma * ph.cfr;
      const rec = k.I * gamma * (1 - ph.cfr);
      k.I = Math.max(0, k.I - died - rec);
      k.R += rec; k.D += died;
      st.stats.deaths += died; st.stats.recoveries += rec;
      if (k.I > st.stats.peakInfected) st.stats.peakInfected = k.I;
    }

    // detection / alert / government response
    let infectedNow = 0;
    for (const s of strainIds) infectedNow += (c.strains[s]?.I || 0);
    const prevalence = alive > 0 ? infectedNow / alive : 0;
    const sevMax = strainIds.reduce((m, s) => Math.max(m, world.strains[s].phenotype.severity), 0);
    const targetAlert = Math.min(1, prevalence * 30 * (c.detected ? 1 : 0.12) * (0.35 + sevMax) + (c.detected ? 0.12 : 0));
    c.alert += (targetAlert - c.alert) * (0.18 + c.wealth * 0.30);
    const targetClosure = c.alert > 0.20 ? Math.min(1, (c.alert - 0.10) * (0.5 + c.wealth)) : 0;
    if (targetClosure > 0.5 && c.closedDay === null) {
      c.closedDay = day;
      pushEvent(world, 'BORDERS_CLOSED', { country: c.name, day, alert: +c.alert.toFixed(3) });
    }
    c.closure += (targetClosure - c.closure) * 0.25;
    const targetLock = c.alert > 0.42 ? Math.min(1, (c.alert - 0.32) * (0.4 + c.wealth)) : 0;
    c.lockdown += (targetLock - c.lockdown) * 0.20;
  }

  // ---- cross-border seeding (land > air > sea), damped by closures
  for (const ca of world.countries) {
    const routes = [...ca.land.map((n) => [n, 0.012, 'land']), ...ca.air.map((n) => [n, 0.008, 'air']), ...ca.sea.map((n) => [n, 0.005, 'sea'])];
    for (const [nid, k, via] of routes) {
      const cb = world.countries[nid];
      if (cb.S <= 0) continue;
      const damp = (1 - ca.closure) * (1 - cb.closure) * (0.35 + ca.openness * 0.4) * (0.35 + cb.openness * 0.4);
      for (const s of strainIds) {
        const ka = ca.strains[s]; if (!ka || ka.I <= 0) continue;
        const moved = Math.min(cb.S, ka.I * k * damp * (0.4 + rng() * 1.2));
        if (moved <= 1e-9) continue;
        // Establishment check: a handful of travellers usually fizzles. This is what
        // makes country-by-country spread a real strategic phase instead of instant.
        const establishP = Math.min(1, (moved * 1e6) / 40);
        if (rng() > establishP) continue;
        if (!cb.strains[s]) cb.strains[s] = { E: 0, I: 0, R: 0, D: 0 };
        cb.strains[s].E += moved;
        const st = world.strains[s];
        st.stats.infections += moved;
        st.dna = Math.min(120, st.dna + Math.log10(1 + moved * 1e6) * 0.05);
        if (cb.firstInfectedDay === null) {
          cb.firstInfectedDay = day;
          pushEvent(world, 'COUNTRY_INFECTED', { country: cb.name, strainId: s, day, via });
        }
      }
    }
  }
  for (const s of strainIds) {
    world.strains[s].stats.countriesReached = world.countries.filter((x) => {
      const k = x.strains[s]; return k && (k.E + k.I + k.R + k.D) > 1e-9;
    }).length;
  }

  // ---- cure research, per strain. Only detected infections yield samples.
  for (const s of strainIds) {
    const st = world.strains[s];
    let research = 0;
    for (const c of world.countries) {
      const k = c.strains[s]; if (!k) continue;
      const people = (k.E + k.I) * 1e6;
      // Once a strain has been sequenced, stored sample material keeps fuelling
      // research even after cases collapse. Without this the cure stalls and the
      // world never ends. 2% of cumulative infections stay available as samples.
      const sampleBase = Math.max(people, st.stats.infections * 1e6 * 0.02);
      if (sampleBase < 1) continue;
      const samples = Math.min(1, Math.log10(1 + sampleBase) / 7.5);
      research += c.wealth * (0.20 + c.alert * 0.80) * samples * 0.0018;
    }
    // Sequenced-and-in-Development floor: >50M cumulative cases means vaccine work
    // continues regardless of current prevalence.
    if (st.stats.infections > 50) research = Math.max(research, 0.0045);
    research *= (1 - st.phenotype.cureResist);
    if (st.cure > 35) research *= 1.35;                    // momentum after a candidate
    st.cure = Math.min(100, st.cure + research * 100);
    if (st.cure >= 100 && !st.cureComplete) {
      st.cureComplete = true; st.curedDay = day;
      pushEvent(world, 'CURE_COMPLETE', { strainId: s, name: st.name, day });
    }
    if (st.cureComplete) {                                // roll-out
      for (const c of world.countries) {
        const k = c.strains[s]; if (!k) continue;
        const v = c.S * 0.022; c.S -= v; k.R += v;
        k.I *= 0.88; k.E *= 0.84; st.stats.recoveries += v;
      }
    }
  }

  // ---- random mutation (one roll per strain per day).
  // Deliberately restricted to MINOR symptoms: the powerful nodes must be bought
  // with DNA, otherwise free mutation makes the whole economy pointless.
  for (const s of strainIds) {
    const st = world.strains[s];
    if (rng() >= st.phenotype.mutationRate) continue;
    const opts = MINOR_SYMPTOMS.filter((n) => !st.genome.symptoms[n]);
    if (!opts.length) continue;
    const pick = opts[Math.floor(rng() * opts.length)];
    st.genome.symptoms[pick] = 1; st.mutations += 1;
    st.genomeHash = genomeHash(st.genome); st.phenotype = phenotype(st.genome);
    pushEvent(world, 'RANDOM_MUTATION', { strainId: s, category: 'symptoms', node: pick, day });
  }

  // ---- extinction
  for (const s of strainIds) {
    const st = world.strains[s];
    let live = 0;
    for (const c of world.countries) { const k = c.strains[s]; if (k) live += k.E + k.I; }
    if (live < 1e-5 && st.alive) {   // fewer than ~10 infectious people left
      st.alive = false; st.extinctDay = day;
      pushEvent(world, 'STRAIN_EXTINCT', { strainId: s, name: st.name, day, cured: st.cureComplete, deaths: +st.stats.deaths.toFixed(2) });
    }
  }
}

function snapshotRow(world) {
  let S = 0, E = 0, I = 0, R = 0, D = 0;
  for (const c of world.countries) {
    S += c.S;
    for (const k of Object.values(c.strains)) { E += k.E; I += k.I; R += k.R; D += k.D; }
  }
  return {
    day: world.meta.day,
    S: +S.toFixed(2), E: +E.toFixed(3), I: +I.toFixed(3), R: +R.toFixed(2), D: +D.toFixed(3),
    infectedCountries: world.countries.filter((c) => c.firstInfectedDay !== null).length,
    closedBorders: world.countries.filter((c) => c.closedDay !== null).length,
    strains: Object.values(world.strains).map((s) => ({
      id: s.id, name: s.name, alive: s.alive, cure: +s.cure.toFixed(2), dna: +s.dna.toFixed(1),
      deaths: +s.stats.deaths.toFixed(3), infections: +s.stats.infections.toFixed(1), countries: s.stats.countriesReached,
    })),
  };
}

function checkEnd(world) {
  if (Object.keys(world.strains).length === 0) return false;
  let D = 0;
  for (const c of world.countries) for (const k of Object.values(c.strains)) D += k.D;
  if (D / world.meta.initialPopulation >= 0.85) {
    world.meta.ended = true;
    world.meta.outcome = { winner: 'PATHOGEN', reason: 'humanity collapsed', deaths: +D.toFixed(1), day: world.meta.day };
    pushEvent(world, 'END', { ...world.meta.outcome });
    return true;
  }
  const alive = Object.values(world.strains).filter((s) => s.alive);
  if (alive.length === 0) {
    world.meta.ended = true;
    world.meta.outcome = { winner: 'HUMANITY', reason: 'all strains contained', deaths: +D.toFixed(2), day: world.meta.day };
    pushEvent(world, 'END', { ...world.meta.outcome });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- outputs
/** Keccak commitment over the whole world state (quantised so floats round-trip). */
export function worldRoot(world) {
  const q = (v, d = 4) => BigInt(Math.round(Number(v) * 10 ** d));
  const parts = ['PP_ROOT_V1', world.meta.seed, BigInt(world.meta.day)];
  const sids = Object.keys(world.strains).sort();
  for (const c of world.countries) {
    parts.push(BigInt(c.id), q(c.S, 3), q(c.alert, 6), q(c.closure, 6), q(c.lockdown, 6));
    for (const s of sids) {
      const k = c.strains[s];
      parts.push(q(k?.E || 0, 3), q(k?.I || 0, 3), q(k?.R || 0, 3), q(k?.D || 0, 3));
    }
  }
  for (const s of sids) {
    const st = world.strains[s];
    parts.push(q(st.cure, 4), q(st.dna, 4), st.alive ? 1n : 0n, st.genomeHash);
  }
  return toHex(hashConcat(...parts));
}

function roundPheno(p) { const o = {}; for (const k of Object.keys(p)) o[k] = +Number(p[k]).toFixed(5); return o; }
export function strainScore(s) {
  return +(s.stats.deaths * 1.0 + s.stats.infections * 0.05 + s.stats.countriesReached * 10 + (s.cureComplete ? -300 : 0) + (s.alive ? 50 : 0)).toFixed(2);
}

export function summary(world) {
  const row = snapshotRow(world);
  return {
    id: world.meta.id, name: world.meta.name, version: world.meta.version,
    day: row.day, ended: world.meta.ended, outcome: world.meta.outcome,
    population: { initial: world.meta.initialPopulation, susceptible: row.S, exposed: row.E, infected: row.I, recovered: row.R, dead: row.D },
    infectedCountries: row.infectedCountries, totalCountries: world.countries.length, closedBorders: row.closedBorders,
    strains: Object.values(world.strains).map((s) => ({
      id: s.id, name: s.name, owner: s.owner, alive: s.alive,
      releasedDay: s.releasedDay, originCountry: world.countries[s.originCountry]?.name,
      dna: +s.dna.toFixed(2), mutations: s.mutations,
      cure: +s.cure.toFixed(2), cureComplete: s.cureComplete,
      genomeHash: s.genomeHash, genome: s.genome, phenotype: roundPheno(s.phenotype),
      stats: { infections: +s.stats.infections.toFixed(1), deaths: +s.stats.deaths.toFixed(3), recoveries: +s.stats.recoveries.toFixed(1), countriesReached: s.stats.countriesReached, peakInfectedM: +s.stats.peakInfected.toFixed(3) },
      score: strainScore(s),
    })).sort((a, b) => b.score - a.score),
    worldRoot: worldRoot(world),
  };
}

export function countryIntel(world, countryId) {
  const c = world.countries[countryId];
  if (!c) throw Object.assign(new Error('bad countryId'), { code: 'BAD_COUNTRY' });
  let alive = c.S;
  for (const k of Object.values(c.strains)) alive += k.E + k.I + k.R;
  return {
    id: c.id, name: c.name, day: world.meta.day,
    population: +c.pop.toFixed(2), alive: +alive.toFixed(2), susceptible: +c.S.toFixed(2),
    climate: c.climate, density: c.density, wealth: c.wealth, openness: c.openness,
    links: { land: c.land.map((i) => world.countries[i].name), sea: c.sea.map((i) => world.countries[i].name), air: c.air.map((i) => world.countries[i].name) },
    response: { alert: +c.alert.toFixed(4), borderClosure: +c.closure.toFixed(4), lockdown: +c.lockdown.toFixed(4), detected: c.detected, firstInfectedDay: c.firstInfectedDay, closedDay: c.closedDay },
    strains: Object.keys(c.strains).map((s) => {
      const k = c.strains[s];
      return { strainId: s, name: world.strains[s]?.name, exposed: +k.E.toFixed(4), infected: +k.I.toFixed(4), recovered: +k.R.toFixed(3), dead: +k.D.toFixed(3), prevalence: alive > 0 ? +(k.I / alive).toFixed(6) : 0 };
    }),
  };
}

export function leaderboard(world) {
  return Object.values(world.strains).map((s) => ({
    strainId: s.id, name: s.name, owner: s.owner, alive: s.alive, score: strainScore(s),
    deaths: +s.stats.deaths.toFixed(3), infections: +s.stats.infections.toFixed(1),
    countries: s.stats.countriesReached, cure: +s.cure.toFixed(2), mutations: s.mutations,
    genomeHash: s.genomeHash, R0: +s.phenotype.R0.toFixed(3), cfr: +s.phenotype.cfr.toFixed(4),
  })).sort((a, b) => b.score - a.score);
}

export function receipt(world, action, payload) {
  const root = worldRoot(world);
  return {
    worldId: world.meta.id, day: world.meta.day, action, worldRoot: root,
    receiptHash: toHex(hashConcat('PP_RECEIPT_V1', world.meta.seed, BigInt(world.meta.day), action, JSON.stringify(payload), root)),
    payload,
  };
}
