'use strict';
// Compatibility shim: provides the otplib v12 `authenticator` API using pure Node.js crypto.
// This avoids the ESM-only @scure/base dependency that breaks ts-jest.
const crypto = require('crypto');

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(str) {
  str = str.toUpperCase().replace(/=+$/, '');
  let bits = 0, value = 0;
  const output = [];
  for (const c of str) {
    const idx = B32_ALPHABET.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function base32Encode(buf) {
  let bits = 0, value = 0, result = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += B32_ALPHABET[(value << (5 - bits)) & 31];
  return result;
}

function computeTOTP(secret, timeMs) {
  const epoch = Math.floor((timeMs !== undefined ? timeMs : Date.now()) / 1000);
  const counter = Math.floor(epoch / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const key = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

const authenticator = {
  generateSecret: () => base32Encode(crypto.randomBytes(20)),
  generate: (secret) => computeTOTP(secret),
  check: (token, secret) => {
    // Allow ±1 time-step tolerance
    const now = Date.now();
    for (const delta of [-30000, 0, 30000]) {
      if (computeTOTP(secret, now + delta) === token) return true;
    }
    return false;
  },
};

module.exports = { authenticator };
