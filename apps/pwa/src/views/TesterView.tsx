import { useMemo, useState } from 'react'
import { Hazard } from '@ligtas/core'
import { latestRelevantAlert, type EvaluatedAlert } from '../lib/evaluateBundle'
import { severityLabel } from '../lib/instructions'
import { planWalkPath } from '../lib/roadGraph'
import type { LiveLocation } from '../lib/useLiveLocation'
import type { Simulation } from '../lib/useSimulation'
import { usePersistedPurok } from '../usePersistedPurok'
import {
  RIVER_MAX_CM,
  TESTER_ISSUER_INDEX,
  TIER_1_CM,
  TIER_2_CM,
  TIER_3_CM,
  defaultBroadcastOptions,
  tierForLevel,
} from '../lib/simulation'
import { LiveMeshPanel } from './LiveMeshPanel'

const HAZARD_OPTIONS = [
  { value: Hazard.RIVER_FLOOD, label: 'River flood' },
  { value: Hazard.FLASH_FLOOD, label: 'Flash flood' },
  { value: Hazard.STORM_SURGE, label: 'Storm surge' },
  { value: Hazard.TEST, label: 'Test' },
]

const OUTCOME_STYLE: Record<EvaluatedAlert['outcome'], string> = {
  accepted: 'border-success bg-success-bg text-success',
  rejected_signature: 'border-danger bg-danger-bg text-danger-deep',
  rejected_unknown_issuer: 'border-danger bg-danger-bg text-danger-deep',
  rejected_replay: 'border-accent bg-accent-bg text-accent-deep',
  duplicate: 'border-border bg-surface text-ink-2',
}

const OUTCOME_LABEL: Record<EvaluatedAlert['outcome'], string> = {
  accepted: 'ACCEPTED',
  rejected_signature: 'REJECTED — signature',
  rejected_unknown_issuer: 'REJECTED — unknown issuer',
  rejected_replay: 'REJECTED — replay',
  duplicate: 'DUPLICATE — already seen',
}

const WALK_SPEEDS = [5, 10, 20]

