# ARGUS 发射执行方案 — Arc Biosphere

> 已实测核对：Argus `/create` 表单字段（SSR HTML）、5 个配对资产的链上地址与精度、
> 代币模板实现合约、初始市值与毕业线推算、平台币市值。核对时间 2026-09-22。

---

## 0. 核心策略：让代币税成为生态的燃料，而不是套在项目外面的壳

这是整个方案的地基。

**问题**：Argus 是 bonding-curve memecoin 发射台。一个「自主生命经济体」直接挂上去，
默认结果就是变成又一个猫币，同时把 Circle/Arc 黑客松的评审印象搞坏。

**解法**：把 Argus 的**交易税 creator share 直接接进生物圈的补贴池**，并且**全部上链可验证**。

```
代币买卖 → 1–10% 税 → 四方分配
                          ├─ Creator funds ──→ SubsidyPool.sol (Arc 主网)
                          │                        ↓
                          │                  生物圈的基线需求补贴
                          │                        ↓
                          │                  生命体存活 / 繁殖 / 演化
                          ├─ Buyback & burn
                          ├─ Dividends
                          └─ Liquidity (Auto-LP)
```

这样一来：

1. **DESIGN.md §3 的「补贴 = 幻影收入」问题被真实资金解决了。** 生命体赚的基线收入不再是我自掏腰包的记账数字，而是代币交易税真金白银打进合约的 USDC。
2. **币价与生态活跃度之间有了真实因果链**，不是纯叙事：交易越活跃 → 税收越多 → 补贴越足 → 种群越大 → 内容/数据越有价值 → 吸引真实 x402 客户。
3. **它变成了一个 "Programmable Money" 故事** —— 而这正好是 Encode Club / Circle 那个加速器的名字。提交材料里可以写：「我们发射了一个代币，它的交易税在 Arc 主网上可验证地资助一个自主 Agent 经济体的存续」。这不是 memecoin，这是**可编程现金流驱动的人工生命**。

### 必须同时做的反身性阻尼（否则就是庞氏回路）

上面的循环有一个致命正反馈：**币价高 → 税收多 → 补贴多 → 生态看起来繁荣 → 币价更高**。
不加阻尼就是自欺欺人的泡沫。三条硬约束：

**① 补贴退坡（DESIGN.md 层次 C，必须实现）**
```
effectiveBaseDemand(n) = baseDemand(n) × subsidyDecay(n)
subsidyDecay(n)        = max(0, 1 − realX402Revenue(n, 30d) / baseDemandValue(n))
```
某生态位的**真实 x402 收入越高，补贴越低**，直到归零。税收再多也不能让补贴超过这个上限。
→ 税收只能**加速**生态成熟，不能**替代**真实需求。

**② 真实收入比率，公开且上链**
```
realRevenueRatio = realX402Revenue / (realX402Revenue + subsidyDrawn)
```
这个数字必须显示在：首页、`/api/bio/meta`、`llms-full.txt`、以及 `SubsidyPool.sol` 的链上状态。
趋近 1 = 生态是真的；停在 0.1 = 所有人都能看见它靠补贴活着。**不做这个，前面全是空话。**

**③ 补贴池有上限，且只能被合约按公式提取**
`SubsidyPool.sol` 的 `draw()` 只允许 biosphere keeper 调用，且单次额度受公式约束；
`treasury` 不可变；任何人可 `verifyDraw()` 复核。**运营方不能拿补贴池的钱去买自己发的币。**

---

## 1. 发射参数（Argus `/create` 表单逐项）

> 以下每一项 **Argus 都在发射时锁死，之后不可更改**。逐项确认后再点 Launch。

