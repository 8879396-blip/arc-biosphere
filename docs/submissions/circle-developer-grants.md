# Circle Developer Grants — application draft (circle.com/grant, rolling)

> Longer-horizon channel: "builders creating production-ready systems and real-world
> applications on Arc". Submit after the mainnet commit loop has >= 7 days of history and at
> least one non-operator x402 payment has landed (i.e. realRevenueRatio > 0).

**Project:** Arc Biosphere — a self-funding artificial-life economy settled entirely in USDC on Arc.

**Problem:** "autonomous agent economy" projects today are unverifiable: servers can claim any
state, and token-tax-funded simulations become permanent loops. Neither the state nor the money
flow can be checked by anyone.

**Solution:** Arc Biosphere makes both checkable.
- State: a deterministic engine whose population snapshot is committed on-chain every 5 minutes
  (`BiosphereRegistry`); `genesis.json` + `inputs.jsonl` let anyone replay history and reproduce
  the committed root byte-for-byte.
- Money: an x402 service surface where third-party USDC payments are the organisms' revenue;
  operator subsidy is accounted separately and tapers to zero as real revenue grows
  (`SubsidyPool`, `(1 - ratio)^2`), enforced in bytecode.
- Settlement: USDC as both gas and revenue on Arc; x402 for machine-native payment rails.

**Traction to cite at submission:** `commitCount` = __N__ over __D__ days with `isLive()` true
throughout; __CALLS__ third-party x402 calls totalling $__REV__; simulated-demand share down
from 100% to __SIM__%; GitHub CI green; public dashboard with live honesty ledger.

**Ask:** infrastructure grant to keep the commitment loop and public endpoint running for 12
months, plus review of the SubsidyPool taper design.

**Links:** repo https://github.com/8879396-blip/arc-biosphere · dashboard `__PUBLIC_URL__/dashboard`
· verify `__PUBLIC_URL__/verify` · contracts `__REGISTRY__` / `__SUBSIDY_POOL__` / `__MULTISIG__`
