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
  return (
    <div className="mx-auto max-w-sm">
      <p className="mb-1 text-sm font-semibold text-ink">Select your purok</p>
      <p className="mb-4 text-xs text-ink-3">Piliin ang inyong purok — to see evacuation instructions for your area.</p>
      <div className="grid grid-cols-6 gap-2">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((p) => (
          <button
            key={p}
            onClick={() => onSelect(p)}
            className="aspect-square rounded-lg border border-border bg-surface font-semibold text-ink hover:bg-bg-alt"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

function AlertList({ alerts, purok }: { alerts: EvaluatedAlert[]; purok: number }) {
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

      <h3 className="mb-2 text-sm font-semibold text-ink-2">All alerts (verification log)</h3>
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
