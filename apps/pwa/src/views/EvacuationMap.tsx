import { useEffect, useRef, useState } from 'react'
import type { EvaluatedAlert } from '../lib/evaluateBundle'
import { latestRelevantAlert } from '../lib/evaluateBundle'
import { alertLevel } from '../lib/instructions'
import {
  MAP_CENTERS,
  MAP_META,
  PUROK_ANCHORS,
  formatWalkTime,
  loadMapGeometry,
  purokAnchorFor,
  routeKeyFor,
  walkMinutes,
  type MapGeometry,
} from '../lib/evacuationCenters'
import { useEvacuationRoute, type EvacuationRoute } from '../lib/useEvacuationRoute'
import type { LiveLocation } from '../lib/useLiveLocation'

const [VIEW_W, VIEW_H] = MAP_META.viewBox

// Width in px of the map when enlarged (about twice a phone's width).
const ENLARGED_WIDTH = 820

// A center's label goes wherever it covers no purok marker: with real
// coordinates a center can sit right beside a purok (the School pin is ~17
// units from purok 12), and a label drawn over a marker hides that purok.
//
// Sizes are in SVG units and the map is drawn ~340 px wide for 400 units, so
// 1 unit is under 1 px: text has to be ~11+ units to read on a phone.
const LABEL_SLOTS = [
  { dx: 12, dy: 4, anchor: 'start' },
  { dx: -12, dy: 4, anchor: 'end' },
  { dx: 0, dy: -12, anchor: 'middle' },
  { dx: 0, dy: 20, anchor: 'middle' },
] as const

const LABEL_CHAR_WIDTH = 6.8 // ~11.5-unit semibold text
const MARKER_CLEARANCE = 10 // a purok marker's radius (own purok is larger)

const CENTER_LABEL_SLOT = new Map(
  MAP_CENTERS.map((c) => {
    const width = c.short.length * LABEL_CHAR_WIDTH
    const scored = LABEL_SLOTS.map((slot) => {
      const x0 = slot.anchor === 'start' ? c.x + slot.dx : slot.anchor === 'end' ? c.x + slot.dx - width : c.x + slot.dx - width / 2
      const box = { x0, x1: x0 + width, y0: c.y + slot.dy - 10, y1: c.y + slot.dy + 3 }
      const covered = PUROK_ANCHORS.filter(
        (a) =>
          a.x > box.x0 - MARKER_CLEARANCE &&
          a.x < box.x1 + MARKER_CLEARANCE &&
          a.y > box.y0 - MARKER_CLEARANCE &&
          a.y < box.y1 + MARKER_CLEARANCE,
      ).length
      const offMap = box.x0 < 0 || box.x1 > VIEW_W || box.y0 < 0 || box.y1 > VIEW_H
      return { slot, cost: covered + (offMap ? 10 : 0) }
    })
    return [c.id, scored.reduce((best, s) => (s.cost < best.cost ? s : best)).slot]
  }),
)

/**
 * Always-visible reference map (not gated behind an active alert) so a
 * resident can learn their evacuation route before disaster strikes, per
 * the product decision -- but it still reacts to a live Tier 3 alert for
 * their own purok via the same latestRelevantAlert InstructionCard uses, so
 * the two surfaces can't disagree about what's currently active.
 *
 * The map is a real, fixed, offline snapshot of one barangay's roads (see
 * lib/evacuationCenters.ts). Where to go, how long it takes and the drawn
 * route all come from useEvacuationRoute, which routes from the resident's
 * live location when there is one and around streets likely flooded at the
 * current alert tier. The road geometry loads as its own precached chunk; the
 * header and distance list render without it.
 */
