'use strict';
// Reads a Movie Archive file (.mvx) in the browser without loading it all into memory.
// The file is AES-256-GCM encrypted. GCM is counter mode underneath, so any part can be decrypted
// on its own with AES-CTR: only the information block is read at start, each picture when it is shown.

const MVX_MAGIC = 'MVXARCH1';
const BUILTIN_SECRET = 'mvx-archive::7f3c9a1e5b2d4c6e8a0b1d3f5e7a9c2b';

// ---- scrypt (RFC 7914) using WebCrypto PBKDF2 for the two PBKDF2 steps ----
async function pbkdf2(passBytes, salt, len) {
  const k = await crypto.subtle.importKey('raw', passBytes, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 1, hash: 'SHA-256' }, k, len * 8));
}
function salsa208(B, x) {
  for (let i = 0; i < 16; i++) x[i] = B[i];
  const R = (a, b) => (a << b) | (a >>> (32 - b));
  for (let i = 0; i < 8; i += 2) {
    x[4] ^= R(x[0] + x[12], 7); x[8] ^= R(x[4] + x[0], 9); x[12] ^= R(x[8] + x[4], 13); x[0] ^= R(x[12] + x[8], 18);
    x[9] ^= R(x[5] + x[1], 7); x[13] ^= R(x[9] + x[5], 9); x[1] ^= R(x[13] + x[9], 13); x[5] ^= R(x[1] + x[13], 18);
    x[14] ^= R(x[10] + x[6], 7); x[2] ^= R(x[14] + x[10], 9); x[6] ^= R(x[2] + x[14], 13); x[10] ^= R(x[6] + x[2], 18);
    x[3] ^= R(x[15] + x[11], 7); x[7] ^= R(x[3] + x[15], 9); x[11] ^= R(x[7] + x[3], 13); x[15] ^= R(x[11] + x[7], 18);
    x[1] ^= R(x[0] + x[3], 7); x[2] ^= R(x[1] + x[0], 9); x[3] ^= R(x[2] + x[1], 13); x[0] ^= R(x[3] + x[2], 18);
    x[6] ^= R(x[5] + x[4], 7); x[7] ^= R(x[6] + x[5], 9); x[4] ^= R(x[7] + x[6], 13); x[5] ^= R(x[4] + x[7], 18);
    x[11] ^= R(x[10] + x[9], 7); x[8] ^= R(x[11] + x[10], 9); x[9] ^= R(x[8] + x[11], 13); x[10] ^= R(x[9] + x[8], 18);
    x[12] ^= R(x[15] + x[14], 7); x[13] ^= R(x[12] + x[15], 9); x[14] ^= R(x[13] + x[12], 13); x[15] ^= R(x[14] + x[13], 18);
  }
  for (let i = 0; i < 16; i++) B[i] = (B[i] + x[i]) | 0;
}
function blockMix(B, Y, r, x) {
  const X = B.subarray((2 * r - 1) * 16, 2 * r * 16).slice();
  for (let i = 0; i < 2 * r; i++) {
    for (let j = 0; j < 16; j++) X[j] ^= B[i * 16 + j];
    salsa208(X, x);
    Y.set(X, i * 16);
  }
  for (let i = 0; i < r; i++) B.set(Y.subarray(2 * i * 16, (2 * i + 1) * 16), i * 16);
  for (let i = 0; i < r; i++) B.set(Y.subarray((2 * i + 1) * 16, (2 * i + 2) * 16), (r + i) * 16);
}
async function scrypt(passBytes, salt, N, r, p, dkLen) {
  const B8 = await pbkdf2(passBytes, salt, p * 128 * r);
  const words = 32 * r;
  const B = new Uint32Array(B8.buffer.slice(0));
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  if (!littleEndian) throw new Error('Unsupported device');
  const V = new Uint32Array(words * N); const Y = new Uint32Array(words); const x = new Uint32Array(16);
  for (let k = 0; k < p; k++) {
    const Xb = B.subarray(k * words, (k + 1) * words);
    for (let i = 0; i < N; i++) { V.set(Xb, i * words); blockMix(Xb, Y, r, x); }
    for (let i = 0; i < N; i++) {
      const j = Xb[(2 * r - 1) * 16] & (N - 1);
      for (let t = 0; t < words; t++) Xb[t] ^= V[j * words + t];
      blockMix(Xb, Y, r, x);
    }
  }
  return pbkdf2(passBytes, new Uint8Array(B.buffer), dkLen);
}

// ---- archive ----
class MvxReader {
  constructor(file) { this.file = file; }
  static b64(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

  async header() {
    const head = new Uint8Array(await this.file.slice(0, 12).arrayBuffer());
    if (String.fromCharCode(...head.subarray(0, 8)) !== MVX_MAGIC) throw Object.assign(new Error('This is not a Movie Archive file.'), { code: 'NOT_ARCHIVE' });
    const hlen = new DataView(head.buffer).getUint32(8);
    this.header_ = JSON.parse(new TextDecoder().decode(await this.file.slice(12, 12 + hlen).arrayBuffer()));
    this.bodyStart = 12 + hlen;
    return this.header_;
  }
  get needsPassword() { return !!(this.header_ && this.header_.pw); }

  async unlock(password) {
    const h = this.header_ || await this.header();
    const secret = h.pw ? 'user::' + (password || '') : BUILTIN_SECRET;
    const raw = await scrypt(new TextEncoder().encode(secret.normalize('NFC')), MvxReader.b64(h.salt), h.n || 16384, h.r || 8, h.p || 1, 32);
    this.key = await crypto.subtle.importKey('raw', raw, 'AES-CTR', false, ['decrypt']);
    this.iv = MvxReader.b64(h.iv);
  }

  // decrypt plaintext bytes [start, end) of the container
  async read(start, end) {
    const blk = Math.floor(start / 16); const skip = start - blk * 16;
    const ct = await this.file.slice(this.bodyStart + blk * 16, this.bodyStart + end).arrayBuffer();
    const counter = new Uint8Array(16); counter.set(this.iv, 0);
    new DataView(counter.buffer).setUint32(12, (2 + blk) >>> 0); // GCM: first data block uses counter 2
    const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CTR', counter, length: 32 }, this.key, ct));
    return pt.subarray(skip);
  }

  // the information part: titles, people, settings, and where each picture sits
  async load() {
    const lenBytes = await this.read(0, 4);
    const mlen = new DataView(lenBytes.buffer, lenBytes.byteOffset, 4).getUint32(0);
    if (!(mlen > 0 && mlen < this.file.size)) throw Object.assign(new Error('Wrong password.'), { code: 'WRONG_PASSWORD' });
    const comp = await this.read(4, 4 + mlen);
    let text;
    try {
      const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      text = await new Response(stream).text();
    } catch { throw Object.assign(new Error(this.needsPassword ? 'Wrong password.' : 'The file could not be read.'), { code: this.needsPassword ? 'WRONG_PASSWORD' : 'BAD_FILE' }); }
    const meta = JSON.parse(text);
    this.images = new Map(); let off = 4 + mlen;
    for (const im of meta.images || []) { this.images.set(im.id, { off, len: im.len, type: im.type }); off += im.len; }
    return meta.data;
  }

  async image(ref) {
    const id = String(ref || '').replace(/^img:/, '');
    const im = this.images && this.images.get(id); if (!im) return null;
    const bytes = await this.read(im.off, im.off + im.len);
    return new Blob([bytes], { type: im.type || 'image/jpeg' });
  }
}
if (typeof module !== 'undefined') module.exports = { MvxReader, scrypt };
