import {
  Asset,
  BASE_FEE,
  Keypair,
  Memo,
  NotFoundError,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { horizonClient, TESTNET_NETWORK_PASSPHRASE } from "./client.js";

const ALERT_HASH_LENGTH = 32;
/** Smallest possible payment (1 stroop) -- the anchor is the memo, not the transfer. */
const ANCHOR_PAYMENT_AMOUNT = "0.0000001";

export interface AnchorResult {
  transactionHash: string;
  ledger: number;
  successful: boolean;
}

export interface PreparedAnchor {
  /**
   * The transaction hash, known as soon as the transaction is built and
   * signed -- before it is ever sent to the network. PRD Section 6.2:
   * callers should persist this *before* calling `submit()`, so an
   * interrupted drain run leaves enough on disk to reconcile against
   * Horizon on the next run instead of blindly resubmitting.
   */
  transactionHash: string;
  submit(): Promise<{ ledger: number; successful: boolean }>;
}

/**
 * Builds and signs (but does not submit) a Stellar Classic anchor
 * transaction: a minimal payment from `account` to itself carrying
 * `MEMO_HASH = alertHash` (PRD Section 7). Split from submission so a
 * caller can record `transactionHash` durably first -- see `PreparedAnchor`.
 */
export async function prepareAnchorTransaction(account: Keypair, alertHash: Uint8Array): Promise<PreparedAnchor> {
  if (alertHash.length !== ALERT_HASH_LENGTH) {
    throw new RangeError(`alertHash must be ${ALERT_HASH_LENGTH} bytes, got ${alertHash.length}`);
  }

  const server = horizonClient();
  const sourceAccount = await server.loadAccount(account.publicKey());

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: account.publicKey(),
        asset: Asset.native(),
        amount: ANCHOR_PAYMENT_AMOUNT,
      }),
    )
    .addMemo(Memo.hash(alertHash))
    .setTimeout(30)
    .build() as Transaction;

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
 * Convenience one-shot form of `prepareAnchorTransaction` + `submit()` for
 * simple callers (scripts, tests) that don't need the two-phase durability
 * `PreparedAnchor` exists for.
 */
export async function anchorAlertHash(account: Keypair, alertHash: Uint8Array): Promise<AnchorResult> {
  const prepared = await prepareAnchorTransaction(account, alertHash);
  const { ledger, successful } = await prepared.submit();
  return { transactionHash: prepared.transactionHash, ledger, successful };
}

export type TransactionStatus = "confirmed" | "failed" | "not_found";

/**
 * Looks up a transaction hash on Horizon directly -- used to reconcile a
 * drain run that was interrupted after recording `transactionHash` but
 * before (or during) `submit()`. `not_found` means the transaction never
 * reached the network and it is safe to build and submit a fresh one;
 * any other error is left to the caller, since it does not distinguish
 * "never happened" from "can't tell right now" (a transient Horizon
 * error), and resubmitting on that ambiguity risks a duplicate anchor.
 */
export async function getTransactionStatus(transactionHash: string): Promise<TransactionStatus> {
  const server = horizonClient();
  try {
    const tx = await server.transactions().transaction(transactionHash).call();
    return tx.successful ? "confirmed" : "failed";
  } catch (err) {
    if (err instanceof NotFoundError) return "not_found";
    throw err;
  }
}
