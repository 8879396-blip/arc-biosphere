import fs from "node:fs";
fs.rmSync(".data-e2e", { recursive: true, force: true });
process.env.PP_DATA_DIR = ".data-e2e";
process.env.PP_BIO_FILE = ".data-e2e/biosphere.json";
process.env.PP_AUTOTICK_MS = "250";
process.env.PORT = "4131";
process.env.PP_BIO_NAME = "Arc Biosphere";
process.env.PP_FOUNDERS = "24";
await import("./src/life-server.js");
await new Promise(r => setTimeout(r, 2600));
const base = "http://127.0.0.1:4131";
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; };
for (const p of ["/api/bio/public", "/api/bio/meta", "/dashboard", "/verify", "/api/bio/prices", "/llms.txt", "/api/bio/nope"]) {
  try {
    const r = await get(p); let note = r.text.length + " bytes";
    if (p === "/api/bio/public") { const j = JSON.parse(r.text); note = "tick=" + j.tick + " alive=" + j.alive + " gen=" + j.generations + " root=" + j.populationRoot.slice(0, 16) + "… history=" + j.history.length + " inputs=" + j.recorder.inputsLogged + " genesis=" + j.recorder.genesis + " chain.configured=" + j.chain.configured; }
    if (p === "/api/bio/meta") { const j = JSON.parse(r.text); note = "honesty.real=$" + j.honesty.realRevenueUSDC + " simShare=" + j.honesty.simulatedDemandShareBps + "bps chain=" + JSON.stringify(j.chain); }
    if (p === "/dashboard") note = (r.text.includes('id="c-live"') && r.text.includes("/api/bio/public")) ? "看板 HTML ok，含链上证明与刷新逻辑" : "缺少标记";
    if (p === "/verify") note = (r.text.includes("MURMUR") && r.text.includes("oBrain") ? "对比页含 MURMUR/oBrain ✓ · " : "缺对比 · ") + (r.text.includes("bytes") || r.text.includes("合约字节") ? "含合约字节列" : "");
    if (p === "/api/bio/prices") note = JSON.parse(r.text).routes.length + " 条付费路由";
    console.log(String(r.status).padEnd(4) + p.padEnd(20) + note);
  } catch (e) { console.log("ERR " + p.padEnd(20) + e.message.slice(0, 90)); }
}
const v = await get("/verify");
fs.writeFileSync("../verify-sample.html", v.text);
console.log("\n/verify 已存为 outputs/verify-sample.html (" + v.text.length + " bytes)");
const m = v.text.match(/<td>(\d+)<\/td>/g);
console.log("竞品合约字节/USDC 单元格: " + (m ? m.slice(0, 6).join(" ") : "none"));
process.exit(0);
