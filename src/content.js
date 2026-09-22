// Static discovery-layer content: llms-full.txt, openapi.yaml, landing HTML.
import { PRICES, NETWORKS, USDC_ARC } from './x402.js';
import { MUTATION_TREE, COUNTRIES, VERSION } from './sim.js';

const priceTable = Object.entries(PRICES)
  .map(([k, v]) => `  ${k.padEnd(46)} $${String(v.usd).padEnd(8)} ${v.desc}`)
  .join('\n');

const mutationDoc = Object.entries(MUTATION_TREE).map(([cat, nodes]) =>
  `### ${cat}\n` + Object.entries(nodes).map(([n, s]) =>
    `  ${n.padEnd(18)} cost ${String(s.cost).padStart(2)} DNA${s.req ? '  (requires ' + s.req + ')' : ''}  — ${s.desc}`).join('\n')
).join('\n\n');

const countryDoc = COUNTRIES.map((c) =>
  `  ${String(c.id).padStart(2)}  ${c.name.padEnd(15)} pop ${String(c.pop).padStart(5)}M  ${c.climate.padEnd(10)} wealth ${c.wealth.toFixed(2)}  density ${c.density.toFixed(2)}  openness ${c.openness.toFixed(2)}  land[${c.land.join(',')}] sea[${c.sea.join(',')}] air[${c.air.join(',')}]`
).join('\n');

export const LLMS_FULL = `# Pandemic Protocol — full agent documentation

> A Plague Inc.-style deterministic pandemic wargame sold as an x402 paywalled API on Arc
> (Circle L1, chainId 5042, USDC gas). You play a pathogen: release a strain, evolve it with
> DNA points, spread country to country, and try to kill humanity before the cure completes.
> Several agents can release competing strains into ONE shared world.
> Every action is one atomic USDC micropayment over HTTP 402. No API key, no account.

version ${VERSION} · protocol x402 v2 · network-agnostic (defaults to Arc Testnet)

## 1. How to pay (x402)

1. Call any paid route with no \`payment-signature\` header.
2. You get **HTTP 402** plus a base64 \`PAYMENT-REQUIRED\` header and a JSON body listing \`accepts\`.
3. Sign the payment (EIP-3009 \`transferWithAuthorization\` on Arc USDC) and retry with
   \`payment-signature: <base64 payload>\`.
4. On success the response carries a base64 \`PAYMENT-RESPONSE\` header with the settlement tx.

Easiest path — use Circle's SDK, it does steps 1-4 for you:

    npm i @circle-fin/x402-batching
    import { GatewayClient } from "@circle-fin/x402-batching/client";
    const client = new GatewayClient({ chain: "arcTestnet", privateKey: PK });
    await client.deposit("1.00");                       // once
    const res = await client.pay("http://host:4020/api/worlds/WORLD/tick?days=10");

Settlement is batched by Circle Gateway, so neither side pays gas per request.

## 2. Pricing

Asset: USDC on Arc, ERC-20 view at ${USDC_ARC}, **6 decimals**.
(Networks: ${Object.entries(NETWORKS).map(([k, v]) => `${k}=${v.caip2}`).join(', ')})

${priceTable}

## 3. Free discovery routes (no payment)

  GET /api/spec        complete machine-readable spec: formulas, mutation tree, countries
  GET /api/prices      pricing table with atomic USDC amounts
  GET /api/worlds      list of open worlds you can join
  GET /api/meta        network, facilitator mode, seller address
  GET /llms.txt        short index
  GET /openapi.yaml    OpenAPI 3.0
  GET /.well-known/ai.json

## 4. Simulation model

Multi-strain SEIR, frequency dependent, fully deterministic.

  alive      = S + sum over strains of (E + I + R)
  beta_s     = R0_s * gamma_s * climatePenalty * (0.65 + density*0.70) * (1 - 0.60*lockdown)
  gamma_s    = 1 / infectiousDays
  lambda_s   = beta_s * I_s / alive
  newExposed = S * (1 - exp(-sum(lambda_s)))      # shared pool => strains compete
  E -> I at 1/incubationDays ; I -> D at gamma*cfr ; I -> R at gamma*(1-cfr)

Cross-border seeding per day per route (land 0.012, air 0.008, sea 0.005), damped by both
countries' border closure and openness, then multiplied by an **establishment probability**
min(1, importedPeople/40) — a handful of travellers usually fizzles, which is what makes the
country-by-country spread a real strategic phase.

Government response: alert rises with prevalence * severity * detection; above thresholds a
country closes borders and imposes lockdown (lockdown cuts beta by up to 60%).

Cure research (per strain, per day, in percent):
  sum over infected countries of
      wealth * (0.20 + 0.80*alert) * min(1, log10(1+infectedPeople)/7.5) * 0.0018
  * (1 - cureResist) * 100,  times 1.35 once cure > 35% (candidate momentum).
After 100% a roll-out vaccinates 2.2% of remaining S per day and decays I by 0.93/day.

Random mutation: one roll per strain per day at rate
  0.008 + tumours*0.010 - stabiliser1*0.004
and it may ONLY grant minor symptoms (rash, nausea, sweating, coughing, diarrhoea, insanity).
Every powerful node must be bought with DNA — otherwise free mutation makes the economy moot.

## 5. Win conditions

  PATHOGEN wins : total deaths >= 85% of the initial world population (4878.4M)
  HUMANITY wins : every released strain goes extinct (cured or burned out)

## 6. DNA economy

DNA accrues from new infections: log10(1 + newInfectedPeople) * 0.12 per country per day
(halved for cross-border imports), capped at **120 unspent**. Spend it on the tree below.
Devolving a node costs ${3} DNA and is blocked while another owned node requires it.

${mutationDoc}

## 7. Countries (${COUNTRIES.length})

${countryDoc}

## 8. Verifiability

  worldRoot   = keccak256 over the quantised full state (seed, day, every country compartment,
                every strain cure/dna/alive/genomeHash)
  receiptHash = keccak256("PP_RECEIPT_V1" || worldSeed || day || action || payloadJSON || worldRoot)

Both use **keccak-256 (original Keccak padding, not NIST SHA3-256)** so a Solidity contract can
recompute them byte-for-byte. Every paid action returns its receipt; GET .../receipts lists them.
An on-chain registry can store one worldRoot per epoch, letting anyone prove the server never
tampered with a simulation it sold.

RNG is counter-mode keccak: rng = keccak("PP_RNG_V1" || worldSeed || day || counter), 4 floats
per permutation. Identical (world, seed, actions) always produce identical worlds.

## 9. Strategy notes for agents

* Severity is a double-edged sword: it raises detection, which raises alert, which closes
  borders and speeds the cure. Stealth builds infect far more people.
* Lethality kills hosts before they transmit. A CFR of 0.44 halves total infections.
* Cure resistance is the highest-leverage defensive spend: it extends the run by hundreds of days.
* You cannot afford everything. A full stealth+lethal+resistant build costs ~139 DNA; the cap is 120.
* Iceland (id 19) and Australia (13) are the hard targets: low openness, few links.
* Watch GET .../intel/:countryId for prevalence; border closure is visible there before it bites.
* Defender agents: POST .../cure/fund converts USDC straight into cure progress (1 USDC = 4%).

## 10. Reference client

    node client/agent.js            # plays a full pandemic, prints the curve and the bill
`;

