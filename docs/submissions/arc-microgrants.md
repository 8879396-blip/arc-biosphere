# Arc Microgrants — submission draft (DoraHacks, closes 2026-10-14)

> 20 grants x 500 USDC. Requirements: deploy on **Arc mainnet**, public GitHub, link to the
> live deployment. Fill the `__…__` placeholders, paste, submit. Do not submit before the
> commit loop has been running >= 24 h (reviewers can then see `isLive() == true` and a
> growing `commitCount`).

**Project name:** Arc Biosphere

**One-liner:** An autonomous artificial-life economy on Arc where organisms hold USDC, pay
metabolic upkeep or die, and earn revenue by serving real x402 customers — with every claim
about its state committed on-chain and independently replayable.

**What it is (short):**
Arc Biosphere runs a deterministic artificial-life economy (market clearing, metabolism,
reproduction, mutation, speciation, demand shocks) as a public service on Arc. Six niches are
real, purchasable x402 endpoints (keccak hashing, pandemic simulation, SVG rendering,
evolutionary optimisation, telemetry, verifiable randomness); the USDC a customer pays is
credited to the organism that wins the call, so spending steers the gene pool. There is no
scripted fitness function: fitness is solvency.

**Why Arc:**
USDC is the gas asset and the settlement asset, which makes "organisms hold USDC and pay
upkeep" literal rather than metaphorical. x402 gives us machine-native payments without
accounts or keys on the buyer side. The whole economy is denominated in one stable unit with
no bridge and no wrapper.

**Live deployment:** `__PUBLIC_URL__/dashboard` (public panel) · `__PUBLIC_URL__/verify`
(on-chain comparison, reads Arc at request time) · `__PUBLIC_URL__/llms-full.txt` (machine-readable)

**Repository:** https://github.com/8879396-blip/arc-biosphere (CI green; zero runtime dependencies)

**On-chain (Arc mainnet, chainId 5042):**
- `BiosphereRegistry` `__REGISTRY__` — `commit(generation, aliveCount, populationRoot, realRevenueMicro, subsidyMicro)` every 5 minutes; `isLive()`, `realRevenueRatioBps()`, hash-chained `head()`.
- `SubsidyPool` `__SUBSIDY_POOL__` — token-tax-funded subsidy with a hard-wired taper: `maxDrawPerDay = baseCap x (1 - realRevenueRatio)^2`, auto-zero at 100%; draws must carry the latest on-chain `populationRoot` or revert; admin sweeps are rate-limited per day.
- `MultiSigWallet` `__MULTISIG__` — holds the Argus creator share; 65% team / 35% `donate()` into the pool.

**How to verify us (anyone, no trust):**
1. `curl __PUBLIC_URL__/api/bio/public` — live state incl. the honesty ledger (real third-party revenue vs operator subsidy vs simulated-demand share).
2. `git clone https://github.com/8879396-blip/arc-biosphere && node test-replay.mjs` — replays genesis + `inputs.jsonl` and asserts the `populationRoot` matches byte-for-byte, and that tampering with one input changes it.
3. Read `BiosphereRegistry.isLive()` / `commitCount()` on Arc; if we stop committing, the chain says so within `maxGap` (2 h).

**Honesty, stated up front:** baseline niche demand is simulated and is accounted as operator
subsidy; `realRevenueRatioBps` and the simulated-demand share are published on-chain and on the
dashboard. In mock-facilitator mode every credit is booked as subsidy by construction, so the
ratio can never be inflated.

**Use of the 500 USDC grant:**
- $300 seed the SubsidyPool (visible on-chain via `donate()` events and `stats()`),
- $120 six months of VPS for the 24/7 commit loop and public endpoint,
- $40 domain + TLS,
- $40 operator gas for commits (≈ $0.0012 each).

**Team:** solo builder. Status: engine, x402 surface, contracts, dashboard and replay tooling
shipped; mainnet deployment and commit loop in progress at submission time.
