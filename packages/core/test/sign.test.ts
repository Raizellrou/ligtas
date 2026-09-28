import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { encodeBody } from "../src/codec.js";
import { SIGNATURE_LENGTH, signBody, verifyBody } from "../src/sign.js";
import { CURRENT_VERSION, Hazard, Severity, type AlertBody } from "../src/types.js";

const body: AlertBody = {
  version: CURRENT_VERSION,
  hazard: Hazard.RIVER_FLOOD,
  severity: Severity.TIER_3,
  issuerIndex: 0,
  purokBitmap: 0b1010,
  issuedAt: 1_893_456_000,
  sequence: 1,
  waterLevelCm: 210,
};

describe("signBody / verifyBody", () => {
  it("produces a 64-byte signature that verifies against the signer's own public key", () => {
    const issuer = Keypair.random();
    const bodyBytes = encodeBody(body);

    const signature = signBody(bodyBytes, issuer);

    expect(signature.length).toBe(SIGNATURE_LENGTH);
    expect(verifyBody(bodyBytes, signature, issuer.publicKey())).toBe(true);
  });

  it("rejects a signature from a different keypair", () => {
    const issuer = Keypair.random();
    const impostor = Keypair.random();
    const bodyBytes = encodeBody(body);

    const signature = signBody(bodyBytes, impostor);

    expect(verifyBody(bodyBytes, signature, issuer.publicKey())).toBe(false);
  });

  it("rejects a signature over tampered body bytes", () => {
    const issuer = Keypair.random();
    const bodyBytes = encodeBody(body);
    const signature = signBody(bodyBytes, issuer);

    const tampered = bodyBytes.slice();
    tampered[16] = tampered[16] ^ 0xff; // flip waterLevelCm

    expect(verifyBody(tampered, signature, issuer.publicKey())).toBe(false);
  });

  it("rejects a signature of the wrong length rather than throwing", () => {
    const issuer = Keypair.random();
    const bodyBytes = encodeBody(body);

    expect(verifyBody(bodyBytes, new Uint8Array(10), issuer.publicKey())).toBe(false);
  });
});
