// Watch the biosphere: pay for state snapshots and print a live dashboard.
//   node client/watch.js [baseUrl] [rounds] [ticksPerRound]
const BASE = process.argv[2] || process.env.PP_BASE || 'http://localhost:4030';
const ROUNDS = Number(process.argv[3] || 12);
const TICKS = Number(process.argv[4] || 50);
const WALLET = process.env.BUYER_ADDRESS || '0xWATCHER000000000000000000000000000000001';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
let calls = 0, spent = 0;

async function pay(method, path, body, declareUsd) {
  const url = BASE + path;
  const hasBody = body !== undefined && method !== 'GET';
  const init = { method, headers: { 'content-type': 'application/json' }, body: hasBody ? JSON.stringify(body) : undefined };
  let res = await fetch(url, init);
  if (res.status === 402) {
    const pr = JSON.parse(Buffer.from(res.headers.get('payment-required'), 'base64').toString('utf8'));
    const req = pr.accepts[0];
    const amount = req.scheme === 'upto' && declareUsd != null ? String(Math.round(declareUsd * 1e6)) : req.amount;
    calls++; spent += Number(amount) / 1e6;
    res = await fetch(url, { ...init, headers: { ...init.headers, 'payment-signature': b64({ x402Version: 2, scheme: 'mock', payload: { amount, payer: WALLET, network: req.network, asset: req.asset, payTo: req.payTo, nonce: Date.now() } }) } });
  }
  if (!res.ok) throw new Error(method + ' ' + path + ' -> ' + res.status + ': ' + (await res.text()).slice(0, 200));
  return (res.headers.get('content-type') || '').includes('json') ? res.json() : res.text();
}

const spec = await pay('GET', '/api/bio/spec');
console.log('\n=== ' + spec.name + ' — watching ===');
console.log('thesis: ' + spec.thesis.slice(0, 120) + '…\n');
console.log('tick |  pop | gen | born | died | meanEnergy | treasury | niches (pop @ meanPrice)');
console.log('-----+------+------+------+------+------------+----------+---------------------------');
let st = await pay('GET', '/api/bio/state');
for (let i = 0; i < ROUNDS; i++) {
  await pay('POST', '/api/bio/tick?ticks=' + TICKS, { ticks: TICKS });
  st = await pay('GET', '/api/bio/state');
  const niches = Object.entries(st.niches).map(([k, v]) => `${k.slice(0, 4)}:${String(v.population).padStart(3)}@$${(v.meanPrice || 0).toFixed(5)}`).join(' ');
  const tr = st.treasury;
  console.log(
    String(st.tick).padStart(5) + '|' + String(st.population).padStart(6) + '|' + String(st.maxGeneration).padStart(6) + '|' +
    String(st.counters.born).padStart(6) + '|' + String(st.counters.died).padStart(6) + '|' +
    String(st.meanEnergy).padStart(12) + '|' + (tr.birthFees + tr.platformFees).toFixed(2).padStart(10) + '| ' + niches);
}
const fos = await pay('GET', '/api/bio/fossils?limit=1');
console.log('\ndeath causes :', JSON.stringify(fos.causes), ' age at death', JSON.stringify(fos.ageAtDeath));
console.log('speciations  :', st.counters.speciations, ' niche extinctions:', st.counters.extinctions);
console.log('external     :', st.counters.externalCalls, 'real calls, $' + (st.counters.externalRevenue || 0).toFixed(4));
console.log('popRoot      :', st.populationRoot);
console.log('\nwatcher bill : ' + calls + ' paid calls, $' + spent.toFixed(6) + ' USDC\n');
