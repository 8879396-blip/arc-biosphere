// ============================================================================
//  PANDEMIC PROTOCOL — x402 paywalled API server (zero dependencies)
//  node src/server.js
// ============================================================================
import http from 'node:http';
import {
  configFromEnv, paid, json, PRICES, FREE_ROUTES, NETWORKS, USDC_ARC, usdToAtomic, mockLedger,
} from './x402.js';
import * as store from './store.js';
import { LLMS_FULL, OPENAPI, HTML_HOME } from './content.js';
import {
  createWorld, registerStrain, tick, mutate, devolve, summary, countryIntel, leaderboard,
  receipt, COUNTRIES, MUTATION_TREE, phenotype, emptyGenome, VERSION, DEVOLVE_COST,
} from './sim.js';

const cfg = configFromEnv();
const PORT = Number(process.env.PORT || 4020);
const receiptsByWorld = new Map();

// ---------------------------------------------------------------- helpers
const ok = (body, headers) => json(body, 200, headers);
const bad = (msg, code, status = 400) => json({ error: msg, code }, status);
function remember(world, action, payload) {
  const r = receipt(world, action, payload);
  const arr = receiptsByWorld.get(world.meta.id) || [];
  arr.push(r); if (arr.length > 500) arr.shift();
  receiptsByWorld.set(world.meta.id, arr);
  return r;
}
async function readBody(req) {
  if (!req.bodyRaw) return {};
  try { return JSON.parse(req.bodyRaw); } catch { return {}; }
}
async function needWorld(id) {
  const w = await store.load(id);
  if (!w) throw Object.assign(new Error('unknown world: ' + id), { code: 'UNKNOWN_WORLD', status: 404 });
  return w;
}
function svgMap(w) {
  const cols = 5, cell = 150, pad = 8;
  const W = cols * cell, H = Math.ceil(COUNTRIES.length / cols) * (cell * 0.62);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 54}" viewBox="0 0 ${W} ${H + 54}">`,
    `<rect width="${W}" height="${H + 54}" fill="#0b0e14"/>`,
    `<text x="12" y="24" fill="#8be9fd" font-family="monospace" font-size="15">PANDEMIC PROTOCOL — ${esc(w.meta.name)} · day ${w.meta.day}${w.meta.ended ? ' · ENDED' : ''}</text>`];
  COUNTRIES.forEach((c, i) => {
    const st = w.countries[i];
    let alive = st.S; for (const k of Object.values(st.strains)) alive += k.E + k.I + k.R;
    let inf = 0, dead = 0;
    for (const k of Object.values(st.strains)) { inf += k.I + k.E; dead += k.D; }
    const prev = alive > 0 ? inf / alive : 0;
    const deathRate = c.pop > 0 ? dead / c.pop : 0;
    // Colour by CUMULATIVE attack rate (ever infected / population), not current
    // prevalence, so the map still tells the story after the peak has passed.
    const attack = c.pop > 0 ? (c.pop - st.S) / c.pop : 0;
    const fill = attack < 1e-6 ? '#1b2430' : attack < 0.02 ? '#2d5a3d' : attack < 0.20 ? '#7a6a1f' : attack < 0.60 ? '#a8541c' : '#c62828';
    const x = (i % cols) * cell + pad, y = Math.floor(i / cols) * (cell * 0.62) + 38;
    const wBox = cell - pad * 2, hBox = cell * 0.62 - pad * 2;
    parts.push(`<rect x="${x}" y="${y}" width="${wBox}" height="${hBox}" rx="6" fill="${fill}" stroke="${st.closure > 0.5 ? '#f8f8f2' : '#2a3441'}" stroke-width="${st.closure > 0.5 ? 2 : 1}"/>`);
    parts.push(`<text x="${x + 7}" y="${y + 17}" fill="#f8f8f2" font-family="monospace" font-size="11">${esc(c.name)}</text>`);
    parts.push(`<text x="${x + 7}" y="${y + 32}" fill="#cbd5e1" font-family="monospace" font-size="9">attacked ${(attack * 100).toFixed(1)}%  now ${(prev * 100).toFixed(prev < 0.01 ? 4 : 1)}%</text>`);
    parts.push(`<text x="${x + 7}" y="${y + 45}" fill="#8be9fd" font-family="monospace" font-size="9">dead ${(deathRate * 100).toFixed(2)}%  alert ${(st.alert * 100).toFixed(0)}%</text>`);
    if (st.closure > 0.5) parts.push(`<text x="${x + wBox - 30}" y="${y + 17}" fill="#f8f8f2" font-family="monospace" font-size="11">LOCK</text>`);
  });
  const strains = Object.values(w.strains);
  parts.push(`<text x="12" y="${H + 42}" fill="#bd93f9" font-family="monospace" font-size="11">${strains.map((s) => `${esc(s.name)}: cure ${s.cure.toFixed(0)}% dead ${s.stats.deaths.toFixed(1)}M ${s.alive ? 'ACTIVE' : 'extinct'}`).join('   |   ') || 'no strains released'}</text>`);
  parts.push('</svg>');
  return parts.join('');
}
const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

