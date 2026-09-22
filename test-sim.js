import { createWorld, registerStrain, tick, summary, emptyGenome, mutate, leaderboard } from './src/sim.js';

const w = createWorld({ name: 'Test Outbreak', seed: '0x' + '11'.repeat(32) });

// A "patient zero" genome: stealthy spreader, low severity early (Plague Inc. meta)
const g = emptyGenome();
g.transmission.air1 = 1; g.transmission.water1 = 1; g.transmission.insect1 = 1;
g.symptoms.coughing = 1; g.symptoms.sweating = 1;
g.abilities.coldResist1 = 1; g.abilities.heatResist1 = 1;

const sid = registerStrain(w, { owner: '0xAgentAlpha', name: 'ALPHA-1', genome: g, countryId: 0 });
console.log('strain', sid, 'released in', w.countries[0].name);

const t0 = Date.now();
let report = [];
for (let chunk = 0; chunk < 20; chunk++) {
  const r = tick(w, 30);
  const last = r.rows[r.rows.length - 1];
  if (last) report.push(last);
  if (w.meta.ended) break;
}
const ms = Date.now() - t0;

console.log('\nday |    S(M) |    I(M) |    D(M) | cure% | DNA  | ctry | closed');
console.log('----+---------+---------+---------+-------+------+------+-------');
for (const r of report) {
  const st = r.strains[0] || { cure: 0, dna: 0 };
  console.log(String(r.day).padStart(4) + '|' + r.S.toFixed(0).padStart(8) + '|' + r.I.toFixed(1).padStart(8) + '|' + r.D.toFixed(1).padStart(8) + '|' + String(st.cure).padStart(6) + '|' + String(st.dna).padStart(5) + '|' + String(r.infectedCountries).padStart(5) + '|' + String(r.closedBorders).padStart(6));
}
const s = summary(w);
console.log('\nEND:', JSON.stringify(s.outcome), 'day', s.day);
console.log('leaderboard:', JSON.stringify(leaderboard(w), null, 1).slice(0, 600));
console.log('worldRoot:', s.worldRoot);
console.log('events:', w.events.length, '| types:', [...new Set(w.events.map(e => e.type))].join(', '));
console.log('elapsed:', ms, 'ms for', s.day, 'days =>', (ms / s.day).toFixed(1), 'ms/day');
