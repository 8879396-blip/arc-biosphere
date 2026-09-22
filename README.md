# Arc Biosphere

[![ci](https://github.com/8879396-blip/arc-biosphere/actions/workflows/ci.yml/badge.svg)](https://github.com/8879396-blip/arc-biosphere/actions/workflows/ci.yml)
![node](https://img.shields.io/badge/node-%3E%3D20-3c873a)
![deps](https://img.shields.io/badge/runtime%20deps-0-2b6cb0)
![license](https://img.shields.io/badge/license-MIT-blue)
![solc](https://img.shields.io/badge/solc-0.8.37-aa6746)

**An autonomous artificial-life economy on [Arc](https://arc.io) — Circle's EVM L1.**

Organisms hold USDC, pay metabolic upkeep every tick, and earn revenue by competing for
**real x402 customers**. Pay the upkeep → survive and reproduce. Can't pay → die and become a
fossil. There is no scripted fitness function:

> **fitness is solvency.**

Nothing here asks you to trust the operator. Three independent checks are built in:

| Check | How |
|---|---|
| **It is still running** | `BiosphereRegistry.isLive()` — false if no state commitment landed within `maxGap` (default 2 h) |
| **The population was not edited** | `populationRoot` committed on-chain every 5 min; reproduce it byte-for-byte with `node tools/replay.js` |
| **The money is real** | `realRevenueRatioBps()` — third-party x402 revenue vs operator subsidy, published on-chain |

Public endpoints: [`/dashboard`](#dashboard) (live panel) · [`/verify`](#verify) (side-by-side
on-chain comparison, reads the chain at request time) · `/llms.txt` · `/llms-full.txt` ·
`/openapi.yaml` · `/.well-known/ai.json`

---

## 1. Verify it yourself

```bash
# a) the whole system, locally, no dependencies beyond Node >= 20
npm run serve:auto          # autotick on; then open http://127.0.0.1:4030/dashboard

# b) determinism: replay from genesis + input log and compare the root
npm run test:e2e            # keccak vectors + honesty ledger + replay + server endpoints
node test-replay.mjs        # the CI proof (14 assertions, no network)

# c) on-chain: read the commitment yourself
node tools/verify.js --net mainnet --registry 0x<RegistryAddress>
```

A real run (100 ticks, 24 founders, 3 recorded external inputs):

```
live  : tick=100 alive=93 gen=7
root  : 0x4ffc3c0cb251c59bcb2000966a453a9fa3f40aae8a6df88f547e9bbc46ec8de9
replay: tick=100 alive=93 gen=7  (365 ms, 3 inputs applied)
root  : 0x4ffc3c0cb251c59bcb2000966a453a9fa3f40aae8a6df88f547e9bbc46ec8de9   ← identical
```

`test-replay.mjs` also proves the negative direction: change one input by $0.001, or change the
genesis seed, and the root **must** change. If we ever served you a root that does not replay,
that is proof of cheating.

---

## 2. Contracts

Compiled with `solc 0.8.37`, optimizer 200 runs. **Not audited.** Deploy gas measured with
`eth_estimateGas` against Arc mainnet and simulated with `eth_call` (constructor executes, runtime code returned).

| Contract | Purpose | Deploy gas | ≈ cost |
|---|---|---|---|
| `contracts/BiosphereRegistry.sol` | state commitments, hash chain, `isLive()`, `realRevenueRatioBps()` | 837,667 | $0.017 |
| `contracts/SubsidyPool.sol` | token-tax → ecosystem subsidy, with a hard-wired taper | 1,232,808 | $0.025 |
| `contracts/MultiSigWallet.sol` | N-of-M treasury for the creator share (fallback if Safe is unavailable on Arc) | 1,126,970 | $0.023 |

Addresses are written to `deployments.<net>.json` on deploy (gitignored) and should be pasted
into [§6 Token](#6-token) below.

### The taper: why the subsidy cannot become a permanent loop

```
maxDrawPerDay() = baseCapPerDay × (1 − realRevenueRatio)²
```

| realRevenueRatio | daily subsidy cap (baseCap = $50) |
|---|---|
| 0 % | $50.00 |
| 25 % | $28.13 |
| 50 % | $12.50 |
| 75 % | $3.13 |
| 100 % | **$0.00 — automatically** |

Plus two more constraints, both in the contract:

* `draw()` **must** carry the current `populationRoot` from the registry; a stale root reverts
  (`stale root`). Money and verifiable state are bound together.
* `requireLive` — no draws while `isLive()` is false.
* `sweepToTreasury()` is rate-limited per day (`sweepCapPerDay`), so the admin cannot drain the pool in one tx.

### What the operator wallet can and cannot do

The server holds **only** the operator key (a few dollars of gas). It can commit state and draw
subsidy within the taper. It **cannot** touch the creator/treasury funds, change the taper, or
upgrade anything — there is no upgrade mechanism, no `delegatecall`, no `selfdestruct`.

---

## 3. The honesty ledger

Baseline niche demand is **simulated**. That is a subsidy from the operator, and pretending
otherwise is how "agent economy" projects die. So the engine accounts for three separate things:

| Field | Meaning |
|---|---|
| `realRevenueUSDC` | third-party x402 payments (money that did not come from us) |
| `subsidyUSDC` | operator-funded demand, incl. everything spent while `PP_FACILITATOR=mock` |
| `simulatedDemandShareBps` | share of *served demand* that came from the seeded baseline (no money moved) |

`realRevenueRatioBps = real / (real + subsidy)` is what goes on-chain and drives the taper.
`simulatedDemandShareBps` starts at 10 000 (100 %) and **must fall** as real x402 demand arrives —
it is displayed on the dashboard in red until it does.

Rule enforced in code: in mock facilitator mode every credit is marked `subsidized: true`
(`src/chain.js → isSubsidy`). No real money moves, so nothing may be booked as real revenue.

---

## 4. Architecture

```
                       ┌────────────────────────────────────────────┐
   x402 customers ───► │  life-server (src/life-server.js)          │
   (USDC on Arc)       │   · 6 niches, softmax market clearing      │
                       │   · metabolism / birth fees / death        │
                       │   · mutation, speciation, demand shocks    │
                       └───────┬──────────────────────┬─────────────┘
                               │                      │
                    inputs.jsonl (recorder)    every 5 min: commit()
                               │                      ▼
                    genesis.json            ┌──────────────────────┐
                               │            │ BiosphereRegistry    │  isLive()
                    tools/replay.js ◄───────┤ populationRoot chain ├─ realRevenueRatioBps()
                    (byte-identical root)   └──────────────────────┘
                                                      ▲
   token tax → creator share → multisig ──donate()──► ┌┴─────────────────────┐
                                                      │ SubsidyPool          │
                       draw(root) ◄───────────────────┤ cap × (1−ratio)²     │
                                                      └──────────────────────┘
```

Niches (each one is a **real** service in `src/services.js`, not a decoration):

| key | service | base demand | elasticity |
|---|---|---|---|
| `keccak` | Keccak-256 hashing | 120 | — |
| `pandemic` | pandemic simulation (SEIR, 20 countries) | 26 | — |
| `render` | SVG / map rendering | 44 | — |
| `optimize` | evolutionary optimisation | 18 | — |
| `oracle` | stats & telemetry feed | 190 | — |
| `entropy` | verifiable randomness | 70 | — |

Revenue from a purchase is credited to the organism that wins the call, using the same softmax +
capacity rule as the internal market — so **spending steers the gene pool**.

---

## 5. Run it

Zero runtime dependencies (Node ≥ 20; the x402 SDK is an *optional* dependency for gateway mode).

```bash
cp .env.example .env        # then edit
npm run serve:auto          # http://127.0.0.1:4030
```

| Command | What it does |
|---|---|
| `npm run compile` | `solc` → `build/*.bin` + `*.abi` |
| `npm run deploy:dry` | estimate deploy gas + USD cost, sign nothing |
| `ARC_PK=0x… npm run deploy` | deploy Registry + SubsidyPool (≈ $0.043 total) |
| `npm run commit -- --registry 0x… --every 300` | the on-chain commitment loop (≈ $0.0012 / commit) |
| `npm run replay -- --to-tick N [--chain 0x…]` | deterministic replay, optional on-chain comparison |
| `npm run verify` | live comparison table / `/verify` HTML |
| `npm run digest` | generate the daily post from live numbers |
| `npm run selftest` | 11 crypto/RLP assertions for the signer |
| `npm run test:e2e` | honesty ledger + replay + server endpoints |

Signing, RLP, ABI encoding and EIP-1559 transactions are implemented from scratch in
`tools/arc.js` (secp256k1 + RFC 6979 + keccak-256, all in-repo). The signer is validated against
known vectors and by having Arc mainnet decode a signed transaction and recover the sender.

<a name="dashboard"></a>`/dashboard` — live panel: on-chain proof, honesty ledger, population &
mutation-rate curves, niche table, x402 price list, replay command. Single file, no CDN, no tracking.

<a name="verify"></a>`/verify` — reads Arc at request time and lists what comparable projects
expose on-chain (contract size, USDC held, whether any state commitment exists) next to ours.

---

## 6. Token

Launched on [Argus](https://argus.world) (portal `0xb021be536808f551b31789422fd28a6c9c6e97da`),
paired with USDC. Parameters are locked at launch; these are the intended values:

| Parameter | Value |
|---|---|
| Paired asset | USDC `0x3600000000000000000000000000000000000000` (6 dp) |
| LP fee | 1 % (100 bps) |
| Buy / sell tax | 2 % / 2 % (200 / 200 bps) |
| Platform treasury | 10 % of tax (1000 bps, fixed by Argus) |
| Split of the remainder | creator 55 % · liquidity 25 % · buyback & burn 15 % · dividends 5 % |
| Creator funds wallet | N-of-M multisig (`MultiSigWallet.sol`) |
| Multisig policy | 65 % team · 35 % `SubsidyPool.donate()` |
| Dev buy | ≤ $400 (≤ 2 % of supply) |

Net effect per $1,000 of volume: $20 tax → $2 platform → $9.90 creator →
**$6.44 team, $3.47 into the ecosystem**, and that $3.47 is visible on-chain.

Addresses (fill in after deploy):

| | Arc mainnet |
|---|---|
| Token | `—` |
| BiosphereRegistry | `—` |
| SubsidyPool | `—` |
| Multisig | `—` |

The token is a funding and distribution instrument. The product is the x402 service surface:
if the token goes to zero, `/api/bio/serve/:niche` and the commitment loop keep running.

---

## 7. Repo layout

```
contracts/   BiosphereRegistry.sol · SubsidyPool.sol · MultiSigWallet.sol
build/       solc output (bin + abi)
src/         life.js (engine) · life-server.js (x402 API) · services.js · x402.js
             chain.js (on-chain reads, subsidy classification) · recorder.js (genesis + input log)
             public-routes.js (/api/bio/public · /verify · /dashboard) · keccak.js · sim.js
tools/       arc.js (signer/deployer) · deploy-contracts.js · commit-state.js · replay.js
             verify.js · x-digest.js · evolve.js · snapshot.js
web/         index.html (the dashboard)
client/      watch.js · steer.js · agent.js · versus.js
test-*.mjs   determinism, honesty ledger, keccak vectors, engine scenarios, server endpoints
docs/        design + execution plan
DESIGN.md    the economic design, including the subsidy analysis
```

## 8. Chain facts

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | `5042` | `5042002` |
| RPC | `https://rpc.mainnet.arc.io` | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.arc.io` | `https://explorer.arc.io/testnet` |
| Gas | paid in USDC, base-fee floor 20 gwei, block gas limit 30 M, ≈ 0.455 s per block |

## 9. Status & roadmap

- [x] engine: market clearing, metabolism, reproduction, mutation, speciation, demand shocks
- [x] x402 service surface (exact + upto schemes; mock + gateway facilitators)
- [x] `populationRoot`, genesis + input log, deterministic replay (**root verified identical**)
- [x] honesty ledger (real vs subsidy vs simulated demand share)
- [x] contracts compiled, deploy gas measured, EVM-simulated on Arc mainnet
- [x] dashboard, `/verify`, `/api/bio/public`
- [x] zero-dependency signer (11 self-tests; signed tx accepted by Arc mainnet)
- [ ] deploy to Arc **testnet**, then mainnet
- [ ] commitment loop running 24/7 on a public host (`isLive()` continuously true)
- [ ] real x402 traffic from third parties → `simulatedDemandShareBps` below 8 500
- [ ] Argus launch + multisig treasury
- [ ] [Global x402 Challenge](https://www.x402.org/) (deadline 2026-09-30) and Arc Microgrants (2026-10-15)

## 10. Caveats, stated plainly

* The contracts are **not audited**. Do not put more money in them than you can lose.
* Baseline demand is simulated until real x402 customers replace it; the dashboard says so in red.
* The token is not an investment contract, has no promised yield, and `dividends` can be set to 0.
* This project is not affiliated with Circle, Arc, Google/Princeton FlyWire, or Eon Systems.

## License

MIT — see [LICENSE](LICENSE).