| 字段 | 建议值 | 理由 |
|---|---|---|
| **Token image** | 512×512 PNG，深色底 + 培养皿/菌落图形 | 要求方形 ≥64px，PNG/JPG/GIF/WebP。首页缩略图极小，必须高对比、无细节 |
| **Name** | `Arc Biosphere` | 与项目名一致，便于检索 |
| **Ticker** | **`BIOME`**（首选）或 `SOLV` | `BIOME` = 生物群系，好记、可品牌化；`SOLV` = solvency，直接把核心论点「fitness is solvency」编码进 ticker，更硬核但更难懂。**发射前先在 Argus 搜索框查是否被占** |
| **Description**（≤280 字符） | `Autonomous artificial-life economy on Arc. Organisms hold USDC, pay upkeep to stay alive, earn revenue by competing for x402 customers. No fitness function — fitness is solvency. This token's tax funds their subsidy pool, on-chain and verifiable.` | 280 字符内必须说清「不是 memecoin」+「税去哪了」 |
| **Paired asset** | **USDC** | ①项目本身 USDC 计价，语义一致 ②USDC 池是 Argus 上最深的（实测 $4.8M 市值 / $175K 流动性那条就是 USDC 池）③dev buy、税、creator share 全部以它结算，避免二次汇率风险。**不要选 ARGUS** —— 那会让你的币价变成 ARGUS 币价的衍生品 |
| **Buy tax** | **3%** | 1–10% 区间。太低养不起补贴池，太高杀交易量。3% 是 Argus 上「Diamond hands / Deflationary」预设的默认档，用户接受度最高 |
| **Sell tax** | **3%** | 与买税对称。非对称税（买低卖高）在 bonding curve 阶段会显著抑制早期成交 |
| **Tax allocation**（四方，必须合计 100%） | **Custom**：<br>Creator funds **55%**<br>Liquidity **25%**<br>Buyback & burn **15%**<br>Dividends **5%** | 见 §1.1「税到底进谁的口袋」 |
| **Dev buy** | **$150–400 USDC**（≤ 供应量的 2%） | 见 §2 的警告 |
| **Creator funds wallet** | **一个专用的 2/3 Safe 多签**，不要用你的 EOA | **这个地址收 100% 的 Creator funds 份额，钱是你的。** 用多签是为了让你之后能自由决定「自己留多少 / 拨多少给生态」，且这个决定对外可信 |

---

## 1.1 税到底进谁的口袋（重要，前一版方案在这里说错了）

Argus 的税分四份，**只有 Creator funds 那一份是你的**：

| 份额 | 去向 | 是你的吗 |
|---|---|---|
| **Creator funds** | 打到你在 `/create` 填的 **Creator funds wallet**（配对资产计价，永久锁定） | ✅ **是，100% 归你** |
| Buyback & burn | 合约自动回购并销毁 | ❌ 用于支撑币价 |
| Dividends | 分给持币者 | ❌ 分给持币者 |
| Liquidity (Auto-LP) | 自动加进池子 | ❌ 用于加厚流动性 |

**所以「税给我」是对的** —— 前一版方案写「Creator funds 60% → 全部进 SubsidyPool」是我表述错了，
那等于你一分不拿。正确的架构是**两层**：

```
第 1 层（Argus，发射时锁死，永不可改）
  3% 买税 + 3% 卖税
    ├─ Creator funds  55%  ──→  你的 Safe 多签        ← 这笔钱完全归你处置
    ├─ Liquidity      25%  ──→  自动进池子
    ├─ Buyback        15%  ──→  自动回购销毁
    └─ Dividends       5%  ──→  自动分给持币者

第 2 层（你的 Safe，随时可改，不需要动 Argus 参数）
  Safe 收到的 creator share
    ├─ 60–70%  →  团队钱包（你的收入）
    └─ 30–40%  →  SubsidyPool.donate()（生态燃料）
```

**关键好处**：Argus 的参数发射后永久锁死，但**你和生态之间的分成比例在 Safe 层，随时可调**。
生态起不来就少拨，起来了就多拨；想全留也可以。这个灵活性千万别在第 1 层浪费掉。

> 想让「拨款给生态」这件事对外可信，可以给 Safe 装一个 module，把比例写死并公开 —— 但这是**可选**的，
> 不装也完全不影响你的控制权。

### Creator 份额该设多少：不是道德问题，是期望值问题

税 = 交易量 × 3%（买卖各 3%）。每 $1,000 交易额产生 $30 的税，按份额分：

| 方案 | 分配 (C/B/L/D) | 日量 $1K | $5K | $10K | $50K | $200K |
|---|---|---|---|---|---|---|
| A 全拿 | 100/0/0/0 | **$30** | **$150** | **$300** | **$1,500** | **$6,000** |
| B 重收入 | 70/10/15/5 | $21 | $105 | $210 | $1,050 | $4,200 |
| **C 平衡（推荐）** | **55/15/25/5** | $16.5 | $82.5 | $165 | $825 | $3,300 |
| D 重生态 | 40/20/35/5 | $12 | $60 | $120 | $600 | $2,400 |

**方案 A 的费率最高，但期望值最低。** 原因：

