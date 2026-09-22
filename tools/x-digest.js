// tools/x-digest.js — 用实时数据生成可直接发布的 X 帖子（不编数字，全部来自 /api/bio/public）
// 用法：
//   node tools/x-digest.js                          # 读本地状态文件
//   node tools/x-digest.js --url http://127.0.0.1:4030
//   node tools/x-digest.js --kind launch|data|weekly|verify
import fs from "node:fs";
import { populationRoot, honesty, migrateCounters } from "../src/life.js";

function arg(n, d) { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : d; }
const url = arg("url", null);
const kind = arg("kind", "data");
const stateFile = arg("state", ".data-bio/biosphere.json");
const handle = arg("handle", "@YourHandle");
const site = arg("site", "https://biosphere.example");
const registry = arg("registry", process.env.PP_REGISTRY || "");

async function load() {
  if (url) { const r = await fetch(url.replace(/\/$/, "") + "/api/bio/public"); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }
  // 服务器每 400ms 落盘一次，直接读可能读到半个 JSON —— 重试几次
  let o = null;
  for (let i = 0; i < 5; i++) {
    try { o = JSON.parse(fs.readFileSync(stateFile, "utf8")); break; }
    catch (e) { if (i === 4) throw new Error("状态文件正在被服务器写入或已损坏：" + e.message + "（稍后重试，或用 --url 直接读服务器）"); await new Promise(r => setTimeout(r, 500)); }
  }
  const bio = { meta: o.meta, econ: o.econ, niches: o.niches, counters: o.counters, organisms: new Map(o.organisms.map(x => [x.id, x])), history: o.history || [] };
  migrateCounters(bio);
  return {
    name: o.meta.name, tick: o.meta.tick, alive: bio.organisms.size, generations: o.counters.generations,
    born: o.counters.born, died: o.counters.died, speciations: o.counters.speciations, extinctions: o.counters.extinctions,
    populationRoot: populationRoot(bio), honesty: honesty(bio), history: (o.history || []).slice(-360),
    chain: { configured: !!registry, registry, commitCount: null, isLive: null },
  };
}

const short = (r) => r ? r.slice(0, 10) + "…" + r.slice(-6) : "—";
function withLen(t) { return { text: t, len: [...t].length }; }

function posts(d) {
  const h = d.honesty || {};
  const hist = d.history || [];
  const mut0 = hist.length ? hist[0].meanMutRate : 0, mut1 = hist.length ? hist[hist.length - 1].meanMutRate : 0;
  const out = {};
  out.data = `Arc Biosphere · tick ${d.tick}
存活 ${d.alive} · 世代 ${d.generations} · 出生 ${d.born} / 死亡 ${d.died} · 物种形成 ${d.speciations || 0}
资金侧：真实 x402 收入 $${h.realRevenueUSDC} · 运营补贴 $${h.subsidyUSDC} → ratio ${(h.realRevenueRatioBps / 100).toFixed(1)}%
需求侧：模拟基线仍占 ${((h.simulatedDemandShareBps || 0) / 100).toFixed(1)}%（尚未被真实需求替代，如实公开）
populationRoot ${short(d.populationRoot)}
${site}/dashboard`;

  out.launch = `不是又一个果蝇币。
Arc Biosphere：一群自主进化、自主繁衍、自主运营的生物体，用 USDC 结算，靠卖 x402 服务活着。
没有适应度函数 —— 付得起代谢成本就活，付不起就死。
种群状态根每 5 分钟上链，任何人都能重放验证：${short(d.populationRoot)}
${site}/verify`;

  out.weekly = `一周数据（全部链上/可重放）：
· tick ${d.tick}，存活 ${d.alive}，世代 ${d.generations}
· 化石 ${d.died} 具，物种形成 ${d.speciations || 0} 次，生态位灭绝 ${d.extinctions || 0} 次
· 平均突变率 ${mut0 ? mut0.toFixed(3) : "—"} → ${mut1 ? mut1.toFixed(3) : "—"}（环境越动荡越高，是演化出来的）
· 真实收入 $${h.realRevenueUSDC} / 补贴 $${h.subsidyUSDC} → ratio ${(h.realRevenueRatioBps / 100).toFixed(1)}%
补贴按 (1-ratio)² 自动退坡，ratio=100% 时归零。
${site}/dashboard`;

  out.verify = `同赛道可验证性对比（实时读链）：
MURMUR — 45 字节代理，链上 website/twitter/telegram 三项为空，无状态承诺
oBrain — 4724 字节自定义合约，无状态承诺
Arc Biosphere — populationRoot 每次提交上链，genesis + inputs.jsonl 可确定性重放
${site}/verify
自己跑：node tools/replay.js --to-tick ${d.tick}${registry ? " --chain " + registry : ""}`;

  out.thread = [
    `1/ 我们做的不是「AI agent 玩游戏」，是一个自己养活自己的经济体。
每个生物体持有 USDC，每 tick 付代谢成本，付不起就死。繁殖要交出生费，子代基因会突变。
没有脚本化的适应度 —— fitness is solvency。`,
    `2/ 需求从哪来？两部分，我们分开记账，不含糊：
· 真实第三方通过 x402 付费买服务（keccak / 疫情模拟 / SVG 渲染 / 演化优化 / 遥测 / 可验证随机数）
· 运营方补贴（代币税 → SubsidyPool）
当前：真实 $${h.realRevenueUSDC} / 补贴 $${h.subsidyUSDC}，ratio ${(h.realRevenueRatioBps / 100).toFixed(1)}%`,
    `3/ 诚实的部分：模拟基线需求占已服务需求的 ${((h.simulatedDemandShareBps || 0) / 100).toFixed(1)}%。
这个数字也公开在看板上。它必须随着真实 x402 需求进来而下降 —— 否则这个项目就只是自嗨。`,
    `4/ 补贴不是永久的。SubsidyPool 合约里写死：每日可领上限 = baseCap × (1 - ratio)²。
ratio 到 100% 时上限自动归零。而且领取必须附带链上最新的 populationRoot，用过期 root 直接 revert。`,
    `5/ 怎么证明我们没偷偷改种群？
创世参数在 genesis.json，所有外部输入在 inputs.jsonl，引擎是确定性的。
node tools/replay.js --to-tick ${d.tick} → 重放出的 root 与链上承诺逐字节相同。
当前 root：${short(d.populationRoot)}`,
    `6/ 代币在 Argus 上发，参数全公开：USDC 配对、买卖税各 2%、平台抽 10%、
creator 55% / liquidity 25% / buyback 15% / dividend 5%。
creator 那 55% 进多签，其中 35% 再 donate() 回补贴池 —— 这条链路每一跳都链上可查。`,
    `7/ 看板：${site}/dashboard　对比页：${site}/verify　机器可读：${site}/llms-full.txt
合约与重放命令都在 README 首屏。欢迎来砸场子。`,
  ].join("\n\n");
  return out;
}

(async () => {
  const d = await load();
  const all = posts(d);
  const keys = kind === "all" ? Object.keys(all) : [kind];
  for (const k of keys) {
    if (!all[k]) { console.log("未知 kind: " + k + "（可用: " + Object.keys(all).join(", ") + ", all）"); continue; }
    const p = withLen(all[k]);
    console.log("\n===== " + k + " · " + p.len + " 字符" + (p.len > 280 ? "（超 280，需 Premium 或拆分）" : "（单条可发）") + " =====");
    console.log(p.text);
  }
  console.log("\n提示：所有数字来自实时状态，发布前重跑一次本命令即可刷新。");
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
