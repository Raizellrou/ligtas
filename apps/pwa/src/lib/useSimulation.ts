import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AlertBundle, AlertBundleEntry } from '@ligtas/core'
import { cacheBundle, loadCachedBundle } from './alertCache'
import { ALERT_POLL_MS, fetchAlertFeed, fetchHubAlerts, sameAlerts } from './alertFeed'
import { HUB_CONFIGURED } from './hubUrl'
import { evaluateBundle, type EvaluatedAlert } from './evaluateBundle'
import {
  TESTER_ISSUER_INDEX,
  buildPacketHex,
  loadOrCreateTesterKeypair,
  newEntry,
  type BroadcastKind,
  type BroadcastOptions,
} from './simulation'

const BROADCAST_STORAGE_KEY = 'ligtas.sim.broadcasts'

function loadStoredBroadcasts(): AlertBundleEntry[] {
  const stored = localStorage.getItem(BROADCAST_STORAGE_KEY)
  if (stored === null) return []
  try {
    const parsed: unknown = JSON.parse(stored)
    return Array.isArray(parsed) ? (parsed as AlertBundleEntry[]) : []
  } catch {
    return []
  }
}

export interface Simulation {
  loading: boolean
  error: string | null
  /** Captured entries plus everything the tester has broadcast, in order. */
  bundle: AlertBundle | null
  evaluated: EvaluatedAlert[] | null
  /** How many leading entries came from the alert feed (the hub, or the recorded run) rather than from the tester. */
  capturedCount: number
  /** How many of those are the recorded demo run, as opposed to a live hub -- 0 when the hub is the source. */
  historicalCount: number
  /** True when the network fetch failed and this is the last idb-cached bundle instead. */
  offline: boolean
  /** When this device last got the alert list (ms): now on a successful fetch, the stored fetch time when offline. */
  checkedAt: number | null
  testerPublicKey: string
  broadcast: (kind: Exclude<BroadcastKind, 'replay-exact'>, options: BroadcastOptions) => void
  replayExact: (index: number) => void
  reset: () => void
}

/**
 * Owns the shared state both roles read: the resident view renders it, the
 * tester view drives it. The captured bundle (a real mesh-sim run, see
 * apps/pwa/public/alert-bundle.json) is the starting scenario; tester
 * broadcasts are appended on top and persisted, so a reload keeps whatever
 * the tester set up.
 */
export function useSimulation(): Simulation {
  const issuer = useMemo(loadOrCreateTesterKeypair, [])
  const [captured, setCaptured] = useState<AlertBundle | null>(null)
  const [broadcasts, setBroadcasts] = useState<AlertBundleEntry[]>(loadStoredBroadcasts)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [checkedAt, setCheckedAt] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    let inFlight = false
    // Once the hub has answered, never fall back to the recorded demo bundle
    // mid-session: that would silently swap real alerts for an old recording.
    // A failed poll then just leaves the live data up while "checked" ages.
    let hubReached = false
    let shown: AlertBundle | null = null

    function apply(feed: AlertBundle) {
      const at = Date.now()
      if (shown === null || !sameAlerts(shown, feed)) {
        shown = feed
        setCaptured(feed)
      }
      setOffline(false)
      setError(null)
      setCheckedAt(at)
      // Written every time, not only on change, so the "checked ... ago" a
      // phone shows after going offline is when it last actually looked.
      void cacheBundle(feed, at)
    }

    // Only where a hub is meant to exist, and only while someone is looking:
    // the timer chain stops while the tab is hidden and load() restarts it.
    function schedule() {
      window.clearTimeout(timer)
      if (cancelled || !HUB_CONFIGURED || document.hidden) return
      timer = window.setTimeout(() => void load(false), ALERT_POLL_MS)
    }

    async function load(initial: boolean) {
      if (inFlight) return
      inFlight = true
      window.clearTimeout(timer)
      try {
        const feed = hubReached
          ? { bundle: await fetchHubAlerts(), from: 'hub' as const }
          : await fetchAlertFeed()
        if (cancelled) return
        if (feed.from === 'hub') hubReached = true
        apply(feed.bundle)
      } catch (fetchError: unknown) {
        // A failed re-check keeps what is already on screen.
        if (initial && !cancelled) {
          // No network (or no hub reachable): fall back to the last bundle
          // this device actually received, rather than an empty screen.
          const cached = await loadCachedBundle()
          if (cancelled) return
          if (cached !== null) {
            shown = cached.bundle
            setCaptured(cached.bundle)
            setCheckedAt(cached.fetchedAt)
            setOffline(true)
            setError(null)
          } else {
            setError(String(fetchError))
          }
        }
      } finally {
        inFlight = false
        schedule()
      }
    }

    void load(true)
    // Coming back online, or back to the app, is the moment to look again;
    // without the first the "offline" state set at load would never clear.
    const onOnline = () => void load(false)
    const onVisible = () => {
      if (!document.hidden) void load(false)
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const bundle = useMemo<AlertBundle | null>(() => {
    if (captured === null) return null
    return {
      ...captured,
      issuers: [
        ...captured.issuers,
        {
          issuerIndex: TESTER_ISSUER_INDEX,
          issuerPublicKey: issuer.publicKey(),
          label: 'Tester (this browser)',
        },
      ],
      alerts: [...captured.alerts, ...broadcasts],
    }
  }, [captured, broadcasts, issuer])

  const evaluated = useMemo(() => (bundle === null ? null : evaluateBundle(bundle)), [bundle])

  const persist = useCallback((next: AlertBundleEntry[]) => {
    setBroadcasts(next)
    localStorage.setItem(BROADCAST_STORAGE_KEY, JSON.stringify(next))
  }, [])

  const broadcast = useCallback(
    (kind: Exclude<BroadcastKind, 'replay-exact'>, options: BroadcastOptions) => {
      const packetHex = buildPacketHex(kind, issuer, options)
      persist([...broadcasts, newEntry(packetHex, kind)])
    },
    [broadcasts, issuer, persist],
  )

  const replayExact = useCallback(
    (index: number) => {
      const source = bundle?.alerts[index]
      if (source === undefined) return
      persist([...broadcasts, newEntry(source.packetHex, 'replay-exact')])
    },
    [bundle, broadcasts, persist],
  )

  const reset = useCallback(() => {
    persist([])
  }, [persist])

  return {
    loading: bundle === null && error === null,
    error,
    bundle,
    evaluated,
    capturedCount: captured?.alerts.length ?? 0,
    historicalCount: captured?.source === 'captured' ? captured.alerts.length : 0,
    offline,
    checkedAt,
    testerPublicKey: issuer.publicKey(),
    broadcast,
    replayExact,
    reset,
  }
}
