import { Asset, BASE_FEE, Claimant, Keypair, Operation, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { horizonClient, TESTNET_NETWORK_PASSPHRASE } from "./client.js";

/**
 * Flat payout by severity tier, native XLM on Testnet -- decided in
 * docs/BUILD-PLAN.md Section 6 (PRD open question #8, resolved).
 */
export const PAYOUT_TIER_AMOUNT_XLM: Record<1 | 2 | 3, string> = {
  1: "10",
  2: "25",
  3: "50",
};

/**
 * How long an unclaimed balance stays outstanding before the barangay
 * account can reclaim it -- PRD open question #7, resolved at 30 days.
 */
export const RECLAIM_WINDOW_SECONDS = 30 * 24 * 60 * 60;

export interface PayoutClaim {
  householdId: string;
  stellarAddress: string;
}

export interface PreparedPayout {
  /**
   * Known as soon as the transaction is built and signed -- before it is
   * ever sent to the network. Same durability rationale as
   * PreparedAnchor.transactionHash in anchor.ts: a caller should persist
   * this before calling submit(), so an interrupted drain run can
   * reconcile against Horizon on the next pass instead of resubmitting
   * blindly (PRD Section 7's idempotency requirement).
   */
  transactionHash: string;
  submit(): Promise<{ ledger: number; successful: boolean }>;
}

/**
 * Builds and signs (but does not submit) one createClaimableBalance
 * operation per claim, in a single transaction (PRD Section 7). Each
 * balance is claimable unconditionally by the household, and by the
 * paying account itself only after RECLAIM_WINDOW_SECONDS -- so a payout
 * nobody ever claims is eventually recoverable rather than stuck forever.
 */
export async function preparePayoutTransaction(
  account: Keypair,
  severity: 1 | 2 | 3,
  claims: PayoutClaim[],
): Promise<PreparedPayout> {
  if (claims.length === 0) {
    throw new RangeError("preparePayoutTransaction requires at least one claim");
  }

  const amount = PAYOUT_TIER_AMOUNT_XLM[severity];
  const server = horizonClient();
  const sourceAccount = await server.loadAccount(account.publicKey());

  const builder = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_NETWORK_PASSPHRASE,
  });

  for (const claim of claims) {
    builder.addOperation(
      Operation.createClaimableBalance({
        asset: Asset.native(),
        amount,
        claimants: [
          new Claimant(claim.stellarAddress, Claimant.predicateUnconditional()),
          new Claimant(
            account.publicKey(),
            Claimant.predicateNot(Claimant.predicateBeforeRelativeTime(String(RECLAIM_WINDOW_SECONDS))),
          ),
        ],
      }),
    );
  }

  const transaction = builder.setTimeout(30).build() as Transaction;
  transaction.sign(account);
  const transactionHash = Buffer.from(transaction.hash()).toString("hex");

  return {
    transactionHash,
    async submit() {
      const response = await server.submitTransaction(transaction);
      return { ledger: response.ledger, successful: response.successful };
    },
  };
}

/**
 * PRD Section 7's idempotency fallback: "where uncertain, queries existing
 * claimable balances for the sponsoring account." Used when a drain run
 * can't tell a payout transaction's fate from its hash alone (Horizon
 * returned something other than a clean "not found" -- a transient error,
 * not proof the transaction never landed), so resubmitting on that
 * ambiguity would risk creating a second balance for the same household.
 *
 * Matches on sponsor + claimant + asset + amount, not a transaction hash,
 * since that is all a claimable balance record carries -- there is no
 * alert-hash tag on it. That is an approximation, not a certainty: a
 * household that separately received an identical flat-tier payout from a
 * different alert would also match. Accepted here because the caller only
 * ever uses a "yes" answer to avoid resubmitting a specific already-pending
 * payout it already believes should exist -- it is a defense against
 * double-paying that same payout, not a general ledger reconciliation.
 */
export async function findMatchingClaimableBalance(
  sponsor: string,
  claimantAddress: string,
  amount: string,
): Promise<boolean> {
  const server = horizonClient();
  const page = await server.claimableBalances().claimant(claimantAddress).sponsor(sponsor).call();
  return page.records.some((record) => record.asset === "native" && Number(record.amount) === Number(amount));
}
