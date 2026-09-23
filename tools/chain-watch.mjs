// tools/chain-watch.mjs — 只读监控：链上承诺 vs 本地状态（演示/截图用）
//   node tools/chain-watch.mjs --registry 0x.. [--net testnet] [--server http://127.0.0.1:4030] [--once]
import { rpc, encodeCall, NETS } from './arc.js';
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; }
const has = (n) => process.argv.includes('--' + n);
const net = arg('net', 'testnet');
const reg = arg('registry', null);
const server = arg('server', 'http://127.0.0.1:4030');
const every = Number(arg('every', '10'));
if (!reg) { console.log('用法：node tools/chain-watch.mjs --registry 0x<registry> [--net testnet|mainnet] [--once]'); process.exit(1); }
const sel = (s) => '0x' + encodeCall(s, [], []).toString('hex').slice(0, 10);
const call = async (sig) => { try { return await rpc(net, 'eth_call', [{ to: reg, data: sel(sig) }, 'latest']); } catch { return null; } };
async function once() {
  const cnt = await call('commitCount()');
  const live = await call('isLive()');
  const ratio = await call('realRevenueRatioBps()');
  const gap = await call('secondsSinceLastCommit()');
  const lh = await call('latest()');
  let local = null;
  try { local = await (await fetch(server + '/api/bio/public', { cache: 'no-store' })).json(); } catch { /* server down */ }
  const w = lh && lh.length >= 2 + 64 * 4 ? lh.slice(2) : null;
  const chainRoot = w ? '0x' + w.slice(3 * 64, 4 * 64) : null;
  const chainGen = w ? Number(BigInt('0x' + w.slice(64, 128))) : null;
  const chainAlive = w ? Number(BigInt('0x' + w.slice(128, 192))) : null;
  console.log('--- ' + new Date().toLocaleTimeString() + ' · ' + net + ' · ' + reg);
  console.log('    commitCount=' + (cnt ? BigInt(cnt) : '—') + '  isLive=' + (live ? BigInt(live) === 1n : '—') +
    '  ratio=' + (ratio ? (Number(BigInt(ratio)) / 100).toFixed(2) + '%' : '—') +
    '  lastCommit=' + (gap ? Number(BigInt(gap)) + 's ago' : '—'));
  console.log('    chain : gen=' + chainGen + ' alive=' + chainAlive + ' root=' + (chainRoot ? chainRoot.slice(0, 22) + '…' : '—'));
  console.log('    local : gen=' + (local ? local.generations : '—') + ' alive=' + (local ? local.alive : '—') +
    ' root=' + (local ? local.populationRoot.slice(0, 22) + '…' : '(server 未启动)') +
    (local && chainRoot ? '  match=' + (chainRoot === local.populationRoot ? '✓' : '✗(不同 tick)') : ''));
}
await once();
if (!has('once')) setInterval(once, every * 1000);