export const OPENAPI = `openapi: 3.0.3
info:
  title: Pandemic Protocol
  version: "${VERSION}"
  description: Plague Inc.-style deterministic pandemic wargame sold per-call over x402 on Arc.
servers:
  - url: http://localhost:4020
tags:
  - name: free
  - name: world
  - name: strain
  - name: defender
paths:
  /api/spec:      { get: { tags: [free],   summary: Full machine-readable spec, responses: { '200': { description: spec } } } }
  /api/prices:    { get: { tags: [free],   summary: Pricing table,        responses: { '200': { description: prices } } } }
  /api/worlds:    { get: { tags: [free],   summary: List open worlds,     responses: { '200': { description: worlds } } } }
  /api/meta:      { get: { tags: [free],   summary: Network config,       responses: { '200': { description: meta } } } }
  /api/worlds/{id}:
    get:
      tags: [world]
      summary: Paid world snapshot (x402)
      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
      responses: { '200': { description: summary }, '402': { description: Payment Required, headers: { PAYMENT-REQUIRED: { schema: { type: string } } } } }
  /api/worlds/{id}/tick:
    post:
      tags: [world]
      summary: Advance the simulation (x402)
      parameters: [{ name: id, in: path, required: true, schema: { type: string } }, { name: days, in: query, schema: { type: integer, default: 1, maximum: 90 } }]
      responses: { '200': { description: tick result }, '402': { description: Payment Required } }
  /api/worlds/{id}/strains:
    post:
      tags: [strain]
      summary: Release a pathogen strain (x402)
      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
      responses: { '200': { description: strain }, '402': { description: Payment Required } }
  /api/worlds/{id}/strains/{sid}/mutate:
    post:
      tags: [strain]
      summary: Spend DNA on a mutation (x402)
      parameters: [{ name: id, in: path, required: true, schema: { type: string } }, { name: sid, in: path, required: true, schema: { type: string } }]
      responses: { '200': { description: mutation }, '402': { description: Payment Required } }
  /api/worlds/{id}/cure/fund:
    post:
      tags: [defender]
      summary: Fund cure research with USDC (x402)
      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
      responses: { '200': { description: funding }, '402': { description: Payment Required } }
`;

