import { beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { Keypair } from "@stellar/stellar-sdk/base";
import { openDb } from "../src/db.js";
import { seedHouseholds } from "../src/households.js";
import { drainOutbox } from "../src/drain.js";
import {
  preparePayoutTransaction,
  getTransactionStatus,
  findMatchingClaimableBalance,
  PAYOUT_TIER_AMOUNT_XLM,
} from "@ligtas/stellar";

vi.mock("@ligtas/stellar", () => ({
  prepareAnchorTransaction: vi.fn(),
  preparePayoutTransaction: vi.fn(),
  getTransactionStatus: vi.fn(),
  findMatchingClaimableBalance: vi.fn(),
  // Real values (packages/stellar/src/payout.ts) -- kept here rather than
  // imported from the mocked-out package, same reasoning as every other
  // mock in this file.
  PAYOUT_TIER_AMOUNT_XLM: { 1: "10", 2: "25", 3: "50" },
}));

const issuer = Keypair.random();

function seedConfirmedAlert(db: Database.Database, alertHash: string): void {
  db.prepare(
    `INSERT INTO alerts
       (alert_hash, body, signature, issuer_pubkey, sequence, hazard, severity, purok_bitmap,
        issued_at, received_at, anchor_status, payout_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'none')`,
  ).run(alertHash, Buffer.alloc(0), Buffer.alloc(0), issuer.publicKey(), 1, 1, 1, 0b1, Date.now(), Date.now());
}

// PRD Section 7 names this the highest-risk correctness surface: a drain
// run that crashes between recording payout_tx and observing the outcome
// of submit() must reconcile against Horizon on its next run rather than
// blindly resubmitting -- which would create a second claimable balance
// for the same household.
describe("drainOutbox payout idempotency", () => {
  let db: Database.Database;

  beforeEach(() => {
    vi.mocked(preparePayoutTransaction).mockReset();
    vi.mocked(getTransactionStatus).mockReset();
    vi.mocked(findMatchingClaimableBalance).mockReset();
    db = openDb(":memory:");
    seedHouseholds(db, [{ householdId: "hh-001", purok: 1, stellarAddress: "GDUMMY", joinCode: "TST-001" }]);
    seedConfirmedAlert(db, "alert-1");
  });

  it("does not resubmit a payout that actually landed before the crash", async () => {
    // First run: transaction hash recorded, then the process loses the
    // network before it learns whether submit() succeeded -- exactly the
    // gap prepareAnchorTransaction/preparePayoutTransaction's two-phase
    // split exists to survive.
    vi.mocked(preparePayoutTransaction).mockResolvedValueOnce({
      transactionHash: "tx-1",
      submit: () => Promise.reject(new Error("network dropped")),
    });
    await drainOutbox(db, issuer);

    let row = db.prepare("SELECT payout_status, payout_tx FROM alerts WHERE alert_hash = 'alert-1'").get() as {
      payout_status: string;
      payout_tx: string;
    };
    expect(row.payout_status).toBe("pending");
    expect(row.payout_tx).toBe("tx-1");

    // Re-run after connectivity returns: Horizon confirms tx-1 actually
    // landed, so the drain must mark it created WITHOUT ever building a
    // second claimable balance transaction.
    vi.mocked(getTransactionStatus).mockResolvedValueOnce("confirmed");
    await drainOutbox(db, issuer);

    row = db.prepare("SELECT payout_status, payout_tx FROM alerts WHERE alert_hash = 'alert-1'").get() as {
      payout_status: string;
      payout_tx: string;
    };
    expect(row.payout_status).toBe("created");
    expect(row.payout_tx).toBe("tx-1");
    expect(preparePayoutTransaction).toHaveBeenCalledTimes(1);
  });

  it("resubmits exactly once when the crashed transaction never reached the network", async () => {
    vi.mocked(preparePayoutTransaction).mockResolvedValueOnce({
      transactionHash: "tx-1",
      submit: () => Promise.reject(new Error("network dropped")),
    });
    await drainOutbox(db, issuer);

    // Horizon has no record of tx-1: it never reached the network, so
    // rebuilding and resubmitting is safe -- and must happen exactly once.
    vi.mocked(getTransactionStatus).mockResolvedValueOnce("not_found");
    vi.mocked(preparePayoutTransaction).mockResolvedValueOnce({
      transactionHash: "tx-2",
      submit: () => Promise.resolve({ ledger: 1, successful: true }),
    });
    await drainOutbox(db, issuer);

    const row = db.prepare("SELECT payout_status, payout_tx FROM alerts WHERE alert_hash = 'alert-1'").get() as {
      payout_status: string;
      payout_tx: string;
    };
    expect(row.payout_status).toBe("created");
    expect(row.payout_tx).toBe("tx-2");
    expect(preparePayoutTransaction).toHaveBeenCalledTimes(2);
  });

  it("never re-queries an alert once its payout is created", async () => {
    vi.mocked(preparePayoutTransaction).mockResolvedValueOnce({
      transactionHash: "tx-1",
      submit: () => Promise.resolve({ ledger: 1, successful: true }),
    });
    await drainOutbox(db, issuer);

    // Nothing left in 'pending' or 'none' for this alert, so a further
    // drain must be a no-op for it -- the query itself excludes it.
    await drainOutbox(db, issuer);

    expect(preparePayoutTransaction).toHaveBeenCalledTimes(1);
  });

  // Caught live on 2026-09-12: index.ts's setInterval doesn't wait for a
  // slow drain to finish before the next tick fires, and POST /drain can
  // land mid-cycle too. Two overlapping calls both read payout_status =
  // 'none' before either writes 'pending', so both submit a payout for the
  // same alert -- a real double-payment risk, not just a duplicate log
  // line. This reproduces that shape directly: two callers invoke
  // drainOutbox before either has resolved.
  it("collapses concurrent calls into a single run instead of double-submitting", async () => {
    vi.mocked(preparePayoutTransaction).mockResolvedValueOnce({
      transactionHash: "tx-1",
      submit: () => Promise.resolve({ ledger: 1, successful: true }),
    });

    // Two callers -- e.g. index.ts's interval firing while POST /drain is
    // mid-cycle -- calling drainOutbox before either has resolved. The
    // guard latches synchronously on the first call, before any awaiting
    // even starts, so this reproduces the race regardless of how slow the
    // mocked network calls are.
    const first = drainOutbox(db, issuer);
    const second = drainOutbox(db, issuer);

    const [firstSummary, secondSummary] = await Promise.all([first, second]);

    expect(firstSummary).toBe(secondSummary);
    expect(preparePayoutTransaction).toHaveBeenCalledTimes(1);

    const row = db.prepare("SELECT payout_status, payout_tx FROM alerts WHERE alert_hash = 'alert-1'").get() as {
      payout_status: string;
      payout_tx: string;
    };
    expect(row.payout_status).toBe("created");
    expect(row.payout_tx).toBe("tx-1");
  });

  // PRD Section 7's "where uncertain" fallback: getTransactionStatus can
  // throw instead of cleanly answering not_found (a transient Horizon
  // error, not proof the transaction never landed). Resubmitting on that
  // ambiguity would risk a second claimable balance for the same
  // household, so this checks Horizon for the balances directly instead.
  describe("when the transaction-hash reconciliation itself is ambiguous", () => {
    beforeEach(async () => {
      vi.mocked(preparePayoutTransaction).mockResolvedValueOnce({
        transactionHash: "tx-1",
        submit: () => Promise.reject(new Error("network dropped")),
      });
      await drainOutbox(db, issuer);
    });

    it("marks the payout created when every matched household already has a matching claimable balance", async () => {
      vi.mocked(getTransactionStatus).mockRejectedValueOnce(new Error("Horizon 503"));
      vi.mocked(findMatchingClaimableBalance).mockResolvedValueOnce(true);

      await drainOutbox(db, issuer);

      expect(findMatchingClaimableBalance).toHaveBeenCalledWith(issuer.publicKey(), "GDUMMY", "10");
      const row = db.prepare("SELECT payout_status, payout_tx FROM alerts WHERE alert_hash = 'alert-1'").get() as {
        payout_status: string;
        payout_tx: string;
      };
      expect(row.payout_status).toBe("created");
      // The tx hash from the original (uncertain) attempt is left as-is --
      // this path confirms the payout landed, it doesn't learn which
      // transaction did it.
      expect(row.payout_tx).toBe("tx-1");
      expect(preparePayoutTransaction).toHaveBeenCalledTimes(1);
    });

    it("leaves the payout pending, not resubmitted, when the balances don't all match", async () => {
      vi.mocked(getTransactionStatus).mockRejectedValueOnce(new Error("Horizon 503"));
      vi.mocked(findMatchingClaimableBalance).mockResolvedValueOnce(false);

      await drainOutbox(db, issuer);

      const row = db.prepare("SELECT payout_status, payout_tx, last_error FROM alerts WHERE alert_hash = 'alert-1'").get() as {
        payout_status: string;
        payout_tx: string;
        last_error: string;
      };
      expect(row.payout_status).toBe("pending");
      expect(row.payout_tx).toBe("tx-1");
      expect(row.last_error).toBe("Horizon 503");
      // Never resubmitted -- an ambiguous answer must not risk a double pay.
      expect(preparePayoutTransaction).toHaveBeenCalledTimes(1);
    });
  });
});
