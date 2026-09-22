# 7 天落地执行方案 — Arc Biosphere 上 Argus

> 版本：2026-09-23 00:30（北京时间）· 前置阅读：`果蝇赛道核查与ARGUS发射执行方案.md`（赛道判断与参数依据）
> 本方案里的每一个数字都是**实测**的：合约已用 solc 0.8.37 编译、已在 Arc 主网做 EVM 模拟部署、
> 签名器已过 11 项自检并被主网节点验证接受。你只需要按天推进。


## ✅ 执行进度（2026-09-23 01:00 更新）— Day 2 的工程部分已经做完并实测通过

| 方案里的步骤 | 状态 | 实测证据 |
|---|---|---|
| Day 0 · 编译 | ✅ 完成 | solc 0.8.37，Registry / SubsidyPool / **MultiSigWallet** 全部零 warning |
| Day 0 · 干跑估 gas | ✅ 完成 | Registry 837,667 ≈ $0.017 · SubsidyPool 1,232,808 ≈ $0.025 · **MultiSigWallet(2/3) 1,126,970 ≈ $0.023**（主网+测试网模拟均通过，runtime 4,024 字节） |
| Day 1 · 部署工具 | ✅ 就绪 | `tools/deploy-contracts.js`（`--dry` 实测通过；设 `ARC_PK` 即可真部署） |
| Day 1 · 状态承诺循环 | ✅ 就绪 | `tools/commit-state.js`（实测算出 root，calldata 164 字节） |
| **Day 2 · S3 补贴记账** | ✅ **完成** | `src/life.js` 新增 `subsidyUSDC / realRevenueUSDC / subsidizedCalls / baselineUnits / externalUnits` 与 `honesty()`、`migrateCounters()`；`creditExternalCall(..., {subsidized})` 分流；**mock facilitator 下一律记为补贴，绝不冒充真实收入** |
| **Day 2 · S4 确定性重放** | ✅ **完成并验收** | `src/recorder.js`（genesis.json + inputs.jsonl）+ `tools/replay.js`；实测：实时 root `0x4ffc3c0c…c8de9` == 重放 root，tick/存活/世代全部一致（100 tick，367ms） |
| Day 3 · 网页 | ✅ **完成** | `web/index.html` 看板 + 服务器新增 3 个免费端点 `/dashboard`、`/verify`、`/api/bio/public`；实测全部 200：看板含链上证明/诚实账本/种群曲线/生态位表/x402 价目；`/verify` **实时读链**得到 MURMUR 45 字节、oBrain 4,724 字节 |
| Day 4 · 多签回退方案 | ✅ 完成 | `contracts/MultiSigWallet.sol`（N-of-M，无升级/无 delegatecall/无自毁，含 `erc20ApproveCalldata` 便捷方法） |
| X 运营 | ✅ 方案 + 工具就绪 | `outputs/X-运营方案.md`（定位/基建/4 类内容支柱/14 天排期/冷启动清单/KPI 止损/话术库/素材清单）+ `tools/x-digest.js`（data/launch/weekly/verify/thread 五种帖型，数字全部实时生成，实测 167–238 字符可直接发） |

**还剩的只有需要你本人做的事**：测试网/主网真实部署（要私钥与 USDC）、买域名、注册 X 账号、
建 Safe 或多签、Argus 网页上点发射。工程侧已经全部就绪。

新增/修改的文件：
```
contracts/BiosphereRegistry.sol   contracts/SubsidyPool.sol   contracts/MultiSigWallet.sol   (全部已编译到 build/)
src/life.js        (+honesty / migrateCounters / 补贴分流)
src/recorder.js    (新) genesis.json + inputs.jsonl
src/chain.js       (新) 链上承诺读取 + 补贴判定 + 创世初始化
src/public-routes.js (新) /api/bio/public · /verify · /dashboard
src/life-server.js (7 处小改：接入 recorder / chain / public-routes，并给 demand、serve 记账)
web/index.html     (新) 公开看板，零外部依赖
tools/arc.js · deploy-contracts.js · commit-state.js · replay.js · verify.js · x-digest.js
test-record.mjs · test-server.mjs · test-honesty.mjs   (回归测试，可重复跑)
```

