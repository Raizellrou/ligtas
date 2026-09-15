import { Severity } from '@ligtas/core'
import type { EvaluatedAlert } from '../lib/evaluateBundle'
import { latestRelevantAlert } from '../lib/evaluateBundle'
import { CENTER_POSITIONS, MAP_GRID, centerDistancesFor, connectorPathFor, formatDistance, purokZoneCenter } from '../lib/evacuationCenters'

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
    <div className={`mb-6 rounded-lg border p-4 ${urgent ? 'border-red-700 bg-red-900/60' : 'border-slate-800 bg-slate-900'}`}>
      {urgent ? (
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-red-300">Evacuate now</p>
      ) : (
        <h3 className="mb-1 text-sm font-semibold text-slate-200">Your evacuation route</h3>
      )}
      <p className={`mb-2 text-xs ${urgent ? 'text-red-200' : 'text-slate-300'}`}>
        {urgent ? `Go now to ${nearest.center.name}` : `Nearest: ${nearest.center.name}`} ({formatDistance(nearest.meters)})
        {nearest.center.note && <span className="text-slate-500"> · {nearest.center.note}</span>}
      </p>

      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-400">
        {distances.map(({ center, meters }) => (
          <li key={center.id} className={center.id === nearest.center.id ? 'font-semibold text-sky-300' : undefined}>
            {center.name} — {formatDistance(meters)}
          </li>
        ))}
      </ul>

      <svg
        viewBox="0 0 400 300"
        className="w-full rounded bg-slate-950/50"
        role="img"
        aria-label={`Map showing purok ${purok} and its nearest evacuation center, ${nearest.center.name}, ${formatDistance(nearest.meters)} away`}
      >
        <path
          d="M -10 260 C 100 220, 180 280, 260 230 S 400 190, 420 200"
          fill="none"
          stroke="#0ea5e9"
          strokeOpacity={0.25}
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
                    ? 'fill-red-950 stroke-red-500'
                    : 'fill-slate-800 stroke-sky-400'
                  : 'fill-slate-900 stroke-slate-700'
              }
              strokeWidth={isMine ? 2.5 : 1}
            />
          )
        })}
        {ALL_PUROKS.map((p) => {
          const c = purokZoneCenter(p)
          return (
            <text key={p} x={c.x} y={c.y + 4} textAnchor="middle" className="fill-slate-400 text-[10px]">
              {p}
            </text>
          )
        })}

        <path
          d={routePath}
          fill="none"
          className={urgent ? 'stroke-red-500' : 'stroke-sky-500'}
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
                className={isNearest ? (urgent ? 'fill-red-500 animate-pulse' : 'fill-sky-400') : 'fill-slate-600'}
              />
              <text x={pos.x + labelDx} y={pos.y + 4} textAnchor={pos.labelAnchor} className="fill-slate-400 text-[9px]">
                {EVACUATION_CENTER_SHORT_LABEL[id]}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
