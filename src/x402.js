// ============================================================================
//  x402 payment layer for Pandemic Protocol
//
//  Implements the x402 v2 wire protocol:
//    no  `payment-signature` header -> HTTP 402 + base64 `PAYMENT-REQUIRED`
//    with `payment-signature` header -> verify -> settle -> run handler
//                                    -> base64 `PAYMENT-RESPONSE`
//
//  Two facilitator modes:
//    "mock"    zero-setup local ledger. Lets you run the whole game offline.
//    "gateway" Circle Gateway batched settlement via @circle-fin/x402-batching
//              (gasless, batched on-chain, real USDC on Arc).
//
//  Arc facts (verified 2026-09-22):
//    mainnet  chainId 5042      rpc https://rpc.mainnet.arc.io
//    testnet  chainId 5042002   rpc https://rpc.testnet.arc.io
//    USDC ERC-20 (6 decimals)   0x3600000000000000000000000000000000000000
//    Gateway wallet  mainnet    0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE
//                    testnet    0x0077777d7EBA4688BDeF3E311b846F25870A19B9
//    NOTE: native USDC is 18 decimals; the ERC-20 view is 6. x402 amounts are
//    always in the 6-decimal ERC-20 unit. Never mix the two.
// ============================================================================

export const X402_VERSION = 2;
export const USDC_ARC = '0x3600000000000000000000000000000000000000';
export const USDC_DECIMALS = 6;

export const NETWORKS = {
  arc: {
    caip2: 'eip155:5042', chainId: 5042, name: 'Arc',
    rpc: 'https://rpc.mainnet.arc.io', explorer: 'https://explorer.arc.io',
    gatewayWallet: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE',
    gatewayClientChain: 'arc', testnet: false,
  },
  arcTestnet: {
    caip2: 'eip155:5042002', chainId: 5042002, name: 'Arc Testnet',
    rpc: 'https://rpc.testnet.arc.io', explorer: 'https://explorer.testnet.arc.io',
    gatewayWallet: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
    gatewayClientChain: 'arcTestnet', testnet: true,
  },
};

// --------------------------------------------------------------- pricing
// Every paid action is one atomic micropayment. Prices are deliberately in the
// sub-cent range: Circle Gateway batches signed authorisations into a single
// on-chain settlement, which is what makes $0.0002 viable.
export const PRICES = {
  'POST /api/worlds':                          { usd: 0.02,   desc: 'Create a new persistent outbreak world' },
  'GET /api/worlds/:id':                       { usd: 0.0003, desc: 'World snapshot: SEIR totals, strains, worldRoot' },
  'POST /api/worlds/:id/tick':                 { usd: 0.0005, desc: 'Advance the simulation N days (0.0002/day extra)', perDay: 0.0002 },
  'POST /api/worlds/:id/strains':              { usd: 0.01,   desc: 'Release a new pathogen strain (agent enters the world)' },
  'POST /api/worlds/:id/strains/:sid/mutate':  { usd: 0.001,  desc: 'Spend DNA points on a mutation node' },
  'POST /api/worlds/:id/strains/:sid/devolve': { usd: 0.001,  desc: 'Spend DNA to remove a node (stay stealthy)' },
  'GET /api/worlds/:id/intel/:countryId':      { usd: 0.0004, desc: 'Per-country intelligence: compartments, alert, response, links' },
  'GET /api/worlds/:id/telemetry':             { usd: 0.0006, desc: 'Full daily time series for plotting / analysis' },
  'GET /api/worlds/:id/leaderboard':           { usd: 0.0002, desc: 'Strain ranking by score' },
  'GET /api/worlds/:id/receipts':              { usd: 0.0002, desc: 'Signed simulation receipts (keccak worldRoot per action)' },
  'GET /api/worlds/:id/map.svg':               { usd: 0.001,  desc: 'Rendered world infection map (SVG)' },
  'GET /api/worlds/:id/events':                { usd: 0.0002, desc: 'Event log: detections, closures, mutations, cure milestones' },
  // ---- BIOSPHERE (autonomous evolution) -------------------------------------
  'POST /api/bio/tick':                        { usd: 0.002, desc: 'Advance the biosphere N ticks (0.0004/tick extra)', perTick: 0.0004 },
  'GET /api/bio/state':                        { usd: 0.0004, desc: 'Full biosphere state + populationRoot commitment' },
  'GET /api/bio/organisms':                    { usd: 0.0005, desc: 'Census: every living organism, its genome and break-even' },
  'GET /api/bio/organism/:id':                 { usd: 0.0003, desc: 'One organism: genome, energy, lineage, economics' },
  'GET /api/bio/lineage/:id':                  { usd: 0.0005, desc: 'Ancestry + descendant tree across the fossil record' },
  'GET /api/bio/fossils':                      { usd: 0.0004, desc: 'The fossil record: every death, cause, age, lifetime earnings' },
  'GET /api/bio/history':                      { usd: 0.0005, desc: 'Population / price / trait time series' },
  'GET /api/bio/events':                       { usd: 0.0003, desc: 'Extinctions, speciations, demand shocks, births' },
  'GET /api/bio/niche/:key/chart.svg':         { usd: 0.001, desc: 'Rendered niche chart (price + trait evolution)' },
  'POST /api/bio/seed':                        { usd: 0.05, desc: 'Release YOUR genome as a founder organism into the biosphere' },
  // upto: buyer declares the amount. This is how outside money steers evolution.
  'POST /api/bio/demand':                      { usd: 5.00, upto: true, minUsd: 0.002, desc: 'Inject real USDC demand into a niche -> redirects evolution' },
  'POST /api/bio/serve/:niche':                { usd: 0.50, upto: true, minUsd: 0.0002, desc: 'Buy a REAL service; revenue is credited to the organism that wins the call' },

  // ---- PANDEMIC SEASON (the earlier game, kept as a sellable service) --------
  // upto scheme: 1.00 USDC is the CEILING; the buyer declares the actual amount
  // per call. This is what makes "pay for as much cure progress as you want" work.
  'POST /api/worlds/:id/cure/fund':            { usd: 1.00, upto: true, minUsd: 0.001, desc: 'DEFENDER SIDE: fund cure research (1 USDC = 4% progress; buyer chooses the amount)' },
};

