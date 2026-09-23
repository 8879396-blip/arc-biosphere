# Arc Testnet 部署记录（chainId 5042002）

> 测试网 operator：`0xa1730595a16eaa2c607969837f5e89f2b5351428`（私钥仅在本机 `.data-live/testnet-operator.key`，0600，不入库）
> 当前生效版本：**v2**。承诺循环每 60s 一次；看板 `PP_REGISTRY` 指向 v2。

## v2 — 当前生效（2026-09-23 12:41 UTC+8）

重部署原因：`SubsidyPool.donate` 的 CEI 顺序修复（B2）后字节码变化，保持测试网与主网将用字节码一致。

| 合约 | 地址 | 部署 gas |
|---|---|---|
| MultiSigWallet (1-of-1) | `0x3db6ac7d7f10a6d4cd1a2ff498106da2166aea44` | 1,025,952 |
| BiosphereRegistry | `0x27e62032d56d3e664bdf834118acb21dff8f350e` | 829,913 |
| SubsidyPool | `0xc75fd3f8d9be8454f1986db0c6867945d60adf5a` | 1,221,943 |

首个承诺：`commit #1 tick=12616 alive=134 gen=154 rootMatch=✓ tx 0xa7a42057…`

## v1 — 已弃用（2026-09-23 12:19 UTC+8，仍可在链上查，不再提交）

| 合约 | 地址 |
|---|---|
| MultiSigWallet (1-of-1) | `0x8de397b91f396f4467aecd2e5048e575660cc60b` |
| BiosphereRegistry | `0x851b5b0ac422358c2a7f6958318ea9ff470c9cc7` |
| SubsidyPool | `0xe31726b51ee5e8559df88e192db129828e6a897d` |

v1 期间共 12 次承诺（commitCount=12），全部 `rootMatch=✓`；余额消耗 20 → 19.86 USDC。

## 复现 / 切换命令

```powershell
node tools\testnet-run.mjs --once          # 部署（若 deployments.testnet.json 不存在）+ 提交一次
node tools\testnet-run.mjs                 # 承诺循环（Ctrl-C 停）
node tools\chain-watch.mjs --registry 0x27e62032d56d3e664bdf834118acb21dff8f350e --net testnet
powershell -File tools\serve.ps1 -Stop     # 停看板；重启时记得带上 PP_REGISTRY / PP_CHAIN_NET=testnet
```
