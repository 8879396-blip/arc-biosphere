import { createBiosphere, step, state, NICHES } from '../src/life.js';

const TICKS = Number(process.argv[2] || 3000);
const SEED = process.argv[3] || '0x' + 'be'.repeat(32);
const bio = createBiosphere({ seed: SEED, name: 'EVO RUN', founders: 40 });

console.log(`\n=== BIOSPHERE — autonomous evolution run ===`);
console.log(`seed ${SEED.slice(0, 14)}…  founders 40  ticks ${TICKS}\n`);
console.log('tick |  pop | gen | births | deaths | energy/tick | treasury | mean mutRate | niche populations');
console.log('-----+------+-----+--------+--------+-------------+----------+--------------+------------------');

let last = null;
for (let i = 0; i < TICKS; i++) {
  const rows = step(bio, 1);
  const r = rows[0];
  if (!r) break;
  last = r;
  if (i % 200 === 199 || i === TICKS - 1) {
    const np = NICHES.map((n) => (r.niches[n.key]?.population ?? 0).toString().padStart(3)).join(' ');
    console.log(
      String(r.tick).padStart(5) + '|' + String(r.population).padStart(6) + '|' +
      String(r.maxGeneration).padStart(5) + '|' + String(r.births).padStart(8) + '|' +
      String(r.deaths).padStart(8) + '|' + String(r.meanEnergy).padStart(13) + '|' +
      String(r.treasury.birthFees + r.treasury.platformFees).padStart(8) + '|' +
      String(r.meanMutRate).padStart(14) + '| ' + np);
  }
  if (r.population === 0) { console.log('\n*** TOTAL EXTINCTION at tick ' + r.tick + ' ***'); break; }
}

const s = state(bio);
console.log('\n=== EMERGENT MARKET (mean genome per niche) ===');
console.log('niche        pop | meanPrice  | quality | speed | effic | mutRate | demand | revenue/tick');
console.log('------------+-----+------------+---------+-------+-------+---------+--------+-------------');
for (const n of NICHES) {
  const x = s.niches[n.key];
  console.log(n.key.padEnd(11) + String(x.population).padStart(4) + ' | ' +
    (x.meanPrice ? ('$' + x.meanPrice.toFixed(6)).padEnd(11) : '    —      ') + '| ' +
    String(x.meanQuality || 0).padStart(7) + ' | ' + String(x.meanSpeed || 0).padStart(5) + ' | ' +
    String(x.meanEfficiency || 0).padStart(5) + ' | ' + String(x.meanMutRate || 0).padStart(7) + ' | ' +
    String(x.demand).padStart(6) + ' | ' + String(x.revenue || 0).padStart(11));
}

console.log('\n=== COUNTERS ===');
console.log(JSON.stringify(s.counters, null, 1));
console.log('treasury  :', JSON.stringify(s.treasury));
console.log('population:', s.population, ' maxGeneration:', s.maxGeneration, ' fossils:', bio.fossils.length);
console.log('popRoot   :', s.populationRoot);

console.log('\n=== RICHEST LINEAGES ===');
for (const t of s.topLineages.slice(0, 5)) {
  console.log(`  ${t.id.slice(0, 16)}…  gen ${String(t.generation).padStart(3)}  $${t.energy.toFixed(4)}  age ${String(t.age).padStart(4)}  niche ${t.niche.padEnd(9)} price $${t.genome.price.toFixed(6)}  q=${t.genome.quality.toFixed(2)} s=${t.genome.speed.toFixed(2)} e=${t.genome.efficiency.toFixed(2)} mut=${t.genome.mutRate.toFixed(3)} life=${t.genome.lifespan}`);
}

console.log('\n=== DEATH CAUSES ===');
const causes = {};
for (const f of bio.fossils) causes[f.cause] = (causes[f.cause] || 0) + 1;
console.log('  ' + JSON.stringify(causes));
const ages = bio.fossils.map((f) => f.age).sort((a, b) => a - b);
if (ages.length) console.log(`  age at death: p10=${ages[Math.floor(ages.length * 0.1)]} median=${ages[Math.floor(ages.length / 2)]} p90=${ages[Math.floor(ages.length * 0.9)]}`);
console.log('');
