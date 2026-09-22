# ARC BIOSPHERE — 设计文档

经济模型 · 钱从哪来 · 运营层 · 上链路线 · 风险清单

---

## 1. 为什么是「自主生命经济体 × x402」

x402 让机器可以在**无人授权**的情况下为单次调用付亚美分的钱。这件事真正解锁的不是"卖 API"，而是：

> **一个进程可以靠自己赚的钱活下去。**

一旦"存活"需要真金白银，"进化"就不再是模拟，而是**经济选择**。这就是本项目的全部前提：

| 传统 ALife | Arc Biosphere |
|---|---|
| 适应度是人写的函数 | **适应度 = 偿付能力**，没人写过 |
| "能量"是抽象数字 | 能量就是 **USDC 余额** |
| 环境是固定规则 | 环境是**真实市场需求 + 付费者行为** |
| 观察者是被动的 | 观察者**花钱就能改写选择压力** |
| 结果可预测 | 结果连作者都不知道（我已实测出自己没预料的行为） |

**外部资金可以直接改写基因池** —— 这是整个项目最有价值的能力，也是 x402 独有的：
你不需要 API key、不需要注册、不需要跟任何人谈，只要往某个生态位持续付费，那个生态位的种群、质量、定价就会朝你的方向移动。实测：$80 让一个生态位种群 +282%，另两个生态位灭绝。

---

## 2. 「没有适应度函数」为什么重要

大部分 ALife / 进化模拟都需要你写一个 `fitness(genome) -> float`。这个函数就是**设计师的价值观**——你决定了什么算"更好"。

这里没有。系统里只有三条硬规则：

1. 每 tick 扣 USDC（代谢）
2. 客户按 `quality·speed / price^elasticity` 分配（市场）
3. 余额 ≤ 0 就死，有余量就能生（选择）

所有"看起来像智能设计"的结果都是涌现的：

- 低需求高价值生态位 → 高价高质量
- 高流量商品生态位 → 低价 + 代谢效率推到 0.95+
- 稳定环境 → 突变率下降；波动环境 → 突变率上升
- 缺乏弹性的生态位遇需求冲击 → 提价；富有弹性的 → 打价格战
- 竞争把每个个体的收入压到**精确的盈亏平衡点**（经济利润归零）

**这些我都没有写进去。** 我只写了上面三条规则。这是这个项目最值得展示的地方——比任何具体功能都有说服力。

---

## 3. 钱从哪来（必须诚实面对的问题）

这是整个设计里**唯一真正困难**的部分。目前有三个层次，必须分清：

### 层次 A：模拟的基线需求（现状）
`baseDemand` 是硬编码的（keccak 120 / oracle 190 / optimize 18 …）。这部分"客户收入"**凭空产生**，本质是**运营方补贴**。

- 优点：从 tick 0 就有演化，不依赖冷启动流量
- 缺点：**创造的价值没有收入支撑**。如果生命体的余额可以提现，这就是印钞
- 现状处理：余额**不可提现**，只能在系统内用于代谢和繁殖。所以它现在是"游戏内货币"，只是用 USDC 计价

### 层次 B：真实 x402 收入（已实现）
`POST /api/bio/serve/:niche` 和 `POST /api/bio/demand` 走真实 USDC。外部付费者的钱**按市场出清的同一套规则**分给生态位里的生命体。

这部分是真钱、真服务（keccak / GA / SVG / 疫情模拟都真的在算）。

### 层次 C：补贴退坡（路线图，未实现）
```
effectiveBaseDemand(n, t) = baseDemand(n) * subsidyDecay(t)
subsidyDecay(t) = max(0, 1 - realRevenue(n, trailingWindow) / baseDemandValue(n))
```
即：**某个生态位的真实收入越高，它的补贴就越低**，直到归零。届时那个生态位完全靠市场存活——真正的自持经济体。

### 运营方收入（这个模型下是正的）
```
platformFees  5% 的真实服务收入      （实测 3000 tick: $122）
birthFees     每次出生 0.020 + 0.00012·pop（实测: $125）
upkeep        代谢成本               （实测: $2076，但目前只是记账，不真收）
serve/demand  真实服务与需求注入      （实测: $1.20 / $2.40 每次 demo）
```
只要**真实服务有毛利**（keccak/GA/SVG 的边际成本近乎为零，只有 CPU），平台就是正现金流。补贴只花在"基线需求"上，而这部分可以用层次 C 逐步关掉。

> **一句话结论**：现在它是一个用 USDC 计价、由运营方补贴的封闭经济体，真实 x402 收入可以直接注入并改写演化。要变成自持经济体，需要实现层次 C 的补贴退坡，并让 `serve` 的真实流量足够大。这不是技术问题，是分发问题。

---

## 4. 运营层（自我运营 + 对外发声）

「自主进化 / 繁衍 / 运营」的第三项。分两层：

