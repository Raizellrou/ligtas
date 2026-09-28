import { sha256 } from "@noble/hashes/sha2.js";

/** PRD §5.2 — 32-byte alert identity, doubles as the Stellar `MEMO_HASH` value. */
export const ALERT_HASH_LENGTH = 32;

/**
 * `alertHash = SHA-256(body)`.
 *
 * Deliberately *not* Web Crypto (`crypto.subtle`): that is only defined in
 * secure contexts, so it is missing over plain HTTP on a LAN address —
 * which is exactly how PRD §9's hub serves this code to residents, from its
 * own WiFi at an IP address with no certificate and no internet to get one.
 * A verifier that silently loses its hash function in the field is worse
 * than useless, so hashing here is a pure-JS implementation that behaves
 * identically in every context (verified against `crypto.subtle` for the
 * same inputs).
 */
export function alertHash(body: Uint8Array): Uint8Array {
  return sha256(body);
}

/** Lowercase hex, used as the outbox primary key and mesh dedupe key. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Inverse of toHex. Used to decode a wire packet carried as hex -- see AlertBundleEntry. */
export function bytesFromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new RangeError(`hex string must have an even length, got ${hex.length}`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
