// ============================================================================
//  VERSUS demo — the two things a single-player game cannot show:
//
//   1. MULTI-AGENT COMPETITION. Two independent agents release different strains
//      into ONE shared world. Susceptibles are a single pool, so the strains
//      compete (competitive exclusion) — a real epidemiological phenomenon and
//      the reason this is an agent economy rather than a solo puzzle.
//
//   2. TWO-SIDED MARKET. A defender agent pays USDC via POST /cure/fund to buy
//      cure progress directly. Money -> game effect, no token, no governance.
//      Pathogen agents and cure agents are both paying customers.
//
//  node client/versus.js [baseUrl]
// ============================================================================
const BASE = process.argv[2] || process.env.PP_BASE || 'http://localhost:4021';
const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');

const bill = {};
function tally(route, atomic) {
  const key = route.replace(/\/0x[0-9a-fA-F]+/g, '/:id');
  bill[key] = (bill[key] || 0) + atomic / 1e6;
}

// declareUsd: for `upto` routes the buyer chooses the amount within the ceiling.
async function pay(method, path, body, payer, declareUsd) {
  const url = BASE + path;
  const hasBody = body !== undefined && method !== 'GET' && method !== 'HEAD';
  const init = { method, headers: { 'content-type': 'application/json' }, body: hasBody ? JSON.stringify(body) : undefined };
  let res = await fetch(url, init);
  if (res.status === 402) {
    const pr = JSON.parse(Buffer.from(res.headers.get('payment-required'), 'base64').toString('utf8'));
    const req = pr.accepts[0];
    const amount = req.scheme === 'upto' && declareUsd != null
      ? String(Math.round(declareUsd * 1e6))
      : req.amount;
    tally(path.split('?')[0], Number(amount));
    res = await fetch(url, { ...init, headers: { ...init.headers, 'payment-signature': b64({ x402Version: 2, scheme: 'mock', payload: { amount, payer, network: req.network, asset: req.asset, payTo: req.payTo, scheme: req.scheme, nonce: Date.now() + Math.floor(Math.random() * 1e6) } }) } });
  }
  if (!res.ok) throw new Error(method + ' ' + path + ' -> ' + res.status + ': ' + (await res.text()).slice(0, 260));
  return (res.headers.get('content-type') || '').includes('json') ? res.json() : res.text();
}

const AGENT_RED  = '0xRED0000000000000000000000000000000000AA1';
const AGENT_BLUE = '0xB1UE0000000000000000000000000000000000BB2'.replace('0xB1UE', '0xB10E');
const DEFENDER   = '0xD00000000000000000000000000000000000DEF1';

console.log('\n=== PANDEMIC PROTOCOL — VERSUS (2 pathogens + 1 defender, 1 shared world) ===\n');

const world = await pay('POST', '/api/worlds', { name: 'VERSUS ARENA', seed: '0x' + 'cd'.repeat(32) }, DEFENDER);
const wid = world.world.id;
console.log('shared world:', wid, ' pop', world.world.population + 'M\n');

const G = (t, s, a) => ({ transmission: t, symptoms: s, abilities: a });
const red = await pay('POST', `/api/worlds/${wid}/strains`, {
  owner: AGENT_RED, name: 'RED-PLAGUE', countryId: 1,          // India: dense, hot
  genome: G({ air1: 1, insect1: 1, rodent1: 1 }, { coughing: 1, sweating: 1 }, { heatResist1: 1 }),
}, AGENT_RED);
const blue = await pay('POST', `/api/worlds/${wid}/strains`, {
  owner: AGENT_BLUE, name: 'BLUE-FROST', countryId: 6,         // Russia: cold, low density
  genome: G({ air1: 1, water1: 1 }, { coughing: 1, rash: 1 }, { coldResist1: 1, coldResist2: 1, drugResist1: 1 }),
}, AGENT_BLUE);

console.log('RED  ', red.strainId, 'origin', red.originCountry.padEnd(6), 'R0', red.phenotype.R0, 'cfr', red.phenotype.cfr, 'cold/heat', red.phenotype.coldResist + '/' + red.phenotype.heatResist);
console.log('BLUE ', blue.strainId, 'origin', blue.originCountry.padEnd(6), 'R0', blue.phenotype.R0, 'cfr', blue.phenotype.cfr, 'cold/heat', blue.phenotype.coldResist + '/' + blue.phenotype.heatResist);
console.log('\nRED starts hot+dense, BLUE starts cold+sparse with drug resistance. Watch them race.\n');

