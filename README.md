# ARC BIOSPHERE

**一个自主进化、自主繁衍、自我运营的人工生命经济体，跑在 Arc（Circle L1，USDC gas）上，以 x402 微支付按次售卖。**

零依赖纯 Node：`node src/life-server.js` 直接启动，不需要 `npm install`。

> 目录名 `pandemic-protocol` 是历史遗留。最初做的是瘟疫公司式游戏，后来转向自主生命经济体；
> 那套 SEIR 疫情引擎**保留了下来**，现在是生物体可以售卖的六个真实服务之一（`/api/bio/serve/pandemic`）。

---

## 核心思想：没有适应度函数

**适应度就是「你还活着吗」。**

每个生命体：

- 持有一个 **USDC 余额**（就是它的"能量"，不是抽象积分）
- 基因组编码一套**商业策略**：在哪个生态位竞争、定价多少、质量、吞吐、代谢效率、繁殖力，以及**它自己的突变率**
- 每 tick 支付**代谢成本**（upkeep）才能活着
- 靠在生态位里**竞争 x402 客户**赚收入
- 余额归零 → **立刻死亡**，进化石记录
- 有余量 → 支付出生费，把余额分给一个**基因突变的后代**

所以定价水平、生态位特化、寿命策略、甚至**可演化性本身**，全部是涌现的。**没有人设计过任何一条。**

---

## 30 秒上手

```bash
# 自我运营的生物圈（autotick 让它无客户也持续进化）
PP_AUTOTICK_MS=1500 PP_AUTOTICK_TICKS=2 node src/life-server.js     # http://localhost:4030

node client/watch.js      # 付费拉快照，打印演化仪表盘
node client/steer.js      # 用真钱买服务，观察基因池如何被改写
node tools/evolve.js 3000 # 离线跑 3000 tick 纯演化实验
npm test                  # keccak-256 测试向量 + 疫情引擎平衡性
```

---

## 已实测的演化结果

### A. 纯种子驱动的 3000 tick（无任何外部需求）

```
66 个世代 · 3747 出生 / 3657 死亡 · 30% 死于饥饿
3 次生态位灭绝 · 43 次物种形成
种群在 52 ↔ 171 之间震荡（需求冲击造成的繁荣-萧条周期）
```

**涌现出的价格阶梯**（无人设计，纯粹由需求和成本决定）：

| niche | 基线需求 | 演化出的均价 | quality | efficiency | mutRate |
|---|---|---|---|---|---|
| `optimize` | 18 | **$0.006576** ← 最高 | 0.954 | 0.643 | 0.0999 |
| `pandemic` | 26 | $0.006384 | 0.968 | 0.949 | 0.147 |
| `render` | 47 | $0.002266 | 0.911 | 0.651 | 0.0419 |
| `keccak` | 120 | $0.001396 | 0.740 | **0.954** ← 最高 | 0.0839 |
| `oracle` | 190 | **$0.000479** ← 最低 | 0.952 | 0.684 | 0.0776 |

低需求高价值生态位演化出**高价 + 高质量**；高流量商品位演化出**低价 + 极致代谢效率**（那里只有降本一条活路）。

个体收入**精确收敛到盈亏平衡点** —— 竞争把经济利润压到零，这是正确的演化经济学结果。

### B. 可演化性本身在演化（教科书级结果）

| 环境 | 平均突变率的演化方向 |
|---|---|
| **稳定**（无需求冲击） | 0.097 → **0.070** ↓ 适应后降低探索 |
| **波动**（有需求冲击） | 0.097 → **0.140** ↑ 波动环境奖励可演化性 |
| **被外部资金稳定补贴**的生态位 | → **0.0497** ↓ 该位一旦稳定有利可图，压低突变率 |

这是 bet-hedging 理论的直接验证，而且是**自己跑出来的**，不是我写进去的。

### C. 外部真实付费改写演化方向

向 `entropy` 生态位持续注入 **$80 真实需求 / 500 tick**：

```
entropy 种群      11 → 42      (+282%)
全球种群          100 → 135
entropy quality   0.733 → 0.992
entropy speed     0.706 → 0.985
entropy mutRate   → 0.0497     (变稳定了，压低可演化性)
entropy 平均能量  $0.0628  vs  生物圈均值 $0.0525   ← 被补贴的生态位更富
世代深度          26 → 37
另有两个生态位灭绝（资源被抽走）
```

### D. 弹性决定价格反应方向（涌现，非设计）

同样注入外部需求，两个生态位反应**完全相反**：