export function EvacuationMap({
  purok,
  alerts,
  liveLocation,
}: {
  purok: number
  alerts: EvaluatedAlert[] | null
  liveLocation: LiveLocation
}) {
  const latest = alerts ? latestRelevantAlert(alerts, purok) : undefined
  const severity = latest?.body?.severity ?? 0
  const urgent = latest?.body !== undefined && alertLevel(latest.body.severity) === 'evacuate'
  const route = useEvacuationRoute({ purok, severity, position: liveLocation.position })
  const { ranked, nearest } = route

  const [geometry, setGeometry] = useState<MapGeometry | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    loadMapGeometry()
      .then((g) => {
        if (live) setGeometry(g)
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [])

  // "Enlarge": the same map at twice the width in a sideways-scrolling box, so
  // the labels can be read properly without a map library. Opens centred on
  // the resident's own purok.
  const [enlarged, setEnlarged] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = scroller.current
    if (!enlarged || box === null) return
    const focusX = (purokAnchorFor(purok).x / VIEW_W) * ENLARGED_WIDTH
    box.scrollLeft = Math.max(0, focusX - box.clientWidth / 2)
  }, [enlarged, purok, geometry])

  return (
    <div className={`mb-6 rounded-lg border p-4 ${urgent ? 'border-danger bg-danger-bg' : 'border-border bg-surface'}`}>
      <div className="mb-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">
          {urgent ? 'Evacuate now to' : 'Nearest evacuation center'}
          {route.mode === 'from-you' && ' · from your location'}
        </p>
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-lg font-semibold text-ink">{nearest.center.name}</span>
          <span
            className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${
              urgent ? 'bg-danger text-white' : 'bg-info-bg text-info'
            }`}
          >
            {formatWalkTime(nearest.meters)}
          </span>
        </div>
        {nearest.center.note && <p className="mt-1 text-sm text-ink-2">{nearest.center.note}</p>}
      </div>

      <FloodNotice route={route} />

      <ul className="mb-3 space-y-1 text-sm">
        {ranked.map(({ center, meters }) => (
          <li key={center.id} className="flex items-center justify-between gap-3">
            <span className={center.id === nearest.center.id ? 'font-semibold text-ink' : 'text-ink-2'}>
              {center.name}
            </span>
            <span className="whitespace-nowrap text-ink-2">
              {meters === null ? 'cut off by flooding' : formatWalkTime(meters)}
            </span>
          </li>
        ))}
      </ul>

      {geometry ? (
        <>
          <div ref={scroller} className={enlarged ? 'overflow-x-auto rounded' : undefined}>
            <MapSvg geometry={geometry} purok={purok} route={route} urgent={urgent} enlarged={enlarged} />
          </div>
          <button
            onClick={() => setEnlarged((e) => !e)}
            aria-pressed={enlarged}
            className="mt-2 rounded-lg border border-ink-3 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-bg-alt"
          >
            {enlarged ? 'Fit map to screen' : 'Enlarge map'}
          </button>
        </>
      ) : (
        <div
          className="flex w-full items-center justify-center rounded bg-bg-alt/50 text-xs text-ink-2"
          style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
        >
          {failed ? 'Map unavailable. The list above still works.' : 'Loading map…'}
        </div>
      )}

      {route.blockingTier > 0 && route.blockedD !== null && (
        <p className="mt-2 flex items-center gap-2 text-xs text-ink-2">
          <span className="h-1 w-5 rounded-full bg-accent" />
          Streets likely flooded at Tier {route.blockingTier} (demo, not surveyed)
        </p>
      )}

      <LocationControl liveLocation={liveLocation} outsideMap={route.outsideMap} />

      <p className="mt-2 text-xs text-ink-2">
        Usual walking route. From Tier 2 up it avoids streets known to flood, which is not live conditions. Roads
        may be flooded; follow barangay officials.
      </p>
      <p className="mt-1 text-xs text-ink-2">
        © {MAP_META.source.replace(' (ODbL)', '')} ({MAP_META.snapshotDate}). Demo layout, not official.
      </p>
    </div>
  )
}

function FloodNotice({ route }: { route: EvacuationRoute }) {
  if (route.blockingTier === 0) return null
  if (route.allFlooded) {
    return (
      <p className="mb-3 rounded border border-danger bg-danger-bg px-2 py-1.5 text-sm font-semibold text-danger-deep">
        Every known route from here may be flooded. The route shown ignores flooding. Follow barangay officials.
      </p>
    )
  }
  return (
    <p className="mb-3 rounded border border-accent bg-accent-bg px-2 py-1.5 text-sm text-ink-2">
      Avoiding streets likely flooded at Tier {route.blockingTier}
      {route.detourMeters !== null && ` (+${walkMinutes(route.detourMeters)} min)`}.
    </p>
  )
}

function LocationControl({ liveLocation, outsideMap }: { liveLocation: LiveLocation; outsideMap: boolean }) {
  const { status, position, hint, simulation } = liveLocation
  const button =
    'rounded-lg border border-ink-3 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-bg-alt'

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-2">
          {status === 'off' && 'Show where you are on the map.'}
          {status === 'locating' && (hint ?? 'Finding you…')}
          {status === 'active' && `Live location · ±${Math.round(position?.accuracy ?? 0)} m`}
          {status === 'simulated' &&
            `Simulated walk (demo) · ${Math.round(simulation.progress * 100)}%${simulation.progress >= 1 ? ' · arrived' : ''}`}
          {status === 'denied' && 'Location is blocked for this site. Allow it in your browser settings.'}
          {status === 'insecure' && 'Location needs a secure page (https or localhost).'}
          {status === 'unsupported' && "This device can't share its location."}
        </span>
        {(status === 'off' || status === 'denied' || status === 'insecure' || status === 'unsupported') && (
          <button onClick={liveLocation.start} className={button}>
            {status === 'off' ? 'Show my location' : 'Try again'}
          </button>
        )}
        {(status === 'locating' || status === 'active') && (
          <button onClick={liveLocation.stop} className={button}>
            Stop
          </button>
        )}
        {status === 'simulated' && (
          <button onClick={liveLocation.stopSimulation} className={button}>
            Stop
          </button>
        )}
      </div>
      {outsideMap && (
        <p className="mt-1 text-xs text-ink-2">You're outside the mapped area, so the route starts from your purok.</p>
      )}
      <p className="mt-1 text-xs text-ink-3">Your location stays on this phone. It works without internet.</p>
    </div>
  )
}

function MapSvg({
  geometry,
  purok,
  route,
  urgent,
  enlarged,
}: {
  geometry: MapGeometry
  purok: number
  route: EvacuationRoute
  urgent: boolean
  enlarged: boolean
}) {
  const nearestId = route.nearest.center.id
  const nearest = MAP_CENTERS.find((c) => c.id === nearestId)!
  // Until the road graph loads, draw the precomputed route for this purok.
  const routeD = route.routeD ?? geometry.routes[routeKeyFor(purok)]?.[nearestId]
  const mine = purokAnchorFor(purok)
  const you = route.you

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="rounded bg-bg-alt/50"
      style={enlarged ? { width: ENLARGED_WIDTH, maxWidth: 'none' } : { width: '100%' }}
      role="img"
      aria-label={`Map of ${MAP_META.barangay} showing purok ${mine.purok}${you ? ', your location' : ''} and its nearest evacuation center, ${nearest.name}`}
    >
      <path d={geometry.water.areas} fillRule="evenodd" className="fill-info/20" />
      <path
        d={geometry.water.river}
        fill="none"
        className="stroke-info/25"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d={geometry.water.stream} fill="none" className="stroke-info/40" strokeWidth={1.4} strokeLinejoin="round" />

      <path
        d={geometry.roads.path}
        fill="none"
        className="stroke-ink-3/35"
        strokeWidth={0.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d={geometry.roads.minor}
        fill="none"
        className="stroke-ink-3/50"
        strokeWidth={1}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d={geometry.roads.major}
        fill="none"
        className="stroke-ink-3/80"
        strokeWidth={1.9}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {route.blockedD !== null && (
        <path
          d={route.blockedD}
          fill="none"
          className="stroke-accent"
          strokeWidth={3}
          strokeLinecap="round"
          strokeOpacity={0.85}
        />
      )}

      {/* Veil everything outside the barangay boundary, then outline the boundary itself. */}
      <path
        d={`M-10 -10H${VIEW_W + 10}V${VIEW_H + 10}H-10Z${geometry.boundary}`}
        fillRule="evenodd"
        className="fill-bg-alt/70"
      />
      <path d={geometry.boundary} fill="none" className="stroke-ink-3" strokeWidth={1} strokeDasharray="5 3" />

      {routeD && (
        <>
          <path
            d={routeD}
            fill="none"
            className="stroke-bg"
            strokeWidth={urgent ? 5.5 : 4.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={routeD}
            fill="none"
            className={urgent || route.allFlooded ? 'stroke-danger' : 'stroke-info'}
            strokeWidth={urgent ? 3 : 2.2}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={urgent ? '0.1 5' : '6 4'}
          />
        </>
      )}

      {PUROK_ANCHORS.map((a) => {
        const isMine = a.purok === mine.purok
        return (
          <g key={a.purok}>
            <circle
              cx={a.x}
              cy={a.y}
              r={isMine ? 10 : 7}
              className={isMine ? (urgent ? 'fill-danger-deep stroke-bg' : 'fill-ink stroke-bg') : 'fill-surface stroke-ink-3'}
              strokeWidth={isMine ? 1.5 : 0.9}
            />
            <text
              x={a.x}
              y={a.y + (isMine ? 4.6 : 3.9)}
              textAnchor="middle"
              className={isMine ? 'fill-white text-[13px] font-bold' : 'fill-ink text-[11px] font-semibold'}
            >
              {a.purok}
            </text>
          </g>
        )
      })}

      {MAP_CENTERS.map((c) => {
        const isNearest = c.id === nearestId
        const slot = CENTER_LABEL_SLOT.get(c.id)!
        return (
          <g key={c.id}>
            <circle
              cx={c.x}
              cy={c.y}
              r={isNearest ? 8.5 : 6}
              className={`stroke-bg ${isNearest ? (urgent ? 'fill-danger animate-pulse motion-reduce:animate-none' : 'fill-info') : 'fill-ink-2'}`}
              strokeWidth={1.5}
            />
            <text
              x={c.x + slot.dx}
              y={c.y + slot.dy}
              textAnchor={slot.anchor}
              className="fill-ink stroke-bg text-[11.5px] font-semibold"
              strokeWidth={3.5}
              style={{ paintOrder: 'stroke' }}
            >
              {c.short}
            </text>
          </g>
        )
      })}

      {you && (
        <g>
          <circle cx={you.x} cy={you.y} r={Math.min(40, Math.max(6, you.accuracyUnits))} className="fill-info/15 stroke-info/40" strokeWidth={0.8} />
          <circle cx={you.x} cy={you.y} r={6.5} className="fill-info stroke-white" strokeWidth={2} />
        </g>
      )}
    </svg>
  )
}