---

## 0. 现在手上有什么（已验证）

| 资产 | 路径 | 状态 |
|---|---|---|
| 生命经济引擎（市场出清/代谢/繁殖/死亡/演化） | `outputs/pandemic-protocol/src/life.js` | ✅ 已跑出 tick 63,798 / 348 世代 / 340 存活个体 |
| `populationRoot()` 种群状态根 | 同上，第 397 行 | ✅ 实测可算（`0x0c136e3140aaf2b0…`） |
| x402 服务层（exact + upto，mock/gateway 双 facilitator） | `src/x402.js` · `src/services.js` · `src/life-server.js` | ✅ 已记录外部真实收入 $2.466 |
| keccak-256（过标准测试向量） | `src/keccak.js` | ✅ |
| **`BiosphereRegistry.sol`**（状态承诺 + `isLive()` + `realRevenueRatioBps()`） | `outputs/pandemic-protocol/contracts/BiosphereRegistry.sol` | ✅ **solc 0.8.37 编译通过；Arc 主网 `eth_call` 模拟部署成功；gas 837,667 ≈ $0.017** |
| **`SubsidyPool.sol`**（内置退坡 + 领取必须绑定最新状态根 + 回收限速） | `contracts/SubsidyPool.sol` | ✅ **同上；gas 1,232,808 ≈ $0.025** |
| **`tools/arc.js`** 零依赖签名/部署/调用 | `tools/arc.js` | ✅ 自检 11/11 通过；签名交易被 Arc 主网节点解码并正确恢复发件人（仅因余额不足被拒 → 编码与签名全部正确） |
| **`tools/deploy-contracts.js`** | `tools/deploy-contracts.js` | ✅ `--dry` 实跑通过 |
| **`tools/commit-state.js`** | `tools/commit-state.js` | ✅ 用真实模拟状态算出 root 与 calldata（164 字节） |
| **`tools/verify.js`** 可验证性对比表 / `/verify` 数据源 | `tools/verify.js` | ✅ 实时读链跑通，已能列出 MURMUR / oBrain 的合约字节数与「无状态根承诺」 |

**还缺的 6 件事**（就是下面 Day 0–7 的全部内容）：
测试网演练 → 主网部署 → 补贴记账接线 → 确定性重放 → 公网+公开仓库 → 发射与分发。

---

## Day 0 · 今晚（约 2 小时）：编译产物固化 + 测试网演练

### 0.1 编译（solc 已下载在 `work/solc/solc.exe`）
```powershell
$solc="C:\Users\Administrator\Documents\Codex\2026-09-22\ni-3\work\solc\solc.exe"
$root="C:\Users\Administrator\Documents\Codex\2026-09-22\ni-3\outputs\pandemic-protocol"
& $solc --optimize --optimize-runs 200 --bin --abi --overwrite -o "$root\build" `
  "$root\contracts\BiosphereRegistry.sol" "$root\contracts\SubsidyPool.sol"
```
**验收**：`build/` 下出现 4 个文件（两个 `.bin` + 两个 `.abi`），无 warning。
**实测产物大小**：Registry runtime 3,265 字节 · SubsidyPool runtime 4,771 字节（远低于 24,576 上限）。

### 0.2 干跑部署，确认 gas 与参数
```powershell
cd $root
node tools/deploy-contracts.js --dry --net mainnet --operator 0x<你的服务器钱包地址> --base-cap 50 --sweep-cap 25
```
**实测输出**（我刚跑过）：
```
[dry] BiosphereRegistry: gas 837667 ≈ $0.0172
[dry] SubsidyPool:       gas 1232808 ≈ $0.0254
```
`--base-cap 50` = 退坡前每天最多 $50 补贴；`--sweep-cap 25` = 你每天最多回收 $25（限速，防抽干）。

### 0.3 测试网演练（可选，但建议做）
```powershell
# 1) 生成一个只用于测试的钱包（不要复用主网私钥）
node -e "const c=require('crypto');console.log('0x'+c.randomBytes(32).toString('hex'))"
# 2) 测试网 USDC：https://faucet.circle.com （选 Arc testnet, chainId 5042002）
# 3) 部署
$env:ARC_PK="0x<测试网私钥>"
node tools/deploy-contracts.js --net testnet --operator 0x<同一个地址> --base-cap 50 --sweep-cap 25
```
**验收**：打印两个合约地址 + 交易哈希，生成 `deployments.testnet.json`，浏览器打开 `https://explorer.arc.io/testnet/address/<registry>` 能看到合约创建。
**回退**：如果 faucet 拿不到测试币 → **直接跳过测试网**。主网两个合约总成本 **$0.043**，比折腾 faucet 便宜得多；风险仅在于「部署失败」，而失败的交易不会创建合约、gas 损失 < $0.03。

