/** PRD §5.1 — wire format version this codec implements. */
export const CURRENT_VERSION = 1;

/** PRD §5.1 offset 1 — `hazard` values. */
export const Hazard = {
  TEST: 0,
  RIVER_FLOOD: 1,
  FLASH_FLOOD: 2,
  STORM_SURGE: 3,
} as const;
export type Hazard = (typeof Hazard)[keyof typeof Hazard];

/** PRD §5.1 offset 2 — `severity` tiers. */
export const Severity = {
  TIER_1: 1,
  TIER_2: 2,
  TIER_3: 3,
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

/**
 * The 20-byte signed body, decoded to fields. This is what gets hashed and
 * signed — see PRD §5.1 and §5.2.
 */
export interface AlertBody {
  version: number;
  hazard: number;
  severity: number;
  /** Index into the cached authorised-issuer public-key list, not the key itself. */
  issuerIndex: number;
  /** Bit n set = purok n+1 affected. */
  purokBitmap: number;
  /** Unix seconds, as claimed by the issuer — never trusted for ordering. See PRD §5.4. */
  issuedAt: number;
  /** Per-issuer, strictly increasing. The sole replay defence. */
  sequence: number;
  waterLevelCm: number;
}

/** A decoded `AlertBody` plus its 64-byte Ed25519 signature. */
export interface AlertPacket {
  body: AlertBody;
  signature: Uint8Array;
}
