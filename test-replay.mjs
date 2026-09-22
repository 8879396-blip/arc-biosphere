// test-replay.mjs — CI 用的核心证明：确定性重放 + 诚实账本 + 篡改检测
// 不联网、不依赖任何已有状态文件，可在 GitHub Actions 直接跑。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bio-replay-"));
process.env.PP_DATA_DIR = TMP;

const { createBiosphere, step, creditExternalCall, populationRoot, honesty } = await import("./src/life.js");
const rec = await import("./src/recorder.js");
const { replayTo } = await import("./tools/replay.js");

let fails = 0;
const check = (name, cond, detail = "") => { console.log((cond ? "PASS  " : "FAIL  ") + name + (detail ? "  " + detail : "")); if (!cond) fails++; };

const SEED = "0xc0ffee";
const FOUNDERS = 24;

// ---- 1. 实时运行一个经济体，边跑边记录外部输入 ----
const bio = createBiosphere({ seed: SEED, name: "CI Sphere", founders: FOUNDERS, tickLabel: "hour" });
rec.writeGenesis(bio, { note: "ci" });
step(bio, 20);
rec.record(bio, { kind: "serve", niche: "keccak", usd: 0.5, buyer: "0xb0b", txHash: "0xaa", subsidized: false });
creditExternalCall(bio, "keccak", { revenue: 0.5, calls: 1, buyer: "0xb0b", txHash: "0xaa", subsidized: false });
step(bio, 20);
rec.record(bio, { kind: "demand", niche: "oracle", usd: 1.0, units: 250, chunks: 10, buyer: "0xoperator", subsidized: true });
for (let i = 0; i < 10; i++) creditExternalCall(bio, "oracle", { revenue: 0.1, calls: 25, buyer: "0xoperator", subsidized: true });
step(bio, 20);
rec.record(bio, { kind: "credit", niche: "render", revenue: 0.25, calls: 2, buyer: "0xalice", subsidized: false });
creditExternalCall(bio, "render", { revenue: 0.25, calls: 2, buyer: "0xalice", subsidized: false });
step(bio, 40);

const liveRoot = populationRoot(bio);
const liveH = honesty(bio);
const g = rec.readGenesis();
const inputs = rec.loadInputs();

// ---- 2. 从创世 + 输入日志重放，必须得到完全相同的状态 ----
const r1 = replayTo(g, inputs, bio.meta.tick);
check("重放 tick 一致", r1.tick === bio.meta.tick, r1.tick + " vs " + bio.meta.tick);
check("重放存活数一致", r1.alive === bio.organisms.size, r1.alive + " vs " + bio.organisms.size);
check("重放世代一致", r1.generations === bio.counters.generations, r1.generations + " vs " + bio.counters.generations);
check("populationRoot 逐字节一致", r1.populationRoot === liveRoot, r1.populationRoot.slice(0, 24) + "…");

// ---- 3. 重放本身是确定性的（跑两次结果相同）----
const r2 = replayTo(g, inputs, bio.meta.tick);
check("重放可重复（两次 root 相同）", r2.populationRoot === r1.populationRoot);

// ---- 4. 篡改检测：改一条输入，root 必须变 ----
const tampered = inputs.map(x => ({ ...x }));
const t = tampered.find(x => x.kind === "serve");
if (t) { t.usd = t.usd + 0.001; }
const r3 = replayTo(g, tampered, bio.meta.tick);
check("篡改输入 → root 改变", t ? r3.populationRoot !== liveRoot : true, t ? r3.populationRoot.slice(0, 24) + "…" : "no serve input");

// ---- 5. 换创世种子，root 必须变 ----
const r4 = replayTo({ ...g, seed: "0xdeadbeef" }, inputs, bio.meta.tick);
check("换 seed → root 改变", r4.populationRoot !== liveRoot);

// ---- 6. 诚实账本：真实收入与补贴必须分开记 ----
check("真实收入 = $0.75", Math.abs(liveH.realRevenueUSDC - 0.75) < 1e-9, "$" + liveH.realRevenueUSDC);
check("补贴 = $1.00", Math.abs(liveH.subsidyUSDC - 1.0) < 1e-9, "$" + liveH.subsidyUSDC);
check("realRevenueRatio = 42.86%", liveH.realRevenueRatioBps === 4286, liveH.realRevenueRatioBps + "bps");
check("重放后的账本与实时一致", r1.honesty.realRevenueUSDC === liveH.realRevenueUSDC && r1.honesty.subsidyUSDC === liveH.subsidyUSDC);
check("模拟需求占比被如实公开（>0）", liveH.simulatedDemandShareBps > 0, liveH.simulatedDemandShareBps + "bps");

// ---- 7. 创世文件记录了重放所需的一切 ----
check("genesis 含 seed/founders/econ", !!g.seed && g.founders === FOUNDERS && !!g.econ, "founders=" + g.founders);
check("inputs.jsonl 记录了 3 条外部输入", inputs.length === 3, inputs.length + " 条");

fs.rmSync(TMP, { recursive: true, force: true });
console.log(fails === 0 ? "\n>>> REPLAY + HONESTY OK" : "\n>>> " + fails + " FAILURES");
process.exit(fails === 0 ? 0 : 1);
