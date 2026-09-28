import type { Keypair } from "@stellar/stellar-sdk/base";
import { BODY_LENGTH, decodeBody, encodeBody } from "./codec.js";
import { signBody, verifyBody, SIGNATURE_LENGTH } from "./sign.js";
import type { AlertBody, AlertPacket } from "./types.js";

/** PRD §5.1 — 20-byte body + 64-byte signature, comfortably inside a LoRa payload. */
export const PACKET_LENGTH = BODY_LENGTH + SIGNATURE_LENGTH;

/** Builds and signs a full 84-byte wire packet from body fields. */
export function encodePacket(body: AlertBody, issuer: Keypair): Uint8Array {
  const bodyBytes = encodeBody(body);
  const signature = signBody(bodyBytes, issuer);
  const packet = new Uint8Array(PACKET_LENGTH);
  packet.set(bodyBytes, 0);
  packet.set(signature, BODY_LENGTH);
  return packet;
}

/**
 * Splits a wire packet into its body and signature without checking the
 * signature — structural parsing only. Callers verify separately with
 * `verifyBody` (or `verifyPacket` below) before trusting the contents.
 */
export function decodePacket(packet: Uint8Array): AlertPacket {
  if (packet.length !== PACKET_LENGTH) {
    throw new RangeError(`expected ${PACKET_LENGTH}-byte packet, got ${packet.length}`);
  }
  return {
    body: decodeBody(packet.subarray(0, BODY_LENGTH)),
    signature: packet.subarray(BODY_LENGTH),
  };
}

/**
 * Decodes and verifies a wire packet against a specific issuer's public key
 * in one step. Returns `null` for a bad signature rather than throwing, so
 * a relay's reject path is a single `if (verifyPacket(...) === null)`.
 */
export function verifyPacket(packet: Uint8Array, issuerPublicKey: string): AlertPacket | null {
  const { body, signature } = decodePacket(packet);
  const bodyBytes = packet.subarray(0, BODY_LENGTH);
  return verifyBody(bodyBytes, signature, issuerPublicKey) ? { body, signature } : null;
}
