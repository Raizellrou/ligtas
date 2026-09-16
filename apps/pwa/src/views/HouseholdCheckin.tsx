import { useState, type FormEvent } from 'react'
import type { UseHouseholdCheckin } from '../lib/useHouseholdCheckin'

const STATUS_LABEL: Record<'safe' | 'need_help', string> = {
  safe: 'Safe',
  need_help: 'Need help',
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
          className="rounded border border-success bg-success-bg py-2 text-sm font-semibold text-success hover:bg-success-bg/70"
        >
          I'm safe
        </button>
        <button
          type="button"
          onClick={() => submit('need_help')}
          className="rounded border border-danger bg-danger-bg py-2 text-sm font-semibold text-danger-deep hover:bg-danger-bg/70"
        >
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
              <span className={m.status === 'safe' ? 'text-success' : 'text-danger'}>{STATUS_LABEL[m.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
