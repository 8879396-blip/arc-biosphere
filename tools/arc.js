// tools/arc.js — 零依赖 Arc(EVM) 签名 / 部署 / 调用工具
// 用途：部署 BiosphereRegistry + SubsidyPool，并让生命服务器周期性提交 populationRoot。
// 私钥只从环境变量 ARC_PK 读取，永不打印、永不落盘。
import crypto from 'node:crypto';
import fs from 'node:fs';
import { keccak256 } from '../src/keccak.js';

// ── secp256k1 ────────────────────────────────────────────────
const P  = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N  = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const HALF_N = N >> 1n;

const mod = (a, m = P) => { const r = a % m; return r < 0n ? r + m : r; };
const pow = (b, e, m) => { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = mod(r * b, m); b = mod(b * b, m); e >>= 1n; } return r; };
const inv = (a, m = P) => pow(mod(a, m), m - 2n, m);

function add(p1, p2) {
  if (!p1) return p2; if (!p2) return p1;
  const [x1, y1] = p1, [x2, y2] = p2;
  if (x1 === x2 && mod(y1 + y2) === 0n) return null;
  const l = x1 === x2 && y1 === y2 ? mod(3n * x1 * x1 * inv(2n * y1)) : mod((y2 - y1) * inv(mod(x2 - x1)));
  const x3 = mod(l * l - x1 - x2);
  return [x3, mod(l * (x1 - x3) - y1)];
}
const mul = (k, pt = [GX, GY]) => { let r = null, a = pt, s = mod(k, N); while (s > 0n) { if (s & 1n) r = add(r, a); a = add(a, a); s >>= 1n; } return r; };

const hx = (v, len = 32) => v.toString(16).padStart(len * 2, '0');
const b = (h) => Buffer.from(h, 'hex');
const toBig = (buf) => BigInt('0x' + Buffer.from(buf).toString('hex'));

function pubkeyFromPriv(d) { const pt = mul(d); return { x: pt[0], y: pt[1], uncompressed: b('04' + hx(pt[0]) + hx(pt[1])) }; }
function addressFromPriv(d) { const pk = pubkeyFromPriv(d); return '0x' + Buffer.from(keccak256(pk.uncompressed.subarray(1))).subarray(12).toString('hex'); }

// RFC6979 确定性 k
function rfc6979(d, msgHash) {
  let V = Buffer.alloc(32, 1), K = Buffer.alloc(32, 0);
  const x = b(hx(d));
  const h1 = Buffer.from(msgHash);
  K = crypto.createHmac('sha256', K).update(Buffer.concat([V, Buffer.from([0]), x, h1])).digest();
  V = crypto.createHmac('sha256', K).update(V).digest();
  K = crypto.createHmac('sha256', K).update(Buffer.concat([V, Buffer.from([1]), x, h1])).digest();
  V = crypto.createHmac('sha256', K).update(V).digest();
  for (;;) {
    V = crypto.createHmac('sha256', K).update(V).digest();
    const k = toBig(V);
    if (k > 0n && k < N) return k;
    K = crypto.createHmac('sha256', K).update(Buffer.concat([V, Buffer.from([0])])).digest();
    V = crypto.createHmac('sha256', K).update(V).digest();
  }
}

function sign(hashBytes, d) {
  const z = toBig(hashBytes);
  for (;;) {
    const k = rfc6979(d, hashBytes);
    const R = mul(k);
    const r = mod(R[0], N);
    if (r === 0n) continue;
    let s = mod(inv(k, N) * mod(z + r * d, N), N);
    if (s === 0n) continue;
    let parity = Number(R[1] & 1n);
    if (s > HALF_N) { s = N - s; parity ^= 1; }
    return { r, s, yParity: parity };
  }
}

function recover(hashBytes, r, s, yParity) {
  const z = toBig(hashBytes);
  const x = r;
  const alpha = mod(x * x * x + 7n);
  let y = pow(alpha, (P + 1n) / 4n, P);
  if (mod(y * y) !== alpha) throw new Error('bad point');
  if (Number(y & 1n) !== yParity) y = P - y;
  const R = [x, y];
  const rInv = inv(r, N);
  const u1 = mod(-z * rInv, N), u2 = mod(s * rInv, N);
  return add(mul(u1), mul(u2, R));
}

