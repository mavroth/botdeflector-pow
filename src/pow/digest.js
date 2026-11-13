import { createHash } from 'node:crypto';

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const cache = new Map();
const CACHE_LIMIT = 8;

function remember(key, fn) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, fn);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return fn;
}

function asBuffer(seed) {
  if (Buffer.isBuffer(seed)) return seed;
  if (typeof seed !== 'string') throw new TypeError('seed must be a string');
  return Buffer.from(seed, 'utf8');
}

function blockWords(seed) {
  const len = 4 + seed.length;
  const msg = new Uint8Array(64);
  msg.set(seed, 4);
  msg[len] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(60, len * 8, false);
  const words = new Uint32Array(16);
  for (let i = 0; i < 16; i++) words[i] = view.getUint32(i * 4, false);
  return words;
}

/**
 * Hash every edge in [start, end).
 * The message is u32le(edge) || seed and, for a seed of at most 51 bytes, it
 * fits in one SHA-256 block. Word 0 is the edge. Words 1..15 stay put.
 * One shared function stays hot across sessions; a fresh closure per seed does not.
 */
// One schedule buffer per isolate. fillBlock never yields, so callers cannot overlap.
const schedule = new Uint32Array(64);

function fillBlock(start, end, mask, us, vs, words) {
  const w = schedule;
  for (let edge = start; edge < end; edge++) {
    w[0] = ((edge & 255) << 24)
      | (((edge >>> 8) & 255) << 16)
      | (((edge >>> 16) & 255) << 8)
      | (edge >>> 24);
    for (let i = 1; i < 16; i++) w[i] = words[i];
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = 0x6a09e667;
    let b = 0xbb67ae85;
    let c = 0x3c6ef372;
    let d = 0xa54ff53a;
    let e = 0x510e527f;
    let f = 0x9b05688c;
    let g = 0x1f83d9ab;
    let h = 0x5be0cd19;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const h0 = (0x6a09e667 + a) >>> 0;
    const h2 = (0x3c6ef372 + c) >>> 0;
    us[edge] = ((((h0 & 255) << 24) | ((h0 >>> 8) & 65280) | ((h0 & 65280) << 8) | (h0 >>> 24)) & mask) >>> 0;
    vs[edge] = ((((h2 & 255) << 24) | ((h2 >>> 8) & 65280) | ((h2 & 65280) << 8) | (h2 >>> 24)) & mask) >>> 0;
  }
}

function compileShort(seed) {
  const words = blockWords(seed);
  return function fillShort(start, end, mask, us, vs) {
    fillBlock(start, end, mask, us, vs, words);
  };
}

function compileCrypto(seed) {
  const input = Buffer.allocUnsafe(4 + seed.length);
  seed.copy(input, 4);
  return function fillCrypto(start, end, mask, us, vs) {
    for (let edge = start; edge < end; edge++) {
      input.writeUInt32LE(edge, 0);
      const digest = createHash('sha256').update(input).digest();
      us[edge] = digest.readUInt32LE(0) & mask;
      vs[edge] = digest.readUInt32LE(8) & mask;
    }
  };
}

/** Fill us[edge], vs[edge] for edge in [start, end). */
export function compileFill(seed) {
  const buf = asBuffer(seed);
  const key = buf.toString('latin1');
  const hit = cache.get(key);
  if (hit) return remember(key, hit);
  const fn = buf.length <= 51 ? compileShort(buf) : compileCrypto(buf);
  return remember(key, fn);
}

/** Spec endpoints: sha256(u32le(edge) || seed), masked to the node space. */
export function edgeEndpoints(edge, numNodes, seed) {
  if (!Number.isInteger(edge) || edge < 0) throw new RangeError('edge must be >= 0');
  if (!Number.isInteger(numNodes) || numNodes < 2 || (numNodes & (numNodes - 1)) !== 0) {
    throw new RangeError('numNodes must be a power of two');
  }
  const head = Buffer.alloc(4);
  head.writeUInt32LE(edge, 0);
  const digest = createHash('sha256').update(head).update(asBuffer(seed)).digest();
  const mask = numNodes - 1;
  return [digest.readUInt32LE(0) & mask, digest.readUInt32LE(8) & mask];
}
