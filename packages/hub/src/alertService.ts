import type Database from "better-sqlite3";
import {
  ALERT_BUNDLE_VERSION,
  ReplayGuard,
  alertHash,
  bytesFromHex,
  decodePacket,
  toHex,
  verifyBody,
  type AlertBundle,
  type AlertBundleEntry,
} from "@ligtas/core";

export type IngestDecision =
  | { decision: "accepted"; alertHash: string }
  | { decision: "rejected_signature" }
  | { decision: "rejected_unknown_issuer" }
  | { decision: "rejected_replay" }
  | { decision: "duplicate" }
  | { decision: "malformed"; reason: string };

interface AlertRow {
  alert_hash: string;
  body: Buffer;
  signature: Buffer;
  received_at: number;
}

interface HighestSequenceRow {
  issuer_pubkey: string;
  maxSequence: number;
}

export class AlertService {
  private readonly guard = new ReplayGuard();
  /** How many configured issuers had prior history restored at startup -- surfaced for the startup log, not used internally. */
  readonly restoredIssuerCount: number;

  constructor(
    private readonly db: Database.Database,
    private readonly issuers: Map<number, string>,
  ) {
    this.restoredIssuerCount = this.restoreGuardFromHistory();
  }

  /**
   * The guard's in-memory state does not survive a restart, but every alert
   * it ever accepted is already durable in `alerts` (issuer_pubkey,
   * sequence) -- read it back once at construction so an old sequence can't
   * be accepted again just because the process restarted. Keyed by pubkey
   * here (that's what's stored per row, not the 1-byte wire issuerIndex),
   * then mapped back to the issuerIndex this guard actually tracks by via
   * the *current* issuers config -- an issuer no longer configured is
   * skipped, since it would be rejected as unknown before ever reaching the
   * guard anyway.
   */
  private restoreGuardFromHistory(): number {
    const indexByPubkey = new Map<string, number>();
    for (const [issuerIndex, pubkey] of this.issuers) indexByPubkey.set(pubkey, issuerIndex);

    const rows = this.db
      .prepare<[], HighestSequenceRow>("SELECT issuer_pubkey, MAX(sequence) AS maxSequence FROM alerts GROUP BY issuer_pubkey")
      .all();

    let restored = 0;
    for (const row of rows) {
      const issuerIndex = indexByPubkey.get(row.issuer_pubkey);
      if (issuerIndex === undefined) continue;
      this.guard.restoreSequence(issuerIndex, row.maxSequence);
      restored++;
    }
    return restored;
  }

  /**
   * The hub's own verification path -- the same decision packages/core's
   * verify-alert.ts makes standalone, and the same one apps/pwa makes in
   * the browser for the hosted build. One implementation (ReplayGuard,
   * verifyBody) shared across all three; this method is orchestration, not
   * a second copy of the logic.
   */
  ingest(packetHex: string): IngestDecision {
    let packet: Uint8Array;
    try {
      packet = bytesFromHex(packetHex);
    } catch (e) {
      return { decision: "malformed", reason: (e as Error).message };
    }
    if (packet.length !== 84) {
      return { decision: "malformed", reason: `expected 84-byte packet, got ${packet.length}` };
    }

    const { body, signature } = decodePacket(packet);
    const bodyBytes = packet.subarray(0, 20);

    const issuerPublicKey = this.issuers.get(body.issuerIndex);
    if (issuerPublicKey === undefined) {
      return { decision: "rejected_unknown_issuer" };
    }

    if (!verifyBody(bodyBytes, signature, issuerPublicKey)) {
      return { decision: "rejected_signature" };
    }

    const hashHex = toHex(alertHash(bodyBytes));
    const replayDecision = this.guard.evaluate(hashHex, body.issuerIndex, body.sequence);
    if (replayDecision === "duplicate") return { decision: "duplicate" };
    if (replayDecision === "replay") return { decision: "rejected_replay" };

    // INSERT OR IGNORE: the guard already gates on hash uniqueness, but a
    // primary-key conflict here would otherwise throw and mask what really
    // happened -- defense in depth, not the primary dedupe mechanism.
    this.db
      .prepare(
        `INSERT OR IGNORE INTO alerts
           (alert_hash, body, signature, issuer_pubkey, sequence, hazard, severity, purok_bitmap, issued_at, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        hashHex,
        Buffer.from(bodyBytes),
        Buffer.from(signature),
        issuerPublicKey,
        body.sequence,
        body.hazard,
        body.severity,
        body.purokBitmap,
        body.issuedAt,
        Math.floor(Date.now() / 1000),
      );

    // Siren: no physical hardware in this build (CLAUDE.md hard constraint).
    // This is the hook a real siren driver or apps/sensor-wokwi integration
    // replaces; for now it's the visible proof an accepted alert fires one.
    console.log(`[siren] FIRED -- hazard=${body.hazard} severity=${body.severity} purokBitmap=${body.purokBitmap}`);

    return { decision: "accepted", alertHash: hashHex };
  }

  /** GET /alerts payload -- a live AlertBundle, same shape a captured one uses. */
  toBundle(): AlertBundle {
    const rows = this.db
      .prepare<[], AlertRow>("SELECT alert_hash, body, signature, received_at FROM alerts ORDER BY received_at ASC")
      .all();

    const alerts: AlertBundleEntry[] = rows.map((row) => ({
      packetHex: toHex(new Uint8Array(row.body)) + toHex(new Uint8Array(row.signature)),
      receivedAt: row.received_at,
    }));

    return {
      schemaVersion: ALERT_BUNDLE_VERSION,
      generatedAt: Math.floor(Date.now() / 1000),
      source: "live",
      issuers: Array.from(this.issuers, ([issuerIndex, issuerPublicKey]) => ({ issuerIndex, issuerPublicKey })),
      alerts,
    };
  }
}
