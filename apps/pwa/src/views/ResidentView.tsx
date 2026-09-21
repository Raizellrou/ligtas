import { useState, type FormEvent } from 'react'
import { latestRelevantAlert, type EvaluatedAlert } from '../lib/evaluateBundle'
import { alertLevel, instructionFor, severityLabel } from '../lib/instructions'
import { useEvacuationRoute } from '../lib/useEvacuationRoute'
import type { LiveLocation, LivePosition } from '../lib/useLiveLocation'
import { usePersistedPurok } from '../usePersistedPurok'
import { useDismissedAlert } from '../useDismissedAlert'
import { useJoinSkipped } from '../useJoinSkipped'
import type { UseHouseholdCheckin } from '../lib/useHouseholdCheckin'
import { useReliefBalance } from '../lib/useReliefBalance'
import { HouseholdCheckin } from './HouseholdCheckin'
import { EvacuationMap } from './EvacuationMap'
import { EmergencyNotice } from './EmergencyNotice'

// Mirrors packages/hub/config/households.json's seed data -- one test join
// code per purok, so onboarding can offer a dropdown instead of asking
// residents to type a code from memory. Demo/testing convenience only; a
// real deployment would still have residents get their code from whoever
// registered their household, same as JoinHouseholdForm always required.
const JOIN_CODE_OPTIONS: { purok: number; code: string }[] = [
  { purok: 1, code: 'ORG-529' },
  { purok: 2, code: 'YLW-777' },
  { purok: 3, code: 'BLU-482' },
  { purok: 4, code: 'AMB-207' },
  { purok: 5, code: 'PRP-419' },
  { purok: 6, code: 'TEA-874' },
  { purok: 7, code: 'CRM-520' },
  { purok: 8, code: 'SLV-126' },
  { purok: 9, code: 'GLD-638' },
  { purok: 10, code: 'MRN-605' },
  { purok: 11, code: 'CYN-801' },
  { purok: 12, code: 'RSE-577' },
]

