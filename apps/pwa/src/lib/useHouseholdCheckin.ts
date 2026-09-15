import { useCallback, useEffect, useState } from 'react'
import { useHouseholdIdentity } from '../useHouseholdIdentity'
import { enqueueCheckin, listQueuedCheckins, removeQueuedCheckin, type CheckinStatus } from './checkinQueue'
import { fetchHouseholdStatus, resolveJoinCode, submitCheckinToHub, type MemberCheckin } from './householdApi'

const POLL_MS = 12_000

// Module-level, not per-hook-instance: an interval tick, an `online` event,
// and a manual submit() can all fire concurrently. Without this guard the
// same queued entry could be POSTed twice before the first response comes
// back and removes it from the queue -- the identical race drain.ts's
// concurrent-drain regression test documents on the hub side.
let inFlight: Promise<void> | null = null

export interface UseHouseholdCheckin {
  householdId: string | null
  displayName: string | null
  joined: boolean
  join(joinCode: string, displayName: string): Promise<'ok' | 'not_found' | 'unreachable'>
  leave(): void
  roster: MemberCheckin[] | null
  pendingCount: number
  offline: boolean
  submit(status: CheckinStatus): void
}

export function useHouseholdCheckin(): UseHouseholdCheckin {
  const { householdId, displayName, setIdentity, clearIdentity } = useHouseholdIdentity()
  const [roster, setRoster] = useState<MemberCheckin[] | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [offline, setOffline] = useState(false)

  const refreshPendingCount = useCallback(async (id: string) => {
    const queued = await listQueuedCheckins()
    setPendingCount(queued.filter((q) => q.householdId === id).length)
  }, [])

  const drainQueue = useCallback((id: string) => {
    inFlight ??= runDrain(id, setRoster, setOffline, () => refreshPendingCount(id)).finally(() => {
      inFlight = null
    })
    return inFlight
  }, [refreshPendingCount])

  const refreshRoster = useCallback(async (id: string, cancelledRef: { current: boolean }) => {
    const result = await fetchHouseholdStatus(id)
    if (cancelledRef.current) return
    if (result === 'unreachable') {
      setOffline(true)
    } else {
      setRoster(result)
      setOffline(false)
    }
  }, [])

  useEffect(() => {
    if (!householdId) return
    const cancelledRef = { current: false }
    void refreshRoster(householdId, cancelledRef)
    void drainQueue(householdId)
    void refreshPendingCount(householdId)

    const onOnline = () => {
      void drainQueue(householdId)
      void refreshRoster(householdId, cancelledRef)
    }
    window.addEventListener('online', onOnline)

    const pollHandle = window.setInterval(() => {
      void drainQueue(householdId)
      void refreshRoster(householdId, cancelledRef)
    }, POLL_MS)

    return () => {
      cancelledRef.current = true
      window.removeEventListener('online', onOnline)
      window.clearInterval(pollHandle)
    }
  }, [householdId, drainQueue, refreshRoster, refreshPendingCount])

  async function join(joinCode: string, name: string): Promise<'ok' | 'not_found' | 'unreachable'> {
    const result = await resolveJoinCode(joinCode)
    if (result === 'not_found' || result === 'unreachable') return result
    setIdentity(result.householdId, name)
    return 'ok'
  }

  function leave() {
    clearIdentity()
    setRoster(null)
    setPendingCount(0)
    setOffline(false)
  }

  function submit(status: CheckinStatus) {
    if (!householdId || !displayName) return
    // Durably record before attempting the network, same two-phase
    // ordering drain.ts uses for anchor/payout: a tap must survive a reload
    // or a dropped connection, not just live in React state.
    void enqueueCheckin({ householdId, displayName, status }).then(async () => {
      await refreshPendingCount(householdId)
      void drainQueue(householdId)
    })
  }

  return {
    householdId,
    displayName,
    joined: householdId !== null && displayName !== null,
    join,
    leave,
    roster,
    pendingCount,
    offline,
    submit,
  }
}

async function runDrain(
  householdId: string,
  setRoster: (roster: MemberCheckin[]) => void,
  setOffline: (offline: boolean) => void,
  refreshPendingCount: () => Promise<void>,
): Promise<void> {
  const queued = (await listQueuedCheckins()).filter((q) => q.householdId === householdId)
  for (const entry of queued) {
    const result = await submitCheckinToHub(householdId, {
      displayName: entry.displayName,
      status: entry.status,
      clientCheckinId: entry.id,
    })
    if (result === 'unreachable') {
      setOffline(true)
      // Stop rather than reorder -- the rest of the queue retries as a
      // whole on the next trigger, in the same tap order.
      return
    }
    setOffline(false)
    setRoster(result)
    await removeQueuedCheckin(entry.id)
  }
  await refreshPendingCount()
}
