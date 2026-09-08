import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AlertBundle, AlertBundleEntry } from '@ligtas/core'
import { cacheBundle, loadCachedBundle } from './alertCache'
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
  /** How many leading entries came from the real captured mesh-sim run. */
  capturedCount: number
  /** True when the network fetch failed and this is the last idb-cached bundle instead. */
  offline: boolean
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

  useEffect(() => {
    let cancelled = false
    fetch('/alert-bundle.json')
      .then((r) => {
        if (!r.ok) throw new Error(`fetch failed: ${r.status}`)
        return r.json() as Promise<AlertBundle>
      })
      .then((b) => {
        if (cancelled) return
        setCaptured(b)
        setOffline(false)
        void cacheBundle(b)
      })
      .catch((fetchError: unknown) => {
        // No network (or no hub reachable): fall back to the last bundle
        // this device actually received, rather than an empty screen.
        void loadCachedBundle().then((cached) => {
          if (cancelled) return
          if (cached !== null) {
            setCaptured(cached)
            setOffline(true)
            setError(null)
          } else {
            setError(String(fetchError))
          }
        })
      })
    return () => {
      cancelled = true
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
    offline,
    testerPublicKey: issuer.publicKey(),
    broadcast,
    replayExact,
    reset,
  }
}
