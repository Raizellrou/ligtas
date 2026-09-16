import { Severity } from '@ligtas/core'
import type { EvaluatedAlert } from '../lib/evaluateBundle'
import { latestRelevantAlert } from '../lib/evaluateBundle'
import {
  CENTER_POSITIONS,
  MAP_GRID,
  centerDistancesFor,
  connectorPathFor,
  formatWalkTime,
  purokZoneCenter,
} from '../lib/evacuationCenters'

function purokZoneRect(purok: number) {
  const i = purok - 1
  const col = i % MAP_GRID.cols
  const row = Math.floor(i / MAP_GRID.cols)
  const pad = 6
  return {
    x: MAP_GRID.originX + col * MAP_GRID.zoneW + pad,
    y: MAP_GRID.originY + row * MAP_GRID.zoneH + pad,
    width: MAP_GRID.zoneW - pad * 2,
    height: MAP_GRID.zoneH - pad * 2,
  }
}

const ALL_PUROKS = Array.from({ length: MAP_GRID.cols * MAP_GRID.rows }, (_, i) => i + 1)

const EVACUATION_CENTER_SHORT_LABEL: Record<string, string> = {
  'center-a': 'School',
  'center-b': 'Hall',
  'center-c': 'Court',
}

/**
 * Always-visible reference map (not gated behind an active alert) so a
 * resident can learn their evacuation route before disaster strikes, per
 * the product decision -- but it still reacts to a live Tier 3 alert for
 * their own purok via the same latestRelevantAlert InstructionCard uses, so
 * the two surfaces can't disagree about what's currently active.
 *
 * "Nearest" is computed from real map coordinates (centerDistancesFor),
 * not a hand-maintained purok->center table -- a fixed table silently went
 * stale the first time the pins moved, since geometric proximity and a
 * manually authored grouping have no reason to stay in sync.
 */
export function EvacuationMap({ purok, alerts }: { purok: number; alerts: EvaluatedAlert[] | null }) {
  const distances = centerDistancesFor(purok)
  const nearest = distances[0]
  const latest = alerts ? latestRelevantAlert(alerts, purok) : undefined
  const urgent = latest !== undefined && latest.body !== undefined && latest.body.severity >= Severity.TIER_3

  const routePath = connectorPathFor(purok, nearest.center.id)

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
          <li key={center.id} className="flex items-center justify-between">
            <span className={center.id === nearest.center.id ? 'font-semibold text-ink' : 'text-ink-2'}>
              {center.name}
            </span>
            <span className="text-ink-3">{formatWalkTime(meters)}</span>
          </li>
        ))}
      </ul>

      <svg
        viewBox="0 0 400 300"
        className="w-full rounded bg-bg-alt/50"
        role="img"
        aria-label={`Map showing purok ${purok} and its nearest evacuation center, ${nearest.center.name}, ${formatWalkTime(nearest.meters)} away`}
      >
        <path
          d="M -10 260 C 100 220, 180 280, 260 230 S 400 190, 420 200"
          fill="none"
          stroke="var(--color-info)"
          strokeOpacity={0.2}
          strokeWidth={26}
          strokeLinecap="round"
        />

        {ALL_PUROKS.map((p) => {
          const rect = purokZoneRect(p)
          const isMine = p === purok
          return (
            <rect
              key={p}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              rx={6}
              className={
                isMine
                  ? urgent
                    ? 'fill-danger-bg stroke-danger'
                    : 'fill-bg-alt stroke-info'
                  : 'fill-surface stroke-border'
              }
              strokeWidth={isMine ? 2.5 : 1}
            />
          )
        })}
        {ALL_PUROKS.map((p) => {
          const c = purokZoneCenter(p)
          return (
            <text key={p} x={c.x} y={c.y + 4} textAnchor="middle" className="fill-ink-3 text-[10px]">
              {p}
            </text>
          )
        })}

        <path
          d={routePath}
          fill="none"
          className={urgent ? 'stroke-danger' : 'stroke-info'}
          strokeWidth={urgent ? 2.5 : 1.5}
          strokeLinejoin="round"
          strokeDasharray={urgent ? '2 4' : '4 3'}
        />

        {Object.entries(CENTER_POSITIONS).map(([id, pos]) => {
          const isNearest = id === nearest.center.id
          const labelDx = pos.labelAnchor === 'start' ? 10 : pos.labelAnchor === 'end' ? -10 : 0
          return (
            <g key={id}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={isNearest ? 7 : 5}
                className={isNearest ? (urgent ? 'fill-danger animate-pulse' : 'fill-info') : 'fill-ink-3'}
              />
              <text x={pos.x + labelDx} y={pos.y + 4} textAnchor={pos.labelAnchor} className="fill-ink-3 text-[9px]">
                {EVACUATION_CENTER_SHORT_LABEL[id]}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
