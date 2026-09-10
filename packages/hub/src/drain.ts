import type Database from "better-sqlite3";
import type { Keypair } from "@stellar/stellar-sdk/base";
import { bytesFromHex } from "@ligtas/core";
import {
  getTransactionStatus,
  prepareAnchorTransaction,
  preparePayoutTransaction,
  type PayoutClaim,
} from "@ligtas/stellar";
import { matchingHouseholds } from "./households.js";

export interface DrainResult {
  alertHash: string;
  outcome: "confirmed" | "failed";
}

export interface PayoutDrainResult {
  alertHash: string;
  outcome: "created" | "failed";
  /** Omitted when reconciling a previously-submitted payout, where re-deriving it costs an extra query for no correctness benefit. */
  matchedHouseholds?: number;
}

export interface DrainSummary {
  anchors: DrainResult[];
  payouts: PayoutDrainResult[];
}

interface AlertRow {
  severity: number;
  purok_bitmap: number;
}

/**
 * Drains the outbox to Stellar Testnet (PRD Section 6.2). Meant to be
 * called whenever connectivity is present -- on an interval, or on demand
 * via POST /drain -- not run continuously.
 *
 * Two phases, in order: anchoring, then payout. Payout only ever considers
 * an alert once its anchor_status is 'confirmed' (PRD Section 6.2 step 3),
 * so an alert anchored in this same call is eligible for payout in this
 * same call -- the anchor phase fully completes before the payout phase's
 * queries run.
 *
 * Each phase reconciles anything left in a `pending`-style state by an
 * interrupted previous run *before* picking up new work, so a crash never
 * loses track of a transaction that may have actually landed. This is the
 * property `prepareAnchorTransaction`/`preparePayoutTransaction`'s
 * two-phase split exists for: the transaction hash is known and persisted
 * before this function ever awaits the network.
 *
 * What this does NOT do: query Horizon for existing claimable balances as
 * a fallback when `payout_status` itself is ambiguous (PRD Section 7's
 * "where uncertain" case). That extra defense-in-depth check, plus
 * dedicated interrupt-and-rerun tests, is Stage 5 item 5.3 (idempotency
 * hardening) -- not built here. What IS built here is idempotent by
 * construction: re-running this function never re-submits a payout whose
 * transaction hash is already recorded, since it reconciles that state via
 * Horizon before ever building a new one.
 */
export async function drainOutbox(db: Database.Database, issuer: Keypair): Promise<DrainSummary> {
  const anchors: DrainResult[] = [];

  const stuckAnchors = db
    .prepare<[], { alert_hash: string; anchor_tx: string }>(
      "SELECT alert_hash, anchor_tx FROM alerts WHERE anchor_status = 'submitted' ORDER BY received_at ASC",
    )
    .all();
  for (const row of stuckAnchors) {
    anchors.push(await reconcileAnchor(db, issuer, row.alert_hash, row.anchor_tx));
  }

  const pendingAnchors = db
    .prepare<[], { alert_hash: string }>(
      "SELECT alert_hash FROM alerts WHERE anchor_status = 'pending' ORDER BY received_at ASC",
    )
    .all();
  for (const row of pendingAnchors) {
    anchors.push(await submitAnchor(db, issuer, row.alert_hash));
  }

  const payouts: PayoutDrainResult[] = [];

  const stuckPayouts = db
    .prepare<[], { alert_hash: string; payout_tx: string }>(
      "SELECT alert_hash, payout_tx FROM alerts WHERE payout_status = 'pending' ORDER BY received_at ASC",
    )
    .all();
  for (const row of stuckPayouts) {
    payouts.push(await reconcilePayout(db, issuer, row.alert_hash, row.payout_tx));
  }

  const payoutCandidates = db
    .prepare<[], { alert_hash: string; severity: number; purok_bitmap: number }>(
      "SELECT alert_hash, severity, purok_bitmap FROM alerts WHERE anchor_status = 'confirmed' AND payout_status = 'none' ORDER BY received_at ASC",
    )
    .all();
  for (const row of payoutCandidates) {
    payouts.push(await submitPayout(db, issuer, row.alert_hash, row.severity, row.purok_bitmap));
  }

  return { anchors, payouts };
}

