// keccak-256 (original Keccak padding, NOT NIST SHA3-256) — chain-compatible.
// Zero dependencies; BigInt lanes. Verified against known test vectors.
// Lane flat index convention: idx = x + 5*y  (matches KeccakP1600 LANE_INDEX).
const MASK = (1n << 64n) - 1n;

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// ROTC[x + 5*y], from the spec recurrence
//   (x,y) <- (y, (2x+3y) mod 5),  r = (t+1)(t+2)/2 mod 64, starting at (1,0), r(0,0)=0
// Verified: Keccak-f[1600] on the all-zero state yields lane[0] = F1258F7940E1DDE7.
const ROTC = [
  0,  1, 62, 28, 27,   // y = 0
 36, 44,  6, 55, 20,   // y = 1
  3, 10, 43, 25, 39,   // y = 2
 41, 45, 15, 21,  8,   // y = 3
 18,  2, 61, 56, 14,   // y = 4
];

function rotl(v, n) {
  const s = BigInt(n) % 64n;
  if (s === 0n) return v & MASK;
  return ((v << s) | (v >> (64n - s))) & MASK;
}

function keccakF(A) {
  const B = new Array(25);
  const C = new Array(5);
  const D = new Array(5);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
    for (let i = 0; i < 25; i++) A[i] = (A[i] ^ D[i % 5]) & MASK;

    // rho + pi :  B[y][2x+3y] = rot(A[x][y], r[x][y])   ->  flat dst = y + 5*((2x+3y) % 5)
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const src = x + 5 * y;
        const dst = y + 5 * ((2 * x + 3 * y) % 5);
        B[dst] = rotl(A[src], ROTC[src]);
      }
    }
    // chi
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const i = x + 5 * y;
        A[i] = B[i] ^ ((~B[((x + 1) % 5) + 5 * y] & MASK) & B[((x + 2) % 5) + 5 * y]);
      }
    }
    A[0] = (A[0] ^ RC[round]) & MASK;   // iota
  }
  return A;
}

const RATE = 136; // bytes for keccak-256

function absorb(A, block, off) {
  for (let i = 0; i < RATE / 8; i++) {
    let lane = 0n;
    for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(block[off + i * 8 + b]);
    A[i] ^= lane;
  }
  keccakF(A);
}

export function keccak256(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(String(bytes));
  const blocks = Math.floor(input.length / RATE) + 1;
  const padded = new Uint8Array(blocks * RATE);
  padded.set(input);
  padded[input.length] ^= 0x01;              // original Keccak pad10*1 (SHA3 would use 0x06)
  padded[padded.length - 1] ^= 0x80;

  const A = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += RATE) absorb(A, padded, off);

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = A[i];
    for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(lane & 0xffn); lane >>= 8n; }
  }
  return out;
}

export function keccak256Hex(bytes) { return '0x' + Buffer.from(keccak256(bytes)).toString('hex'); }

function toBytes(p) {
  if (p instanceof Uint8Array) return p;
  if (typeof p === 'string' && /^0x[0-9a-fA-F]*$/.test(p)) return new Uint8Array(Buffer.from(p.slice(2), 'hex'));
  if (typeof p === 'bigint' || typeof p === 'number') {
    const t = Buffer.alloc(32); let v = BigInt(p) & ((1n << 256n) - 1n);
    for (let i = 31; i >= 0; i--) { t[i] = Number(v & 0xffn); v >>= 8n; }
    return new Uint8Array(t);
  }
  if (typeof p === 'string') return new TextEncoder().encode(p);
  return new TextEncoder().encode(JSON.stringify(p));
}

/** Mirrors Solidity `keccak256(abi.encodePacked(bytes32, string, uint256, ...))` for
 *  bytes32/uint256/string parts — so a contract can recompute the identical receipt. */
export function hashConcat(...parts) {
  const cs = parts.map(toBytes);
  const total = cs.reduce((s, c) => s + c.length, 0);
  const buf = new Uint8Array(total); let o = 0;
  for (const c of cs) { buf.set(c, o); o += c.length; }
  return keccak256(buf);
}
export function hashConcatHex(...parts) { return '0x' + Buffer.from(hashConcat(...parts)).toString('hex'); }
export const toHex = (u8) => '0x' + Buffer.from(u8).toString('hex');