export const FREE_ROUTES = [
  'GET /', 'GET /api/spec', 'GET /api/worlds', 'GET /api/prices', 'GET /api/meta',
  'GET /llms.txt', 'GET /llms-full.txt', 'GET /openapi.yaml', 'GET /.well-known/ai.json',
];

export function usdToAtomic(usd) { return String(Math.round(usd * 10 ** USDC_DECIMALS)); }
export function atomicToUsd(atomic) { return Number(BigInt(atomic)) / 10 ** USDC_DECIMALS; }

// --------------------------------------------------------------- config
export function configFromEnv() {
  const network = process.env.PP_NETWORK || 'arcTestnet';
  const net = NETWORKS[network];
  if (!net) throw new Error(`unknown PP_NETWORK "${network}" (use "arc" or "arcTestnet")`);
  return {
    network, net,
    facilitatorMode: process.env.PP_FACILITATOR || 'mock',   // mock | gateway
    sellerAddress: process.env.SELLER_ADDRESS || '0x0000000000000000000000000000000000000000',
    maxTimeoutSeconds: Number(process.env.PP_MAX_TIMEOUT_SECONDS || 300),
  };
}

export function buildRequirements(cfg, usd, resourceUrl, description, opts = {}) {
  return {
    scheme: opts.upto ? 'upto' : 'exact',
    network: cfg.net.caip2,
    asset: USDC_ARC,
    amount: usdToAtomic(usd),
    payTo: cfg.sellerAddress,
    maxTimeoutSeconds: cfg.maxTimeoutSeconds,
    extra: { name: 'GatewayWalletBatched', version: '1', verifyingContract: cfg.net.gatewayWallet },
  };
}

export function paymentRequiredBody(cfg, usd, resourceUrl, description, opts = {}) {
  return {
    x402Version: X402_VERSION,
    resource: { url: resourceUrl, description, mimeType: 'application/json' },
    accepts: [buildRequirements(cfg, usd, resourceUrl, description, opts)],
  };
}

export function encodeHeader(obj) { return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64'); }
export function decodeHeader(b64) { return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); }

// --------------------------------------------------------------- facilitators
const ledger = [];           // mock settlement ledger
export function mockLedger() { return ledger; }

async function loadGatewayFacilitator() {
  try {
    const mod = await import('@circle-fin/x402-batching/server');
    return new mod.BatchFacilitatorClient();
  } catch (e) {
    throw new Error(
      'PP_FACILITATOR=gateway requires the Circle SDK. Run: npm i @circle-fin/x402-batching @x402/core\n' +
      'Or use PP_FACILITATOR=mock for local development. Original error: ' + e.message);
  }
}