// ── RLP ──────────────────────────────────────────────────────
function rlpEnc(item) {
  if (Array.isArray(item)) {
    const payload = Buffer.concat(item.map(rlpEnc));
    return Buffer.concat([lenPrefix(payload.length, 0xc0), payload]);
  }
  const buf = typeof item === 'string'
    ? (item.startsWith('0x') ? b(item.slice(2).padStart(Math.ceil((item.length - 2) / 2) * 2, '0')) : Buffer.from(item))
    : Buffer.isBuffer(item) ? item
    : typeof item === 'bigint' || typeof item === 'number' ? (BigInt(item) === 0n ? Buffer.alloc(0) : b(hx(BigInt(item), (BigInt(item).toString(16).length + 1) >> 1)))
    : item === null || item === undefined ? Buffer.alloc(0) : Buffer.alloc(0);
  if (buf.length === 1 && buf[0] < 0x80) return buf;
  return Buffer.concat([lenPrefix(buf.length, 0x80), buf]);
}
function lenPrefix(len, offset) {
  if (len < 56) return Buffer.from([offset + len]);
  const lb = b(hx(BigInt(len), (BigInt(len).toString(16).length + 1) >> 1));
  return Buffer.concat([Buffer.from([offset + 55 + lb.length]), lb]);
}

// ── ABI ──────────────────────────────────────────────────────
const selector = (sig) => Buffer.from(keccak256(Buffer.from(sig))).subarray(0, 4);
function encArg(type, v) {
  if (type === 'address') return b(hx(BigInt(v), 32));
  if (type === 'bool') return b(hx(v ? 1n : 0n, 32));
  if (/^u?int/.test(type)) return b(hx(BigInt(v), 32));
  if (/^bytes\d+$/.test(type)) return b(Buffer.from(String(v).replace(/^0x/, ''), 'hex').toString('hex').padEnd(64, '0'));
  if (type === 'bytes' || type === 'string') return null; // handled by caller
  throw new Error('unsupported type ' + type);
}
function encodeCall(sig, types, values) {
  const head = [], tail = [];
  let dynOffset = types.length * 32;
  const tails = [];
  types.forEach((t, i) => {
    if (t === 'string' || t === 'bytes') {
      const raw = t === 'string' ? Buffer.from(values[i]) : b(String(values[i]).replace(/^0x/, ''));
      const padded = Buffer.concat([raw, Buffer.alloc((32 - (raw.length % 32)) % 32)]);
      const chunk = Buffer.concat([b(hx(BigInt(raw.length), 32)), padded]);
      head.push(b(hx(BigInt(dynOffset), 32)));
      tails.push(chunk);
      dynOffset += chunk.length;
    } else head.push(encArg(t, values[i]));
  });
  return Buffer.concat([selector(sig), ...head, ...tails]);
}
function encodeCtor(types, values) {
  if (!types || !types.length) return Buffer.alloc(0);
  const hasDyn = types.some((t) => t.endsWith('[]'));
  if (!hasDyn) return Buffer.concat(types.map((t, i) => encArg(t, values[i])));
  // 含动态类型（如 address[]）：head 放偏移，tail 放内容
  const head = [], tail = [];
  let dynOff = types.length * 32;
  types.forEach((t, i) => {
    if (t.endsWith('[]')) {
      const items = values[i] || [];
      const chunk = Buffer.concat([b(hx(BigInt(items.length), 32)), ...items.map((v) => encArg(t.slice(0, -2), v))]);
      head.push(b(hx(BigInt(dynOff), 32)));
      tail.push(chunk);
      dynOff += chunk.length;
    } else head.push(encArg(t, values[i]));
  });
  return Buffer.concat([...head, ...tail]);
}

// ── RPC ──────────────────────────────────────────────────────
const NETS = {
  mainnet: { rpc: 'https://rpc.mainnet.arc.io', chainId: 5042n, usdc: '0x3600000000000000000000000000000000000000' },
  testnet: { rpc: 'https://rpc.testnet.arc.io', chainId: 5042002n, usdc: '0x3600000000000000000000000000000000000000' },
};
export async function rpc(net, method, params = []) {
  const { rpc: url } = NETS[net] || NETS.mainnet;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = await res.json();
    if (j.error) { if (/rate limit|exceeded/i.test(j.error.message || '')) { await new Promise(r => setTimeout(r, 800)); continue; } throw new Error(method + ': ' + JSON.stringify(j.error)); }
    return j.result;
  }
  throw new Error(method + ': rate limited');
}

export async function estimateDeploy(net, data, from) {
  const g = await rpc(net, 'eth_estimateGas', [{ from, data, value: '0x0' }]);
  return BigInt(g);
}

