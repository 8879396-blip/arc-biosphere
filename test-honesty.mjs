import { createBiosphere, step, creditExternalCall, populationRoot, honesty, migrateCounters } from "./src/life.js";
const bio = createBiosphere({ seed: "0xdeadbeef", name: "TestSphere", founders: 30 });
console.log("genesis root:", populationRoot(bio).slice(0, 24));
creditExternalCall(bio, "keccak", { revenue: 1.25, calls: 3, buyer: "0xbuyer", txHash: "0xtx1" });
creditExternalCall(bio, "oracle", { revenue: 0.75, calls: 2, buyer: "0xoperator", txHash: "0xtx2", subsidized: true });
step(bio, 40);
console.log("honesty:", JSON.stringify(honesty(bio), null, 0));
console.log("root after 40 ticks:", populationRoot(bio).slice(0, 24), "alive:", bio.organisms.size, "gen:", bio.counters.generations);
// 确定性验证：同 seed 同输入重放两次必须得到同一个 root
const b2 = createBiosphere({ seed: "0xdeadbeef", name: "TestSphere", founders: 30 });
creditExternalCall(b2, "keccak", { revenue: 1.25, calls: 3, buyer: "0xbuyer", txHash: "0xtx1" });
creditExternalCall(b2, "oracle", { revenue: 0.75, calls: 2, buyer: "0xoperator", txHash: "0xtx2", subsidized: true });
step(b2, 40);
console.log("deterministic replay identical:", populationRoot(b2) === populationRoot(bio));
// 旧存档兼容
const legacy = JSON.parse((await import("node:fs")).readFileSync(".data-bio2/biosphere.json", "utf8"));
legacy.organisms = new Map(legacy.organisms.map(o => [o.id, o]));
migrateCounters(legacy);
console.log("legacy world honesty:", JSON.stringify(honesty(legacy)).slice(0, 220));
