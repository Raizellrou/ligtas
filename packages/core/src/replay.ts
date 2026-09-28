/**
 * PRD §5.4 — replay, duplicate, and staleness rules.
 *
 * A multi-hop mesh delivers the *same* legitimate alert to a node more than
 * once, by different paths. Duplicate suppression (has this exact packet
 * been seen recently?) and replay defence (is this issuer's sequence number
 * moving backward?) are deliberately separate mechanisms — conflating them
 * either breaks propagation (an old-but-legitimate rebroadcast gets treated
 * as an attack) or opens a replay hole (a resent old packet gets waved
 * through as "just a duplicate").
 *
 * Clock trust is deliberately excluded: field nodes have no NTP and drift is
 * guaranteed, so `issuedAt` is never used to accept or reject a packet here.
 * Sequence number is the sole ordering defence — see PRD §5.4.
 */

export type ReplayDecision =
  | "accept"
  | "duplicate" // same alertHash seen recently — normal mesh rebroadcast, not an attack
  | "replay"; // sequence not newer than the last one accepted from this issuer

export interface ReplayGuardOptions {
  /** How long a seen `alertHash` is remembered for dedupe. Default 10 minutes. */
  seenHashTtlMs?: number;
}

interface SeenEntry {
  expiresAt: number;
}

const DEFAULT_SEEN_HASH_TTL_MS = 10 * 60 * 1000;

export class ReplayGuard {
  private readonly lastSeq = new Map<number, number>(); // issuerIndex -> highest sequence accepted
  private readonly seenHashes = new Map<string, SeenEntry>(); // alertHash hex -> expiry
  private readonly seenHashTtlMs: number;

  constructor(options: ReplayGuardOptions = {}) {
    this.seenHashTtlMs = options.seenHashTtlMs ?? DEFAULT_SEEN_HASH_TTL_MS;
  }

  /**
   * Evaluates one already-signature-verified packet and, if accepted,
   * records it — so a relay's whole receive path is
   * `if (guard.evaluate(...) !== "accept") drop(); else rebroadcast();`.
   * Sequence checks and dedupe both key off `issuerIndex`, not the public
   * key itself, matching the wire format's 1-byte issuer reference.
   */
  evaluate(alertHashHex: string, issuerIndex: number, sequence: number, now = Date.now()): ReplayDecision {
    this.pruneExpired(now);

    if (this.seenHashes.has(alertHashHex)) {
      return "duplicate";
    }

    const highestSeen = this.lastSeq.get(issuerIndex) ?? -1;
    if (sequence <= highestSeen) {
      return "replay";
    }

    this.seenHashes.set(alertHashHex, { expiresAt: now + this.seenHashTtlMs });
    this.lastSeq.set(issuerIndex, sequence);
    return "accept";
  }

  /**
   * Restores state after a restart. This guard's memory does not survive a
   * process restart, but a verifying endpoint that durably stores what it
   * accepted (the hub's `alerts` table) already has everything needed to
   * rebuild it -- call this once per issuer at startup with the highest
   * sequence previously accepted, read back from that storage, so an old
   * sequence cannot be accepted again just because the process restarted
   * (PRD §12, open question on replay-guard persistence). Never lowers an
   * already-tracked sequence, so calling this defensively, or more than
   * once, can only add protection, never remove it. Does not restore
   * `seenHashes`: that cache's TTL means it protects only against a
   * near-immediate rebroadcast, which is a narrower window than this closes.
   */
  restoreSequence(issuerIndex: number, sequence: number): void {
    const current = this.lastSeq.get(issuerIndex) ?? -1;
    if (sequence > current) this.lastSeq.set(issuerIndex, sequence);
  }

  private pruneExpired(now: number): void {
    for (const [hash, entry] of this.seenHashes) {
      if (entry.expiresAt <= now) this.seenHashes.delete(hash);
    }
  }
}
