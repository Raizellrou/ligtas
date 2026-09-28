import { Horizon, Networks } from "@stellar/stellar-sdk";

/**
 * Testnet throughout (PRD Section 7) -- this package is the one place in
 * the repo allowed to import Horizon; see CLAUDE.md's "packages/core must
 * never import Horizon or RPC" for why the boundary exists.
 */
export const HORIZON_TESTNET_URL = "https://horizon-testnet.stellar.org";
export const TESTNET_NETWORK_PASSPHRASE = Networks.TESTNET;

export function horizonClient(): Horizon.Server {
  return new Horizon.Server(HORIZON_TESTNET_URL);
}
