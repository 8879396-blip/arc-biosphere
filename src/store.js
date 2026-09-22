// Tiny JSON-file persistence. Zero dependencies. Swap for Postgres/Supabase later.
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.env.PP_DATA_DIR || '.data/worlds');

export async function init() { await fs.mkdir(DIR, { recursive: true }); }
const file = (id) => path.join(DIR, id.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');

export async function save(world) {
  await fs.writeFile(file(world.meta.id), JSON.stringify(world));
  return world.meta.id;
}
export async function load(id) {
  if (!id) return null;
  try { return JSON.parse(await fs.readFile(file(id), 'utf8')); } catch { return null; }
}
export async function list() {
  await init();
  const names = (await fs.readdir(DIR)).filter((n) => n.endsWith('.json'));
  const out = [];
  for (const n of names) {
    try {
      const w = JSON.parse(await fs.readFile(path.join(DIR, n), 'utf8'));
      let dead = 0, inf = 0;
      for (const c of w.countries) for (const k of Object.values(c.strains)) { dead += k.D; inf += k.I; }
      out.push({
        id: w.meta.id, name: w.meta.name, day: w.meta.day, ended: w.meta.ended,
        outcome: w.meta.outcome, strains: Object.keys(w.strains).length,
        infectedM: +inf.toFixed(2), deadM: +dead.toFixed(2),
        infectedCountries: w.countries.filter((c) => c.firstInfectedDay !== null).length,
      });
    } catch { /* skip corrupt */ }
  }
  return out.sort((a, b) => b.day - a.day);
}
export async function remove(id) { try { await fs.unlink(file(id)); return true; } catch { return false; } }
