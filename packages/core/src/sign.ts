// Only the /base subpath — never the root package or /rpc. The root package
// pulls in Horizon; importing it here would put a network dependency in the
// exact code that has to run correctly with zero connectivity. See CLAUDE.md
// "packages/core must never import Horizon or RPC".
import { Keypair } from "@stellar/stellar-sdk/base";

/** PRD §5.1 — 64-byte Ed25519 signature. */
export const SIGNATURE_LENGTH = 64;

/**
 * Signs an alert body per SEP-53 (`Keypair.signMessage`). The signing
 * identity is the issuer's Stellar keypair — no separate PKI, per the
 * project's key design rule.
 */
export function signBody(body: Uint8Array, issuer: Keypair): Uint8Array {
  return issuer.signMessage(body);
}

/**
 * Verifies an alert body's signature against an issuer's public key, fully
 * offline. Returns `false` for a bad signature rather than throwing, so a
 * relay's reject path stays a simple `if` — the one exception is a
 * malformed `issuerPublicKey` string, which is a config bug on the node's
 * cached issuer list, not a forged packet, and is left to throw.
 */
export function verifyBody(
  body: Uint8Array,
  signature: Uint8Array,
  issuerPublicKey: string,
): boolean {
  if (signature.length !== SIGNATURE_LENGTH) return false;
  return Keypair.fromPublicKey(issuerPublicKey).verifyMessage(body, signature);
}
