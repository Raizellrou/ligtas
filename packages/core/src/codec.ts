import { CURRENT_VERSION, Hazard, Severity, type AlertBody } from "./types.js";

/** PRD §5.1 — 20-byte signed body. */
export const BODY_LENGTH = 20;

const U8_MAX = 0xff;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;

function assertRange(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${name} must be an integer in [0, ${max}], got ${value}`);
  }
}

/**
 * Encodes an `AlertBody` to its 20-byte wire form, big-endian throughout.
 * Field ranges are enforced here because this is *our own* outgoing data —
 * an out-of-range value at this point is a bug, and should throw rather than
 * silently truncate. Contrast with `decodeBody`, which handles untrusted
 * wire input and never throws on field values, only on length.
 */
export function encodeBody(body: AlertBody): Uint8Array {
  assertRange("version", body.version, U8_MAX);
  assertRange("hazard", body.hazard, U8_MAX);
  assertRange("severity", body.severity, U8_MAX);
  assertRange("issuerIndex", body.issuerIndex, U8_MAX);
  assertRange("purokBitmap", body.purokBitmap, U32_MAX);
  assertRange("issuedAt", body.issuedAt, U32_MAX);
  assertRange("sequence", body.sequence, U32_MAX);
  assertRange("waterLevelCm", body.waterLevelCm, U16_MAX);

  const bytes = new Uint8Array(BODY_LENGTH);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, body.version);
  view.setUint8(1, body.hazard);
  view.setUint8(2, body.severity);
  view.setUint8(3, body.issuerIndex);
  view.setUint32(4, body.purokBitmap, false);
  view.setUint32(8, body.issuedAt, false);
  view.setUint32(12, body.sequence, false);
  view.setUint16(16, body.waterLevelCm, false);
  view.setUint16(18, 0, false); // reserved
  return bytes;
}

/**
 * Decodes a 20-byte wire body to an `AlertBody`. This is untrusted field
 * input — every byte pattern is structurally valid (a uint8 is never
 * "out of range" for its own field), so this never throws on field values,
 * only on wrong length. Semantic validity (known hazard, sane severity) is
 * `validateBody`'s job, run separately by whoever needs to gate on it.
 */
export function decodeBody(bytes: Uint8Array): AlertBody {
  if (bytes.length !== BODY_LENGTH) {
    throw new RangeError(`expected ${BODY_LENGTH}-byte body, got ${bytes.length}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    version: view.getUint8(0),
    hazard: view.getUint8(1),
    severity: view.getUint8(2),
    issuerIndex: view.getUint8(3),
    purokBitmap: view.getUint32(4, false),
    issuedAt: view.getUint32(8, false),
    sequence: view.getUint32(12, false),
    waterLevelCm: view.getUint16(16, false),
  };
}

const KNOWN_HAZARDS: ReadonlySet<number> = new Set(Object.values(Hazard));
const KNOWN_SEVERITIES: ReadonlySet<number> = new Set(Object.values(Severity));

/**
 * Semantic checks for a decoded body — separate from `decodeBody` because a
 * relay needs to structurally parse a packet before it can even check the
 * signature, and rejecting on semantics first would leak which check failed
 * to an attacker probing the format. Returns an empty array when valid.
 */
export function validateBody(body: AlertBody): string[] {
  const problems: string[] = [];
  if (body.version !== CURRENT_VERSION) {
    problems.push(`unsupported version ${body.version}`);
  }
  if (!KNOWN_HAZARDS.has(body.hazard)) {
    problems.push(`unknown hazard ${body.hazard}`);
  }
  if (!KNOWN_SEVERITIES.has(body.severity)) {
    problems.push(`unknown severity ${body.severity}`);
  }
  if (body.purokBitmap === 0) {
    problems.push("purokBitmap has no puroks set");
  }
  return problems;
}