---

## Day 1 · （约 2 小时）：主网部署 + 状态承诺循环开跑

### 1.1 准备两个钱包（职责分离，这是可信度的来源）
| 钱包 | 用途 | 保管 |
|---|---|---|
| **Creator 钱包**（建议 2/3 多签，见 Day 4） | 收 Argus 的 creator funds；`donate()` 给补贴池 | 硬件/密码管理器，**不放服务器** |
| **Operator 钱包**（普通 EOA） | 只用来 `commit()` 状态根、`draw()` 补贴 | 放服务器环境变量 `ARC_PK`，**只充 $5–10 USDC 当 gas** |

> Operator 钱包被黑了最坏结果：伪造状态根 + 每天最多领 `baseCap × (1-ratio)²` 的补贴。
> 补贴上限、`requireLive`、`sweepCapPerDay` 全部写死在合约里，**它拿不到你的 creator 资金**。

### 1.2 部署
```powershell
cd "C:\Users\Administrator\Documents\Codex\2026-09-22\ni-3\outputs\pandemic-protocol"
$env:ARC_PK="0x<operator 私钥>"
node tools/deploy-contracts.js --net mainnet --operator 0x<operator 地址> --base-cap 50 --sweep-cap 25
```
**验收**：`deployments.mainnet.json` 里两个地址；`https://explorer.arc.io/address/<registry>` 有合约代码。

### 1.3 开状态承诺循环（这就是「还在跑，而且能证明」）
```powershell
node tools/commit-state.js --net mainnet --registry 0x<registry 地址> --every 300
```
**成本**：单次 ≈ 55k gas ≈ **$0.0012**；每 5 分钟一次 → **$0.34/天**，$10/月。
**验收**（任何人都能独立核查）：
```powershell
node -e "const{rpc}=await import('./tools/arc.js');const R='0x<registry>';const s=async(x)=>await rpc('mainnet','eth_call',[{to:R,data:x},'latest']);console.log('commitCount',parseInt(await s('0x'+ 'c4e4c8a2'),16));"
```
更省事的做法：直接跑 `node tools/verify.js --net mainnet --registry 0x<registry> --html ..\verify.html`
→ 输出一张实时对比表：**我们的 `commitCount` / `isLive=true` / `realRevenueRatio` vs MURMUR、oBrain 的「无」**。

**回退**：循环崩了超过 `maxGap`（默认 2 小时）→ `isLive()` 自动变 false，链上如实反映「停了」。
**不要**为了好看去调大 `maxGap`；这个诚实性本身就是卖点。

---

## Day 2 · （约 3 小时）：把补贴退坡接上真实引擎 + 确定性重放

### 2.1 S3 · 补贴记账（`src/life.js`，约 20 行）
在 `counters` 里加 `subsidyUSDC: 0`，并在每次「基线需求注入」处累加金额：
```js
// src/life.js — counters 初始化处
counters: { born:0, died:0, extinctions:0, speciations:0, generations:0, externalCalls:0, externalRevenue:0, subsidyUSDC:0 },
```
然后在注入基线需求的函数里：`bio.counters.subsidyUSDC += amount;`
**验收**：`node tools/commit-state.js --once --dry --state .data-bio2/biosphere.json`
输出的 `subsidy=$X` 不再是 0，`ratio` 从 10000bps 下降到真实值。
> 这一步是**整个方案诚实性的关键**：`realRevenueRatioBps()` 是链上公开的，
> 退坡乘数 = `(1 − ratio)²`，所以「真实收入涨 → 补贴自动缩 → 到 100% 时归零」是合约强制的，不是我口头承诺的。

