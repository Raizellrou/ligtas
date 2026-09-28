#!/usr/bin/env node
/**
 * Manual/CI smoke tool for packages/stellar -- anchors a single 32-byte
 * alert hash to Stellar Testnet for real, optionally funding the source
 * account via Friendbot first. Prints the result as JSON on stdout.
 *
 * Usage:
 *   node scripts/anchor-alert.js --alert-hash <64 hex chars> [--secret <S...>] [--fund]
 *
 * Options:
 *   --alert-hash <hex>  required, 32 bytes (64 hex chars) -- e.g. packages/core's alertHash() output
 *   --secret <S...>     reuse an existing Testnet account; a fresh one is generated if omitted
 *   --fund              fund the account via Friendbot before anchoring (needed for a fresh account)
 */
import { Keypair } from "@stellar/stellar-sdk";
import { anchorAlertHash, fundTestnetAccount } from "@ligtas/stellar";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const alertHashHex = argValue("alert-hash");
if (!alertHashHex || !/^[0-9a-f]{64}$/i.test(alertHashHex)) {
  console.error("--alert-hash is required: 64 lowercase hex characters (32 bytes)");
  process.exit(1);
}
const alertHash = Uint8Array.from(Buffer.from(alertHashHex, "hex"));

const secret = argValue("secret");
const account = secret ? Keypair.fromSecret(secret) : Keypair.random();

async function main() {
  if (hasFlag("fund")) {
    await fundTestnetAccount(account.publicKey());
  }
  const result = await anchorAlertHash(account, alertHash);
  process.stdout.write(
    JSON.stringify(
      {
        sourceAccount: account.publicKey(),
        alertHashHex,
        ...result,
        stellarExpertUrl: `https://stellar.expert/explorer/testnet/tx/${result.transactionHash}`,
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
