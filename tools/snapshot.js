import { promises as fs } from 'node:fs';
const w = JSON.parse(await fs.readFile('.data-demo/worlds/0xe7e7e7e7e7e7e7e7.json', 'utf8'));
const rows = w.countries.map((c, i) => {
  let dead = 0, inf = 0, ever = 0;
  for (const k of Object.values(c.strains)) { dead += k.D; inf += k.I + k.E; ever += k.I + k.E + k.R + k.D; }
  return { name: c.name, pop: c.pop, attack: ever / c.pop, now: inf / (c.S + ever), dead: dead / c.pop, alert: c.alert, lock: c.lockdown, closed: c.closedDay !== null };
}).sort((a, b) => b.attack - a.attack);
const pct = (v, d = 1) => (v * 100).toFixed(d).padStart(6) + '%';
console.log('country          pop(M)  attacked    active     dead    alert   lock  border');
console.log('--------------- ------- --------- --------- -------- ------- ------ -------');
for (const r of rows) {
  console.log(r.name.padEnd(15) + String(r.pop).padStart(6) + ' ' + pct(r.attack) + '  ' + pct(r.now) + '  ' + pct(r.dead, 2) + '  ' + pct(r.alert, 0) + ' ' + pct(r.lock, 0) + '   ' + (r.closed ? 'CLOSED' : 'open'));
}
let D = 0, I = 0, S = 0;
for (const c of w.countries) { S += c.S; for (const k of Object.values(c.strains)) { D += k.D; I += k.I; } }
const st = Object.values(w.strains)[0];
console.log('\nday ' + w.meta.day + ' | susceptible ' + S.toFixed(0) + 'M | active ' + I.toFixed(1) + 'M | dead ' + D.toFixed(1) + 'M (' + (D / 4878.4 * 100).toFixed(2) + '% of humanity)');
console.log(st.name + ': cure ' + st.cure.toFixed(1) + '% | R0 ' + st.phenotype.R0 + ' | CFR ' + st.phenotype.cfr + ' | cureResist ' + st.phenotype.cureResist + ' | DNA ' + st.dna.toFixed(0) + '/120');
