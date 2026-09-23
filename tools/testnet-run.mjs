// tools/testnet-run.mjs — 一条命令跑通测试网全链路：部署三合约 → 周期性 commit → 实时核对链上状态
//   node tools/testnet-run.mjs                 # 用 .data-live/testnet-operator.key
//   ARC_PK=0x.. node tools/testnet-run.mjs     # 或显式私钥
//   COMMIT_EVERY_SEC=30 node tools/testnet-run.mjs
// 前置：测试网钱包要有 USDC（gas 用）。没有的话本脚本会打印领取步骤并退出。
import fs from 'node:fs';
import path from 'node:path';
import { deploy, rpc, addressFromPriv, encodeCtor, encodeCall, buildSend, sendRaw, waitReceipt, NETS } from './arc.js';

const NET = 'testnet';
const KEY = path.resolve('.data-live/testnet-operator.key');
const DEPL = path.resolve('deployments.testnet.json');
const SERVER = process.env.PP_SERVER || 'http://127.0.0.1:4030';
const EVERY = Number(process.env.COMMIT_EVERY_SEC || 60);
const USDC = NETS[NET].usdc;

const pk = process.env.ARC_PK ? BigInt(process.env.ARC_PK) : BigInt(fs.readFileSync(KEY, 'utf8').trim());
const op = addressFromPriv(pk);
console.log('== testnet-run ==');
console.log('   operator : ' + op);
console.log('   network  : ' + NET + ' (chainId ' + NETS[NET].chainId + ')');
console.log('   server   : ' + SERVER + '  · 每 ' + EVERY + 's 提交一次');

const bal = BigInt(await rpc(NET, 'eth_call', [{ to: USDC, data: '0x' + encodeCall('balanceOf(address)', ['address'], [op]).toString('hex') }, 'latest']));
const funded = bal > 0n;
if (!funded) {
  console.log('\n   ✗ 测试网钱包余额为 0，Arc 的 gas 用 USDC 结算，先领测试币：');
  console.log('     1) 打开 https://faucet.circle.com');
  console.log('     2) 网络选 Arc Testnet（chainId ' + Number(NETS[NET].chainId) + '）');
  console.log('     3) 地址填 ' + op);
  console.log('     4) 领完后重跑本命令');
  process.exitCode = 2;
}
if (funded) {
console.log('   balance  : ' + (Number(bal) / 1e6).toFixed(4) + ' USDC ✓');

// ---- 部署（已有 deployments.testnet.json 就复用）----
let reg = null, pool = null, multi = null;
if (fs.existsSync(DEPL)) {
  const d = JSON.parse(fs.readFileSync(DEPL, 'utf8'));
  reg = d.contracts.BiosphereRegistry.address; pool = d.contracts.SubsidyPool.address; multi = d.contracts.MultiSigWallet.address;
  console.log('   复用已部署合约：registry ' + reg);
} else {
  const build = (f) => fs.readFileSync(path.join('build', f), 'utf8').trim();
  const steps = [
    { name: 'MultiSigWallet', bin: 'MultiSigWallet.bin', types: ['address[]', 'uint256'], args: [[op], 1n] },
    { name: 'BiosphereRegistry', bin: 'BiosphereRegistry.bin', types: ['address'], args: [op] },
    { name: 'SubsidyPool', bin: 'SubsidyPool.bin', types: ['address', 'address', 'address', 'uint256', 'uint256'], args: [USDC, op, 'REG', 50_000_000n, 25_000_000n] },
  ];
  const out = { net: NET, chainId: Number(NETS[NET].chainId), usdc: USDC, operator: op, contracts: {}, deployedAt: null };
  for (const s of steps) {
    const args = s.args.map(a => (a === 'REG' ? reg : a));
    const r = await deploy({ net: NET, pk, bin: build(s.bin), ctorTypes: s.types, ctorArgs: args });
    if (r.status !== '0x1') throw new Error(s.name + ' reverted: ' + r.hash);
    out.contracts[s.name] = { address: r.contractAddress, tx: r.hash, gasUsed: r.gasUsed.toString() };
    console.log('   ✓ ' + s.name.padEnd(18) + r.contractAddress + '  gas ' + r.gasUsed);
    if (s.name === 'BiosphereRegistry') reg = r.contractAddress;
    if (s.name === 'SubsidyPool') pool = r.contractAddress;
    if (s.name === 'MultiSigWallet') multi = r.contractAddress;
  }
  out.deployedAt = new Date().toISOString();
  fs.writeFileSync(DEPL, JSON.stringify(out, null, 2));
  console.log('   已写入 deployments.testnet.json');
}

// ---- 承诺循环 ----
const sel = (s) => '0x' + encodeCall(s, [], []).toString('hex').slice(0, 10);
const call = async (sig) => rpc(NET, 'eth_call', [{ to: reg, data: sel(sig) }, 'latest']);
const u64 = (x) => BigInt(Math.round(Number(x) * 1e6));

for (;;) {
  try {
    const d = await (await fetch(SERVER + '/api/bio/public', { cache: 'no-store' })).json();
    const h = d.honesty || {};
    const data = encodeCall('commit(uint32,uint32,bytes32,uint64,uint64)', ['uint32', 'uint32', 'bytes32', 'uint64', 'uint64'],
      [d.generations, d.alive, d.populationRoot, u64(h.realRevenueUSDC || 0), u64(h.subsidyUSDC || 0)]);
    const tx = await buildSend({ net: NET, pk, to: reg, data, gasLimit: 250000n });
    const hash = await sendRaw(NET, tx.raw);
    const rc = await waitReceipt(NET, hash, 60000);
    const cnt = BigInt(await call('commitCount()'));
    const live = BigInt(await call('isLive()')) === 1n;
    const ratio = Number(BigInt(await call('realRevenueRatioBps()')));
    const lh = (await call('latest()')).slice(2);
    const chainRoot = '0x' + lh.slice(3 * 64, 4 * 64);
    const match = chainRoot === d.populationRoot;
    console.log('   [' + new Date().toLocaleTimeString() + '] commit #' + cnt + ' tick=' + d.tick + ' alive=' + d.alive +
      ' gen=' + d.generations + ' ratio=' + (ratio / 100).toFixed(2) + '% isLive=' + live +
      ' rootMatch=' + (match ? '✓' : '✗') + ' gas=' + BigInt(rc.gasUsed) + ' tx=' + hash.slice(0, 18) + '…');
  } catch (e) {
    console.log('   [warn] ' + e.message.slice(0, 160));
  }
  await new Promise(r => setTimeout(r, EVERY * 1000));
}
}