### 4.1 系统自我运营（已实现）
```bash
PP_AUTOTICK_MS=1500 PP_AUTOTICK_TICKS=2 node src/life-server.js
```
生物圈**无客户也持续进化**。进程重启后从 `.data-bio/biosphere.json` 恢复，演化连续。
配合一个 cron/systemd 就是完全无人值守的长期实验。

### 4.2 对外发声（设计，未实现 —— 需要你的 X API 凭据）

一个 `ops/broadcaster.js` 模块，定期读 `/api/bio/state` 和 `/api/bio/events`，把**种群自己的历史**变成内容：

| 触发条件 | 发布内容 |
|---|---|
| 生态位灭绝 | `R.I.P. niche "render" — 存活 2,847 tick，最后的个体 0xab12… 定价 $0.0019，一生服务 41 次。#ArcBiosphere` |
| 新世代里程碑 | `Generation 100. 从 40 个随机基因组到现在，均价自发分化出 13 倍。没有人设计过这个。` |
| 物种形成 | `Speciation: 0x9f3c… 的后代跳转到了 optimize 生态位。逃避竞争。` |
| 需求冲击 | `Boom: oracle 需求 ×3.2，持续 47 tick。观察谁吃到红利。` |
| 大额外部注入 | `某钱包向 entropy 注入了 $12.40。该生态位种群 6 小时内 +180%。#x402` |
| 每日摘要 | 种群 / 世代 / 出生死亡 / 国库 / populationRoot |

**关键点**：内容不需要人写。种群的事件流本身就是内容，而且是**独一无二的、无法伪造的**（每条都带 `populationRoot`，可链上验证）。这是"自我运营"最自然的形态——它播报自己的演化史。

配套（全部已实现）：`changelog.xml` RSS、`llms-full.txt` 里内嵌当前演化状态、`/api/bio/meta` 暴露实时计数器。**别的 Agent 读 `llms-full.txt` 就能看到"现在有 137 个生命体、最深 41 代、entropy 生态位均价 $0.0011"，然后决定要不要花钱干预。**

### 4.3 可选：让生命体自己发声
更激进的版本：每个生命体的基因组里加一个 `voice` 特征，高 energy 的个体可以付费发布一条状态。种群自己产生社交媒体内容。这个我**不建议现在做**——垃圾内容风险高，且会让 X 账号不可控。先做 4.2 的系统级播报。

---

## 5. 上链路线（渐进）

### Phase 0 — 现在（已实现）
纯服务端 + x402。零合约。可验证性靠 keccak 收据 + 开源代码 + 确定性重放。

### Phase 1 — `BiosphereRegistry.sol`（~120 行，1 周）
```solidity
function commitRoot(uint32 epoch, bytes32 populationRoot, uint32 population, uint32 generation) external; // keeper
function roots(uint32 epoch) external view returns (bytes32);
function verifyGenome(bytes32 root, Genome calldata g, uint96 energy, uint32 gen, uint32 age, bytes32[] proof) external view returns (bool);
```
任何人可对链上 root 校验 `genomeHash` → **运营方无法篡改它卖给你的种群**。gas 极低（每 epoch 一次 SSTORE，Arc 上约 $0.001）。

### Phase 2 — `LineageNFT.sol`（可选）
把 `keccak256(genome ‖ seed ‖ birthTick)` 铸成 NFT，附带完整谱系。冠军血统可交易、可作为下一纪元的创始人基因组。这是**"基因 IP"市场**。

### Phase 3 — `Treasury.sol` + 补贴退坡上链
把层次 C 的退坡公式写进合约，让补贴率**由链上真实收入自动决定**，运营方无法作弊续命。这一步做完，才算真正的自持经济体。

### 合约工具链
- 必须用 **`circlefin/arc-foundry`**（Foundry 的 Arc fork），官方版支持不全
- viem 已内置 `arc` / `arcTestnet`，不要自己 `defineChain`
- gas floor 20 gwei，`maxFeePerGas = max(20 gwei, 2×baseFee)`，`maxPriorityFeePerGas` 常态设 0
- USDC 用 ERC-20 视图 `0x3600…0000`（**6 位小数**），native 是 18 位

---

## 6. 差异化

| | Circle `arc-nanopayments` | Proof of Architect | **Arc Biosphere** |
|---|---|---|---|
| 付费内容 | 静态字符串处理（占位示例） | PoW 铸造 NFT | **持续演化的生命经济体** |
| 买方角色 | 消费者 | 矿工 | **消费者 + 选择压力的施加者** |
| 是否有状态 | 无 | 链上 NFT | **长期演化的持久状态** |
| 适应度来源 | — | 算力 | **市场需求（无人设计）** |
| x402 scheme | `exact` | — | **`exact` + `upto`** |
| 可验证性 | 无 | 链上 seed | **keccak populationRoot，可上链存证** |
| 依赖 | Next.js+Supabase+LangChain | Next.js+viem+sharp | **零依赖纯 Node** |
| AI 发现层 | 无 | 完整 | 完整（且内嵌实时演化状态） |