export function ResidentView({
  alerts,
  capturedCount,
  checkin,
  liveLocation,
  offline,
}: {
  alerts: EvaluatedAlert[] | null
  capturedCount: number
  checkin: UseHouseholdCheckin
  liveLocation: LiveLocation
  offline: boolean
}) {
  const { purok, setPurok, clearPurok } = usePersistedPurok()
  // Relief only ever shows once this purok actually has a live alert
  // against it -- a household's address can hold an old/unrelated
  // claimable balance (e.g. from a past drill), and showing that here
  // would read as "you got relief" for an event that isn't happening.
  const relief = useReliefBalance(checkin.stellarAddress)
  const { dismissed, dismiss } = useDismissedAlert()
  const { skipped, skip, unskip } = useJoinSkipped()
  // The resident tapped "Join household" from the home screen after skipping.
  const [joining, setJoining] = useState(false)

  if (purok === null) return <PurokPicker onSelect={setPurok} />

  // The evacuation takeover only needs the purok -- deliberately checked
  // before the household-join gate below. Joining needs the hub, and an
  // evacuation alert must not be hidden from a resident who can't reach it.
  // Only Tier 3 interrupts the screen; lower tiers are a card on the home
  // screen (see alertLevel). The newest accepted alert wins, so a later
  // lower-tier alert reads as de-escalation.
  const latest = alerts !== null ? latestRelevantAlert(alerts, purok) : undefined
  const latestKey = latest === undefined ? null : (latest.alertHashHex ?? String(latest.index))
  if (latest?.body && latestKey !== null && latestKey !== dismissed && alertLevel(latest.body.severity) === 'evacuate') {
    return (
      <EmergencyNotice
        body={latest.body}
        purok={purok}
        checkin={checkin}
        position={liveLocation.position}
        onContinue={() => {
          dismiss(latestKey)
          // "Show my route" must lead to the route. An unjoined resident
          // would otherwise land on the join form, mid-evacuation.
          if (!checkin.joined) skip()
        }}
      />
    )
  }

  // Joining is offered, never required: it needs the hub, while the alert
  // card and the evacuation map below work without it.
  if (!checkin.joined && (!skipped || joining)) {
    return (
      <JoinStep
        purok={purok}
        join={async (code, name) => {
          const result = await checkin.join(code, name)
          if (result === 'ok') {
            unskip()
            setJoining(false)
          }
          return result
        }}
        onSkip={skipped ? undefined : skip}
        onBack={joining ? () => setJoining(false) : clearPurok}
        backLabel={joining ? 'Back' : 'Back to purok selection'}
      />
    )
  }

  // Only alerts actually broadcast live this session count toward relief --
  // the leading captured entries are a historical demo recording (Sep
  // 2026), and a household's real balance from that real past run
  // shouldn't read as "relief happening right now" on a fresh page load.
  const liveAlerts = alerts?.filter((a) => a.index >= capturedCount) ?? null
  const affected = liveAlerts !== null && latestRelevantAlert(liveAlerts, purok) !== undefined
  const showRelief = affected && relief !== null

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">Resident</h2>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-ink-2">
            <span className={`h-1.5 w-1.5 rounded-full ${offline ? 'bg-ink-3' : 'bg-info'}`} />
            Purok {purok} · {offline ? 'offline' : 'online'}
          </span>
          {showRelief ? (
            <a
              href={`https://stellar.expert/explorer/testnet/claimable-balance/${relief!.id}`}
              target="_blank"
              rel="noreferrer"
              title="View proof on Stellar Expert"
              className="flex items-center gap-1.5 rounded-full border border-success bg-success-bg px-3 py-1 text-xs font-medium text-success hover:bg-success-bg/70"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              {relief!.amountXlm} XLM
            </a>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-ink-2">
              <span className="h-1.5 w-1.5 rounded-full bg-ink-3" />0 XLM
            </span>
          )}
          <button onClick={clearPurok} className="text-sm text-ink-2 underline">
            change
          </button>
        </div>
      </div>

      {checkin.joined ? <HouseholdCheckin {...checkin} /> : <JoinPrompt onJoin={() => setJoining(true)} />}

      <EvacuationMap purok={purok} alerts={alerts} liveLocation={liveLocation} />

      {alerts === null ? (
        <p className="text-ink-2">Loading alerts…</p>
      ) : (
        <AlertList alerts={alerts} purok={purok} position={liveLocation.position} />
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

// Shown on the home screen in place of the family check-in card until the
// resident joins. Joining is the only part of the app that needs the hub.
function JoinPrompt({ onJoin }: { onJoin: () => void }) {
  return (
    <div className="mb-6 rounded-lg border border-border bg-surface p-4">
      <p className="mb-1 text-sm font-semibold text-ink">Household check-in</p>
      <p className="mb-3 text-xs text-ink-2">
        Join your household so your family can see you're safe. Needs a connection to the hub; alerts and the map
        work without it.
      </p>
      <button
        onClick={onJoin}
        className="w-full rounded-lg border border-accent py-2.5 text-sm font-semibold text-ink hover:bg-accent-bg"
      >
        Join household
      </button>
    </div>
  )
}

function JoinStep({
  purok,
  join,
  onSkip,
  onBack,
  backLabel,
}: {
  purok: number
  join: UseHouseholdCheckin['join']
  onSkip?: () => void
  onBack: () => void
  backLabel: string
}) {
  const joinCode = JOIN_CODE_OPTIONS.find((o) => o.purok === purok)?.code ?? JOIN_CODE_OPTIONS[0]!.code
  const [name, setName] = useState('')
  const [status, setStatus] = useState<'idle' | 'joining' | 'not_found' | 'unreachable'>('idle')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('joining')
    const result = await join(joinCode, name.trim())
    if (result !== 'ok') setStatus(result)
  }

  return (
    <div className="mx-auto max-w-sm">
      <p className="mb-1 text-sm font-semibold text-ink">Purok {purok} · join your household</p>
      <p className="mb-4 text-xs text-ink-3">Type your name so your family can see your status.</p>

      <form onSubmit={handleSubmit}>
        <label className="mb-1 block text-xs font-medium text-ink-2">Household join code</label>
        <p className="mb-3 rounded border border-border bg-bg-alt px-2 py-1.5 text-sm font-mono text-ink-2">
          {joinCode}
        </p>

        <label className="mb-1 block text-xs font-medium text-ink-2">Your username</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Bob"
          className="mb-3 w-full rounded border border-border bg-bg-alt px-2 py-1.5 text-sm text-ink placeholder:text-ink-3"
        />

        <button
          type="submit"
          disabled={!name.trim() || status === 'joining'}
          className="w-full rounded-lg bg-accent py-3 text-sm font-semibold text-white hover:bg-accent-deep disabled:cursor-not-allowed disabled:bg-bg-alt disabled:text-ink-3"
        >
          {status === 'joining' ? 'Joining…' : 'Continue'}
        </button>
      </form>

      {status === 'not_found' && <p className="mt-2 text-xs text-danger">That join code wasn't recognized.</p>}
      {status === 'unreachable' && (
        <p className="mt-2 text-xs text-accent-deep">Can't reach the hub right now — try again once connected.</p>
      )}

      {onSkip && (
        <>
          <button
            onClick={onSkip}
            className="mt-3 w-full rounded-lg border border-border py-3 text-sm font-semibold text-ink-2 hover:bg-bg-alt"
          >
            Skip for now
          </button>
          <p className="mt-1 text-center text-xs text-ink-3">
            You'll still get alerts and the evacuation map. Join anytime.
          </p>
        </>
      )}

      <button onClick={onBack} className="mt-3 w-full text-center text-xs text-ink-3 underline hover:text-ink-2">
        {backLabel}
      </button>
    </div>
  )
}

function AlertList({ alerts, purok, position }: { alerts: EvaluatedAlert[]; purok: number; position: LivePosition | null }) {
  const accepted = alerts.filter((a) => a.outcome === 'accepted' && a.body)
  const latest = latestRelevantAlert(alerts, purok)

  return latest ? (
    <InstructionCard alert={latest} purok={purok} position={position} />
  ) : accepted.length > 0 ? (
    <div className="mb-6 rounded border border-border bg-surface p-4">
      <p className="text-ink-2">Your purok is not affected by any current alert.</p>
    </div>
  ) : (
    <div className="mb-6 rounded border border-border bg-surface p-4">
      <p className="text-ink-2">No alerts.</p>
    </div>
  )
}

// Tier decides how loud the card is: only an evacuation is red, a "prepare"
// is marigold, and a "watch" is a quiet info note -- so red keeps meaning
// "go now". Tier 3 names the same nearest center the map and the takeover do.
function InstructionCard({ alert, purok, position }: { alert: EvaluatedAlert; purok: number; position: LivePosition | null }) {
  const body = alert.body!
  const level = alertLevel(body.severity)
  const route = useEvacuationRoute({ purok, severity: body.severity, position })
  const text = instructionFor(body, level === 'evacuate' ? route.nearest.center.name : undefined)

  if (level === 'watch') {
    return (
      <div className="mb-6 rounded-lg border border-info bg-info-bg p-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">{severityLabel(body.severity)} · Watch</p>
        <p className="text-sm text-ink-2">{text}</p>
      </div>
    )
  }

  const box = level === 'prepare' ? 'border-accent bg-accent-bg' : 'border-danger bg-danger-bg'
  const eyebrow = level === 'prepare' ? 'text-ink-2' : 'text-danger-deep'
  return (
    <div className={`mb-6 rounded-lg border p-4 ${box}`}>
      <p className={`mb-1 text-xs font-semibold uppercase tracking-wide ${eyebrow}`}>{severityLabel(body.severity)} alert</p>
      <p className="font-display text-lg font-semibold text-ink">{text}</p>
    </div>
  )
}
