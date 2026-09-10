#!/usr/bin/env node
/**
 * Manual/CI smoke tool for packages/stellar -- creates a claimable balance
 * for one or more household addresses on Stellar Testnet for real,
 * optionally funding the source account via Friendbot first. Prints the
 * result as JSON on stdout.
 *
 * Usage:
 *   node scripts/payout-alert.js --severity <1|2|3> --to <G...> [--to <G...> ...] [--secret <S...>] [--fund]
 *
 * Options:
 *   --severity <1|2|3>  required -- selects the flat payout tier (10/25/50 XLM)
 *   --to <G...>         required, repeatable -- one claimable balance per address
 *   --secret <S...>     reuse an existing Testnet account; a fresh one is generated if omitted
 *   --fund              fund the account via Friendbot before paying out (needed for a fresh account)
 */
import { Keypair } from "@stellar/stellar-sdk";
import { fundTestnetAccount, preparePayoutTransaction, type PayoutClaim } from "@ligtas/stellar";

function argValues(name: string): string[] {
  const values: string[] = [];
  const flag = `--${name}`;
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && process.argv[i + 1]) values.push(process.argv[i + 1]!);
  }
  return values;
}
function argValue(name: string): string | undefined {
  return argValues(name)[0];
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const severityRaw = argValue("severity");
if (!severityRaw || !["1", "2", "3"].includes(severityRaw)) {
  console.error("--severity is required: 1, 2, or 3");
  process.exit(1);
}
const severity = Number(severityRaw) as 1 | 2 | 3;

const addresses = argValues("to");
if (addresses.length === 0) {
  console.error("at least one --to <G...> is required");
  process.exit(1);
}
const claims: PayoutClaim[] = addresses.map((address, i) => ({ householdId: `cli-${i}`, stellarAddress: address }));

const secret = argValue("secret");
const account = secret ? Keypair.fromSecret(secret) : Keypair.random();

async function main() {
  if (hasFlag("fund")) {
    await fundTestnetAccount(account.publicKey());
  }
  const prepared = await preparePayoutTransaction(account, severity, claims);
  const { ledger, successful } = await prepared.submit();
  process.stdout.write(
    JSON.stringify(
      {
        sourceAccount: account.publicKey(),
        severity,
        claimants: addresses,
        transactionHash: prepared.transactionHash,
        ledger,
        successful,
        stellarExpertUrl: `https://stellar.expert/explorer/testnet/tx/${prepared.transactionHash}`,
      },
      null,
      2,
    ) + "\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
