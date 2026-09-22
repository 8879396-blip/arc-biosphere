import { createBiosphere, step, state, creditExternalCall, NICHES } from '../src/life.js';

// Does REAL money from outside steer evolution? Run a baseline, then inject a
// sustained stream of paid x402 calls into ONE niche and watch it respond.
const TARGET = process.argv[2] || 'entropy';
const bio = createBiosphere({ seed: '0x' + 'c0'.repeat(32), name: 'STEER TEST', founders: 40 });

const show = (label) => {
  const s = state(bio);
  console.log('\n' + label + '  (tick ' + s.tick + ', pop ' + s.population + ', gen ' + s.maxGeneration + ')');
  console.log('  niche       pop | meanPrice  | quality | speed | effic | revenue/tick');
  for (const n of NICHES) {
    const x = s.niches[n.key];
    const mark = n.key === TARGET ? '  <== EXTERNAL DEMAND' : '';
    console.log('  ' + n.key.padEnd(10) + String(x.population).padStart(4) + ' | ' +
      (x.meanPrice ? ('$' + x.meanPrice.toFixed(6)).padEnd(11) : '    —      ') + '| ' +
      String(x.meanQuality || 0).padStart(7) + ' | ' + String(x.meanSpeed || 0).padStart(5) + ' | ' +
      String(x.meanEfficiency || 0).padStart(5) + ' | ' + String(x.revenue || 0).padStart(11) + mark);
  }
  return s;
};

step(bio, 900);
const before = show('=== BASELINE (900 ticks, no external demand) ===');
const bPop = before.niches[TARGET].population, bPrice = before.niches[TARGET].meanPrice;

// Now: an external agent starts hammering ONE niche with real paid x402 calls.
// 40 calls/tick at $0.02 each = $0.80/tick of REAL revenue into that niche.
console.log(`\n>>> injecting 40 real x402 calls/tick @ $0.02 into "${TARGET}" for 500 ticks (=$400 total)`);
let injected = 0;
for (let i = 0; i < 500; i++) {
  for (let k = 0; k < 8; k++) {
    creditExternalCall(bio, TARGET, { revenue: 0.02, calls: 5, buyer: '0xEXTERNAL' + (k % 3), txHash: '0xtx' + i + '_' + k });
    injected += 0.02 * 5;
  }
  step(bio, 1);
}
const after = show(`=== AFTER 500 TICKS OF EXTERNAL DEMAND ($${injected.toFixed(0)} injected) ===`);
const aPop = after.niches[TARGET].population, aPrice = after.niches[TARGET].meanPrice;

console.log('\n=== RESPONSE ===');
console.log(`  ${TARGET} population : ${bPop} -> ${aPop}   (${aPop >= bPop ? '+' : ''}${aPop - bPop}, ${bPop ? ((aPop / bPop - 1) * 100).toFixed(0) + '%' : 'n/a'})`);
console.log(`  ${TARGET} mean price : $${(bPrice || 0).toFixed(6)} -> $${(aPrice || 0).toFixed(6)}`);
console.log(`  external calls       : ${bio.counters.externalCalls}`);
console.log(`  external revenue     : $${bio.counters.externalRevenue.toFixed(2)}`);
console.log(`  total population     : ${before.population} -> ${after.population}`);
console.log(`  generations          : ${before.maxGeneration} -> ${after.maxGeneration}`);
const targetOrgs = [...bio.organisms.values()].filter((o) => o.genome.niche === NICHES.find((n) => n.key === TARGET).id);
if (targetOrgs.length) {
  const mean = (f) => targetOrgs.reduce((a, o) => a + f(o), 0) / targetOrgs.length;
  console.log(`  ${TARGET} mean traits  : quality=${mean((o) => o.genome.quality).toFixed(3)} speed=${mean((o) => o.genome.speed).toFixed(3)} efficiency=${mean((o) => o.genome.efficiency).toFixed(3)} mutRate=${mean((o) => o.genome.mutRate).toFixed(4)}`);
  console.log(`  ${TARGET} mean energy  : $${mean((o) => o.energy).toFixed(4)}  vs biosphere mean $${after.meanEnergy}`);
}
console.log('');
