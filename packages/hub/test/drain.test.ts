import { beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { Keypair } from "@stellar/stellar-sdk/base";
import { openDb } from "../src/db.js";
import { seedHouseholds } from "../src/households.js";
import { drainOutbox } from "../src/drain.js";
import { preparePayoutTransaction, getTransactionStatus } from "@ligtas/stellar";

vi.mock("@ligtas/stellar", () => ({
  prepareAnchorTransaction: vi.fn(),
  preparePayoutTransaction: vi.fn(),
  getTransactionStatus: vi.fn(),
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
    db = openDb(":memory:");
    seedHouseholds(db, [{ householdId: "hh-001", purok: 1, stellarAddress: "GDUMMY" }]);
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
});
