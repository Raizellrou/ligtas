/**
 * Alert bundle — the wire contract between hub, PWA, and the captured
 * dataset behind the Stage 3 hosted demo (PRD Section 11). One shape,
 * three producers: the live hub's GET /alerts, a file captured from a real
 * mesh-sim run, and (identically structured) any future replay tooling.
 *
 * Deliberately thin. An entry carries the raw packet hex and nothing
 * pre-decoded -- hazard, severity, purok, sequence all come from decoding
 * the packet itself, in whichever runtime consumes the bundle, via
 * decodeBody/verifyPacket. A bundle that shipped pre-decoded fields
 * alongside the packet would let a producer's metadata drift from what was
 * actually signed, which is exactly the failure mode signing exists to
 * prevent. The PWA verifies bundles itself for the same reason PRD Section 8
 * gives it packages/core at all: on the hosted build there is no hub to
 * trust, so the bundle has to be self-proving.
 */

/** Schema version for this contract. Bump on any breaking field change. */
export const ALERT_BUNDLE_VERSION = 1;

export type AlertBundleSource = "live" | "captured";

/**
 * Maps the packet's 1-byte issuerIndex to the full Stellar public key.
 * Real field nodes carry this as a provisioned, cached list (PRD Section
 * 5.1); a bundle has to carry the same list, since nothing else supplies it
 * to a browser with no hub to ask.
 */
export interface AlertBundleIssuer {
  issuerIndex: number;
  issuerPublicKey: string;
  /** Human label for demo/display only -- never used in verification. */
  label?: string;
}

export interface AlertBundleEntry {
  /** 84-byte packet (20-byte body + 64-byte signature), lowercase hex. */
  packetHex: string;
  /**
   * Hub's local receive time, unix seconds. This is NOT the packet's
   * issuedAt field -- see PRD Section 5.4 on why issuedAt is never trusted
   * for ordering. receivedAt is what determines bundle replay order below.
   */
  receivedAt: number;
  /**
   * Demo narration only, e.g. "genuine", "forged (impostor key)",
   * "replay of entry 0". Never consulted by verification logic -- a
   * consumer that reads this field to decide accept/reject has broken the
   * whole point of shipping raw bytes instead of a verdict.
   */
  demoLabel?: string;
}

export interface AlertBundle {
  schemaVersion: typeof ALERT_BUNDLE_VERSION;
  /** When this bundle was produced (hub export time, or capture time), unix seconds. */
  generatedAt: number;
  /**
   * "live" -- served fresh by packages/hub's GET /alerts.
   * "captured" -- a static file from a recorded mesh-sim run, behind the
   * Stage 3 hosted PWA build where no hub is reachable. PRD Section 11
   * requires this distinction be stated plainly, not left implicit.
   */
  source: AlertBundleSource;
  /** Free-text provenance note, required when source is "captured" -- e.g. which mesh-sim run, on what date. */
  captureNote?: string;
  issuers: AlertBundleIssuer[];
  /**
   * Ascending by receivedAt. Order matters: a consumer replaying this
   * bundle through a ReplayGuard to demonstrate replay rejection must feed
   * entries in this order for the sequence-based rules to mean anything.
   */
  alerts: AlertBundleEntry[];
}