- **Liquidity 份额 = 0** → bonding curve 极薄 → 实测 Argus 上大量代币**卡在 0%–6% of milestone**，永远毕不了业
- **Buyback 份额 = 0** → 没有任何价格支撑 → 毕业到 Uniswap v4 后第一批获利盘砸下来就归零
- 代币活不过两周 → 交易量归零 → **你的 100% × $0 = $0**

算一笔期望值：
```
方案 A：$30/天 × 14 天然后死透          ≈ $420 总额
方案 C：$16.5/天 × 60 天 + 毕业后 $825/天 × 90 天 ≈ $75,000 总额
```
**放弃 45% 的费率，换来的是能不能活到第 15 天。** 这不是慈善，是让你自己的收入流存在下去。

> 而且 Liquidity 和 Buyback 那两份**并没有消失**：它们变成池子深度和币价支撑，
> 你的 dev buy 持仓和后续交易量都从中受益。

### 你的收入不止税这一条

| 流 | 来源 | Argus 抽成 | 稳定性 |
|---|---|---|---|
| ① **x402 平台费** | 所有 `/api/bio/serve` 调用的 5% → 你的 treasury | **无** | 随真实需求增长，**这才是业务本体** |
| ② 代币 creator share | Argus 交易税 | 已含在份额里 | 高度依赖交易量，**极不稳定** |
| ③ Dev buy 持仓 | 毕业线 $47K ÷ 初始 $2.5K = **18.8×** 价格空间 | 卖出时 3% 卖税 | 一次性，且卖出会自己砸盘 |
| ④ Grant / 加速器 | Arc Microgrants 500 USDC、Encode 加速器（11 月投资人 Demo Day） | 无 | 一次性，但**通道价值远大于金额** |

**② 是最小、最不稳的一条。** 把它的一部分投回生态，是为了让 ① 和 ③ 存在。

### 拨多少给生态：把 SubsidyPool 当成本，不是当慈善

生物圈需要「需求」才有意思。基线需求目前是我补贴的（DESIGN.md §3 层次 A）。
如果不投钱进去，生态就是一潭死水，没人愿意为 `/serve` 付费，① 也起不来。

**建议 Safe 层比例：你 65% / SubsidyPool 35%。**
净效果：每 $1,000 交易量 → $30 税 → $16.5 creator → **$10.7 进你口袋，$5.8 进生态**。

这 $5.8 是你产品的**变动成本**，跟 SaaS 的服务器账单一个性质 —— 而且它链上可查，
可以当成营销素材：「本周生态从代币税里收到了 $X，realRevenueRatio 从 0.12 涨到 0.19」。

### 四方分配的理由

**Creator funds 60%** → 全部进 `SubsidyPool.sol`。这是整个方案的目的，占比必须最大。
按 3% 买 + 3% 卖、60% 归 creator 计算：**每 $1,000 交易额产生 $18 的生态补贴**。

**Buyback & burn 20%** → 通缩。毕业到 Uniswap v4 后这是唯一能对抗增发抛压的机制。
而且它和 §0 的阻尼设计天然配合：生态越活跃 → 税收越多 → 回购越多。

**Liquidity 15%** → Auto-LP。bonding curve 阶段加厚曲线，毕业后加厚 v4 池。
**这一项决定你能不能毕业**。实测 Argus 上大量代币卡在 0%–6% of milestone，流动性不足是主因。

**Dividends 5%** → 象征性。给早期持有者一点现金流叙事，但**不要设高**：
高分红 = 明确的收益权 = 证券特征最强的一档。5% 是「有，但不构成投资动机」的量级。

> ⚠️ 如果你的目标里有黑客松评审，把 Dividends 设成 **0%**，把那 5% 挪给 Creator funds。
> 少一个「持有代币获得分红」的说法，证券面就少一大块。

---

## 2. Dev buy：这是最容易把自己搞死的一项

Dev buy 是可选的，用配对资产（USDC）在发射瞬间买入。

**建议：$150–400，且不超过总供应量 2–3%。**

⚠️ **注意尺度**：初始市值只有 **$2.5K**（1B 供应 × $0.0000025）。所以 $300 的 dev buy
相当于**初始市值的 12%** —— 在 bonding curve 上这是很大的一笔，会显著推高你的成交均价，
并吃掉可观的供应量。**发射时 Preview 卡片会显示你的实际持仓占比，以那个数字为准。**

⚠️ **别把 18.8× 当成你的收益**：毕业线 $47K ÷ 初始 $2.5K = 18.8× 是**价格**空间，
但你的 dev buy 是在曲线上成交的，均价高于 $0.0000025；而且真要变现就得卖，
卖会自己砸盘 + 吃 3% 卖税。**把它当成「有 skin in the game 的信号」，不要当成财务模型。**