export const HTML_HOME = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pandemic Protocol — x402 on Arc</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#0b0e14;color:#e6edf3;font:15px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;padding:32px}
h1{color:#8be9fd;font-size:26px;margin:0 0 4px}h2{color:#bd93f9;font-size:17px;margin:28px 0 8px;border-bottom:1px solid #21262d;padding-bottom:5px}
.sub{color:#8b949e;margin-bottom:22px}a{color:#79c0ff}code{background:#161b22;padding:1px 5px;border-radius:4px;color:#ffa657}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #21262d;padding:5px 9px;text-align:left}th{color:#8be9fd;background:#161b22}
.p{color:#f0f6fc}.card{background:#11151c;border:1px solid #21262d;border-radius:9px;padding:16px 18px;margin:12px 0}
.badge{display:inline-block;background:#1f6feb22;border:1px solid #1f6feb;color:#79c0ff;border-radius:99px;padding:1px 10px;font-size:12px;margin-right:6px}
.warn{color:#ffa657}
</style></head><body>
<h1>PANDEMIC PROTOCOL</h1>
<div class="sub">瘟疫公司式确定性大流行兵棋 · 以 x402 微支付按次售卖 · Arc (Circle L1, USDC gas)</div>
<div>
<span class="badge">x402 v2</span><span class="badge">Arc chainId 5042 / 5042002</span>
<span class="badge">USDC 6-dec ERC-20</span><span class="badge">Circle Gateway 批量结算</span><span class="badge">零依赖 Node</span>
</div>

<div class="card"><b>你扮演病原体。</b> 释放毒株 → 用 DNA 点数进化 → 逐国传播 → 在解药完成前杀死足够多的人。
多个 Agent 可以把各自毒株放进<b>同一个世界</b>，共享易感人群、互相竞争（competitive exclusion）。
<b>另一边也有钱可赚</b>：防御方 Agent 用 <code>POST /cure/fund</code> 直接把 USDC 换成解药进度。</div>

<h2>付费端点（每次调用 = 一笔原子 USDC 微支付）</h2>
<table><tr><th>路由</th><th>价格</th><th>说明</th></tr>
${Object.entries(PRICES).map(([k, v]) => `<tr><td><code>${k}</code></td><td class="p">$${v.usd}</td><td>${v.desc}</td></tr>`).join('\n')}
</table>

<h2>免费发现层</h2>
<table>
<tr><td><a href="/api/spec">/api/spec</a></td><td>完整机读规范：公式、突变树、20 国参数、Agent 作战手册</td></tr>
<tr><td><a href="/api/prices">/api/prices</a></td><td>价格表（含 atomic USDC 数额）</td></tr>
<tr><td><a href="/api/worlds">/api/worlds</a></td><td>可加入的公开世界列表</td></tr>
<tr><td><a href="/api/meta">/api/meta</a></td><td>网络 / facilitator 模式 / 收款地址</td></tr>
<tr><td><a href="/llms-full.txt">/llms-full.txt</a></td><td>给 AI Agent 的完整说明书</td></tr>
<tr><td><a href="/openapi.yaml">/openapi.yaml</a></td><td>OpenAPI 3.0</td></tr>
<tr><td><a href="/.well-known/ai.json">/.well-known/ai.json</a></td><td>服务发现</td></tr>
</table>

<h2>快速开始</h2>
<div class="card">
<div># 1. 启动服务端（mock facilitator，零配置、不动真钱）</div>
<div><code>node src/server.js</code></div><br>
<div># 2. 看 402 握手</div>
<div><code>curl -i http://localhost:4020/api/worlds/anything</code></div><br>
<div># 3. 让 Agent 自动打一局完整疫情</div>
<div><code>node client/agent.js</code></div><br>
<div># 4. 上真钱：装 Circle SDK 并切换 facilitator</div>
<div><code>npm i @circle-fin/x402-batching @x402/core</code></div>
<div><code>PP_FACILITATOR=gateway PP_NETWORK=arcTestnet SELLER_ADDRESS=0x.. node src/server.js</code></div>
</div>

<h2 class="warn">可验证性</h2>
<div class="card">模拟是纯函数 + keccak 计数器模式 RNG，<b>相同输入必然产生逐字节相同的世界</b>。
每次付费动作返回 <code>receiptHash</code>，<code>worldRoot</code> 是全状态 keccak256 承诺，
两者都用<b>原版 Keccak 填充（非 NIST SHA3-256）</b>，Solidity 合约可逐字节重算 → 可以上链存证，
证明服务器没有篡改它卖出去的模拟结果。</div>

<p style="color:#8b949e;margin-top:26px">原型 · mock facilitator 模式下不发生任何真实转账 · 主网前必须切到 gateway 模式并在 Arc Testnet 全流程验证</p>
</body></html>`;
