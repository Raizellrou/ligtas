#!/usr/bin/env node
/**
 * Emits one signed 84-byte alert packet as JSON on stdout, for consumption
 * by packages/mesh-sim (Python) — see PRD §5.5 for why the language
 * boundary exists. This script is the *only* place a packet gets built and
 * signed; mesh-sim only ever moves the bytes it's handed here.
 *
 * Usage:
 *   node scripts/emit-alert.ts [options]
 *
 * Options (all optional, sensible test defaults):
 *   --hazard <n>        default 1 (RIVER_FLOOD)
 *   --severity <n>      default 2
 *   --purok-bitmap <n>  default 12 (puroks 3 and 4)
 *   --sequence <n>      default 1
 *   --water-level <n>   default 187
 *   --issuer-index <n>  default 0
 *   --issuer-secret <S...>  reuse an existing issuer keypair instead of a fresh random one
 *   --mode <genuine|forged|tampered>  default genuine
 *     genuine  — signed by the issuer keypair (or a fresh one if --issuer-secret omitted)
 *     forged   — signed by a *different*, freshly generated keypair, while the
 *                output still reports the genuine issuer's public key as
 *                "expectedIssuerPublicKey" — this is what a verifying endpoint
 *                should reject
 *     tampered — genuinely signed, then one byte of the body is flipped after
 *                signing — this is what a verifying endpoint should also reject
 */
import { Keypair } from "@stellar/stellar-sdk/base";
import { CURRENT_VERSION, encodePacket, type AlertBody } from "@ligtas/core";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const mode = argValue("mode") ?? "genuine";
if (!["genuine", "forged", "tampered"].includes(mode)) {
  console.error(`unknown --mode ${mode}; expected genuine, forged, or tampered`);
  process.exit(1);
}

const body: AlertBody = {
  version: CURRENT_VERSION,
  hazard: Number(argValue("hazard") ?? 1),
  severity: Number(argValue("severity") ?? 2),
  issuerIndex: Number(argValue("issuer-index") ?? 0),
  purokBitmap: Number(argValue("purok-bitmap") ?? 0b1100),
  issuedAt: Math.floor(Date.now() / 1000),
  sequence: Number(argValue("sequence") ?? 1),
  waterLevelCm: Number(argValue("water-level") ?? 187),
};

const issuerSecret = argValue("issuer-secret");
const issuer = issuerSecret ? Keypair.fromSecret(issuerSecret) : Keypair.random();
const signer = mode === "forged" ? Keypair.random() : issuer;

const packet = encodePacket(body, signer);
if (mode === "tampered") {
  packet[16] ^= 0xff; // flip a byte inside waterLevelCm, after signing
}

process.stdout.write(
  JSON.stringify(
    {
      mode,
      packetHex: toHex(packet),
      body,
      expectedIssuerPublicKey: issuer.publicKey(),
      expectedIssuerSecret: issuer.secret(),
      signedByPublicKey: signer.publicKey(),
    },
    null,
    2,
  ) + "\n",
);