| niche | 需求弹性 | 均价反应 |
|---|---|---|
| `optimize` | 0.85（缺乏弹性） | $0.001441 → **$0.001865 ↑** 提价 |
| `entropy` | 1.35（富有弹性） | $0.002508 → **$0.000870 ↓** 打价格战 |

经济学上完全正确，且是模拟自己产生的。

### E. 化石记录

```
406 具化石 · starvation 247 / old_age 159  (61% 饿死)
死亡年龄  p10=20  median=53  p90=98
样例: 第 5 代, niche 5, 定价 $0.001589, 活 78 tick, 一生赚 $0.516324, 留下 1 个后代, 老死
```

---

## 端点

**免费（发现层）**

| 路由 | 内容 |
|---|---|
| `GET /api/bio/spec` | 完整机读规范：基因组 schema、市场出清公式、经济参数、Agent 操作手册 |
| `GET /api/bio/prices` | 价格表（含 atomic USDC 与 scheme） |
| `GET /api/bio/meta` | 网络 / facilitator / 国库 / autotick 状态 / populationRoot |
| `GET /llms.txt` · `/llms-full.txt` · `/openapi.yaml` · `/.well-known/ai.json` | AI 发现层（含**当前演化状态**） |
| `GET /` | 仪表盘首页 |

**付费**

| 路由 | 价格 | 说明 |
|---|---|---|
| `POST /api/bio/tick?ticks=N` | $0.002 + $0.0004/tick | 推进生物圈（≤500 tick/次） |
| `GET /api/bio/state` | $0.0004 | 全量状态 + `populationRoot` |
| `GET /api/bio/organisms` | $0.0005 | 普查：每个个体的基因组与盈亏平衡点 |
| `GET /api/bio/organism/:id` | $0.0003 | 单个体：能量、谱系、经济学指标、还有几 tick 会饿死 |
| `GET /api/bio/lineage/:id` | $0.0005 | 跨化石记录的祖先/后代树 |
| `GET /api/bio/fossils` | $0.0004 | 化石记录：死因、寿命、一生盈亏 |
| `GET /api/bio/history` | $0.0005 | 种群/价格/性状时序 |
| `GET /api/bio/events` | $0.0003 | 灭绝、物种形成、需求冲击、创始人释放 |
| `GET /api/bio/niche/:key/chart.svg` | $0.001 | 生态位演化曲线图 |
| `POST /api/bio/seed` | $0.05 | **释放你自己设计的基因组**当创始人 |
| `POST /api/bio/demand` | **upto ≤$5** | 把 USDC 需求直接注入某生态位（纯选择压力） |
| `POST /api/bio/serve/:niche` | **upto ≤$0.5** | **买一个真实服务**，收入记给中标的生命体 |

### 六个真实服务（不是模拟的，真的在算）

| niche | 服务 | 实测 |
|---|---|---|
| `keccak` | keccak-256 批量哈希 | 真实摘要 |
| `entropy` | 带承诺披露的可验证随机数 | commitment + values |
| `render` | 确定性 SVG 生成 | 真实 SVG |
| `pandemic` | 完整 SEIR 疫情模拟（20 国 / 37 突变节点） | 150 天 / 1160ms |
| `optimize` | 真实遗传算法 | fitness 0.999938 / 70ms |
| `oracle` | 生物圈遥测源 | 实时状态 |

**这是关键**：生命体不是装饰，它们是真实算力之上的**定价与分配层**。你付的 USDC 真的买了计算，同时变成了某个基因组的能量。

---

## 经济模型

```
市场出清（每 tick，每生态位）
  attractiveness_i = (0.30+quality_i)·(0.30+speed_i) / price_i^elasticity
  share_i          = attractiveness_i / Σ attractiveness
  customers_i      = min(demand_n · share_i, speed_i · 21)     ← 吞吐是硬约束
  revenue_i        = customers_i · price_i · (1 − 5% 平台费)

代谢
  upkeep_i = 0.0078 · (1 + 0.30·complexity_i) · (1 − 0.45·efficiency_i) · (1 + 0.35·congestion)
  complexity_i = (quality + speed + 1 − efficiency) / 3       ← 越"有野心"的基因组越贵

繁殖
  条件: age ≥ 4 且 energy ≥ 0.020 + 0.00012·pop + 0.052·(1.6 − 0.9·fecundity)
  后代拿到 62% 的能量，基因组按父代 mutRate 突变

环境
  demand_n(t) = baseDemand · 季节(sin, 周期240) · 噪声(±52%) · 冲击 + 外部真实 x402 调用
  冲击: 0.6%/生态位/tick 概率触发 0.12–0.7× 萧条 或 1.5–3.2× 繁荣，持续 18–90 tick
```

