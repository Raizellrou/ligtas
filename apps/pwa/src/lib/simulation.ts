import { Keypair } from '@stellar/stellar-sdk/base'
import {
  CURRENT_VERSION,
  Hazard,
  encodePacket,
  toHex,
  type AlertBody,
  type AlertBundle,
  type AlertBundleEntry,
} from '@ligtas/core'

/**
 * The tester role's simulation engine.
 *
 * Everything here produces *real* signed bytes: packets are built with
 * `@ligtas/core`'s own `encodePacket` and signed with a real Ed25519
 * keypair, exactly as `packages/core`'s emit-alert.ts and the Wokwi sensor
 * node do. Nothing tells the verifier what kind of packet it is -- the
 * resident view decides for itself by running the same `evaluateBundle`
 * path it already ran against the captured bundle. A "forged" packet here
 * is genuinely signed by the wrong key, not flagged as fake.
 *
 * What is *not* real in the browser: radio propagation. There is no LoRa
 * mesh here; `packages/mesh-sim` owns that proof against a real
 * Meshtasticator instance (PRD Section 11 requires that distinction stay
 * explicit rather than implied, so the UI states it too).
 */

/**
 * Reserved for the browser's own synthetic tester keypair -- must never
 * collide with a real issuer index from the captured bundle. It used to be
 * hardcoded to 1 on the assumption the bundle only ever used index 0; that
 * assumption broke the moment a second real demo issuer (also index 1) was
 * added to packages/hub/config/issuers.json. useSimulation.ts's issuers
 * array is captured.issuers with this entry appended after, and
 * evaluateBundle.ts's issuerByIndex Map keeps the *last* entry on a
 * duplicate key -- so the tester's own public key silently shadowed the
 * real issuer 1's, and every genuine alert signed by issuer 1 verified
 * against the wrong key and came back rejected_signature. 255 (u8 max) is
 * outside the range any real committed issuer index would plausibly use.
 */
export const TESTER_ISSUER_INDEX = 255

/**
 * Thresholds mirroring apps/sensor-wokwi's own tier logic, so the river
 * gauge in the browser behaves like the simulated ESP32 gauge does.
 */
export const TIER_1_CM = 150
export const TIER_2_CM = 200
export const TIER_3_CM = 250
export const RIVER_MAX_CM = 400

export function tierForLevel(levelCm: number): number {
  if (levelCm >= TIER_3_CM) return 3
  if (levelCm >= TIER_2_CM) return 2
  if (levelCm >= TIER_1_CM) return 1
  return 0
}

export type BroadcastKind = 'genuine' | 'forged' | 'tampered' | 'replay-exact' | 'replay-sequence'

export const BROADCAST_LABEL: Record<BroadcastKind, string> = {
  genuine: 'genuine — signed by the authorised issuer',
  forged: 'forged — signed by an impostor keypair',
  tampered: 'tampered — a body byte flipped after signing',
  'replay-exact': 'replay — the exact same packet rebroadcast',
  'replay-sequence': 'replay — a fresh packet reusing an old sequence number',
}

export interface BroadcastOptions {
  hazard: number
  severity: number
  purokBitmap: number
  waterLevelCm: number
  sequence: number
}

const SECRET_STORAGE_KEY = 'ligtas.sim.issuerSecret'

/**
 * A throwaway keypair for the tester role, persisted so a page reload
 * doesn't invalidate packets broadcast before it. It never holds funds and
 * never leaves this browser -- it exists only so the signatures the
 * resident view checks are real ones.
 */
export function loadOrCreateTesterKeypair(): Keypair {
  const stored = localStorage.getItem(SECRET_STORAGE_KEY)
  if (stored !== null) {
    try {
      return Keypair.fromSecret(stored)
    } catch {
      // Stored value isn't a usable secret (hand-edited, or from an older
      // build) -- fall through and mint a fresh one rather than trapping
      // the tester on a broken key.
    }
  }
  const keypair = Keypair.random()
  localStorage.setItem(SECRET_STORAGE_KEY, keypair.secret())
  return keypair
}

function buildBody(options: BroadcastOptions): AlertBody {
  return {
    version: CURRENT_VERSION,
    hazard: options.hazard,
    severity: options.severity,
    issuerIndex: TESTER_ISSUER_INDEX,
    purokBitmap: options.purokBitmap,
    issuedAt: Math.floor(Date.now() / 1000),
    sequence: options.sequence,
    waterLevelCm: options.waterLevelCm,
  }
}

/**
 * Builds the raw packet bytes for a broadcast. `replay-exact` is handled by
 * the caller (it resends bytes that already exist), everything else is
 * built and signed here.
 */
export function buildPacketHex(kind: Exclude<BroadcastKind, 'replay-exact'>, issuer: Keypair, options: BroadcastOptions): string {
  const body = buildBody(options)

  if (kind === 'forged') {
    // A real signature from a key the verifier has never heard of. The
    // packet still *claims* the authorised issuer index -- which is exactly
    // why issuerIndex alone proves nothing (see packages/mesh-sim's README,
    // bug 3: a "genuine" packet is only genuine if the right key signed it).
    return toHex(encodePacket(body, Keypair.random()))
  }

  const packet = encodePacket(body, issuer)
  if (kind === 'tampered') {
    packet[16] ^= 0xff // flip a byte inside waterLevelCm, after signing
  }
  return toHex(packet)
}

export function emptyBundle(): AlertBundle {
  return {
    schemaVersion: 1,
    generatedAt: Math.floor(Date.now() / 1000),
    source: 'captured',
    issuers: [],
    alerts: [],
  }
}

export function defaultBroadcastOptions(): BroadcastOptions {
  return {
    hazard: Hazard.RIVER_FLOOD,
    severity: 2,
    purokBitmap: 0b1100, // puroks 3 and 4, matching the captured demo data
    waterLevelCm: 210,
    sequence: 1,
  }
}

export function newEntry(packetHex: string, kind: BroadcastKind): AlertBundleEntry {
  return {
    packetHex,
    receivedAt: Math.floor(Date.now() / 1000),
    demoLabel: BROADCAST_LABEL[kind],
  }
}