理由：
- Argus 上毕业线（milestone）按实测推算约 **$47K 市值**（46.4% ↔ $22.2K、65% ↔ $30.2K 两个自洽点反推）。
  初始市值 $2.5K（1B 供应 × $0.0000025）。
- Dev buy 太大会让你**一开始就吃掉曲线的一大段**，后来者的买入成本立刻抬高，
  在 Argus 这种以「King of the Hill / 最接近 $30K」为叙事的环境里，这会被读作老鼠仓。
- Dev buy 太小则你在毕业后没有筹码做市/护盘。
- 2% 是「有 skin in the game，但不构成控盘」的区间。

**并且：把 dev buy 的钱包地址、数量、以及锁仓承诺写进项目文档和代币描述。**
不写，社区会自己去链上翻，然后按最坏的意图解读。

---

## 3. 发射前必须完成的工程

按依赖顺序排。**S1 是硬前置** —— 没有它，§0 的整个策略就不成立，发射就真的只是发个 memecoin。

### S1 · `SubsidyPool.sol`（Arc 主网，~200 行，1–2 天）

```solidity
// 接收 Argus creator share，按公式向生物圈 keeper 放款，全程可验证
contract SubsidyPool {
    address public immutable treasury;        // 2/3 Safe，不可变
    address public immutable usdc;            // 0x3600000000000000000000000000000000000000 (6 dec)
    address public immutable registry;        // BiosphereRegistry
    address public keeper;                     // 生物圈服务地址（可由 treasury 更换）

    uint256 public totalIn;                    // 累计收到的税
    uint256 public totalDrawn;                 // 累计放款给生态
    uint256 public realRevenue;                // 由 keeper 申报、可抽查的真实 x402 收入

    // 单次放款上限 = f(池子余额, 真实收入比率)，写死在合约里，keeper 无法超额
    function maxDraw() public view returns (uint256);
    function draw(uint256 amount, bytes32 populationRoot, uint32 epoch) external;  // onlyKeeper
    function reportRealRevenue(uint256 amount, bytes32 merkleRoot) external;         // onlyKeeper
    function realRevenueRatio() external view returns (uint256 bps);                 // 关键透明度指标
    function donate() external payable;        // 任何人可补充补贴池
    function sweepToTreasury(uint256 amount) external;  // onlyTreasury，且有速率限制
}
```

要点：
- `treasury` **不可变**，`sweepToTreasury` 有**速率限制**（例如每 7 天 ≤ 池子的 10%），
  否则「补贴池」和「团队钱包」没有区别，§0 的可信度归零。
- `maxDraw()` 必须实现 §0 的退坡公式：`realRevenueRatio` 越高，可放款越少。
- 每次 `draw` 都带 `populationRoot` + `epoch`，和 `BiosphereRegistry` 交叉验证。

### S2 · `BiosphereRegistry.sol`（Arc 主网，~120 行，0.5–1 天）

```solidity
function commitRoot(uint32 epoch, bytes32 populationRoot, uint32 population, uint32 generation) external; // onlyKeeper
function roots(uint32 epoch) external view returns (bytes32);
function verifyGenome(bytes32 root, bytes32 genomeHash, uint96 energy, uint32 gen, uint32 age, bytes32[] proof) external view returns (bool);
```
这本来就是 DESIGN.md Phase 1 的东西，也是 **Arc Microgrants 的硬性要求**（主网部署）。
一份工作同时满足两个目的。

### S3 · 补贴退坡（`src/life.js`，0.5 天）

把 `NICHES[].baseDemand` 改成运行时函数：
```js
effectiveBaseDemand(n) = n.baseDemand * subsidyDecay(n)
subsidyDecay(n) = Math.max(0, 1 - realRevenue30d(n) / baseDemandValue(n))
```
`realRevenue30d` 从 `EXTERNAL_CALL` 事件流读取（只统计 `/serve` 与 `/demand`，不统计模拟需求）。

### S4 · `inputs.jsonl` 输入日志 + `replay.js`（0.5 天）

可验证性的最后一块。每次外部注入 append 一行：
```json
{"tick":1234,"type":"EXTERNAL_CALL","niche":"entropy","calls":5,"revenue":"20000","payer":"0x..","tx":"0x.."}
```
`replay.js` 从种子 + 输入日志重放出**逐字节相同**的演化历史和 `populationRoot`。
这是你在黑客松评审面前最有说服力的一件事。