### 2.2 S3+ · 服务器领补贴（`src/life-server.js`，约 40 行）
补贴不再由我私下垫，而是由服务器按需向 `SubsidyPool.draw(to, amount, populationRoot)` 申请：
```js
import { encodeCall } from './tools/arc.js';   // 或复制到 src/ 下避免跨目录依赖
const data = encodeCall('draw(address,uint256,bytes32)', ['address','uint256','bytes32'],
                        [OPERATOR, BigInt(Math.round(usdc * 1e6)), latestRoot]);
```
**注意顺序**：先 `commit()` 拿到最新 root，再 `draw()` —— 合约会校验 `populationRoot == registry.latest()`，
用过期 root 会被拒绝（`stale root`）。这是**故意设计的**：钱和可验证状态绑定。

### 2.3 S4 · 输入日志 + 确定性重放（约 60 行）
```js
// src/recorder.js：把每一次外部输入追加到 inputs.jsonl
{ "tick": 63798, "ts": 1790000000, "kind": "x402:serve", "niche": "compute", "amountUSDC": 0.05, "buyer": "0x…", "txHash": "0x…" }
{ "tick": 63799, "ts": 1790000300, "kind": "steer", "params": { … } }
```
```js
// tools/replay.js：从创世 + inputs.jsonl 重放，重新算 root
node tools/replay.js --from .data-bio2/genesis.json --inputs inputs.jsonl --to-tick 63798
```
**验收（这是全场最有杀伤力的一条）**：重放算出的 `populationRoot` **逐字节等于**链上 `registry.commitAt(i).populationRoot`。
截图发推：「你可以自己重放我们的经济体，root 对得上。」—— MURMUR / oBrain / NECTAR / TRUMAN 没有任何一个能做到。

---

## Day 3 · （约 2 小时）：公网可访问 + 仓库公开（黑客松硬门槛）

| 项 | 做法 | 验收 |
|---|---|---|
| 公网部署 | 一台 $5/月 VPS（或 Render/Railway 免费层）跑 `npm start`（实为 `node src/life-server.js`），systemd 常驻 | `curl https://<域名>/api/bio/state` 返回 alive/root/tick |
| 必备端点 | `/api/bio/state` · `/x402`（服务发现）· `/llms.txt` · `/verify`（贴 Day 1 生成的对比表） | 4 个都 200 |
| 公开仓库 | `git init && git add -A && git commit && git push`（GitHub 公开） | README 首屏写清：合约地址、`isLive()`、重放命令 |
| 域名 | 买一个 `.xyz`（≈$2/年）。**别重蹈 MURMUR 的覆辙**：它链上 website/twitter/telegram 三项全空，`murmur.xyz`/`murmurlabs.xyz` 现在是 Afternic 待售停放页 | 域名能打开，且和 Argus 表单里填的一致 |

> Arc Microgrants（10-15 截止）**硬性要求主网部署 + 公开 GitHub**，这一天不做，后面就没有申请资格。

---

## Day 4 · （约 1 小时）：Creator 钱包与资金就位

**首选**：Safe{Wallet} 2/3 多签（若 Arc 未被 Safe 官方 UI 支持，见回退）。
**用途**：作为 Argus `/create` 的 Creator funds wallet —— 它收 100% 的 creator 份额，**钱是你的**。

Safe 层的分配规则（随时可调，不受 Argus 锁死参数影响）：
```
Safe 收到的 creator share
   ├─ 65% → 团队钱包（你的收入）
   └─ 35% → USDC.approve(SubsidyPool) → SubsidyPool.donate()（生态燃料）
```
**净效果实测公式**（2% 买卖税、平台先抽 10%、creator 份额 55%）：
每 $1,000 成交 → 毛税 $20 → 平台 $2 → creator $9.9 → **$6.4 进你口袋，$3.5 进生态**，且这 $3.5 链上可查。

