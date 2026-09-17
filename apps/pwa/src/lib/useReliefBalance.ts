import { useEffect, useState } from 'react'
import { fetchReliefBalance, type ReliefBalance } from './reliefBalance'

const POLL_MS = 30_000

/** Polls Horizon Testnet for a claimable balance on the household's address. Null once checked and found none. */
export function useReliefBalance(stellarAddress: string | null): ReliefBalance | null {
  const [balance, setBalance] = useState<ReliefBalance | null>(null)

  useEffect(() => {
    if (!stellarAddress) {
      setBalance(null)
      return
    }
    let cancelled = false

    async function check() {
      const result = await fetchReliefBalance(stellarAddress!)
      if (!cancelled && result !== 'unreachable') setBalance(result)
    }

    void check()
    const handle = window.setInterval(check, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [stellarAddress])

  return balance
}