async function submitAnchor(db: Database.Database, issuer: Keypair, alertHash: string): Promise<DrainResult> {
  const prepared = await prepareAnchorTransaction(issuer, bytesFromHex(alertHash));

  // Recorded *before* awaiting confirmation -- see module docstring.
  db.prepare("UPDATE alerts SET anchor_status = 'submitted', anchor_tx = ? WHERE alert_hash = ?").run(
    prepared.transactionHash,
    alertHash,
  );

  try {
    const { successful } = await prepared.submit();
    const outcome: DrainResult["outcome"] = successful ? "confirmed" : "failed";
    db.prepare("UPDATE alerts SET anchor_status = ? WHERE alert_hash = ?").run(outcome, alertHash);
    return { alertHash, outcome };
  } catch (err) {
    // Ambiguous: the transaction may or may not have reached the network.
    // Leave anchor_status = 'submitted' (already set above) so the next
    // drain run reconciles it against Horizon directly, rather than
    // guessing here and risking either a lost anchor or a duplicate one.
    db.prepare("UPDATE alerts SET attempts = attempts + 1, last_error = ? WHERE alert_hash = ?").run(
      (err as Error).message,
      alertHash,
    );
    return { alertHash, outcome: "failed" };
  }
}

async function reconcileAnchor(
  db: Database.Database,
  issuer: Keypair,
  alertHash: string,
  transactionHash: string,
): Promise<DrainResult> {
  const status = await getTransactionStatus(transactionHash);
  if (status === "not_found") {
    // The previous run recorded a hash but the transaction never reached
    // the network (crashed before or during submit) -- safe to build and
    // submit a fresh one. Its timebounds would have expired by now anyway.
    return submitAnchor(db, issuer, alertHash);
  }
  db.prepare("UPDATE alerts SET anchor_status = ? WHERE alert_hash = ?").run(status, alertHash);
  return { alertHash, outcome: status };
}

async function submitPayout(
  db: Database.Database,
  issuer: Keypair,
  alertHash: string,
  severity: number,
  purokBitmap: number,
): Promise<PayoutDrainResult> {
  const households = matchingHouseholds(db, purokBitmap);

  if (households.length === 0) {
    // Nothing to pay for this alert -- mark it done rather than leaving it
    // 'none' forever, which would make every future drain re-query it.
    db.prepare("UPDATE alerts SET payout_status = 'created' WHERE alert_hash = ?").run(alertHash);
    return { alertHash, outcome: "created", matchedHouseholds: 0 };
  }

  const claims: PayoutClaim[] = households.map((h) => ({
    householdId: h.householdId,
    stellarAddress: h.stellarAddress,
  }));

  // Severity is trusted here the same way the rest of the hub trusts it:
  // packages/core's codec only ever decodes 1-3 into this field (packet
  // spec, PRD Section 5.1) -- there is no untrusted input path to this
  // function that could smuggle another value in.
  const prepared = await preparePayoutTransaction(issuer, severity as 1 | 2 | 3, claims);

  // Recorded *before* awaiting confirmation -- same durability rationale
  // as submitAnchor above.
  db.prepare("UPDATE alerts SET payout_status = 'pending', payout_tx = ? WHERE alert_hash = ?").run(
    prepared.transactionHash,
    alertHash,
  );

  try {
    const { successful } = await prepared.submit();
    const outcome: PayoutDrainResult["outcome"] = successful ? "created" : "failed";
    db.prepare("UPDATE alerts SET payout_status = ? WHERE alert_hash = ?").run(outcome, alertHash);
    return { alertHash, outcome, matchedHouseholds: households.length };
  } catch (err) {
    db.prepare("UPDATE alerts SET attempts = attempts + 1, last_error = ? WHERE alert_hash = ?").run(
      (err as Error).message,
      alertHash,
    );
    return { alertHash, outcome: "failed", matchedHouseholds: households.length };
  }
}

async function reconcilePayout(
  db: Database.Database,
  issuer: Keypair,
  alertHash: string,
  transactionHash: string,
): Promise<PayoutDrainResult> {
  const status = await getTransactionStatus(transactionHash);
  if (status === "not_found") {
    // Never reached the network -- safe to rebuild and resubmit, same as
    // reconcileAnchor. Needs the alert's severity/purok_bitmap again since
    // only the transaction hash was carried into this reconcile path.
    const row = db
      .prepare<[string], AlertRow>("SELECT severity, purok_bitmap FROM alerts WHERE alert_hash = ?")
      .get(alertHash)!;
    return submitPayout(db, issuer, alertHash, row.severity, row.purok_bitmap);
  }
  const outcome: PayoutDrainResult["outcome"] = status === "confirmed" ? "created" : "failed";
  db.prepare("UPDATE alerts SET payout_status = ? WHERE alert_hash = ?").run(outcome, alertHash);
  return { alertHash, outcome };
}