**回退**（Safe 在 Arc 上不可用时，按优先级）：
1. 我再写一个 ~80 行的 `MultiSigWallet.sol`（2/3，只支持 `submit/approve/execute`），部署成本 ≈ $0.03 —— **推荐，半天内可交付**；
2. 用专用 EOA + 公开承诺（把「65/35」写进 README 与推文），只放必要资金 —— 可信度低一档，但零成本。

**资金准备**（一次性打进 operator 钱包 / Safe）：
| 用途 | 金额 |
|---|---|
| operator gas（状态承诺 $0.34/天 × 30 天） | $15 |
| 补贴池启动金（`donate`） | $50–100 |
| Argus dev buy | $200 |
| **合计** | **≈ $300** |

---

## Day 5 · 发射日（约 1 小时）：Argus `/create` 逐项填

> 表单文案以页面为准（`argus.world` 现在有浏览器校验，脚本抓不到）；下面的 bps 语义来自 27 次近期发射的链上实测。

| 字段 | 填这个 | 实测依据 |
|---|---|---|
| Paired asset | **USDC**（`0x3600…0000`，6 位精度） | 不要选 ARGUS，否则币价变成平台币的衍生品 |
| Name / Ticker | `Arc Biosphere` / **`BIOME`**（先搜索确认未占用，被占则 `SOLV`） | — |
| Image | 512×512 PNG，深色底 + 培养皿，高对比 | 首页缩略图极小 |
| imageURI | 传 IPFS，填 `ipfs://baf…` | MURMUR 就是这么填的 |
| **website / twitter / telegram** | **三项全部填** | MURMUR 三项全空 —— 这是最低成本的差异化 |
| Description（≤280） | `Autonomous artificial-life economy on Arc. Organisms hold USDC, pay upkeep to stay alive, earn revenue from x402 customers. No scripted fitness — fitness is solvency. Token tax funds their subsidy pool; population root and real-revenue ratio are committed on-chain.` | — |
| Buy tax / Sell tax | **2% / 2%**（200 / 200 bps） | MURMUR 用 2/2 活到第 5 天；当前流量只有峰值 1.3%，3% 会进一步压成交 |
| treasury | 10%（1000 bps，平台固定，不可改） | 27/27 样本恒为 1000 |
| **四方分配** | **creator 55% / liquidity 25% / buyback 15% / dividend 5%**（`5500/2500/1500/500`）<br>若在意合规：dividend 设 0 → `6000/2500/1500/0` | MURMUR 选的是 `10000/0/0/0`（全拿、零流动性、零回购）= 毕业后无价格支撑 |
| Creator funds wallet | Day 4 的多签地址 | 发射后永久锁死 |
| Dev buy | **$200 USDC**（≤ 供应量 2%） | `DevBuy` 事件公开可见，只有 ~10% 的发射有 → 正向信号；但别超过 $400 |

**点 Launch 之前的 4 项 Preview 复核**（发射后全部不可改）：
1. 四方百分比合计 = 100%；2. 买/卖税 = 2%；3. Creator wallet 地址逐字符核对；4. Ticker 未被占用。

**发射后 60 分钟内**：
- 发对比贴（含 `/verify` 链接 + `commitCount`/`isLive` 截图）；
- 在 @something_labs 那条盘点贴下评论：「Arc 上补一个：BIOME — 自主进化/繁衍/运营的生命经济体，种群状态根每 5 分钟上链，可确定性重放。合约 `0x…`，`/verify` 自查。」
- 把 Registry 的第一批 root 提交截图存档。

---

## Day 6–7 · 分发与提交（不靠币价的两条通道）

