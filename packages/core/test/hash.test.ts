import { describe, expect, it } from "vitest";
import { encodeBody } from "../src/codec.js";
import { ALERT_HASH_LENGTH, alertHash, toHex } from "../src/hash.js";
import { CURRENT_VERSION, Hazard, Severity, type AlertBody } from "../src/types.js";

const body: AlertBody = {
  version: CURRENT_VERSION,
  hazard: Hazard.STORM_SURGE,
  severity: Severity.TIER_2,
  issuerIndex: 1,
  purokBitmap: 0b0110,
  issuedAt: 1_893_456_000,
  sequence: 3,
  waterLevelCm: 150,
};

describe("alertHash", () => {
  it("is 32 bytes — exactly a Stellar MEMO_HASH", () => {
    const hash = alertHash(encodeBody(body));
    expect(hash.length).toBe(ALERT_HASH_LENGTH);
  });

  it("is deterministic for the same body", () => {
    const bodyBytes = encodeBody(body);
    expect(toHex(alertHash(bodyBytes))).toBe(toHex(alertHash(bodyBytes)));
  });

  it("changes if a single body byte changes", () => {
    const bodyBytes = encodeBody(body);
    const tampered = bodyBytes.slice();
    tampered[12] ^= 0x01; // flip a bit in sequence

    expect(toHex(alertHash(tampered))).not.toBe(toHex(alertHash(bodyBytes)));
  });

  /**
   * The reason this module doesn't use `crypto.subtle`: it is undefined
   * outside a secure context, which is precisely how the hub serves the PWA
   * in the field (plain HTTP, LAN IP, no certificate). This pins the
   * pure-JS implementation to the same answer Web Crypto gives, so the
   * swap can never silently change an alert's identity.
   */
  it("matches crypto.subtle's SHA-256 for the same body", async () => {
    const bodyBytes = encodeBody(body);
    const viaWebCrypto = new Uint8Array(await crypto.subtle.digest("SHA-256", bodyBytes as BufferSource));
    expect(toHex(alertHash(bodyBytes))).toBe(toHex(viaWebCrypto));
  });
});
