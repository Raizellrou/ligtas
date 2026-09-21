import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AlertBody } from '@ligtas/core'
import { stopVibration, vibrateEmergency } from '../lib/alertFeedback'
import type { CheckinStatus } from '../lib/checkinQueue'
import { formatWalkTime, walkMinutes } from '../lib/evacuationCenters'
import { hazardLabel } from '../lib/instructions'
import { useEvacuationRoute } from '../lib/useEvacuationRoute'
import type { UseHouseholdCheckin } from '../lib/useHouseholdCheckin'
import type { LivePosition } from '../lib/useLiveLocation'

function affectedPuroks(purokBitmap: number): number[] {
  return Array.from({ length: 12 }, (_, i) => i + 1).filter((p) => (purokBitmap & (1 << (p - 1))) !== 0)
}

// Full-screen takeover for an evacuation (Tier 3) only -- lower tiers are a
// card on the home screen. It leads with where to go: the nearest center is
// computed from local static data, so it renders with no connection at all,
// and it comes from the same route hook as the map, so the two always agree
// (including when a GPS fix or flooded streets change the answer).
// The check-in buttons are shown only to a joined household, and confirm
// with wording that is always true (the tap is queued on this phone before
// the network is touched, but the family only sees it once it syncs).
//
// A real modal: it is rendered outside #root and #root is made inert while it
// is up, so keyboard focus and screen readers cannot reach the page behind it
// (no hand-rolled focus trap needed). Escape deliberately does nothing -- the
// resident leaves it with "Show my route". It vibrates once on appearing; see
// lib/alertFeedback.ts for what that can and can't do.
export function EmergencyNotice({
  body,
  purok,
  checkin,
  position,
  onContinue,
}: {
  body: AlertBody
  purok: number
  checkin: UseHouseholdCheckin
  position: LivePosition | null
  onContinue: () => void
}) {
  const puroks = affectedPuroks(body.purokBitmap)
  const route = useEvacuationRoute({ purok, severity: body.severity, position })
  const nearest = route.nearest
  const [sent, setSent] = useState<CheckinStatus | null>(null)

  function tell(status: CheckinStatus) {
    checkin.submit(status)
    setSent(status)
  }

  useEffect(() => {
    const root = document.getElementById('root')
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (root) root.inert = true
    vibrateEmergency()
    return () => {
      if (root) root.inert = false
      stopVibration()
      previouslyFocused?.focus()
    }
  }, [])

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="emergency-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-bg text-ink"
    >
      <div className="flex min-h-full flex-col items-center justify-center p-6 text-center">
        <div className="relative mb-5 flex h-24 w-24 shrink-0 items-center justify-center">
          <span className="absolute h-24 w-24 rounded-full bg-danger-bg" />
          <span className="absolute h-16 w-16 rounded-full bg-danger/25" />
          <span className="absolute h-10 w-10 rounded-full bg-danger" />
        </div>

        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-danger-deep">Evacuate now</p>
        <h1 id="emergency-title" className="font-display text-3xl font-bold leading-tight text-ink">
          {hazardLabel(body.hazard)}
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          Affects {puroks.map((p) => `Purok ${p}`).join(', ')}
        </p>

        <div className="mt-6 w-full max-w-xs rounded-lg border border-danger bg-danger-bg p-4 text-left">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-danger-deep">Go to</p>
          <p className="font-display text-xl font-semibold text-ink">{nearest.center.name}</p>
          <p className="mt-1 text-sm font-semibold text-ink-2">{formatWalkTime(nearest.meters)}</p>
          {nearest.center.note && <p className="mt-1 text-sm text-ink-2">{nearest.center.note}</p>}
          {route.allFlooded ? (
            <p className="mt-2 text-sm font-semibold text-danger-deep">
              Every known route may be flooded. Follow barangay officials.
            </p>
          ) : (
            route.detourMeters !== null && (
              <p className="mt-2 text-sm text-ink-2">
                Avoids streets likely flooded (+{walkMinutes(route.detourMeters)} min).
              </p>
            )
          )}
        </div>

        <button
          autoFocus
          onClick={onContinue}
          className="mt-6 w-full max-w-xs rounded-lg bg-danger-deep py-3 text-sm font-semibold text-white hover:bg-danger"
        >
          Show my route
        </button>

        {checkin.joined && (
          <div className="mt-6 w-full max-w-xs">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Let your family know</p>
            {sent === null ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => tell('safe')}
                  className="rounded-lg border border-success bg-success-bg py-2.5 text-sm font-semibold text-success hover:bg-success-bg/70"
                >
                  I'm safe
                </button>
                <button
                  onClick={() => tell('need_help')}
                  className="rounded-lg border border-danger bg-danger-bg py-2.5 text-sm font-semibold text-danger-deep hover:bg-danger-bg/70"
                >
                  I need help
                </button>
              </div>
            ) : (
              <p className="text-sm text-ink-2" role="status">
                Saved on this phone: {sent === 'safe' ? "I'm safe" : 'I need help'}. Your household sees it as soon
                as it syncs.
              </p>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