### S5 · 公开仓库 + 公网部署（0.5 天）

- GitHub 公开仓库（**Arc Microgrants 硬性要求 GitHub/GitLab/Bitbucket 链接**）
- 生物圈服务器部署到公网（Fly.io / Railway / 一台 VPS 都行，Node 20+ 即可，零依赖）
- `PP_FACILITATOR=gateway` + `PP_NETWORK=arc`，先在 **Arc Testnet（5042002）** 用
  `faucet.circle.com` 跑通真实 EIP-3009 签名与 Circle Gateway 批量结算，再切主网

### S6 · 代币实用面（发射后再做也来得及，但越早越好）

给代币真实的 sink，否则它只有交易税一条命：
1. **Founder slot**：销毁 N 枚代币 → 获得一次 `POST /api/bio/seed`，且创始人能量 ×2
2. **Demand 折扣**：用代币支付 `/api/bio/demand` 打 8 折（USDC 支付全价）
3. **LineageNFT**：用代币铸造冠军血统 NFT（可交易基因组，可作为下一纪元创始人）
4. **Epoch verifier 质押**：质押代币成为 `populationRoot` 验证者，分平台费，提交假 root 被罚没

> 第 4 项最有价值 —— 它把「可验证性」从口号变成有经济后果的行为。

---

## 4. 发射日 Runbook

### T-7 天
- [ ] 确认 ticker `BIOME` / `SOLV` 在 Argus 搜索框未被占用
- [ ] 制作 512×512 代币图（深色底、高对比、缩略图下仍可辨）
- [ ] 写好 280 字符描述并数字符
- [ ] **创建一个专用 2/3 Safe 多签**作为 Creator funds wallet（用 Safe{Wallet} 部署到 Arc 主网，
      参考 Proof of Architect 的做法：Safe 1.4.1，3 签名人阈值 2）
- [ ] 通过 Argus 的 **Bridge** 按钮或 CCTP（Arc domain = `26`）把 USDC 桥到 Arc 主网
- [ ] 准备发射钱包的 gas：Arc gas 是 USDC，floor 20 gwei，`maxFeePerGas = max(20 gwei, 2×baseFee)`，
      `maxPriorityFeePerGas = 0`。留 **$20–50 USDC** 足够几十笔交易
- [ ] S1 + S2 已部署到主网并在 explorer.arc.io **验证源码**

### T-1 天
- [ ] 生物圈公网 URL 可访问，`/api/bio/meta` 返回真实 tick 与 populationRoot
- [ ] `llms-full.txt` 已内嵌当前演化状态
- [ ] 首页、`/api/bio/spec` 的 `honesty` 字段已更新为「补贴来自代币税，链上可验证」
- [ ] 准备发射公告（X 帖 + Telegram），包含：Safe 地址、SubsidyPool 地址、realRevenueRatio 在哪看
- [ ] **在 Argus `/create` 页面把所有参数填完，截图 Preview 卡片，逐项对照 §1 表格**

### T-0 发射
1. 连钱包（发射钱包，不是 Safe）
2. 填 Token details：image / Name / Ticker / Description / socials（Website、X、Telegram）
3. Paired asset → **USDC**
4. Advanced → Buy tax 3% / Sell tax 3%
5. Tax allocation → **Custom**：Creator 60 / Buyback 20 / Liquidity 15 / Dividends 5
   （**页面会校验合计必须 100%，不到 100% 无法发射**）
6. Creator funds wallet → **填 Safe 地址**（填错永久锁死，复制粘贴后逐字符核对）
7. Dev buy → 填 USDC 金额（$150–400）
8. **检查 Preview 卡片**：初始市值应为 $2.5K、价格 $0.0000025、税率 3%/3%
9. Launch
10. 立刻记录：代币合约地址（会是 `0x122c82cfca7a3a2227285cc21f4522e8f551db3a` 的 EIP-1167 克隆）、
    发射交易哈希、Argus 页面 URL
11. 在 explorer.arc.io 上确认代币合约存在，并检查 Argus 是否已验证模板源码

### T+0 到 T+1 小时
- [ ] 把 creator share 的接收路径打通：Argus 把 creator share 打到你的 Safe →
      **Safe 多签执行一笔转账，把收到的 USDC 全部转进 `SubsidyPool.donate()`**
