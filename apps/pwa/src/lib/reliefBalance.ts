// Reads Stellar Testnet's own public Horizon API directly -- same data
// Stellar Expert shows, no hub involved. A household's claimable balance is
// public ledger state, not something that needs our own backend in the way.
const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org'

export interface ReliefBalance {
  id: string
  amountXlm: string
}

interface ClaimableBalanceRecord {
  id: string
  amount: string
  asset: string
}

export async function fetchReliefBalance(stellarAddress: string): Promise<ReliefBalance | null | 'unreachable'> {
  try {
    const res = await fetch(
      `${HORIZON_TESTNET_URL}/claimable_balances?claimant=${encodeURIComponent(stellarAddress)}&limit=1&order=desc`,
    )
    if (!res.ok) return 'unreachable'
    const data = (await res.json()) as { _embedded: { records: ClaimableBalanceRecord[] } }
    const record = data._embedded.records[0]
    if (!record) return null
    return { id: record.id, amountXlm: String(Number(record.amount)) }
  } catch {
    return 'unreachable'
  }
}
