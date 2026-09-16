import { useState } from 'react'
import { latestRelevantAlert, type EvaluatedAlert } from '../lib/evaluateBundle'
import { instructionFor, severityLabel } from '../lib/instructions'
import { usePersistedPurok } from '../usePersistedPurok'
import type { UseHouseholdCheckin } from '../lib/useHouseholdCheckin'
import { HouseholdCheckin } from './HouseholdCheckin'
import { EvacuationMap } from './EvacuationMap'

const OUTCOME_LABEL: Record<EvaluatedAlert['outcome'], string> = {
  accepted: 'Verified',
  rejected_signature: 'Rejected — bad signature',
  rejected_unknown_issuer: 'Rejected — unknown issuer',
  rejected_replay: 'Rejected — replay',
  duplicate: 'Duplicate (already seen)',
}

export function ResidentView({
  alerts,
  checkin,
  offline,
}: {
  alerts: EvaluatedAlert[] | null
  checkin: UseHouseholdCheckin
  offline: boolean
}) {
  const { purok, setPurok, clearPurok } = usePersistedPurok()

  if (purok === null) return <PurokPicker onSelect={setPurok} />

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">Resident</h2>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-ink-2">
            <span className={`h-1.5 w-1.5 rounded-full ${offline ? 'bg-ink-3' : 'bg-info'}`} />
            Purok {purok} · {offline ? 'offline' : 'online'}
          </span>
          <button onClick={clearPurok} className="text-sm text-ink-2 underline">
            change
          </button>
        </div>
      </div>

      <HouseholdCheckin {...checkin} />

      <EvacuationMap purok={purok} alerts={alerts} />

      {alerts === null ? (
        <p className="text-ink-2">Loading alerts…</p>
      ) : (
        <AlertList alerts={alerts} purok={purok} />
      )}
    </>
  )
}

function PurokPicker({ onSelect }: { onSelect: (p: number) => void }) {
  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="mx-auto max-w-sm">
      <p className="mb-4 text-xs text-ink-3">
        Flood alerts from your barangay, verified and delivered even without internet.
      </p>

      <p className="mb-1 text-sm font-semibold text-ink">Select your purok</p>
      <p className="mb-4 text-xs text-ink-3">Piliin ang inyong purok</p>

      <div className="mb-4 grid grid-cols-6 gap-2">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((p) => (
          <button
            key={p}
            onClick={() => setSelected(p)}
            className={`relative aspect-square rounded-lg border font-semibold ${
              selected === p
                ? 'border-accent bg-accent text-white'
                : 'border-border bg-surface text-ink hover:bg-bg-alt'
            }`}
          >
            {p}
            {selected === p && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="absolute right-1 top-1">
                <circle cx="12" cy="12" r="11" fill="white" />
                <path d="M7 12.5l3 3 7-7" stroke="var(--color-accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-1.5">
        <span className="flex items-center gap-2 text-xs text-ink-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0">
            <path d="M2 8.5C7 4 17 4 22 8.5M5.5 12C9 9 15 9 18.5 12M9 15.5C10.5 14.2 13.5 14.2 15 15.5" stroke="var(--color-info)" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="19" r="1.3" fill="var(--color-info)" />
          </svg>
          Works even without internet
        </span>
        <span className="flex items-center gap-2 text-xs text-ink-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0">
            <path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6l7-3z" stroke="var(--color-info)" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M8.5 12l2.3 2.3L16 9.5" stroke="var(--color-info)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Every alert is signed by your barangay
        </span>
      </div>

      <button
        onClick={() => selected !== null && onSelect(selected)}
        disabled={selected === null}
        className="w-full rounded-lg bg-accent py-3 text-sm font-semibold text-white hover:bg-accent-deep disabled:cursor-not-allowed disabled:bg-bg-alt disabled:text-ink-3"
      >
        {selected === null ? 'Select a purok to continue' : `Continue as Purok ${selected}`}
      </button>
      <p className="mt-2 text-center text-xs text-ink-3">You can change this anytime</p>
    </div>
  )
}

function AlertList({ alerts, purok }: { alerts: EvaluatedAlert[]; purok: number }) {
  const [showLog, setShowLog] = useState(false)
  const accepted = alerts.filter((a) => a.outcome === 'accepted' && a.body)
  const latest = latestRelevantAlert(alerts, purok)

  return (
    <>
      {latest ? (
        <InstructionCard alert={latest} />
      ) : accepted.length > 0 ? (
        <div className="mb-6 rounded border border-border bg-surface p-4">
          <p className="text-ink-2">Your purok is not affected by any current alert.</p>
        </div>
      ) : (
        <div className="mb-6 rounded border border-border bg-surface p-4">
          <p className="text-ink-2">No alerts.</p>
        </div>
      )}

      <button onClick={() => setShowLog((v) => !v)} className="mb-2 text-xs text-ink-3 underline hover:text-ink-2">
        {showLog ? 'Hide' : 'Show'} verification details ({alerts.length})
      </button>

      {showLog && (
        <ul className="space-y-1">
          {alerts.map((a) => (
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
    </>
  )
}

function InstructionCard({ alert }: { alert: EvaluatedAlert }) {
  const body = alert.body!
  return (
    <div className="mb-6 rounded-lg border border-danger bg-danger-bg p-4">
      <p className="mb-1 text-xs uppercase tracking-wide text-danger-deep">{severityLabel(body.severity)} alert</p>
      <p className="font-display text-lg font-semibold text-ink">{instructionFor(body)}</p>
    </div>
  )
}
