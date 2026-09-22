import { keccak256Hex, hashConcatHex } from './src/keccak.js';
const vectors = [
  ['', '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'],
  ['abc', '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'],
  ['hello', '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8'],
];
let ok = true;
for (const [inp, exp] of vectors) {
  const got = keccak256Hex(inp);
  const pass = got === exp;
  ok = ok && pass;
  console.log((pass ? 'PASS' : 'FAIL') + '  keccak256(' + JSON.stringify(inp) + ') = ' + got);
  if (!pass) console.log('       expected ' + exp);
}
// 200-byte input crosses the 136-byte rate boundary
const long = 'a'.repeat(200);
console.log('long input (200B) =', keccak256Hex(long).slice(0, 20) + '...');
console.log('concat           =', hashConcatHex('0x' + '11'.repeat(32), 'PoA', 5042n));
console.log(ok ? '\n>>> KECCAK-256 OK' : '\n>>> KECCAK-256 BROKEN');
