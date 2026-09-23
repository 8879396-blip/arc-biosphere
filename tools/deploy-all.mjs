// tools/deploy-all.mjs — 一条命令部署全部三个合约并接线
//   ARC_PK=0x<operator私钥> node tools/deploy-all.mjs --net testnet --owners 0xA,0xB,0xC --required 2
//   node tools/deploy-all.mjs --dry --net mainnet        # 只估 gas，不签名
// 产出：deployments.<net>.json + 屏幕上的后续命令（commit 循环 / donate 流程）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deploy, rpc, addressFromPriv, pkFromEnv, encodeCtor, NETS } from './arc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const build = (f) => fs.readFileSync(path.join(here, '..', 'build', f), 'utf8').trim();
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; }
const has = (n) => process.argv.includes('--' + n);

const net = arg('net', 'mainnet');
const dry = has('dry') || !process.env.ARC_PK;
const baseCap = BigInt(Math.round(Number(arg('base-cap', '50')) * 1e6));
const sweepCap = BigInt(Math.round(Number(arg('sweep-cap', '25')) * 1e6));
const USDC = NETS[net].usdc;

let pk = null, operator = arg('operator', null);
if (!dry) { pk = pkFromEnv(); operator = operator || addressFromPriv(pk); }
else operator = operator || '0x1111111111111111111111111111111111111111';

const owners = (arg('owners', operator) || '').split(',').map(s => s.trim()).filter(Boolean);
const required = Number(arg('required', String(Math.min(2, owners.length))));
if (required < 1 || required > owners.length) { console.error('--required 必须在 1..owners 之间'); process.exit(1); }

const steps = [
  { name: 'MultiSigWallet', bin: 'MultiSigWallet.bin', types: ['address[]', 'uint256'], args: [owners, BigInt(required)] },
  { name: 'BiosphereRegistry', bin: 'BiosphereRegistry.bin', types: ['address'], args: [operator], needs: [] },
  { name: 'SubsidyPool', bin: 'SubsidyPool.bin', types: ['address', 'address', 'address', 'uint256', 'uint256'], args: [USDC, operator, 'REGISTRY', baseCap, sweepCap] },
];

console.log('== deploy-all · net=' + net + ' (chainId ' + NETS[net].chainId + ') · mode=' + (dry ? 'DRY' : 'LIVE'));
console.log('   operator : ' + operator);
console.log('   multisig : ' + required + '-of-' + owners.length + '  ' + owners.join(', '));
console.log('   caps     : base ' + (Number(baseCap) / 1e6) + ' USDC/day · sweep ' + (Number(sweepCap) / 1e6) + ' USDC/day\n');

const out = { net, chainId: Number(NETS[net].chainId), usdc: USDC, operator, multisig: { owners, required }, deployedAt: null, contracts: {} };
let registry = '0x2222222222222222222222222222222222222222';
let totalGas = 0n;

for (const s of steps) {
  const args = s.args.map(a => (a === 'REGISTRY' ? registry : a));
  const data = '0x' + Buffer.concat([Buffer.from(build(s.bin), 'hex'), encodeCtor(s.types, args)]).toString('hex');
  if (dry) {
    const g = BigInt(await rpc(net, 'eth_estimateGas', [{ from: operator, data, value: '0x0' }]));
    const gp = BigInt(await rpc(net, 'eth_gasPrice'));
    totalGas += g;
    console.log('   [dry] ' + s.name.padEnd(18) + ' gas ' + g.toString().padStart(9) + '  ≈ $' + (Number(g * gp) / 1e18).toFixed(4));
    if (s.name === 'BiosphereRegistry') registry = '0x3333333333333333333333333333333333333333';
    continue;
  }
  const r = await deploy({ net, pk, bin: build(s.bin), ctorTypes: s.types, ctorArgs: args });
  if (r.status !== '0x1') throw new Error(s.name + ' reverted: ' + r.hash);
  totalGas += r.gasUsed;
  out.contracts[s.name] = { address: r.contractAddress, tx: r.hash, gasUsed: r.gasUsed.toString() };
  console.log('   ✓ ' + s.name.padEnd(18) + r.contractAddress + '  (tx ' + r.hash.slice(0, 18) + '…, gas ' + r.gasUsed + ')');
  if (s.name === 'BiosphereRegistry') registry = r.contractAddress;
}

if (dry) {
  const gp = BigInt(await rpc(net, 'eth_gasPrice'));
  console.log('\n   合计 gas ' + totalGas.toString() + '  ≈ $' + (Number(totalGas * gp) / 1e18).toFixed(4) + '（三个合约）');
  console.log('   设 ARC_PK 后去掉 --dry 即真实部署。');
  process.exit(0);
}

out.deployedAt = new Date().toISOString();
out.contracts.BiosphereRegistry = out.contracts.BiosphereRegistry || {};
const f = path.join(here, '..', 'deployments.' + net + '.json');
fs.writeFileSync(f, JSON.stringify(out, null, 2));
console.log('\n   已写入 ' + f);
console.log('\n   接下来：');
console.log('   1) 服务器环境变量：');
console.log('      PP_REGISTRY=' + out.contracts.BiosphereRegistry.address);
console.log('      PP_SUBSIDY_POOL=' + out.contracts.SubsidyPool.address);
console.log('      PP_SUBSIDY_WALLETS=' + operator);
console.log('   2) 起承诺循环：node tools/commit-state.js --net ' + net + ' --registry ' + out.contracts.BiosphereRegistry.address + ' --every 300');
console.log('   3) 多签给补贴池注资（creator share 到账后）：');
console.log('      MultiSig.submit(USDC, 0, erc20ApproveCalldata(USDC, SubsidyPool, amount)) → 达到 ' + required + ' 票后 execute');
console.log('      再 submit(SubsidyPool, 0, donate(amount))');
