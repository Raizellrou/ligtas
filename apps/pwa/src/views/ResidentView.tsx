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

export function ResidentView({ alerts, checkin }: { alerts: EvaluatedAlert[] | null; checkin: UseHouseholdCheckin }) {
  const { purok, setPurok, clearPurok } = usePersistedPurok()

  if (purok === null) return <PurokPicker onSelect={setPurok} />

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Resident</h2>
        <button onClick={clearPurok} className="text-sm text-slate-400 underline">
          Purok {purok} · change
        </button>
      </div>

      <HouseholdCheckin {...checkin} />

      <EvacuationMap purok={purok} alerts={alerts} />

      {alerts === null ? (
        <p className="text-slate-400">Loading alerts…</p>
      ) : (
        <AlertList alerts={alerts} purok={purok} />
      )}
    </>
  )
}

function PurokPicker({ onSelect }: { onSelect: (p: number) => void }) {
  return (
    <div className="mx-auto max-w-sm">
      <p className="mb-4 text-sm text-slate-400">
        Select your purok to see evacuation instructions for your area.
      </p>
      <div className="grid grid-cols-6 gap-2">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((p) => (
          <button
            key={p}
            onClick={() => onSelect(p)}
            className="aspect-square rounded bg-slate-800 font-semibold hover:bg-slate-700"
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
        <div className="mb-6 rounded border border-slate-800 bg-slate-900 p-4">
          <p className="text-slate-300">Your purok is not affected by any current alert.</p>
        </div>
      ) : (
        <div className="mb-6 rounded border border-slate-800 bg-slate-900 p-4">
          <p className="text-slate-300">No alerts.</p>
        </div>
      )}

      <h3 className="mb-2 text-sm font-semibold text-slate-400">All alerts (verification log)</h3>
      <ul className="space-y-1">
        {alerts.map((a) => (
          <li
            key={a.index}
            className={`rounded border p-2 text-xs ${
              a.outcome === 'accepted' ? 'border-emerald-800 bg-emerald-950/40' : 'border-slate-800 bg-slate-900'
            }`}
          >
            <span className="font-mono">{OUTCOME_LABEL[a.outcome]}</span>
            {a.body && (
              <span className="text-slate-400">
                {' '}
                — {severityLabel(a.body.severity)}, puroks bitmap {a.body.purokBitmap.toString(2).padStart(8, '0')}
              </span>
            )}
            {a.demoLabel && <span className="text-slate-500"> ({a.demoLabel})</span>}
          </li>
        ))}
      </ul>
    </>
  )
}

function InstructionCard({ alert }: { alert: EvaluatedAlert }) {
  const body = alert.body!
  return (
    <div className="mb-6 rounded-lg border border-red-700 bg-red-900/60 p-4">
      <p className="mb-1 text-xs uppercase tracking-wide text-red-300">{severityLabel(body.severity)} alert</p>
      <p className="text-lg font-semibold">{instructionFor(body)}</p>
    </div>
  )
}
