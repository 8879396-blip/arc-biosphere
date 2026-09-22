// Grab a paid map.svg through the real x402 402-handshake. Usage:
//   node tools/grab-map.js [baseUrl] [worldId] [outFile]
const BASE = process.argv[2] || 'http://localhost:4025';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const ws = await (await fetch(BASE + '/api/worlds')).json();
const id = process.argv[3] || (ws.worlds.find((w) => !w.ended) || ws.worlds[0])?.id;
if (!id) { console.log('no worlds at ' + BASE); process.exit(1); }
const url = `${BASE}/api/worlds/${id}/map.svg`;
let res = await fetch(url);
if (res.status !== 402) { console.log('expected 402, got ' + res.status); process.exit(1); }
const pr = JSON.parse(Buffer.from(res.headers.get('payment-required'), 'base64').toString('utf8'));
const req = pr.accepts[0];
console.log('402 received. scheme=' + req.scheme + ' network=' + req.network + ' amount=' + req.amount + ' atomic USDC ($' + (Number(req.amount) / 1e6) + ')');
res = await fetch(url, { headers: { 'payment-signature': b64({ x402Version: 2, scheme: 'mock', payload: { amount: req.amount, payer: '0xMAPBUYER0000000000000000000000000000001', network: req.network, asset: req.asset, payTo: req.payTo, nonce: 1 } }) } });
console.log('after payment: HTTP ' + res.status + ' ' + res.headers.get('content-type'));
const pr2 = res.headers.get('payment-response');
if (pr2) console.log('PAYMENT-RESPONSE: ' + JSON.stringify(JSON.parse(Buffer.from(pr2, 'base64').toString('utf8'))));
const svg = await res.text();
const out = process.argv[4] || 'sample-map.svg';
const fs = await import('node:fs/promises');
await fs.writeFile(out, svg);
console.log('wrote ' + out + ' (' + svg.length + ' bytes)');