- [ ] 把这第一笔转账的哈希公开（X + 项目文档）。**这是整个可信度叙事的第一块砖**
- [ ] 生物圈服务端开始从 `SubsidyPool` 读取余额，`/api/bio/meta` 暴露
      `subsidyPoolBalance` 与 `realRevenueRatio`

---

## 5. 毕业后（Bonding curve → Uniswap v4）

Argus 的机制是达到 milestone 后「毕业」，代币转到 **Uniswap v4** 池子交易。

毕业前你要做的：
- **盯 Liquidity 那 15% 的税**。实测 Argus 上大量代币卡在 0%–6% of milestone，
  流动性不足是主因。如果发现进度停滞，考虑用 SubsidyPool 之外的团队资金做一次 LP 加注。
- **每 24 小时发一次生态战报**（用 §4.2 的 broadcaster）：种群、世代、灭绝、
  realRevenueRatio、SubsidyPool 余额、populationRoot。
  **这是你和其他 Argus 代币唯一的区别** —— 别的币没有每天在真实演化的东西可以播报。
- 把 `POST /api/bio/demand` 做成一个显眼的「用 USDC 干预进化」入口，
  并在 X 上直播每次干预的后果。这是天然的传播素材。

毕业后：
- Uniswap v4 池子建立后，税的 Liquidity 份额继续加厚池子
- 上线 §3-S6 的代币实用面（Founder slot / NFT / verifier 质押），给代币真实的 sink
- 此时才有资格谈「代币有用途」，之前都还只是税

---

## 6. 风险与不可越过的护栏

### 必须守住的三条线

**① 生命体的 USDC 余额永远不可提现。**
这条一旦破，补贴就变成印钞机，代币变成对一个凭空记账系统的索赔权。
写在 `README.md`、`DESIGN.md`、`/api/bio/spec` 的 `honesty` 字段里，三处都要有。

**② `realRevenueRatio` 必须公开且真实。**
不要美化，不要只报好看的窗口。如果它长期停在 0.1，就如实说
「目前生态 90% 靠代币税补贴」。主动披露是唯一能保住信誉的做法，
被社区自己算出来则项目直接死。

**③ SubsidyPool 的钱不能用来买自己发的币。**
`sweepToTreasury` 有速率限制，且回购只能来自合约的 Buyback 份额（那是 Argus 层面自动执行的）。
团队手动用补贴池回购 = 操纵，且链上一查就知道。

### 其他风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| **反身性泡沫** | 币价↑→税↑→补贴↑→生态看起来繁荣→币价↑ | §0 的三条阻尼，特别是退坡公式写进合约 |
| **证券属性** | Dividends 份额 = 明确收益权 | 设 0% 或最多 5%；不做任何「持有代币分享生态收入」的宣传 |
| **Argus 平台风险** | 模板合约 `0x122c…db3a` 未经审计（未找到审计报告），所有代币都是它的 EIP-1167 克隆；平台方单方面改规则你无法阻止 | 发射前在 explorer 上读一遍模板源码；不要把项目核心资产（SubsidyPool）放在 Argus 合约里，两者**必须是独立合约** |
| **毕业失败** | 实测大量代币卡在 0%–6% of milestone，永远毕不了业 | Liquidity 税 ≥15%；发射后持续做内容和真实需求注入 |
| **黑客松评审负面印象** | Argus 上主流是 `A Retarded Cat` / `STABLECAT` / `USDC Cat` 这类 | 提交材料里**第一段就讲 SubsidyPool 的链上可验证资金流**，把代币定位成 Programmable Money 的基础设施，而不是融资工具 |
| **狙击/老鼠仓指控** | Dev buy 会被链上追踪 | Dev buy ≤2%，钱包与数量主动公开 |
| **仿冒** | 实测 Argus 上已有 `dоt`（西里尔字母 о）这类仿冒 | 发射后立刻在所有官方渠道公布**唯一**合约地址，并在 Argus 页面填满 socials |

---

## 7. 与黑客松时间线的整合

**Arc Microgrants（DoraHacks）截止 2026-10-14**（页面口径；按 10-13 提交留缓冲），硬性要求「已部署且在 Arc 主网运行」+ GitHub 链接。草稿见 `docs/submissions/arc-microgrants.md`。

推荐顺序（**先工程，后发射**）：

