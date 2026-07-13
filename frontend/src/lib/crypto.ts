/**
 * Client-side end-to-end encryption using tweetnacl (X25519 + XSalsa20-Poly1305).
 *
 * Each user has a Curve25519 keypair. Private key stays on-device (SecureStore/localStorage).
 * Public key is uploaded to the server so other users can encrypt for us.
 *
 * Encrypting: nacl.box(plaintext, nonce, theirPublicKey, myPrivateKey)
 * The server only ever sees {ciphertext, nonce, encrypted: true} — no plaintext.
 */
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const PRIV_KEY = 'bubble_e2ee_priv';
const PUB_KEY = 'bubble_e2ee_pub';

async function storeGet(k: string): Promise<string | null> {
  if (Platform.OS === 'web') return localStorage.getItem(k);
  return await SecureStore.getItemAsync(k);
}
async function storeSet(k: string, v: string): Promise<void> {
  if (Platform.OS === 'web') { localStorage.setItem(k, v); return; }
  await SecureStore.setItemAsync(k, v);
}

export type Keypair = { publicKey: string; secretKey: string }; // base64

export async function ensureKeypair(): Promise<Keypair> {
  let pub = await storeGet(PUB_KEY);
  let priv = await storeGet(PRIV_KEY);
  if (!pub || !priv) {
    const kp = nacl.box.keyPair();
    pub = util.encodeBase64(kp.publicKey);
    priv = util.encodeBase64(kp.secretKey);
    await storeSet(PUB_KEY, pub);
    await storeSet(PRIV_KEY, priv);
  }
  return { publicKey: pub, secretKey: priv };
}

export function encryptFor(theirPubB64: string, mySecretB64: string, plaintext: string): { ciphertext: string; nonce: string } {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(
    util.decodeUTF8(plaintext),
    nonce,
    util.decodeBase64(theirPubB64),
    util.decodeBase64(mySecretB64),
  );
  return { ciphertext: util.encodeBase64(box), nonce: util.encodeBase64(nonce) };
}

export function decryptFrom(theirPubB64: string, mySecretB64: string, ciphertext: string, nonce: string): string | null {
  try {
    const box = util.decodeBase64(ciphertext);
    const n = util.decodeBase64(nonce);
    const plain = nacl.box.open(box, n, util.decodeBase64(theirPubB64), util.decodeBase64(mySecretB64));
    if (!plain) return null;
    return util.encodeUTF8(plain);
  } catch { return null; }
}

/**
 * Deterministic safety-number for verification.
 * SHA-256 of the sorted concat of both public keys, formatted as 5×5-digit groups.
 * Two users comparing this in person can confirm no man-in-the-middle.
 */
export async function fingerprintOf(pubA: string, pubB: string): Promise<string> {
  const sorted = [pubA, pubB].sort().join('|');
  let hex: string;
  if (typeof crypto !== 'undefined' && crypto.subtle && Platform.OS === 'web') {
    const data = new TextEncoder().encode(sorted);
    const buf = await crypto.subtle.digest('SHA-256', data);
    hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } else {
    // Fallback: use nacl.hash (SHA-512 → take first 32 bytes)
    const bytes = nacl.hash(util.decodeUTF8(sorted)).slice(0, 32);
    hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Convert to base-10 groups of 5 digits × 5 groups (25 digits total)
  const digits = BigInt('0x' + hex).toString(10).padStart(25, '0').slice(0, 25);
  return digits.match(/.{1,5}/g)!.join(' ');
}
