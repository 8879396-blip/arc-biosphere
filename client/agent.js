// ============================================================================
//  Demo buyer agent — plays a full pandemic autonomously and pays for every call.
//
//  Two modes (auto-detected):
//    mock     server runs PP_FACILITATOR=mock; we synthesise a payment payload
//             from the 402 `accepts` block. Zero setup, no real USDC.
//    gateway  @circle-fin/x402-batching is installed; the SDK signs a real
//             EIP-3009 authorisation and Circle Gateway settles it on Arc.
//
//  node client/agent.js [baseUrl]
// ============================================================================
const BASE = process.argv[2] || process.env.PP_BASE || 'http://localhost:4020';
const WALLET = process.env.BUYER_ADDRESS || '0xA11CE00000000000000000000000000000000001';

let GatewayClient = null;
try { ({ GatewayClient } = await import('@circle-fin/x402-batching/client')); } catch { /* mock mode */ }

let spend = { calls: 0, usd: 0, byRoute: {} };
const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');

async function call(method, path, body) {
  const url = BASE + path;
  let res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 402) {
    const prHeader = res.headers.get('payment-required');
    const requirements = prHeader
      ? JSON.parse(Buffer.from(prHeader, 'base64').toString('utf8')).accepts[0]
      : (await res.clone().json()).accepts?.[0];
    if (!requirements) throw new Error('402 without usable payment requirements on ' + path);

    const sig = GatewayClient
      ? await signWithGateway(url, requirements)
      : b64({ x402Version: 2, scheme: 'mock', payload: { amount: requirements.amount, payer: WALLET, network: requirements.network, asset: requirements.asset, payTo: requirements.payTo, nonce: Date.now() } });

    spend.calls += 1;
    spend.usd += Number(requirements.amount) / 1e6;
    const key = method + ' ' + path.split('?')[0].replace(/\/0x[0-9a-fA-F]+/g, '/:id');
    spend.byRoute[key] = (spend.byRoute[key] || 0) + Number(requirements.amount) / 1e6;

    res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', 'payment-signature': sig },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

async function signWithGateway(url, requirements) {
  // Real path: let Circle's client handle the whole handshake.
  const client = new GatewayClient({ chain: process.env.PP_CHAIN || 'arcTestnet', privateKey: process.env.BUYER_PRIVATE_KEY });
  const r = await client.pay(url);
  return r?.paymentSignature ?? b64({ x402Version: 2, scheme: 'gateway', payload: { amount: requirements.amount, payer: WALLET } });
}

// ---------------------------------------------------------------- the run
console.log('\n=== PANDEMIC PROTOCOL — autonomous buyer agent ===');
console.log('server :', BASE);
console.log('mode   :', GatewayClient ? 'gateway (real USDC)' : 'mock (no real money moves)');
console.log('wallet :', WALLET, '\n');

const spec = await call('GET', '/api/spec');
console.log(`spec loaded: ${spec.mutationTree ? Object.values(spec.mutationTree).reduce((a, c) => a + Object.keys(c).length, 0) : 0} mutation nodes, ${spec.countries.length} countries, DNA cap ${spec.dnaCap}`);

const worlds = await call('GET', '/api/worlds');
console.log(`open worlds: ${worlds.worlds.length}`);

const created = await call('POST', '/api/worlds', { name: 'Agent Run ' + new Date().toISOString().slice(0, 16) });
const wid = created.world.id;
console.log(`world created: ${wid}  seed=${created.world.seed.slice(0, 18)}…  pop=${created.world.population}M`);
console.log(`receipt: ${created.receipt.receiptHash}\n`);

// Opening build: stealth spreader. No severity yet — stay off the radar.
const genome = {
  transmission: { air1: 1, water1: 1, insect1: 1 },
  abilities: { coldResist1: 1, heatResist1: 1 },
};
const strain = await call('POST', `/api/worlds/${wid}/strains`, { owner: WALLET, name: 'AGENT-ALPHA', genome, countryId: 0 });
console.log(`strain released: ${strain.strainId}`);
console.log(`  origin=${strain.originCountry}  R0=${strain.phenotype.R0}  CFR=${strain.phenotype.cfr}  severity=${strain.phenotype.severity}  DNA=${strain.dna}`);
console.log(`  genomeHash=${strain.genomeHash}\n`);

// Buy order: what we want, in priority order, as DNA allows.
const WISHLIST = [
  ['transmission', 'air2'], ['abilities', 'drugResist1'], ['abilities', 'hardening1'],
  ['transmission', 'water2'], ['abilities', 'coldResist2'], ['abilities', 'heatResist2'],
  ['abilities', 'drugResist2'], ['abilities', 'hardening2'], ['transmission', 'rodent1'],
  ['symptoms', 'pneumonia'], ['abilities', 'hardening3'], ['symptoms', 'haemorrhage'],
];
let bought = [];

console.log('day |     S(M) |    I(M) |    D(M) | cure% |  DNA | ctry | closed | action');
console.log('----+----------+---------+---------+-------+------+------+--------+------------------');

let snap = await call('GET', `/api/worlds/${wid}`);
for (let round = 0; round < 60 && !snap.ended; round++) {
  const t = await call('POST', `/api/worlds/${wid}/tick?days=10`, { days: 10 });
  snap = await call('GET', `/api/worlds/${wid}`);
  const me = snap.strains.find((s) => s.id === strain.strainId) || snap.strains[0];
  if (!me) break;

  let action = '';
  // Spend DNA greedily on the wishlist, auto-buying prerequisites first.
  const owns = (cat, n) => bought.some((b) => b[0] === cat && b[1] === n) || me.genome?.[cat]?.[n];
  const findReq = ([cat, n]) => {
    const spec2 = spec.mutationTree[cat][n];
    if (!spec2?.req) return null;
    const rc = Object.keys(spec.mutationTree).find((k) => spec.mutationTree[k][spec2.req]);
    return owns(rc, spec2.req) ? null : [rc, spec2.req];
  };
  let dna = me.dna, acted = [];
  for (let guard = 0; guard < 3; guard++) {
    const target = WISHLIST.map((w) => [w, findReq(w)]).find(([w, r]) => !owns(w[0], w[1]))?.[0];
    if (!target) break;
    const want = findReq(target) || target;
    const cost = spec.mutationTree[want[0]][want[1]].cost;
    if (cost > dna) break;
    try {
      const r = await call('POST', `/api/worlds/${wid}/strains/${me.id}/mutate`, { category: want[0], node: want[1] });
      bought.push(want); dna = r.dnaLeft; acted.push(`+${want[1]}(${cost})`);
    } catch (e) {
      const m = e.message.match(/\{[\s\S]*\}/);
      acted.push('!' + (m ? (JSON.parse(m[0]).code || 'fail') : 'fail'));
      break;
    }
  }
  action = acted.join(' ');
  for (const ev of (t.events || []).filter((e) => ['COUNTRY_INFECTED', 'BORDERS_CLOSED', 'CURE_COMPLETE', 'DETECTED'].includes(e.type)).slice(-1)) {
    action = (action ? action + ' · ' : '') + ev.type + (ev.country ? ' ' + ev.country : '');
  }

  const p = snap.population;
  console.log(
    String(snap.day).padStart(4) + '|' + p.susceptible.toFixed(0).padStart(9) + '|' +
    p.infected.toFixed(1).padStart(8) + '|' + p.dead.toFixed(1).padStart(8) + '|' +
    String(me.cure).padStart(6) + '|' + me.dna.toFixed(0).padStart(5) + '|' +
    String(snap.infectedCountries).padStart(5) + '|' + String(snap.closedBorders).padStart(7) + ' | ' + action);

  if (snap.ended) break;
}

// Buy a bit of intel + the map to exercise the read-side economy.
const intel = await call('GET', `/api/worlds/${wid}/intel/19`);
const board = await call('GET', `/api/worlds/${wid}/leaderboard`);
const rcpts = await call('GET', `/api/worlds/${wid}/receipts`);

console.log('\n=== FINAL ===');
console.log('outcome      :', JSON.stringify(snap.outcome));
console.log('day          :', snap.day);
console.log('dead         :', snap.population.dead.toFixed(1), 'M of', snap.population.initial, 'M');
console.log('infected     :', snap.population.recovered.toFixed(0), 'M recovered/exposed');
console.log('Iceland intel:', JSON.stringify(intel.response));
console.log('leaderboard  :', board.ranking.map((r) => `${r.name} score=${r.score} dead=${r.deaths}M cure=${r.cure}%`).join(' | '));
console.log('mutations    :', bought.map((b) => b[1]).join(', ') || 'none');
console.log('worldRoot    :', snap.worldRoot);
console.log('receipts     :', rcpts.count, 'kept; last =', rcpts.receipts.at(-1)?.receiptHash);

console.log('\n=== THE BILL (x402) ===');
console.log('paid calls   :', spend.calls);
console.log('total spend  : $' + spend.usd.toFixed(6), 'USDC');
for (const [k, v] of Object.entries(spend.byRoute).sort((a, b) => b[1] - a[1])) {
  console.log('   ' + k.padEnd(42) + ' $' + v.toFixed(6));
}
console.log('\nfree calls used for discovery: GET /api/spec, GET /api/worlds');
console.log('=> a complete pandemic run cost under $' + spend.usd.toFixed(2) + ', with no API key and no account.\n');
