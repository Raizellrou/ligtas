#!/usr/bin/env node
/**
 * Verifies one alert packet exactly as a verifying endpoint (hub, PWA)
 * would, per PRD Section 5.4/5.5 -- this is the counterpart to
 * emit-alert.ts, and it's the only place in the whole test flow that ever
 * decides accept/reject. packages/mesh-sim (Python) only moves bytes and
 * calls out here; it never re-implements this logic.
 *
 * Usage:
 *   node scripts/verify-alert.ts --packet-hex <hex> --issuer-public-key <G...> [--last-seq <n>]
 *
 * --last-seq   highest sequence already accepted from this issuer, to
 *              evaluate the replay rule statelessly per call. Default -1
 *              (nothing seen yet).
 */
import { alertHash, decodeBody, ReplayGuard, toHex, verifyPacket } from "@ligtas/core";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const packetHex = argValue("packet-hex");
const issuerPublicKey = argValue("issuer-public-key");
if (!packetHex || !issuerPublicKey) {
  console.error("usage: verify-alert.ts --packet-hex <hex> --issuer-public-key <G...> [--last-seq <n>] [--seen-hash <hex>]");
  process.exit(2);
}

const packet = new Uint8Array(packetHex.match(/../g)!.map((b) => parseInt(b, 16)));

const verified = verifyPacket(packet, issuerPublicKey);
if (verified === null) {
  console.log(JSON.stringify({ decision: "rejected_signature" }, null, 2));
  process.exit(0);
}

const bodyBytes = packet.subarray(0, 20);
const hash = toHex(alertHash(bodyBytes));

const lastSeq = Number(argValue("last-seq") ?? -1);
const guard = new ReplayGuard();
// Seed the guard's sequence watermark with a distinct dummy hash, so a
// single stateless CLI call can still exercise the replay rule exactly as a
// long-running endpoint would -- the seed hash can never collide with a
// real alertHash (hex SHA-256), so it never interferes with the dedupe path.
if (lastSeq >= 0) {
  guard.evaluate("__seed__", verified.body.issuerIndex, lastSeq);
}

const decision = guard.evaluate(hash, verified.body.issuerIndex, verified.body.sequence);

console.log(
  JSON.stringify(
    {
      decision: decision === "accept" ? "accepted" : `rejected_${decision}`,
      alertHash: hash,
      body: decodeBody(bodyBytes),
    },
    null,
    2,
  ),
);