/** Verify + settle. Returns { ok, reason?, payer?, transaction?, usd, atomic, scheme }. */
export async function settlePayment(cfg, headerValue, requirements, bounds = {}) {
  let payload;
  try { payload = decodeHeader(headerValue); } catch { return { ok: false, reason: 'malformed payment-signature header' }; }
  const inner = payload?.payload ?? payload ?? {};
  const ceil = BigInt(requirements.amount);

  if (cfg.facilitatorMode === 'mock') {
    // Mock: trust the declared amount and record it. NEVER use in production.
    const declared = BigInt(inner.amount ?? ceil);
    const payer = inner.payer ?? '0xMOCKPAYER';
    if (requirements.scheme === 'exact') {
      if (declared !== ceil) return { ok: false, reason: 'amount mismatch: declared ' + declared + ', required ' + ceil };
    } else {
      if (declared > ceil) return { ok: false, reason: 'amount ' + declared + ' exceeds ceiling ' + ceil };
      const floor = BigInt(bounds.minAtomic ?? 1);
      if (declared < floor) return { ok: false, reason: 'amount ' + declared + ' below minimum ' + floor };
    }
    const tx = '0xmock' + Date.now().toString(16).padStart(12, '0') + declared.toString(16).padStart(6, '0');
    ledger.push({ at: new Date().toISOString(), payer, amount: declared.toString(), scheme: requirements.scheme, tx, resource: requirements.resource?.url });
    if (ledger.length > 5000) ledger.splice(0, ledger.length - 5000);
    return { ok: true, payer, transaction: tx, atomic: declared.toString(), usd: atomicToUsd(declared.toString()), scheme: requirements.scheme, mock: true };
  }

  const fac = await loadGatewayFacilitator();
  const verify = await fac.verify(payload, requirements);
  if (!verify.isValid) return { ok: false, reason: verify.invalidReason || 'verification failed' };
  const settle = await fac.settle(payload, requirements);
  if (!settle.success) return { ok: false, reason: settle.errorReason || 'settlement failed' };
  // For upto, the facilitator reports what was actually charged.
  const atomic = String(settle.amount ?? inner.amount ?? requirements.amount);
  return { ok: true, payer: settle.payer ?? verify.payer, transaction: settle.transaction, atomic, usd: atomicToUsd(atomic), scheme: requirements.scheme };
}

// --------------------------------------------------------------- middleware
/**
 * Wraps a route handler with an x402 paywall.
 *   handler(ctx) -> { status?, body }   where ctx = { params, query, body, payer, payment }
 */
export function paid(cfg, routeKey, handler) {
  const spec = PRICES[routeKey];
  if (!spec) throw new Error('no price registered for ' + routeKey);
  return async function run(reqCtx) {
    const url = new URL(reqCtx.url, 'http://localhost');
    const usd = spec.usd
      + (spec.perDay ? spec.perDay * Math.max(0, Number(url.searchParams.get('days') || 1) - 1) : 0)
      + (spec.perTick ? spec.perTick * Math.max(0, Number(url.searchParams.get('ticks') || 1) - 1) : 0);
    const resourceUrl = url.pathname + url.search;

    const sig = reqCtx.headers['payment-signature'] || reqCtx.headers['x-payment'];
    if (!sig) {
      return {
        status: 402,
        headers: {
          'Content-Type': 'application/json',
          'PAYMENT-REQUIRED': encodeHeader(paymentRequiredBody(cfg, usd, resourceUrl, spec.desc, spec)),
          'X-Price-USD': String(usd),
          ...(spec.upto ? { 'X-Price-Model': 'upto', 'X-Price-Min-USD': String(spec.minUsd ?? 0) } : {}),
        },
        body: {
          error: 'Payment Required',
          protocol: 'x402', x402Version: X402_VERSION,
          priceUSD: usd, priceModel: spec.upto ? 'upto (ceiling; declare your own amount)' : 'exact',
          network: cfg.net.name, asset: 'USDC',
          hint: 'Retry with header `payment-signature: <base64 payment payload>`. See /api/spec and /llms-full.txt.',
          accepts: paymentRequiredBody(cfg, usd, resourceUrl, spec.desc, spec).accepts,
        },
      };
    }

    const requirements = buildRequirements(cfg, usd, resourceUrl, spec.desc, spec);
    const res = await settlePayment(cfg, sig, requirements, { minAtomic: spec.minUsd != null ? usdToAtomic(spec.minUsd) : null });
    if (!res.ok) {
      return {
        status: 402,
        headers: { 'Content-Type': 'application/json', 'PAYMENT-REQUIRED': encodeHeader(paymentRequiredBody(cfg, usd, resourceUrl, spec.desc, spec)) },
        body: { error: 'Payment rejected', reason: res.reason, priceUSD: usd },
      };
    }

    const out = await handler({ ...reqCtx, payer: res.payer, payment: res, query: url.searchParams });
    out.headers = { ...(out.headers || {}), 'PAYMENT-RESPONSE': encodeHeader({ success: true, transaction: res.transaction, network: cfg.net.caip2, payer: res.payer, scheme: res.scheme, amountUSDC: res.atomic }) };
    return out;
  };
}

export function json(body, status = 200, headers = {}) {
  return { status, headers: { 'Content-Type': 'application/json', ...headers }, body };
}