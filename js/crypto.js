/*
 * Passphrase encryption (PBKDF2-SHA256 -> AES-256-GCM) and passcode hashing.
 * Uses only the browser's built-in Web Crypto. Nothing here talks to the network.
 */
(function (root) {
  'use strict';
  const U = root.U;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const ITER = 250000;

  function hasCrypto() { return !!(root.crypto && root.crypto.subtle); }
  async function deriveKey(pass, salt, iter, usage) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, usage);
  }
  // Returns a small JSON-able envelope. The passphrase never leaves this function.
  async function encryptText(text, pass) {
    if (!hasCrypto()) throw new Error('Encryption needs a secure (https or localhost) page.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pass, salt, ITER, ['encrypt']);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
    return { orbit: 1, enc: 'aes-gcm', kdf: 'pbkdf2-sha256', iter: ITER, salt: U.b64(salt), iv: U.b64(iv), data: U.b64(ct) };
  }
  function isEnvelope(o) { return !!o && typeof o === 'object' && o.enc === 'aes-gcm' && typeof o.data === 'string' && typeof o.salt === 'string' && typeof o.iv === 'string'; }
  async function decryptText(env, pass) {
    if (!isEnvelope(env)) throw new Error('Not an encrypted Orbit file.');
    const iter = Number(env.iter);
    if (!Number.isInteger(iter) || iter < 10000 || iter > 5000000) throw new Error('Unsupported file.');
    const key = await deriveKey(pass, U.unb64(env.salt), iter, ['decrypt']);
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: U.unb64(env.iv) }, key, U.unb64(env.data));
      return dec.decode(pt);
    } catch (e) {
      throw new Error('Wrong passphrase, or the file is damaged.');
    }
  }
  async function hashPin(pin, saltB64) {
    const salt = saltB64 ? U.unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
    const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, 256);
    return { salt: U.b64(salt), hash: U.b64(bits), iter: 150000 };
  }
  async function verifyPin(pin, rec) {
    const r = await hashPin(pin, rec.salt);
    if (r.hash.length !== rec.hash.length) return false;
    let d = 0;
    for (let i = 0; i < r.hash.length; i++) d |= r.hash.charCodeAt(i) ^ rec.hash.charCodeAt(i);
    return d === 0;
  }
  root.Crypt = { hasCrypto, encryptText, decryptText, isEnvelope, hashPin, verifyPin };
})(self);