| 周 | 工程 | 发射 |
|---|---|---|
| W1（→9/29） | S2 `BiosphereRegistry.sol` 上主网 + 验证源码；S5 公开仓库 + 公网部署 | — |
| W2（→10/6） | S1 `SubsidyPool.sol` 上主网；S3 退坡；S4 输入日志 + replay | **Argus Testnet 演练一次完整发射流程**（若 Argus 支持；不支持则用小额真金在主网演练参数填写） |
| W3（10/7–10/13） | S5 gateway 模式跑通真实 x402；录 2 分钟 demo | **10/8–10/10 正式发射** |
| W4（10/13） | 整理提交材料 | **10/13 提交 Arc Microgrants**（截止 10-14，留 1 天缓冲） |

**为什么先工程后发射**：发射时如果 SubsidyPool 还没上链，你的代币税就只能进 Safe，
§0 的整个叙事当场破产，而且**无法追溯补救**（发射参数锁死）。
反过来，先有合约再发射，第一笔税就能公开转进 SubsidyPool，可信度从第 0 分钟就成立。

**并行**：
- 给 Encode Club 发邮件问 **Programmable Money Accelerator**（9/21 刚 Kickoff，8 周 + 11 月投资人 Demo Day）能否补录
- 订阅 community.arc.io/events 与 lablab.ai —— lablab 那届 "Agentic Commerce on Arc"（$50K USDC + GCP credits，Arc/Circle 主办，Google DeepMind 支持）已在 1 月办过，**很可能再办**，我们这套东西是量身定做的
- Global x402 Challenge（$100K + 500K ALGO）提交截止 **9/30**，只剩 8 天。x402 原生支持 Algorand（ASA transfer，USDC ASA ID `31566704`），做多链版本有资格，但时间极紧 —— **只有在 S1–S5 都已完成的前提下才考虑**

---

## 8. 已核对的链上事实（发射时直接引用）

### Argus 代币机制
| 项 | 值 |
|---|---|
| 代币模板实现合约 | `0x122c82cfca7a3a2227285cc21f4522e8f551db3a`（~11 KB，**未找到审计报告**） |
| 每个代币 | 该实现的 **EIP-1167 最小代理克隆** |
| 初始市值 / 价格 / 供应量 | $2.5K / $0.0000025 / 1,000,000,000 |
| 毕业 milestone | 约 **$47K 市值**（由 46.4%↔$22.2K、65%↔$30.2K 两个自洽点反推，**发射前在 Preview 卡片上确认**） |
| 毕业后 | 转到 **Uniswap v4** 池子交易 |
| 买/卖税 | 各 **1–10%**，发射后锁死 |
| 税的四方分配 | Creator funds / Buyback & burn / Dividends / Liquidity，**必须合计 100%** |
| 预设 | Creator-backed（1% creator）· Diamond hands（3% dividends）· Deflationary（3% buyback）· Auto-LP（3% liquidity）· Custom |
| 全部参数 | **发射时锁死，不可更改**（含 Creator funds wallet） |

### 配对资产（Arc 主网，均已链上核对）
| 资产 | 地址 | 精度 |
|---|---|---|
| **USDC** ← 推荐 | `0x3600000000000000000000000000000000000000` | **6**（native gas 视图是 18，勿混） |
| EURC | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` | 6 |
| cirBTC（Circle Wrapped Bitcoin） | `0x171A4217b86A807A64eB94757Db6849fb4bDbAA0` | 8 |
| ARGUS | `0xeCe5cA8bf9220718E5727754026757512212cb3c` | 18（1B 供应，EIP-1167 克隆） |
| ARCASH | `0x0BFFa97f774824e9dA843699aEDd2835cb1b8022` | 18（1B 供应，EIP-1167 克隆） |

### 平台现状（实测首页，2026-09-22）
- `$ARGUS` 平台币：**$25.34M 市值，+769.8%，$1.64M 流动性**
- 首页在发射的代币：`Potato ARC` $26.7K · `A Retarded Cat` $35.9K(+1348.7%) · `Blackrock` $30.2K ·
  `Arcos` $39.0K · `Ultra Serious Dancing Cat` $22.2K · `NOW on Arc` $20.0K · `Arc.win` $19.7K ·
  `DIHCOIN` $2.56K · `STABLECAT` / `USDC Cat` / `HoodARC` / `BEEP` / `dоt`（西里尔字母仿冒）
- **典型毕业前市值 $2.5K–$39K**，milestone 进度大量停在 0%–6%

### Arc 链参数
| | 主网 | 测试网 |
|---|---|---|
| Chain ID | `5042` | `5042002` |
| RPC | `https://rpc.mainnet.arc.io` | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.arc.io` | `https://explorer.testnet.arc.io` |
| Faucet | —（CCTP domain `26` 或 Argus 的 Bridge 按钮） | `https://faucet.circle.com` |
| Gas | USDC，floor 20 gwei，ceiling 20,000 gwei，EWMA 平滑，base fee 不销毁 |