console.log('day |   S(M) |  RED I(M) | BLUE I(M) | REDcure | BLUEcure | defender action');
console.log('----+--------+-----------+-----------+---------+----------+----------------');

let snap = await pay('GET', `/api/worlds/${wid}`, {}, DEFENDER);
let defenderSpend = 0, lastFund = 0;
for (let round = 0; round < 50 && !snap.ended; round++) {
  await pay('POST', `/api/worlds/${wid}/tick?days=10`, { days: 10 }, AGENT_RED);
  snap = await pay('GET', `/api/worlds/${wid}`, {}, AGENT_RED);
  const R = snap.strains.find((s) => s.id === red.strainId);
  const B = snap.strains.find((s) => s.id === blue.strainId);
  if (!R || !B) break;

  // Defender rule: pour USDC into whichever ALIVE strain is closest to a cure,
  // but only once it is past 50% so the money is not wasted early.
  let action = '';
  const alive = snap.strains.filter((s) => s.alive && s.cure > 50 && s.cure < 99.9);
  if (alive.length && snap.day - lastFund >= 20) {
    const target = alive.sort((a, b) => b.cure - a.cure)[0];
    const need = (100 - target.cure) / 4;              // USDC needed to finish it
    const spend = Math.min(0.35, Math.max(0.02, need)); // pay up to $0.35 per call
    const f = await pay('POST', `/api/worlds/${wid}/cure/fund`, { strainId: target.id }, DEFENDER, spend);
    defenderSpend += f.usdSpent; lastFund = snap.day;
    action = `funded ${target.name} $${f.usdSpent.toFixed(3)} -> +${f.cureGained.toFixed(2)}% = ${f.cure}%`;
  }

  console.log(
    String(snap.day).padStart(4) + '|' + snap.population.susceptible.toFixed(0).padStart(7) + '|' +
    String(R.stats.infections.toFixed(0)).padStart(10) + '|' + String(B.stats.infections.toFixed(0)).padStart(10) + '|' +
    String(R.cure.toFixed(0) + '%').padStart(8) + '|' + String(B.cure.toFixed(0) + '%').padStart(9) + ' | ' + action);
  if (snap.ended) break;
}

const board = await pay('GET', `/api/worlds/${wid}/leaderboard`, {}, DEFENDER);
const map = await pay('GET', `/api/worlds/${wid}/map.svg`, {}, DEFENDER);

console.log('\n=== RESULT ===');
console.log('outcome :', JSON.stringify(snap.outcome));
console.log('day     :', snap.day, ' dead', snap.population.dead.toFixed(1) + 'M of', snap.population.initial + 'M');
console.log('\nranking (cumulative infections show who won the competition for hosts):');
for (const [i, r] of board.ranking.entries()) {
  console.log(`  ${i + 1}. ${r.name.padEnd(12)} score=${String(r.score).padStart(8)}  infections=${String(r.infections.toFixed(0)).padStart(6)}M  dead=${r.deaths.toFixed(2)}M  countries=${r.countries}  cure=${r.cure}%  R0=${r.R0}  ${r.alive ? 'ACTIVE' : 'extinct'}`);
}
console.log('\nmap.svg :', typeof map === 'string' ? map.length + ' bytes' : 'n/a');
console.log('defender spent $' + defenderSpend.toFixed(4) + ' buying cure progress directly with USDC');

console.log('\n=== COMBINED BILL ===');
let tot = 0;
for (const [k, v] of Object.entries(bill).sort((a, b) => b[1] - a[1])) { console.log('  ' + k.padEnd(40) + '$' + v.toFixed(6)); tot += v; }
console.log('  ' + 'TOTAL'.padEnd(40) + '$' + tot.toFixed(6));
console.log('\n=> 3 autonomous agents, 1 shared world, $' + tot.toFixed(2) + ' of USDC micropayments, no API keys.\n');
