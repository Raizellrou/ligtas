import { useState, type FormEvent } from 'react'
import type { UseHouseholdCheckin } from '../lib/useHouseholdCheckin'

const STATUS_LABEL: Record<'safe' | 'need_help', string> = {
  safe: 'Safe',
  need_help: 'Need help',
}

// Icon-plus-text, not text alone -- a color/shape a viewer can recognize
// at a glance beats reading "Safe" vs "Need help" every row, especially for
// anyone who reads slowly or not in this language at all.
function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7.5 12.5l3 3 6-6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function HelpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3L2 20h20L12 3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <line x1="12" y1="10" x2="12" y2="14.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </svg>
  )
}

export function HouseholdCheckin(props: UseHouseholdCheckin) {
  if (!props.joined) return <JoinHouseholdForm join={props.join} />
  return <StatusPanel {...props} />
}

function JoinHouseholdForm({ join }: { join: UseHouseholdCheckin['join'] }) {
  const [joinCode, setJoinCode] = useState('')
  const [name, setName] = useState('')
  const [status, setStatus] = useState<'idle' | 'joining' | 'not_found' | 'unreachable'>('idle')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('joining')
    const result = await join(joinCode.trim().toUpperCase(), name.trim())
    if (result !== 'ok') setStatus(result)
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-2 text-sm font-semibold text-ink">Join your household</h3>
      <p className="mb-3 text-xs text-ink-2">
        Ask whoever registered your household for its join code, so everyone can see each other's safety status.
      </p>
      <div className="mb-2 flex gap-2">
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          placeholder="e.g. BLU-482"
          className="w-28 rounded border border-border bg-bg-alt px-2 py-1.5 text-sm uppercase text-ink placeholder:normal-case placeholder:text-ink-3"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name (e.g. Dad)"
          className="flex-1 rounded border border-border bg-bg-alt px-2 py-1.5 text-sm text-ink placeholder:text-ink-3"
        />
      </div>
      <button
        type="submit"
        disabled={!joinCode.trim() || !name.trim() || status === 'joining'}
        className="w-full rounded bg-accent py-1.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-40"
      >
        {status === 'joining' ? 'Joining…' : 'Join'}
      </button>
      {status === 'not_found' && <p className="mt-2 text-xs text-danger">That join code wasn't recognized.</p>}
      {status === 'unreachable' && (
        <p className="mt-2 text-xs text-accent-deep">Can't reach the hub right now — try again once connected.</p>
      )}
    </form>
  )
}

function StatusPanel({ householdId, displayName, roster, pendingCount, submit, leave }: UseHouseholdCheckin) {
  return (
    <div className="mb-6 rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Household check-in</h3>
        <button onClick={leave} className="text-xs text-ink-2 underline">
          {householdId} · leave
        </button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => submit('safe')}
          className="flex items-center justify-center gap-1.5 rounded border border-success bg-success-bg py-2 text-sm font-semibold text-success hover:bg-success-bg/70"
        >
          <CheckIcon />
          I'm safe
        </button>
        <button
          type="button"
          onClick={() => submit('need_help')}
          className="flex items-center justify-center gap-1.5 rounded border border-danger bg-danger-bg py-2 text-sm font-semibold text-danger-deep hover:bg-danger-bg/70"
        >
          <HelpIcon />
          I need help
        </button>
      </div>

      {pendingCount > 0 && (
        <p className="mb-3 text-xs text-info">
          {pendingCount} check-in{pendingCount === 1 ? '' : 's'} pending sync…
        </p>
      )}

      {roster === null ? (
        <p className="text-xs text-ink-3">Loading household status…</p>
      ) : roster.length === 0 ? (
        <p className="text-xs text-ink-3">No one in your household has checked in yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {roster.map((m) => (
            <li key={m.displayName} className="flex items-center justify-between">
              <span className={m.displayName === displayName ? 'font-semibold text-ink' : 'text-ink-2'}>
                {m.displayName}
              </span>
              <span className={`flex items-center gap-1 ${m.status === 'safe' ? 'text-success' : 'text-danger'}`}>
                {m.status === 'safe' ? <CheckIcon /> : <HelpIcon />}
                {STATUS_LABEL[m.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