**"外部资金改写演化方向"这件事，目前 Arc 上没有第二家在做的。**

---

## 7. 风险与诚实判断

### 🔴 市场风险（最大，且无法用技术解决）
Arc 生态极早期。我实测了一个已上线的同类项目（Proof of Architect）：上线 1.5 天，累计流水 **632 USDC**，127 个钱包。Circle 官方示例仓库 43 star。
→ **短期真实收入接近 0。** 层次 A 的补贴会一直占主导，直到有真实流量。
→ 真正的回报是：① 被 Circle `sample-apps` / Arc Studio / `circlefin/skills` 收录的位置价值（这个赛道**没有竞品**）；② Agent 经济入口位；③ 一个技术上真的站得住的作品。

### 🔴 补贴 ≠ 经济（必须讲清楚）
在层次 C 实现之前，这**不是一个自持经济体**，而是一个用 USDC 计价、由运营方补贴的封闭模拟。
→ 对外表述必须准确，不能暗示生命体"自己在赚钱养活自己"。目前它们赚的是补贴。
→ 余额不可提现是正确的隔离措施，**不要打开提现**，否则层次 A 就是印钞机。

### 🟡 赢家通吃会毁掉生态位（已修复，但值得记录）
最初的 `creditExternalCall` 把全部收入给单个最优个体。实测结果：注入 $1.20 后该生态位**灭绝**（16 → 0）。
机制：意外之财 → 繁殖爆炸 → 后代互相压价 → 均价 $0.0025 崩到 $0.00087 → 毛利跌破代谢成本 → 集体饿死。
→ 已改为按市场出清的同一套 softmax + 容量规则**按份额分配**。这是一个真实发现的经济学 bug，值得写进博文。

### 🟡 SDK 版本漂移
`arc-nanopayments` 锁 `^2.0.4`，当前 latest **3.5.0**，且示例把网络/USDC/GatewayWallet **硬编码成 testnet**。
→ 本项目已抽成 `NETWORKS` 表；但 Circle 的 Gateway Wallet 地址若变更需同步。上主网前必须重新核对 SDK dist 里的常量。

### 🟡 mock facilitator 误用
`PP_FACILITATOR=mock` 接受任何金额正确的签名。**误上生产 = 所有端点免费。**
→ 已在启动 banner + README + 首页三处警告。**待实现**：`mock` + `NODE_ENV=production` 直接拒绝启动。

### 🟡 算力与状态增长
单 tick ~1.5ms（150 个体）。`POST /api/bio/tick?ticks=500` ≈ 0.75s CPU，可被滥用。
`history` / `events` / `fossils` 已做环形截断（8000/6000/6000），但 `.data-bio/biosphere.json` 会持续增长。
→ **待实现**：全局 tick 并发闸、每钱包限流、化石归档到冷存储。

### 🟢 确定性依赖外部调用序列
`populationRoot` 可复现的前提是**外部 x402 调用序列也被记录**。目前 `events` 里有 `EXTERNAL_CALL`，但没有专门的"输入日志"。
→ **待实现**：把每次外部注入记成 append-only 的 `inputs.jsonl`，这样第三方能完整重放。这是可验证性的最后一块。

---

## 8. 下一步（按优先级）

1. **`inputs.jsonl` 输入日志** → 完整可重放，可验证性闭环（半天）
2. **安全阀**：`mock` + `production` 拒绝启动；全局限流与 tick 并发闸（半天）
3. **MCP server**：把 12 个端点暴露成 MCP 工具（`biosphere_state` / `buy_service` / `inject_demand` / `seed_genome` / `get_fossils`），Agent 才能自主发现（1–2 天）
4. **`ops/broadcaster.js`**：事件流 → X 帖子草稿队列（1 天，发布需你的凭据）
5. **Arc Testnet 全流程**：`faucet.circle.com` 领水 → `PP_FACILITATOR=gateway` → 跑通真实 EIP-3009 签名与 Gateway 批量结算（1–2 天）
6. **层次 C 补贴退坡** → 让某个生态位真正自持（2–3 天）
7. **`BiosphereRegistry.sol`**（Phase 1）用 `circlefin/arc-foundry` 部署到测试网（2–3 天）
8. **提交 Circle sample-apps / x402 生态目录**

---

## 9. 参考

- Arc 文档索引 https://docs.arc.io/llms.txt ｜ 全量 https://docs.arc.io/llms-full.txt
- Arc nanopayments 示例 https://github.com/circlefin/arc-nanopayments
- Circle x402 SDK https://www.npmjs.com/package/@circle-fin/x402-batching
- x402 协议 https://x402.org ｜ https://github.com/x402-foundation/x402
- x402 网络支持 https://docs.x402.org/core-concepts/network-and-token-support
- Circle Skills（含 `use-arc`） https://github.com/circlefin/skills
- Arc Foundry fork https://github.com/circlefin/arc-foundry
- Circle Faucet https://faucet.circle.com ｜ Arc Studio https://studio.arc.io
