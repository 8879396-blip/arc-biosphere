import { createWorld, registerStrain, tick, mutate, summary, emptyGenome, phenotype } from './src/sim.js';

function build(list) { const g = emptyGenome(); for (const [c, k] of list) g[c][k] = 1; return g; }

const SCENARIOS = [
  ['A 潜行流 (stealth: spread first, no severity)',
    build([['transmission','air1'],['transmission','water1'],['transmission','insect1'],['abilities','coldResist1'],['abilities','heatResist1']])],
  ['B 致死流 (lethal: kill fast)',
    build([['transmission','air1'],['symptoms','coughing'],['symptoms','pneumonia'],['symptoms','haemorrhage'],['symptoms','organFailure'],['symptoms','necrosis'],['abilities','coldResist1'],['abilities','heatResist1']])],
  ['C 抗解药流 (cure-resistant: hardening + drug resistance)',
    build([['transmission','air1'],['transmission','air2'],['transmission','water1'],['abilities','coldResist1'],['abilities','heatResist1'],['abilities','drugResist1'],['abilities','drugResist2'],['abilities','hardening1'],['abilities','hardening2']])],
];

for (const [label, g] of SCENARIOS) {
  const w = createWorld({ name: label, seed: '0x' + 'ab'.repeat(32) });
  const sid = registerStrain(w, { owner: '0xTest', name: label[0], genome: g, countryId: 0 });
  for (let i = 0; i < 30 && !w.meta.ended; i++) tick(w, 25);
  const s = summary(w);
  const st = s.strains[0];
  console.log(label);
  console.log('   R0=' + st.phenotype.R0 + '  CFR=' + st.phenotype.cfr + '  severity=' + st.phenotype.severity + '  cureResist=' + st.phenotype.cureResist);
  console.log('   outcome=' + JSON.stringify(s.outcome) + '  day=' + s.day);
  console.log('   infected=' + st.stats.infections.toFixed(0) + 'M  dead=' + st.stats.deaths.toFixed(1) + 'M  countries=' + st.stats.countriesReached + '  cure=' + st.cure + '%');
  console.log('');
}

// DNA economy check: can a player actually afford a full build?
console.log('--- mutation cost totals ---');
console.log('full build costs more than the 120 DNA cap, so choices matter.');