// ---------------------------------------------------------------- free routes
const FREE = {
  'GET /api/meta': () => ok({
    name: 'Pandemic Protocol', version: VERSION, x402Version: 2,
    network: cfg.net, facilitatorMode: cfg.facilitatorMode, sellerAddress: cfg.sellerAddress,
    usdc: { asset: USDC_ARC, decimals: 6, note: 'x402 amounts use the 6-decimal ERC-20 view. Arc native USDC is 18 decimals — never mix them.' },
    endpoints: { paid: Object.keys(PRICES), free: FREE_ROUTES },
    docs: { llms: '/llms-full.txt', openapi: '/openapi.yaml', aiJson: '/.well-known/ai.json', spec: '/api/spec' },
  }),

  'GET /api/prices': () => ok({
    asset: 'USDC', network: cfg.net.caip2, decimals: 6,
    note: 'Each price is one atomic x402 payment. Circle Gateway batches settlements on-chain, so sub-cent prices are viable.',
    routes: Object.entries(PRICES).map(([k, v]) => ({
      route: k, priceUSD: v.usd, atomicUSDC: usdToAtomic(v.usd), description: v.desc,
      ...(v.perDay ? { perExtraDayUSD: v.perDay } : {}),
    })),
    free: FREE_ROUTES,
  }),

  'GET /api/spec': () => ok({
    name: 'Pandemic Protocol', version: VERSION,
    concept: 'Plague Inc.-style pandemic wargame sold as an x402 paywalled API. Agents release and evolve a pathogen against a researching humanity; several agents can compete in one shared world.',
    units: { population: 'millions', time: 'days', dna: 'points' },
    model: {
      type: 'multi-strain SEIR, frequency dependent',
      R0: 'beta/gamma; beta = R0 * gamma * climatePenalty * (0.65+density*0.70) * (1-0.60*lockdown)',
      forceOfInfection: 'lambda_s = beta_s * I_s / alive ; strains share one susceptible pool (competitive exclusion)',
      newExposed: 'S * (1 - exp(-sum(lambda_s))) allocated pro-rata by lambda',
      cure: 'per strain; sum over infected countries of wealth * (0.20+0.80*alert) * log10(1+people)/7.5 * 0.0018 * (1-cureResist) * 100 per day',
      determinism: 'rng = keccak(worldSeed || day || counter); identical inputs give byte-identical worlds',
      verification: 'worldRoot = keccak256 commitment over the full state; every paid action returns a receipt you can recompute',
    },
    winConditions: {
      PATHOGEN: 'deaths >= 85% of the initial world population',
      HUMANITY: 'every released strain goes extinct (cured or burned out)',
    },
    mutationTree: MUTATION_TREE,
    dnaCap: 120, devolveCost: DEVOLVE_COST,
    countries: COUNTRIES.map((c) => ({ id: c.id, name: c.name, pop: c.pop, climate: c.climate, wealth: c.wealth, density: c.density, openness: c.openness, land: c.land, sea: c.sea, air: c.air })),
    emptyGenome: emptyGenome(),
    examplePhenotypes: {
      stealth: phenotype(Object.assign(emptyGenome(), { transmission: { air1: 1, water1: 1, insect1: 1 }, abilities: { coldResist1: 1, heatResist1: 1 } })),
    },
    agentPlaybook: [
      '1. GET /api/spec (free) to read the mutation tree and phenotypes.',
      '2. POST /api/worlds to create a world, or GET /api/worlds (free) to join an open one.',
      '3. POST /api/worlds/:id/strains with a genome and an origin countryId.',
      '4. Loop: POST .../tick?days=10 -> read dna -> POST .../mutate -> repeat.',
      '5. Strategy: severity buys spread but triggers detection, border closures and faster cure. Lethality kills hosts before they transmit. Cure resistance buys time.',
      '6. Watch GET .../intel/:countryId for the countries you still need to reach.',
      '7. Defender agents can POST .../cure/fund to buy cure progress directly with USDC.',
    ],
  }),

  'GET /api/worlds': async () => ok({ worlds: await store.list(), network: cfg.net.name }),

  'GET /llms.txt': () => ({
    status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: `# Pandemic Protocol\n\n> Plague Inc.-style pandemic wargame sold as an x402 paywalled API on Arc (Circle L1, USDC gas).\n\n- Full documentation: /llms-full.txt\n- Machine-readable spec (mutation tree, countries, formulas): GET /api/spec\n- Pricing: GET /api/prices\n- Network/facilitator config: GET /api/meta\n- OpenAPI: /openapi.yaml\n- Service discovery: /.well-known/ai.json\n`,
  }),

  'GET /llms-full.txt': () => ({ status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: LLMS_FULL }),

  'GET /openapi.yaml': () => ({ status: 200, headers: { 'Content-Type': 'text/yaml; charset=utf-8' }, body: OPENAPI }),

  'GET /.well-known/ai.json': () => ok({
    name: 'Pandemic Protocol', kind: 'x402-resource-server', version: VERSION,
    description: 'Plague Inc.-style deterministic pandemic simulation sold per-call over x402 on Arc.',
    payment: { protocol: 'x402', version: 2, network: cfg.net.caip2, asset: USDC_ARC, assetDecimals: 6, scheme: 'exact', settlement: 'Circle Gateway batched (gasless)' },
    endpoints: {
      spec: '/api/spec', prices: '/api/prices', worlds: '/api/worlds', meta: '/api/meta',
      paid: Object.fromEntries(Object.entries(PRICES).map(([k, v]) => [k, { usd: v.usd, desc: v.desc }])),
    },
    chain: { chainId: cfg.net.chainId, rpc: cfg.net.rpc, explorer: cfg.net.explorer, gasToken: 'USDC (18 decimals native)' },
  }),

  'GET /': () => ({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: HTML_HOME }),
};

