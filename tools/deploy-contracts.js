// tools/deploy-contracts.js — 部署 BiosphereRegistry + SubsidyPool 到 Arc
// 用法：
//   ARC_PK=0x<64hex> node tools/deploy-contracts.js --net testnet --operator 0x<服务器钱包> --base-cap 50 --sweep-cap 25
//   node tools/deploy-contracts.js --dry --net mainnet --operator 0x...   # 只估算 gas，不签名不广播
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deploy, rpc, addressFromPriv, pkFromEnv, encodeCall, NETS } from './arc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(here, '..', 'build');

function arg(name, dflt) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; }
const has = (n) => process.argv.includes('--' + n);

const net = arg('net', 'mainnet');
const operator = arg('operator', null);
const baseCap = Number(arg('base-cap', '50'));      // USDC / 天，退坡前上限
const sweepCap = Number(arg('sweep-cap', '25'));    // USDC / 天，admin 回收限速
const dry = has('dry') || !process.env.ARC_PK;

const USDC = NETS[net].usdc;
const read = (f) => fs.readFileSync(path.join(buildDir, f), 'utf8').trim();

function explorer(a) { return `https://explorer.arc.io/${net === 'testnet' ? 'testnet/' : ''}address/${a}`; }

(async () => {
  if (!NETS[net]) throw new Error('unknown net ' + net);
  const regBin = read('BiosphereRegistry.bin');
  const poolBin = read('SubsidyPool.bin');
  if (!regBin || !poolBin) throw new Error('build/*.bin 不存在，先运行 solc 编译（见执行方案 Day 1）');
  const op = operator || (process.env.ARC_PK ? addressFromPriv(pkFromEnv()) : '0x1111111111111111111111111111111111111111');
  console.log(`\n== Arc ${net} (chainId ${NETS[net].chainId}) ==`);
  console.log(`   operator : ${op}`);
  console.log(`   USDC     : ${USDC}`);
  console.log(`   caps     : base ${baseCap} USDC/day · sweep ${sweepCap} USDC/day`);
  console.log(`   mode     : ${dry ? 'DRY-RUN（只估算，不广播）' : 'LIVE（将用 ARC_PK 签名并广播）'}\n`);

  const steps = [
    { name: 'BiosphereRegistry', bin: regBin, types: ['address'], args: [op] },
    { name: 'SubsidyPool', bin: poolBin, types: ['address', 'address', 'address', 'uint256', 'uint256'], args: [USDC, op, 'REGISTRY', BigInt(Math.round(baseCap * 1e6)), BigInt(Math.round(sweepCap * 1e6))] },
  ];

  const out = { net, deployedAt: new Date().toISOString(), usdc: USDC, operator: op };
  let registryAddress = arg('registry', '0x2222222222222222222222222222222222222222');

  for (const s of steps) {
    const args = s.args.map(a => a === 'REGISTRY' ? registryAddress : a);
    const { encodeCtor } = await import('./arc.js');
    const data = '0x' + Buffer.concat([Buffer.from(s.bin, 'hex'), encodeCtor(s.types, args)]).toString('hex');
    if (dry) {
      const gas = BigInt(await rpc(net, 'eth_estimateGas', [{ from: op, data, value: '0x0' }]));
      const gp = BigInt(await rpc(net, 'eth_gasPrice'));
      const cost = Number(gas * gp) / 1e18;
      console.log(`   [dry] ${s.name}: gas ${gas.toString()} ≈ $${cost.toFixed(4)}`);
      out[s.name] = { gas: gas.toString(), estCostUsdc: +cost.toFixed(6) };
      continue;
    }
    const pk = pkFromEnv();
    const r = await deploy({ net, pk, bin: s.bin, ctorTypes: s.types, ctorArgs: args });
    if (r.status !== '0x1') throw new Error(s.name + ' deployment reverted: ' + r.hash);
    console.log(`   ✓ ${s.name} → ${r.contractAddress}  (tx ${r.hash}, gas ${r.gasUsed.toString()})`);
    console.log(`     ${explorer(r.contractAddress)}`);
    out[s.name] = { address: r.contractAddress, tx: r.hash, gasUsed: r.gasUsed.toString() };
    if (s.name === 'BiosphereRegistry') registryAddress = r.contractAddress;
  }

  if (!dry) {
    const f = path.join(here, '..', `deployments.${net}.json`);
    fs.writeFileSync(f, JSON.stringify(out, null, 2));
    console.log(`\n   已写入 ${f}`);
    console.log(`\n   下一步：`);
    console.log(`     1) 在 Safe 里把 creator funds wallet 指向多签；`);
    console.log(`     2) Safe → USDC.approve(${out.SubsidyPool.address}, <金额>) → SubsidyPool.donate(<金额>)；`);
    console.log(`     3) 启动状态承诺循环：node tools/commit-state.js --net ${net} --registry ${out.BiosphereRegistry.address} --every 300`);
  } else {
    console.log('\n   DRY-RUN 完成。设置 ARC_PK 后去掉 --dry 即可真实部署。');
  }
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
