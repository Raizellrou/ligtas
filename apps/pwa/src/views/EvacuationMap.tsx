import { useEffect, useState } from 'react'
import type { EvaluatedAlert } from '../lib/evaluateBundle'
import { latestRelevantAlert } from '../lib/evaluateBundle'
import { alertLevel } from '../lib/instructions'
import {
  MAP_CENTERS,
  MAP_META,
  PUROK_ANCHORS,
  centerDistancesFor,
  formatWalkTime,
  loadMapGeometry,
  routeKeyFor,
  purokAnchorFor,
  type MapGeometry,
} from '../lib/evacuationCenters'

const [VIEW_W, VIEW_H] = MAP_META.viewBox

// A center's label goes wherever it covers no purok marker: with real
// coordinates a center can sit right beside a purok (the School pin is ~17
// units from purok 12), and a label drawn over a marker hides that purok.
const LABEL_SLOTS = [
  { dx: 10, dy: 3.5, anchor: 'start' },
  { dx: -10, dy: 3.5, anchor: 'end' },
  { dx: 0, dy: -10, anchor: 'middle' },
  { dx: 0, dy: 17, anchor: 'middle' },
] as const

const CENTER_LABEL_SLOT = new Map(
  MAP_CENTERS.map((c) => {
    const width = c.short.length * 5.4
    const scored = LABEL_SLOTS.map((slot) => {
      const x0 = slot.anchor === 'start' ? c.x + slot.dx : slot.anchor === 'end' ? c.x + slot.dx - width : c.x + slot.dx - width / 2
      const box = { x0, x1: x0 + width, y0: c.y + slot.dy - 8, y1: c.y + slot.dy + 2 }
      const covered = PUROK_ANCHORS.filter(
        (a) => a.x > box.x0 - 8 && a.x < box.x1 + 8 && a.y > box.y0 - 8 && a.y < box.y1 + 8,
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
 * lib/evacuationCenters.ts). Both the "nearest" center and the drawn dotted
 * route come from the same precomputed walking routes, so what is drawn and
 * what the distance says can't drift apart. The road geometry loads as its
 * own precached chunk; the header and distance list render without it.
 */
export function EvacuationMap({ purok, alerts }: { purok: number; alerts: EvaluatedAlert[] | null }) {
  const distances = centerDistancesFor(purok)
  const nearest = distances[0]
  const latest = alerts ? latestRelevantAlert(alerts, purok) : undefined
  const urgent = latest?.body !== undefined && alertLevel(latest.body.severity) === 'evacuate'

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

  return (
    <div className={`mb-6 rounded-lg border p-4 ${urgent ? 'border-danger bg-danger-bg' : 'border-border bg-surface'}`}>
      <div className="mb-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">
          {urgent ? 'Evacuate now to' : 'Nearest evacuation center'}
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
        {nearest.center.note && <p className="mt-1 text-xs text-ink-3">{nearest.center.note}</p>}
      </div>

      <ul className="mb-3 space-y-1 text-xs">
        {distances.map(({ center, meters }) => (
          <li key={center.id} className="flex items-center justify-between gap-3">
            <span className={center.id === nearest.center.id ? 'font-semibold text-ink' : 'text-ink-2'}>
              {center.name}
            </span>
            <span className="whitespace-nowrap text-ink-3">{formatWalkTime(meters)}</span>
          </li>
        ))}
      </ul>

      {geometry ? (
        <MapSvg geometry={geometry} purok={purok} nearestId={nearest.center.id} urgent={urgent} />
      ) : (
        <div
          className="flex w-full items-center justify-center rounded bg-bg-alt/50 text-xs text-ink-2"
          style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
        >
          {failed ? 'Map unavailable. The list above still works.' : 'Loading map…'}
        </div>
      )}

      <p className="mt-2 text-xs text-ink-2">
        Usual walking route. Roads may be flooded; follow barangay officials.
      </p>
      <p className="mt-1 text-xs text-ink-2">
        © {MAP_META.source.replace(' (ODbL)', '')} ({MAP_META.snapshotDate}). Demo layout, not official.
      </p>
    </div>
  )
}

function MapSvg({
  geometry,
  purok,
  nearestId,
  urgent,
}: {
  geometry: MapGeometry
  purok: number
  nearestId: string
  urgent: boolean
}) {
  const nearest = MAP_CENTERS.find((c) => c.id === nearestId)!
  const route = geometry.routes[routeKeyFor(purok)]?.[nearestId]
  const mine = purokAnchorFor(purok)

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full rounded bg-bg-alt/50"
      role="img"
      aria-label={`Map of ${MAP_META.barangay} showing purok ${mine.purok} and its nearest evacuation center, ${nearest.name}`}
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

      {/* Veil everything outside the barangay boundary, then outline the boundary itself. */}
      <path
        d={`M-10 -10H${VIEW_W + 10}V${VIEW_H + 10}H-10Z${geometry.boundary}`}
        fillRule="evenodd"
        className="fill-bg-alt/70"
      />
      <path d={geometry.boundary} fill="none" className="stroke-ink-3" strokeWidth={1} strokeDasharray="5 3" />

      {route && (
        <>
          <path
            d={route}
            fill="none"
            className="stroke-bg"
            strokeWidth={urgent ? 5.5 : 4.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={route}
            fill="none"
            className={urgent ? 'stroke-danger' : 'stroke-info'}
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
              r={isMine ? 8 : 5.5}
              className={
                isMine
                  ? urgent
                    ? 'fill-danger-deep stroke-bg'
                    : 'fill-info stroke-bg'
                  : 'fill-surface stroke-ink-3'
              }
              strokeWidth={isMine ? 1.5 : 0.8}
            />
            <text
              x={a.x}
              y={a.y + (isMine ? 3.6 : 2.8)}
              textAnchor="middle"
              className={isMine ? 'fill-white text-[10px] font-bold' : 'fill-ink-2 text-[8px] font-semibold'}
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
              r={isNearest ? 7 : 5}
              className={`stroke-bg ${isNearest ? (urgent ? 'fill-danger animate-pulse' : 'fill-info') : 'fill-ink-2'}`}
              strokeWidth={1.5}
            />
            <text
              x={c.x + slot.dx}
              y={c.y + slot.dy}
              textAnchor={slot.anchor}
              className="fill-ink stroke-bg text-[9px] font-semibold"
              strokeWidth={3}
              style={{ paintOrder: 'stroke' }}
            >
              {c.short}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