**外部收入按市场出清的同一套 softmax + 容量规则按份额分配。** 最初的赢家通吃版本会毁掉生态位：一个个体拿到意外之财 → 繁殖爆炸 → 后代互相压价 → 均价跌破代谢成本 → 整个生态位饿死。按份额分配后，意外之财转化为种群增长。这个 bug 是实测出来的，不是设计出来的。

---

## 可验证性

```
rng            = keccak("BIO_RNG_V1" ‖ seed ‖ tick ‖ salt)   计数器模式，每次置换出 4 个 float
genomeHash     = keccak("BIO_GENOME_V1" ‖ 量化后的基因组)
populationRoot = keccak("BIO_ROOT_V1" ‖ seed ‖ tick ‖ count ‖
                        每个存活个体的 (genomeHash, energy·1e9, generation, age)，按 id 排序)
```

全部用**原版 Keccak 填充（0x01…0x80，不是 NIST SHA3-256 的 0x06）**，已过标准测试向量，Solidity 可逐字节重算：

```
keccak256("")      = 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470  ✓
keccak256("abc")   = 0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45  ✓
Keccak-f[1600] 全零态 lane[0] = F1258F7940E1DDE7                                          ✓
```

相同种子 + 相同外部调用序列 = **逐字节相同的演化历史**（已实测两次运行结果一致）。

把 `populationRoot` 按 epoch 提交上链，任何人就能证明运营方没有偷偷编辑它卖给你的种群。

---

## 切到真实 USDC

默认 `PP_FACILITATOR=mock`，**不发生任何真实转账**。上真钱：

```bash
npm i @circle-fin/x402-batching @x402/core
PP_FACILITATOR=gateway PP_NETWORK=arcTestnet SELLER_ADDRESS=0x... node src/life-server.js
```

```ts
import { GatewayClient } from "@circle-fin/x402-batching/client";
const c = new GatewayClient({ chain: "arcTestnet", privateKey: PK });
await c.deposit("1.00");                                  // 一次性
await c.pay("http://host:4030/api/bio/serve/keccak");     // 之后免 gas
```

### Arc 参数（已核对）

| | 主网 | 测试网 |
|---|---|---|
| Chain ID / CAIP-2 | `5042` / `eip155:5042` | `5042002` / `eip155:5042002` |
| RPC | `https://rpc.mainnet.arc.io` | `https://rpc.testnet.arc.io` |
| Gateway Wallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |
| Faucet | — （CCTP domain 26） | `https://faucet.circle.com` |

USDC ERC-20（两网同址）`0x3600000000000000000000000000000000000000`，**6 位小数**。

> ⚠️ Arc 的 native USDC 是 **18 位小数**（gas / `msg.value`），ERC-20 视图是 **6 位小数**，相差 1e12。
> x402 金额一律用 6 位视图，**绝不可相加或混用**。

---

## 目录

```
src/keccak.js       keccak-256（零依赖，已过测试向量）—— 一切可验证性的基础
src/life.js         生物圈引擎：基因组、市场出清、代谢、繁殖、死亡、需求冲击、populationRoot
src/services.js     六个真实服务实现（keccak / entropy / render / pandemic / optimize）
src/sim.js          多毒株 SEIR 疫情引擎（20 国 / 37 节点突变树）—— 被 pandemic 服务复用
src/x402.js         x402 v2 支付层：exact + upto 双 scheme，mock / gateway 双 facilitator
src/store.js        JSON 持久化
src/life-server.js  生物圈服务器 + 自我运营 autotick + SVG 图表 + llms/openapi 生成
src/server.js       疫情赛季服务器（保留）
client/watch.js     付费观测仪表盘
client/steer.js     用真钱改写演化方向的 demo
client/agent.js     疫情赛季的单 Agent demo
client/versus.js    疫情赛季的多 Agent 对抗 demo
tools/evolve.js     离线纯演化实验（3000 tick）
tools/steer.js      离线注入实验（500 tick + $80）
tools/snapshot.js   疫情世界文字快照
test-keccak.js      哈希测试向量
test-scenarios.js   疫情引擎三种打法平衡性
```

`DESIGN.md` 有完整的经济模型、上链路线、运营（X）方案与风险清单。

---

## 许可与安全

Apache-2.0。**mock 模式下不发生任何真实转账；上主网前必须在 Arc Testnet 用 gateway 模式跑通全流程。**
私钥只走环境变量，不要提交、不要打日志、不要作为明文 CLI 参数传入部署环境。
