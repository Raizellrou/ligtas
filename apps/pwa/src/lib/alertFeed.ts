import type { AlertBundle } from '@ligtas/core'
import { HUB_CONFIGURED, HUB_URL } from './hubUrl'

/** How often an open, visible app asks the hub for new alerts. The household roster polls at 12 s. */
export const ALERT_POLL_MS = 15_000

// A hub that does not answer in this long is treated as unreachable, so one
// dead request cannot stall the poll loop.
const HUB_TIMEOUT_MS = 4_000

export type FeedOrigin = 'hub' | 'static'

export interface AlertFeed {
  bundle: AlertBundle
  from: FeedOrigin
}

async function getBundle(url: string, init?: RequestInit): Promise<AlertBundle> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
  return (await res.json()) as AlertBundle
}

/** The live feed. The PWA verifies every packet itself, so the hub is not trusted to have filtered anything. */
export function fetchHubAlerts(): Promise<AlertBundle> {
  return getBundle(`${HUB_URL}/alerts`, { signal: AbortSignal.timeout(HUB_TIMEOUT_MS), cache: 'no-store' })
}

// The query string is deliberate. The service worker precaches
// /alert-bundle.json, so a bare fetch "succeeds" from that cache with no
// network at all, and an offline phone would look freshly updated. A URL the
// service worker doesn't know goes to the real network, and fails when there
// isn't one -- which is what tells us the phone is out of touch.
export function fetchStaticAlerts(): Promise<AlertBundle> {
  return getBundle(`/alert-bundle.json?t=${Date.now()}`, { cache: 'no-store' })
}

/**
 * The hub if this build has one and it answers, otherwise the recorded demo
 * bundle. Throws only when both fail (the caller then falls back to the copy
 * stored on this device).
 */
export async function fetchAlertFeed(hubConfigured: boolean = HUB_CONFIGURED): Promise<AlertFeed> {
  if (hubConfigured) {
    try {
      return { bundle: await fetchHubAlerts(), from: 'hub' }
    } catch {
      // No hub reachable: the recorded bundle is the next best thing.
    }
  }
  return { bundle: await fetchStaticAlerts(), from: 'static' }
}

/**
 * Whether two feeds carry the same alerts. An unchanged poll should not
 * re-verify every signature or re-render the screen.
 */
export function sameAlerts(a: AlertBundle, b: AlertBundle): boolean {
  if (a.source !== b.source) return false
  if (a.alerts.length !== b.alerts.length || a.issuers.length !== b.issuers.length) return false
  return (
    a.alerts.every((x, i) => x.packetHex === b.alerts[i].packetHex && x.receivedAt === b.alerts[i].receivedAt) &&
    a.issuers.every((x, i) => x.issuerIndex === b.issuers[i].issuerIndex && x.issuerPublicKey === b.issuers[i].issuerPublicKey)
  )
}