export async function buildSend({ net, pk, to, data, value = 0n, gasLimit, maxFeePerGas, maxPriorityFeePerGas, nonce }) {
  const { chainId } = NETS[net] || NETS.mainnet;
  const addr = addressFromPriv(pk);
  if (nonce === undefined) nonce = BigInt(await rpc(net, 'eth_getTransactionCount', [addr, 'pending']));
  if (!maxPriorityFeePerGas) maxPriorityFeePerGas = BigInt(await rpc(net, 'eth_maxPriorityFeePerGas', []).catch(() => '0x4a817c800')) || 1200000000n;
  if (!maxFeePerGas) {
    const blk = await rpc(net, 'eth_getBlockByNumber', ['latest', false]);
    const bf = BigInt(blk.baseFeePerGas || 0);
    maxFeePerGas = bf * 2n + maxPriorityFeePerGas;
  }
  if (!gasLimit) {
    try { gasLimit = BigInt(await rpc(net, 'eth_estimateGas', [{ from: addr, to: to || undefined, data, value: '0x' + value.toString(16) }])) * 12n / 10n; }
    catch (e) { throw new Error('estimateGas failed: ' + e.message); }
  }
  const fields = [chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to ? to : Buffer.alloc(0), value, data || Buffer.alloc(0), []];
  const payload = Buffer.concat([Buffer.from([2]), rlpEnc(fields)]);
  const h = keccak256(payload);
  const { r, s, yParity } = sign(h, pk);
  const signed = Buffer.concat([Buffer.from([2]), rlpEnc([...fields, BigInt(yParity), r, s])]);
  const raw = '0x' + signed.toString('hex');
  const txHash = '0x' + Buffer.from(keccak256(signed)).toString('hex');
  return { raw, txHash, from: addr, nonce, gasLimit, maxFeePerGas, maxPriorityFeePerGas };
}

export async function sendRaw(net, raw) { return rpc(net, 'eth_sendRawTransaction', [raw]); }
export async function waitReceipt(net, txHash, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const rc = await rpc(net, 'eth_getTransactionReceipt', [txHash]);
    if (rc) return rc;
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('receipt timeout ' + txHash);
}

export async function deploy({ net, pk, bin, ctorTypes = [], ctorArgs = [] }) {
  const bytecode = Buffer.from(bin.replace(/^0x/, ''), 'hex');
  const data = Buffer.concat([bytecode, encodeCtor(ctorTypes, ctorArgs)]);
  const tx = await buildSend({ net, pk, to: null, data });
  const hash = await sendRaw(net, tx.raw);
  const rc = await waitReceipt(net, hash);
  return { ...tx, hash, status: rc.status, contractAddress: rc.contractAddress, gasUsed: BigInt(rc.gasUsed) };
}

export function pkFromEnv() {
  const s = process.env.ARC_PK;
  if (!s || !/^0x[0-9a-fA-F]{64}$/.test(s)) throw new Error('set ARC_PK=0x<64 hex> in the environment');
  return BigInt(s);
}

// ── 自检 ─────────────────────────────────────────────────────
export function selfTest() {
  const out = [];
  const empty = Buffer.from(keccak256(Buffer.alloc(0))).toString('hex');
  out.push(['keccak256("")', empty === 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470', empty]);
  const a1 = addressFromPriv(1n);
  out.push(['priv=1 → addr', a1.toLowerCase() === '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', a1]);
  const a2 = addressFromPriv(2n);
  out.push(['priv=2 → addr', a2.toLowerCase() === '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf', a2]);
  const msg = keccak256(Buffer.from('arc biosphere'));
  const sig = sign(msg, 1n);
  const rec = recover(msg, sig.r, sig.s, sig.yParity);
  const okRec = hx(rec[0]) === hx(pubkeyFromPriv(1n).x) && hx(rec[1]) === hx(pubkeyFromPriv(1n).y);
  out.push(['sign/recover roundtrip', okRec, 'r=' + sig.r.toString(16).slice(0, 12) + '… yParity=' + sig.yParity]);
  out.push(['low-s enforced', sig.s <= HALF_N, sig.s.toString(16).slice(0, 12) + '…']);
  // RLP 标准向量
  const r1 = rlpEnc('dog').toString('hex');
  out.push(['rlp("dog")', r1 === '83646f67', r1]);
  const r2 = rlpEnc([Buffer.from('cat'), Buffer.from('dog')]).toString('hex');
  out.push(['rlp(["cat","dog"])', r2 === 'c88363617483646f67', r2]);
  const r3 = rlpEnc(0).toString('hex');
  out.push(['rlp(0)', r3 === '80', r3]);
  const r4 = rlpEnc(1024).toString('hex');
  out.push(['rlp(1024)', r4 === '820400', r4]);
  // selector 校验：transfer(address,uint256) = 0xa9059cbb
  const sel = selector('transfer(address,uint256)').toString('hex');
  out.push(['selector transfer()', sel === 'a9059cbb', sel]);
  const sel2 = selector('approve(address,uint256)').toString('hex');
  out.push(['selector approve()', sel2 === '095ea7b3', sel2]);
  return out;
}

export { addressFromPriv, pubkeyFromPriv, selector, encodeCall, encodeCtor, rlpEnc, sign, recover, NETS };