// Stands in for the phone's GPS (the Resident view can't be walked around
// Nangka in a demo): a fake position walks the resident's route from their
// purok to the nearest evacuation center, feeding the very same location
// pipeline real GPS does. Raising the river gauge mid-walk re-plans the route
// from wherever the walker is.
function WalkSimulator({ liveLocation, alerts }: { liveLocation: LiveLocation; alerts: EvaluatedAlert[] | null }) {
  const { purok } = usePersistedPurok()
  const { simulation, status } = liveLocation
  const [planning, setPlanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const walking = status === 'simulated'
  const btn = 'rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-bg-alt disabled:opacity-50'

  async function start() {
    if (purok === null) return
    setPlanning(true)
    setError(null)
    try {
      // Walk the route the resident would be shown right now.
      const severity = (alerts ? latestRelevantAlert(alerts, purok) : undefined)?.body?.severity ?? 0
      const path = await planWalkPath(purok, severity)
      if (path === null) setError('No walkable route from this purok.')
      else liveLocation.simulateWalk(path, simulation.speed)
    } catch {
      setError('Could not load the road network.')
    } finally {
      setPlanning(false)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-1 text-sm font-semibold text-ink">Walk simulator</h3>
      <p className="mb-3 text-xs text-ink-3">
        Stands in for the phone's GPS: a fake position walks from the resident's purok to the nearest evacuation
        center. Raise the river gauge during the walk to watch the route change from where they are.
      </p>

      {purok === null ? (
        <p className="text-xs text-ink-2">Pick a purok on the Resident tab first.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {!walking || !simulation.active ? (
              <button onClick={start} disabled={planning} className={btn}>
                {planning ? 'Planning…' : walking ? 'Walk again' : `Start walking from Purok ${purok}`}
              </button>
            ) : simulation.paused ? (
              <button onClick={liveLocation.resumeSimulation} className={btn}>
                Resume
              </button>
            ) : (
              <button onClick={liveLocation.pauseSimulation} className={btn}>
                Pause
              </button>
            )}
            {walking && (
              <button onClick={liveLocation.stopSimulation} className={btn}>
                Stop
              </button>
            )}
            <div className="ml-auto flex items-center gap-1" role="group" aria-label="Walking speed">
              {WALK_SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => liveLocation.setSimulationSpeed(s)}
                  aria-pressed={simulation.speed === s}
                  className={`rounded px-2 py-1 text-xs font-semibold ${
                    simulation.speed === s ? 'bg-accent text-ink' : 'bg-bg-alt text-ink-2 hover:bg-border'
                  }`}
                >
                  ×{s}
                </button>
              ))}
            </div>
          </div>

          {walking && (
            <div className="mt-3">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-alt">
                <div className="h-full bg-accent" style={{ width: `${Math.round(simulation.progress * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-ink-2">
                {simulation.progress >= 1
                  ? 'Arrived.'
                  : `${Math.round(simulation.progress * 100)}% of the way${simulation.paused ? ' · paused' : ''}`}{' '}
                Switch to the Resident tab to watch the dot.
              </p>
            </div>
          )}
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </>
      )}
    </section>
  )
}

export function TesterView({ sim, liveLocation }: { sim: Simulation; liveLocation: LiveLocation }) {
  const [riverLevelCm, setRiverLevelCm] = useState(210)
  const [hazard, setHazard] = useState<number>(defaultBroadcastOptions().hazard)
  const [purokBitmap, setPurokBitmap] = useState(defaultBroadcastOptions().purokBitmap)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [showFullLog, setShowFullLog] = useState(false)

  const tier = tierForLevel(riverLevelCm)

  // Next unused sequence for this browser's issuer -- the tester can still
  // override it, which is the whole point of the replay controls below.
  const nextSequence = useMemo(() => {
    const used = (sim.evaluated ?? [])
      .filter((a) => a.body?.issuerIndex === TESTER_ISSUER_INDEX)
      .map((a) => a.body!.sequence)
    return used.length === 0 ? 1 : Math.max(...used) + 1
  }, [sim.evaluated])

  const [sequenceOverride, setSequenceOverride] = useState<number | null>(null)
  const sequence = sequenceOverride ?? nextSequence

  const options = { hazard, severity: Math.max(tier, 1), purokBitmap, waterLevelCm: riverLevelCm, sequence }
  const testerAlerts = (sim.evaluated ?? []).filter((a) => a.index >= sim.capturedCount)
  const latest = testerAlerts.at(-1)

  function send(kind: 'genuine' | 'forged' | 'tampered' | 'replay-sequence') {
    sim.broadcast(kind, kind === 'replay-sequence' ? { ...options, sequence: 1 } : options)
    setSequenceOverride(null)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">Simulator — sensor stand-in</h2>
        <p className="mt-1 text-xs text-ink-3">
          Every packet below is really built and really signed in this browser by{' '}
          <code className="text-ink-2">@ligtas/core</code>. Nothing tells the resident view what kind of packet it
          is — it decides by checking the signature and sequence itself, the same code the hub runs.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-ink">River gauge</h3>
          <TierBadge tier={tier} levelCm={riverLevelCm} />
        </div>
        <SensorVisual tier={tier} levelCm={riverLevelCm} />
        <input
          type="range"
          min={0}
          max={RIVER_MAX_CM}
          value={riverLevelCm}
          onChange={(e) => setRiverLevelCm(Number(e.target.value))}
          className="w-full accent-accent"
          aria-label="River level in centimetres"
        />
        <div className="mt-1 flex justify-between text-[10px] text-ink-3">
          <span>0 cm</span>
          <span>tier 1 · {TIER_1_CM}</span>
          <span>tier 2 · {TIER_2_CM}</span>
          <span>tier 3 · {TIER_3_CM}</span>
          <span>{RIVER_MAX_CM} cm</span>
        </div>
        <p className="mt-2 text-xs text-ink-3">
          Same thresholds the Wokwi sensor node uses (<code>apps/sensor-wokwi</code>).
        </p>
      </section>

      <WalkSimulator liveLocation={liveLocation} alerts={sim.evaluated} />

      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">Alert contents</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs text-ink-2">
            Hazard
            <select
              value={hazard}
              onChange={(e) => setHazard(Number(e.target.value))}
              className="mt-1 w-full rounded border border-border bg-bg-alt p-2 text-sm text-ink"
            >
              {HAZARD_OPTIONS.map((h) => (
                <option key={h.value} value={h.value}>
                  {h.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-ink-2">
            Sequence number
            <input
              type="number"
              min={0}
              value={sequence}
              onChange={(e) => setSequenceOverride(Number(e.target.value))}
              className="mt-1 w-full rounded border border-border bg-bg-alt p-2 text-sm text-ink"
            />
            <span className="mt-1 block text-[10px] text-ink-3">
              Next unused is {nextSequence}. Reusing an old one is what the replay guard catches.
            </span>
          </label>
        </div>

        <fieldset className="mt-4">
          <legend className="text-xs text-ink-2">Affected puroks</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {Array.from({ length: 8 }, (_, i) => i + 1).map((p) => {
              const on = (purokBitmap & (1 << (p - 1))) !== 0
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPurokBitmap(purokBitmap ^ (1 << (p - 1)))}
                  className={`h-9 w-9 rounded text-sm font-semibold ${
                    on ? 'bg-accent text-ink' : 'bg-bg-alt text-ink-2 hover:bg-border'
                  }`}
                  aria-pressed={on}
                >
                  {p}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-[10px] text-ink-3">
            bitmap 0b{purokBitmap.toString(2).padStart(8, '0')} · a resident only sees an instruction if their purok bit
            is set
          </p>
        </fieldset>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-1 text-sm font-semibold text-ink">Broadcast</h3>
        <p className="mb-3 text-xs text-ink-3">
          Severity is taken from the gauge{tier === 0 ? ' (below tier 1 — sending as tier 1)' : ''}.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <BroadcastButton
            onClick={() => send('genuine')}
            className="border-success bg-success-bg hover:bg-success-bg/70"
            title="Genuine alert"
            subtitle="Signed by this browser's authorised issuer key"
          />
          <BroadcastButton
            onClick={() => send('forged')}
            className="border-danger bg-danger-bg hover:bg-danger-bg/70"
            title="Forged alert"
            subtitle="Really signed — by an impostor keypair the verifier doesn't trust"
          />
          <BroadcastButton
            onClick={() => send('tampered')}
            className="border-danger bg-danger-bg hover:bg-danger-bg/70"
            title="Tampered alert"
            subtitle="Signed correctly, then one body byte flipped afterwards"
          />
          <BroadcastButton
            onClick={() => send('replay-sequence')}
            className="border-accent bg-accent-bg hover:bg-accent-bg/70"
            title="Replay (old sequence)"
            subtitle="A fresh, correctly signed packet reusing sequence 1"
          />
        </div>
        <button onClick={sim.reset} className="mt-3 text-xs text-ink-2 underline hover:text-ink">
          Reset — drop everything broadcast here, back to the captured run
        </button>
      </section>

      {latest && <Pipeline latest={latest} />}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">
          Transmission log <span className="font-normal text-ink-3">({testerAlerts.length} sent from here)</span>
        </h3>
        {testerAlerts.length === 0 ? (
          <p className="text-xs text-ink-3">
            Nothing broadcast yet. The resident view is currently showing the {sim.capturedCount} packets captured from
            the real mesh-sim run.
          </p>
        ) : (
          <ul className="space-y-2">
            {[...testerAlerts].reverse().map((a) => (
              <li key={a.index} className={`rounded border p-3 text-xs ${OUTCOME_STYLE[a.outcome]}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold">{OUTCOME_LABEL[a.outcome]}</span>
                  <span className="text-[10px] opacity-70">
                    seq {a.body?.sequence} · {a.body ? severityLabel(a.body.severity) : '—'}
                  </span>
                </div>
                {a.demoLabel && <p className="mt-1 opacity-80">{a.demoLabel}</p>}
                <div className="mt-2 flex gap-3">
                  <button
                    onClick={() => setExpanded(expanded === a.index ? null : a.index)}
                    className="text-[10px] underline opacity-70 hover:opacity-100"
                  >
                    {expanded === a.index ? 'hide bytes' : 'show bytes'}
                  </button>
                  <button
                    onClick={() => sim.replayExact(a.index)}
                    className="text-[10px] underline opacity-70 hover:opacity-100"
                  >
                    rebroadcast these exact bytes
                  </button>
                </div>
                {expanded === a.index && (
                  <p className="mt-2 break-all font-mono text-[10px] opacity-70">
                    {sim.bundle?.alerts[a.index]?.packetHex}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <button
          onClick={() => setShowFullLog((v) => !v)}
          className="text-xs text-ink-3 underline hover:text-ink-2"
        >
          {showFullLog ? 'Hide' : 'Show'} full verification log — every packet, including the captured demo run (
          {(sim.evaluated ?? []).length})
        </button>
        {showFullLog && (
          <ul className="mt-2 space-y-1">
            {(sim.evaluated ?? []).map((a) => (
              <li
                key={a.index}
                className={`rounded border p-2 text-xs ${
                  a.outcome === 'accepted' ? 'border-success bg-success-bg' : 'border-border bg-surface'
                }`}
              >
                <span className="font-mono">{OUTCOME_LABEL[a.outcome]}</span>
                {a.body && (
                  <span className="text-ink-2">
                    {' '}
                    — {severityLabel(a.body.severity)}, puroks bitmap {a.body.purokBitmap.toString(2).padStart(8, '0')}
                  </span>
                )}
                {a.demoLabel && <span className="text-ink-3"> ({a.demoLabel})</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[10px] leading-relaxed text-ink-3">
        Issuer key for this browser: <code className="break-all">{sim.testerPublicKey}</code> (index{' '}
        {TESTER_ISSUER_INDEX}, generated locally, holds no funds).
      </p>

      <LiveMeshPanel />
    </div>
  )
}

function BroadcastButton({
  onClick,
  className,
  title,
  subtitle,
}: {
  onClick: () => void
  className: string
  title: string
  subtitle: string
}) {
  return (
    <button onClick={onClick} className={`rounded border p-3 text-left transition-colors ${className}`}>
      <span className="block text-sm font-semibold text-ink">{title}</span>
      <span className="mt-0.5 block text-[11px] text-ink-2">{subtitle}</span>
    </button>
  )
}

const TIER_FILL: Record<number, string> = {
  0: 'var(--color-info)',
  1: 'var(--color-accent)',
  2: 'var(--color-accent-deep)',
  3: 'var(--color-danger)',
}

/**
 * A picture of the thing the slider is standing in for. The controls below
 * are abstract (a slider, a number) -- this ties them back to "there is a
 * sensor mounted over a river, and this is what it would be seeing," so the
 * simulator reads as a stand-in for hardware rather than an unexplained
 * dashboard.
 */
function SensorVisual({ tier, levelCm }: { tier: number; levelCm: number }) {
  const GROUND_Y = 66
  const TOP_Y = 8
  const usable = GROUND_Y - TOP_Y
  const levelY = GROUND_Y - Math.min(1, levelCm / RIVER_MAX_CM) * usable
  const fill = TIER_FILL[tier] ?? TIER_FILL[0]

  const thresholds = [
    { label: 'T1', cm: TIER_1_CM },
    { label: 'T2', cm: TIER_2_CM },
    { label: 'T3', cm: TIER_3_CM },
  ].map((t) => ({ ...t, y: GROUND_Y - Math.min(1, t.cm / RIVER_MAX_CM) * usable }))

  return (
    <svg viewBox="0 0 300 72" className="mb-2 w-full rounded bg-bg-alt/50" aria-hidden="true">
      <rect x={0} y={levelY} width={300} height={GROUND_Y - levelY} fill={fill} fillOpacity={0.3} />
      <line x1={0} y1={levelY} x2={300} y2={levelY} stroke={fill} strokeWidth={2} />
      <line x1={0} y1={GROUND_Y} x2={300} y2={GROUND_Y} stroke="var(--color-border)" strokeWidth={1} />

      {thresholds.map((t) => (
        <g key={t.label}>
          <line x1={0} y1={t.y} x2={300} y2={t.y} stroke="var(--color-ink-3)" strokeOpacity={0.4} strokeWidth={1} strokeDasharray="3 3" />
          <text x={4} y={t.y - 2} fill="var(--color-ink-3)" fontSize={8}>
            {t.label}
          </text>
        </g>
      ))}

      <line x1={272} y1={18} x2={272} y2={GROUND_Y} stroke="var(--color-ink-3)" strokeWidth={2} />
      <rect x={260} y={2} width={24} height={16} rx={3} fill="var(--color-surface)" stroke={fill} strokeWidth={2} />
      <circle cx={272} cy={10} r={3} fill={fill} />
    </svg>
  )
}

function TierBadge({ tier, levelCm }: { tier: number; levelCm: number }) {
  const style =
    tier === 0
      ? 'bg-bg-alt text-ink-2'
      : tier === 1
        ? 'bg-accent-bg text-accent-deep'
        : tier === 2
          ? 'bg-accent text-ink'
          : 'bg-danger text-white'
  return (
    <span className={`rounded px-2 py-1 text-xs font-semibold ${style}`}>
      {levelCm} cm · {tier === 0 ? 'below threshold' : `tier ${tier}`}
    </span>
  )
}

/**
 * What happened to the most recent broadcast, stage by stage. The radio hop
 * is drawn dimmed on purpose: there is no mesh in this browser, and PRD
 * Section 11 asks that the distinction be stated rather than implied.
 */
function Pipeline({ latest }: { latest: EvaluatedAlert }) {
  const signatureOk = latest.outcome !== 'rejected_signature' && latest.outcome !== 'rejected_unknown_issuer'
  const replayOk = latest.outcome === 'accepted'

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink">What happened to that packet</h3>
      <ol className="space-y-2 text-xs">
        <Stage state="pass" label="Sensor built and signed the packet" detail="real Ed25519, 84 bytes on the wire" />
        <Stage
          state="skipped"
          label="Relay hop across the LoRa mesh"
          detail="not simulated in the browser — packages/mesh-sim proves this against a real Meshtasticator run"
        />
        <Stage
          state={signatureOk ? 'pass' : 'fail'}
          label="Signature check against the cached issuer list"
          detail={signatureOk ? 'signature matches an authorised issuer' : 'signature does not match — dropped here'}
        />
        <Stage
          state={!signatureOk ? 'skipped' : replayOk ? 'pass' : 'fail'}
          label="Replay + duplicate guard"
          detail={
            !signatureOk
              ? 'never reached — the packet was already dropped'
              : replayOk
                ? 'sequence is newer than anything seen from this issuer'
                : latest.outcome === 'duplicate'
                  ? 'this exact packet was already seen — normal mesh rebroadcast, not an attack'
                  : 'sequence is not newer than one already accepted — dropped'
          }
        />
        <Stage
          state={replayOk ? 'pass' : 'fail'}
          label="Shown to residents in the affected puroks"
          detail={replayOk ? 'siren fires, instruction appears in the resident view' : 'nothing shown, nothing fired'}
        />
      </ol>
    </section>
  )
}

function Stage({ state, label, detail }: { state: 'pass' | 'fail' | 'skipped'; label: string; detail: string }) {
  const mark = state === 'pass' ? '✓' : state === 'fail' ? '✕' : '–'
  const color = state === 'pass' ? 'text-success' : state === 'fail' ? 'text-danger' : 'text-ink-3'
  return (
    <li className="flex gap-3">
      <span className={`font-mono font-bold ${color}`}>{mark}</span>
      <span>
        <span className={state === 'skipped' ? 'text-ink-3' : 'text-ink'}>{label}</span>
        <span className="block text-[11px] text-ink-3">{detail}</span>
      </span>
    </li>
  )
}
