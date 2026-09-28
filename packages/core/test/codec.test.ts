import { describe, expect, it } from "vitest";
import { BODY_LENGTH, decodeBody, encodeBody, validateBody } from "../src/codec.js";
import { CURRENT_VERSION, Hazard, Severity, type AlertBody } from "../src/types.js";

const sample: AlertBody = {
  version: CURRENT_VERSION,
  hazard: Hazard.RIVER_FLOOD,
  severity: Severity.TIER_2,
  issuerIndex: 3,
  purokBitmap: 0b1100, // puroks 3 and 4
  issuedAt: 1_893_456_000,
  sequence: 42,
  waterLevelCm: 187,
};

describe("encodeBody / decodeBody", () => {
  it("round-trips every field exactly", () => {
    const encoded = encodeBody(sample);
    expect(encoded.length).toBe(BODY_LENGTH);
    expect(decodeBody(encoded)).toEqual(sample);
  });

  it("is big-endian, not host-endian", () => {
    // issuedAt=1 should land in the low byte of its 4-byte field, at offset 11.
    const encoded = encodeBody({ ...sample, issuedAt: 1 });
    expect(encoded[8]).toBe(0);
    expect(encoded[9]).toBe(0);
    expect(encoded[10]).toBe(0);
    expect(encoded[11]).toBe(1);
  });

  it("zeroes the reserved field", () => {
    const encoded = encodeBody(sample);
    expect(encoded[18]).toBe(0);
    expect(encoded[19]).toBe(0);
  });

  it("throws on out-of-range fields when encoding our own data", () => {
    expect(() => encodeBody({ ...sample, hazard: 256 })).toThrow(RangeError);
    expect(() => encodeBody({ ...sample, purokBitmap: -1 })).toThrow(RangeError);
    expect(() => encodeBody({ ...sample, sequence: 2 ** 32 })).toThrow(RangeError);
  });

  it("never throws on decode of any 20-byte input, however nonsensical", () => {
    const garbage = new Uint8Array(BODY_LENGTH).fill(0xff);
    expect(() => decodeBody(garbage)).not.toThrow();
  });

  it("throws on wrong-length input to decode", () => {
    expect(() => decodeBody(new Uint8Array(19))).toThrow(RangeError);
    expect(() => decodeBody(new Uint8Array(21))).toThrow(RangeError);
  });
});

describe("validateBody", () => {
  it("passes a well-formed body", () => {
    expect(validateBody(sample)).toEqual([]);
  });

  it("flags an unknown hazard byte", () => {
    expect(validateBody({ ...sample, hazard: 99 })).toContain("unknown hazard 99");
  });

  it("flags an unknown severity byte", () => {
    expect(validateBody({ ...sample, severity: 9 })).toContain("unknown severity 9");
  });

  it("flags a zero purok bitmap", () => {
    expect(validateBody({ ...sample, purokBitmap: 0 })).toContain("purokBitmap has no puroks set");
  });

  it("flags an unsupported version", () => {
    expect(validateBody({ ...sample, version: 2 })).toContain("unsupported version 2");
  });
});
