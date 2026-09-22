// Steer evolution with real money: buy actual services from one niche and show
// how the population responds. This is the core claim, demonstrated live.
//   node client/steer.js [baseUrl] [niche] [usdPerCall] [calls]
const BASE = process.argv[2] || process.env.PP_BASE || 'http://localhost:4030';
const NICHE = process.argv[3] || 'entropy';
const USD = Number(process.argv[4] || 0.02);
const CALLS = Number(process.argv[5] || 60);
const WALLET = process.env.BUYER_ADDRESS || '0xSTEERER000000000000000000000000000000001';
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
    res = await fetch(url, { ...init, headers: { ...init.headers, 'payment-signature': b64({ x402Version: 2, scheme: 'mock', payload: { amount, payer: WALLET, network: req.network, asset: req.asset, payTo: req.payTo, nonce: Date.now() + calls } }) } });
  }
  if (!res.ok) throw new Error(method + ' ' + path + ' -> ' + res.status + ': ' + (await res.text()).slice(0, 220));
  return (res.headers.get('content-type') || '').includes('json') ? res.json() : res.text();
}

console.log('\n=== STEERING EVOLUTION WITH REAL MONEY ===');
console.log('target niche : ' + NICHE);
console.log('plan         : ' + CALLS + ' real service purchases @ $' + USD + ' = $' + (CALLS * USD).toFixed(2) + ', interleaved with ticks\n');

const before = await pay('GET', '/api/bio/state');
const nb = before.niches[NICHE] || {};
console.log('BEFORE (tick ' + before.tick + ', global pop ' + before.population + ', gen ' + before.maxGeneration + ')');
console.log('  ' + NICHE + ': pop ' + (nb.population || 0) + '  price $' + (nb.meanPrice || 0).toFixed(6) + '  quality ' + (nb.meanQuality || 0).toFixed(3) + '  speed ' + (nb.meanSpeed || 0).toFixed(3));

const winners = {};
for (let i = 0; i < CALLS; i++) {
  const r = await pay('POST', '/api/bio/serve/' + NICHE, { params: { count: 8 } }, USD);
  if (r.servedBy) winners[r.servedBy] = (winners[r.servedBy] || 0) + 1;
  if (i % 10 === 9) {
    await pay('POST', '/api/bio/tick?ticks=8', { ticks: 8 });
    const mid = await pay('GET', '/api/bio/state');
    const x = mid.niches[NICHE] || {};
    console.log('  after ' + String(i + 1).padStart(3) + ' purchases (tick ' + mid.tick + '): ' + NICHE + ' pop ' + String(x.population || 0).padStart(3) + '  price $' + (x.meanPrice || 0).toFixed(6) + '  quality ' + (x.meanQuality || 0).toFixed(3) + '  | global pop ' + mid.population);
  }
}
await pay('POST', '/api/bio/tick?ticks=60', { ticks: 60 });
const after = await pay('GET', '/api/bio/state');
const na = after.niches[NICHE] || {};

console.log('\n=== RESPONSE ===');
console.log('  ' + NICHE + ' population : ' + (nb.population || 0) + ' -> ' + (na.population || 0));
console.log('  ' + NICHE + ' mean price  : $' + (nb.meanPrice || 0).toFixed(6) + ' -> $' + (na.meanPrice || 0).toFixed(6));
console.log('  ' + NICHE + ' quality     : ' + (nb.meanQuality || 0).toFixed(3) + ' -> ' + (na.meanQuality || 0).toFixed(3));
console.log('  ' + NICHE + ' speed       : ' + (nb.meanSpeed || 0).toFixed(3) + ' -> ' + (na.meanSpeed || 0).toFixed(3));
console.log('  global population : ' + before.population + ' -> ' + after.population);
console.log('  max generation    : ' + before.maxGeneration + ' -> ' + after.maxGeneration);
console.log('  speciations       : ' + before.counters.speciations + ' -> ' + after.counters.speciations);
console.log('  niche extinctions : ' + before.counters.extinctions + ' -> ' + after.counters.extinctions);
console.log('\n  contracts won by organism (revenue went to these genomes):');
Object.entries(winners).sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([id, n]) => console.log('    ' + id.slice(0, 20) + '…  ' + n + ' calls  $' + (n * USD).toFixed(4)));
console.log('\n  steered external calls : ' + after.counters.externalCalls);
console.log('  steered revenue        : $' + (after.counters.externalRevenue || 0).toFixed(4));
console.log('  populationRoot         : ' + after.populationRoot);
console.log('\nmy bill: ' + calls + ' paid calls, $' + spent.toFixed(6) + ' USDC\n');