| 通道 | 截止 | 提交什么 |
|---|---|---|
| **Global x402 Challenge** | **2026-09-30** | 项目本来就是 x402 服务方：服务清单 + `/x402` 发现端点 + 真实收款记录（`counters.externalRevenue`）+ 公网地址 |
| **Arc Microgrants** | **2026-10-15 03:59** | 主网合约地址（Registry/SubsidyPool）+ 公开 GitHub + demo 链接 + `populationRoot`/`isLive()` 核查说明 |
| **Encode Programmable Money Accelerator** | 09-21 已 kickoff，争取下一批 | 同上材料 + 一段 2 分钟录屏（`commit-state` 循环 + `/verify` 实时刷新） |

三条推文（过程 > 结论，这是小账号唯一能撬动注意力的方式）：
1. **Day 2 发**：「重放我们的经济体，root 逐字节对上链上承诺」+ 命令 + 截图；
2. **Day 5 发**：发射贴，只讲机制与合约地址，不讲价格；
3. **Day 7 发**：一周数据贴 —— `commitCount`、`realRevenueRatio` 曲线、补贴退坡实际发生的金额。

---

## 预算与止损（提前写死）

**总花费 < $300**（合约 $0.043 · 承诺循环 $10/月 · VPS $5/月 · 域名 $2 · dev buy $200 · 补贴启动 $50–100）

| 触发条件 | 动作 |
|---|---|
| 48 小时内 milestone < 10% | 不追加 dev buy，不做二次发射 |
| 7 天内 `realRevenueRatio` < 5% | 承认补贴依赖，停投放，资源全转 x402 产品与黑客松 |
| 任何时候 | **代币不作为业务依赖**：币价归零，`/api/bio/serve` 与 `commit()` 循环必须继续跑（这本身就是给评委的最强证明） |

---

## 发射前验收总清单（全绿才点 Launch）

- [ ] `build/` 有 4 个编译产物，solc 0.8.37 无 warning
- [ ] 主网 `BiosphereRegistry` + `SubsidyPool` 已部署，地址写进 README
- [ ] `isLive()` 返回 true，`commitCount` 连续增长 ≥ 24 小时
- [ ] `counters.subsidyUSDC` 已接线，`realRevenueRatioBps()` 是真实值（不是 10000）
- [ ] `tools/replay.js` 重放出的 root == 链上 root（截图存档）
- [ ] 公网 4 个端点全 200：`/api/bio/state` `/x402` `/llms.txt` `/verify`
- [ ] GitHub 仓库公开，README 首屏有合约地址与核查命令
- [ ] Creator 钱包是多签（或已部署 `MultiSigWallet.sol`），65/35 规则已公开
- [ ] Argus Preview 四项复核通过
- [ ] x402 Challenge（9-30）与 Microgrants（10-15）材料已备好

---

## 附录 · 本轮已验证的命令与实测数字（可直接复制）

```powershell
# 编译
& "C:\Users\Administrator\Documents\Codex\2026-09-22\ni-3\work\solc\solc.exe" --optimize --optimize-runs 200 `
  --bin --abi --overwrite -o build contracts\BiosphereRegistry.sol contracts\SubsidyPool.sol

# 签名器自检（11 项：keccak 向量 / priv→addr 向量 ×2 / sign+recover / low-s / RLP ×4 / selector ×2）
node -e "import('./tools/arc.js').then(m=>{for(const[n,p,v]of m.selfTest())console.log(p?'PASS':'FAIL',n,String(v).slice(0,60))})"

# 部署干跑（实测 gas 与美元成本）
node tools/deploy-contracts.js --dry --net mainnet --operator 0x1111111111111111111111111111111111111111

# 状态承诺干跑（实测：tick=63798 gen=348 alive=340 root=0x0c136e3140aaf2b0… external=$2.4660）
node tools/commit-state.js --once --dry --state .data-bio2/biosphere.json

# 可验证性对比表（实时读链，可选 --html 输出页面）
node tools/verify.js --net mainnet --registry 0x<registry> --html ..\verify.html
```

**实测参考值**：Arc 主网 baseFee 20 gwei（floor）· gasPrice ≈ 21.2 gwei · 区块 gas 上限 30,000,000 ·
出块 ≈ 0.455s · 部署 Registry+SubsidyPool 合计 **$0.043** · `commit()` 单次 ≈ **$0.0012**。
