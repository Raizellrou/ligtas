import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { decodePacket, encodePacket, PACKET_LENGTH, verifyPacket } from "../src/packet.js";
import { CURRENT_VERSION, Hazard, Severity, type AlertBody } from "../src/types.js";

const body: AlertBody = {
  version: CURRENT_VERSION,
  hazard: Hazard.FLASH_FLOOD,
  severity: Severity.TIER_1,
  issuerIndex: 2,
  purokBitmap: 0b0001,
  issuedAt: 1_893_456_000,
  sequence: 7,
  waterLevelCm: 95,
};

describe("encodePacket / decodePacket", () => {
  it("is 84 bytes: 20-byte body + 64-byte signature", () => {
    const issuer = Keypair.random();
    const packet = encodePacket(body, issuer);
    expect(packet.length).toBe(PACKET_LENGTH);
    expect(PACKET_LENGTH).toBe(84);
  });

  it("round-trips the body without needing the signature to be valid", () => {
    const issuer = Keypair.random();
    const packet = encodePacket(body, issuer);
    const decoded = decodePacket(packet);
    expect(decoded.body).toEqual(body);
  });
});

describe("verifyPacket", () => {
  it("returns the decoded packet for a genuine issuer", () => {
    const issuer = Keypair.random();
    const packet = encodePacket(body, issuer);

    const result = verifyPacket(packet, issuer.publicKey());

    expect(result).not.toBeNull();
    expect(result?.body).toEqual(body);
  });

  it("returns null for a forged packet — signed by someone else, claiming to be the issuer", () => {
    const issuer = Keypair.random();
    const attacker = Keypair.random();
    const forged = encodePacket(body, attacker);

    expect(verifyPacket(forged, issuer.publicKey())).toBeNull();
  });

  it("returns null when the body bytes are altered after signing", () => {
    const issuer = Keypair.random();
    const packet = encodePacket(body, issuer);
    packet[4] ^= 0xff; // flip a byte inside purokBitmap

    expect(verifyPacket(packet, issuer.publicKey())).toBeNull();
  });
});