---

## 9. 一句话总结

**先上 `SubsidyPool.sol` + `BiosphereRegistry.sol`，把退坡公式写进合约，再发射。**
这样代币税就是生态的真实燃料，链上可验证，`realRevenueRatio` 公开可查 ——
你发的就不是一个挂在生命经济体旁边的 memecoin，而是**这个经济体的供血系统**。
顺序反了，就只剩下一个 memecoin。

---

## 10. 2026-09-22 深夜链上复核补充（本文 §8 的更正与加强）

> 详细核查过程与果蝇赛道数据见 `果蝇赛道核查与ARGUS发射执行方案.md`。这里只列对本方案有影响的部分。

### 10.1 Argus 发射门户地址（新确认）
**`0xb021be536808f551b31789422fd28a6c9c6e97da`**（23,845 字节，`admin()` = `0xf5a088fd51f93f798ad3f11e13b737ded990eeeb`）
一笔 `launch` 交易完成：部署代币克隆 → 部署 locker/hook/splitter → 开 Uniswap v4 曲线 → 锁定费率 → 可选 DevBuy。
`launch` 调用还携带事件里没有的入参：**总供应量、曲线目标、配对资产、metadata URI**（Bitquery Arc 文档已解码）。

事件签名哈希（可直接用于 `eth_getLogs` 过滤）：

| 事件 | topic0 |
|---|---|
| `TokenCreated` | `0x1d8917231579f8ce39407f0d616f36f357b07329b0ce5164d0754ac15145ce0a` |
| `PartsDeployed` | `0xa54419a494ae20a1807712ab7a33ff0928b9a0e6e03e4562885aedb8e8fcd4da` |
| `CurveOpened` | `0x55e45784ac0f1201c142dd0d2119dd11980e98f34cb682c49340d5c28c3a9aa0` |
| `FeeConfigured` | `0xabe14607f311bb63e5b35c469f88100e8fb2ff250876e2364a402e2f2679e8aa` |
| `DevBuy` | `0x84d429ed8af1c9cfe8bb07b556e4120e976c9f4c9232a7f50a15d31d83e232a9` |

### 10.2 §1.1「税到底进谁的口袋」的更正
**平台先抽 10%。** `FeeConfigured` 的 8 个字段实测语义（27 个近期样本，后 4 项之和恒为 10000）：

```
lpFeeBps · buyTaxBps · sellTaxBps · treasuryBps(=1000 恒定) · creatorBps · burnBps · dividendBps · liquidityBps
```

所以本方案 §1 的税率建议要按「净到手 = 税 × 90% × creator 份额」重算：

| 每 $1,000 成交 | 2% 买卖税 | 3% 买卖税 |
|---|---|---|
| 毛税 | $20 | $30 |
| Argus treasury 10% | −$2 | −$3 |
| Creator 55%（本方案） | **$9.9** | **$14.85** |
| → Safe 层 65% 团队 | **$6.4** | **$9.7** |
| → Safe 层 35% 生态 | **$3.5** | **$5.2** |

（§1.1 那张表里「每 $1,000 → $30 税 → $16.5 creator」的数字应按上表下修约 10%。）

### 10.3 §1「买税/卖税 3%」建议下修为 2%
实测 Argus 发射速率：09-17 峰值 ~2,461 枚/小时 → 09-22 ~32 枚/小时（**−98.7%**）。
在只剩 1.3% 流量的环境里，高税会进一步压成交。同赛道的 MURMUR 用的就是 **2%/2%**，且活到了第 5 天
（splitter 累计 1,397.93 USDC + 783,600 枚代币，creator EOA 4,454.28 USDC）。

### 10.4 MURMUR 就是本方案「方案 A 全拿」的活体样本
其链上费率向量：`lpFee 100 / buyTax 200 / sellTax 200 / treasury 1000 / creator 10000 / burn 0 / dividend 0 / liquidity 0`
→ **creator 100%、流动性 0、回购 0**，正是 §1.1 判定「费率最高但期望值最低」的配置。
它靠峰值流量活了 5 天，但毕业后没有任何价格支撑机制；且链上 website/twitter/telegram **三项全空**。
**这正是我们的差异化落点**：填全三项 + `BiosphereRegistry` 提交 `populationRoot` + 确定性重放 + `/verify` 对比看板。