// ---------------------------------------------------------------- paid routes
function paidRoutes() {
  const R = {};

  R['POST /api/worlds'] = paid(cfg, 'POST /api/worlds', async (ctx) => {
    const b = await readBody(ctx.req);
    const w = createWorld({ name: b.name || 'Unnamed Outbreak', seed: b.seed || null });
    await store.save(w);
    const r = remember(w, 'CREATE_WORLD', { name: w.meta.name, seed: w.meta.seed });
    return ok({ world: { id: w.meta.id, name: w.meta.name, seed: w.meta.seed, day: 0, population: w.meta.initialPopulation, countries: COUNTRIES.map((c) => ({ id: c.id, name: c.name, pop: c.pop, climate: c.climate })) }, receipt: r, payment: ctx.payment });
  });

  R['GET /api/worlds/:id'] = paid(cfg, 'GET /api/worlds/:id', async (ctx) => {
    const w = await needWorld(ctx.params.id);
    return ok({ ...summary(w), payment: ctx.payment });
  });

  R['POST /api/worlds/:id/tick'] = paid(cfg, 'POST /api/worlds/:id/tick', async (ctx) => {
    const w = await needWorld(ctx.params.id);
    const b = await readBody(ctx.req);
    let days = Math.max(1, Math.min(90, Number(b.days ?? ctx.query.get('days') ?? 1) | 0));
    const res = tick(w, days);
    await store.save(w);
    const r = remember(w, 'TICK', { days: res.days, worldRoot: w && res.rows.length ? res.rows[res.rows.length - 1] : null });
    return ok({ daysAdvanced: res.days, day: w.meta.day, ended: w.meta.ended, outcome: w.meta.outcome, latest: res.rows[res.rows.length - 1] || null, events: res.events.slice(-40), receipt: r, payment: ctx.payment });
  });

  R['POST /api/worlds/:id/strains'] = paid(cfg, 'POST /api/worlds/:id/strains', async (ctx) => {
    const w = await needWorld(ctx.params.id);
    const b = await readBody(ctx.req);
    if (!b.owner) return bad('owner (wallet address) is required', 'MISSING_OWNER');
    let sid;
    try {
      sid = registerStrain(w, { owner: b.owner, name: b.name, genome: b.genome || null, countryId: Number(b.countryId ?? 0), paid: ctx.payment?.usd != null ? String(ctx.payment.usd) : '0' });
    } catch (e) { return bad(e.message, e.code || 'BAD_REQUEST', e.code === 'WORLD_ENDED' ? 409 : 400); }
    await store.save(w);
    const st = w.strains[sid];
    const r = remember(w, 'RELEASE_STRAIN', { strainId: sid, owner: st.owner, genomeHash: st.genomeHash, countryId: st.originCountry });
    return ok({ strainId: sid, name: st.name, owner: st.owner, originCountry: w.countries[st.originCountry].name, genome: st.genome, genomeHash: st.genomeHash, phenotype: st.phenotype, dna: st.dna, receipt: r, payment: ctx.payment });
  });

  R['POST /api/worlds/:id/strains/:sid/mutate'] = paid(cfg, 'POST /api/worlds/:id/strains/:sid/mutate', async (ctx) => {
    const w = await needWorld(ctx.params.id);
    const b = await readBody(ctx.req);
    const category = b.category || ctx.params.sid2;
    let res;
    try { res = mutate(w, ctx.params.sid, b.category, b.node); }
    catch (e) { return bad(e.message, e.code || 'BAD_MUTATION', e.code === 'UNKNOWN_STRAIN' ? 404 : 409); }
    await store.save(w);
    const r = remember(w, 'MUTATE', { strainId: res.strainId, node: res.node, genomeHash: res.genomeHash });
    return ok({ ...res, receipt: r, payment: ctx.payment });
  });

  R['POST /api/worlds/:id/strains/:sid/devolve'] = paid(cfg, 'POST /api/worlds/:id/strains/:sid/devolve', async (ctx) => {
    const w = await needWorld(ctx.params.id);
    const b = await readBody(ctx.req);
    let res;
    try { res = devolve(w, ctx.params.sid, b.category, b.node); }
    catch (e) { return bad(e.message, e.code || 'BAD_DEVOLVE', e.code === 'UNKNOWN_STRAIN' ? 404 : 409); }
    await store.save(w);
    const r = remember(w, 'DEVOLVE', { strainId: res.strainId, node: res.node, genomeHash: res.genomeHash });
    return ok({ ...res, receipt: r, payment: ctx.payment });
  });

  R['GET /api/worlds/:id/intel/:countryId'] = paid(cfg, 'GET /api/worlds/:id/intel/:countryId', async (ctx) => {
    const w = await needWorld(ctx.params.id);
    let intel;
    try { intel = countryIntel(w, Number(ctx.params.countryId)); } catch (e) { return bad(e.message, e.code, 404); }
    return ok({ ...intel, payment: ctx.payment });
  });

  R['GET /api/worlds/:id/telemetry'] = paid(cfg, 'GET /api/worlds/:id/telemetry', async (ctx) => {
    const w = await needWorld(ctx.params.id);
    const from = Number(ctx.query.get('from') ?? 0), to = Number(ctx.query.get('to') ?? 1e9);
    const rows = w.telemetry.filter((r) => r.day >= from && r.day <= to);
    return ok({ worldId: w.meta.id, count: rows.length, rows, payment: ctx.payment });
  });

  R['GET /api/worlds/:id/leaderboard'] = paid(cfg, 'GET /api/worlds/:id/leaderboard', async (ctx) => {
    const w = await needWorld(ctx.params.id);
    return ok({ worldId: w.meta.id, day: w.meta.day, ended: w.meta.ended, outcome: w.meta.outcome, ranking: leaderboard(w), payment: ctx.payment });
  });

  R['GET /api/worlds/:id/events'] = paid(cfg, 'GET /api/worlds/:id/events', async (ctx) => {
    const w = await needWorld(ctx.params.id);
    const n = Math.min(500, Number(ctx.query.get('limit') ?? 100));
    const types = ctx.query.get('types') ? ctx.query.get('types').split(',') : null;
    let ev = w.events;
    if (types) ev = ev.filter((e) => types.includes(e.type));
    return ok({ worldId: w.meta.id, count: ev.length, events: ev.slice(-n), payment: ctx.payment });
  });

  R['GET /api/worlds/:id/receipts'] = paid(cfg, 'GET /api/worlds/:id/receipts', async (ctx) => {
    const w = await needWorld(ctx.params.id);
    const arr = receiptsByWorld.get(w.meta.id) || [];
    return ok({ worldId: w.meta.id, count: arr.length, receipts: arr.slice(-100), note: 'receiptHash = keccak256("PP_RECEIPT_V1" || worldSeed || day || action || payloadJSON || worldRoot). An on-chain contract can verify these.', payment: ctx.payment });
  });

  R['GET /api/worlds/:id/map.svg'] = paid(cfg, 'GET /api/worlds/:id/map.svg', async (ctx) => {
    const w = await needWorld(ctx.params.id);
    return { status: 200, headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' }, body: svgMap(w) };
  });

  // ---- DEFENDER SIDE: pay USDC to buy cure progress directly.
  // This is the two-sided market: pathogen agents and cure agents both pay.
  R['POST /api/worlds/:id/cure/fund'] = paid(cfg, 'POST /api/worlds/:id/cure/fund', async (ctx) => {
    const w = await needWorld(ctx.params.id);
    const b = await readBody(ctx.req);
    const sid = b.strainId;
    const st = w.strains[sid];
    if (!st) return bad('unknown strainId', 'UNKNOWN_STRAIN', 404);
    if (!st.alive) return bad('strain already extinct', 'STRAIN_EXTINCT', 409);
    // 1 USDC == 4.0 cure percent. The route uses the x402 `upto` scheme, so the
    // buyer declares the amount and pays exactly that. Deterministic, no rng.
    const usd = ctx.payment?.usd ?? 0;
    if (usd <= 0) return bad('zero-value payment', 'ZERO_PAYMENT');
    const gained = Math.min(100 - st.cure, usd * 4.0);
    if (gained <= 0) return bad('cure already at 100%', 'CURE_COMPLETE', 409);
    st.cure = Math.min(100, st.cure + gained);
    if (st.cure >= 100 && !st.cureComplete) { st.cureComplete = true; st.curedDay = w.meta.day; }
    w.events.push({ type: 'CURE_FUNDED', strainId: sid, funder: ctx.payer, usd, gained: +gained.toFixed(3), cure: +st.cure.toFixed(2), day: w.meta.day });
    await store.save(w);
    const r = remember(w, 'FUND_CURE', { strainId: sid, usd, gained: +gained.toFixed(3), cure: +st.cure.toFixed(2), funder: ctx.payer });
    return ok({ strainId: sid, fundedBy: ctx.payer, usdSpent: usd, cureGained: +gained.toFixed(3), cure: +st.cure.toFixed(2), cureComplete: st.cureComplete, receipt: r, payment: ctx.payment });
  });

  return R;
}

// ---------------------------------------------------------------- router
const PAID = paidRoutes();
function matchRoute(method, pathname) {
  for (const table of [FREE, PAID]) {
    for (const pattern of Object.keys(table)) {
      const [m, p] = pattern.split(' ');
      if (m !== method) continue;
      const pp = p.split('/'), ap = pathname.split('/');
      if (pp.length !== ap.length) continue;
      const params = {}; let good = true;
      for (let i = 0; i < pp.length; i++) {
        if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(ap[i]);
        else if (pp[i] !== ap[i]) { good = false; break; }
      }
      if (good) return { handler: table[pattern], params, pattern };
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const send = (out) => {
    res.writeHead(out.status || 200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED,PAYMENT-RESPONSE,X-Price-USD', ...(out.headers || {}) });
    res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body, null, 2));
  };
  if (req.method === 'OPTIONS') return send({ status: 204, body: '' });
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    req.bodyRaw = raw;
    const m = matchRoute(req.method, u.pathname);
    if (!m) return send(json({ error: 'not found', path: u.pathname, method: req.method, hint: 'GET /api/meta for the route list' }, 404));
    const out = await m.handler({ req, params: m.params, query: u.searchParams, url: req.url, headers: req.headers });
    send(out);
  } catch (e) {
    send(json({ error: e.message, code: e.code || 'INTERNAL', status: e.status || 500 }, e.status || 500));
  }
});

await store.init();
server.listen(PORT, () => {
  console.log('');
  console.log('  PANDEMIC PROTOCOL — x402 resource server');
  console.log('  ----------------------------------------------------------');
  console.log('  http://localhost:' + PORT);
  console.log('  network      : ' + cfg.net.name + ' (' + cfg.net.caip2 + ')');
  console.log('  facilitator  : ' + cfg.facilitatorMode + (cfg.facilitatorMode === 'mock' ? '  <-- LOCAL ONLY, no real USDC moves' : ''));
  console.log('  seller       : ' + cfg.sellerAddress);
  console.log('  free routes  : ' + FREE_ROUTES.length + '   paid routes: ' + Object.keys(PRICES).length);
  console.log('  ----------------------------------------------------------');
  console.log('  try:  curl -i http://localhost:' + PORT + '/api/worlds/' + 'xxx');
  console.log('  play: node client/agent.js');
  console.log('');
});
