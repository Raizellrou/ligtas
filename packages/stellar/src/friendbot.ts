/**
 * Friendbot funds fresh Testnet accounts for free -- PRD Section 7: "Network:
 * Testnet throughout, funded by Friendbot." Real network call, not a stub;
 * this package is where that's allowed (see client.ts).
 */
const FRIENDBOT_URL = "https://friendbot.stellar.org";

export async function fundTestnetAccount(publicKey: string): Promise<void> {
  const response = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(publicKey)}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`friendbot funding failed for ${publicKey}: ${response.status} ${body}`);
  }
}
