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
    <form onSubmit={handleSubmit} className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-200">Join your household</h3>
      <p className="mb-3 text-xs text-slate-400">
        Ask whoever registered your household for its join code, so everyone can see each other's safety status.
      </p>
      <div className="mb-2 flex gap-2">
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          placeholder="e.g. BLU-482"
          className="w-28 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm uppercase text-slate-100 placeholder:normal-case placeholder:text-slate-500"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name (e.g. Dad)"
          className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500"
        />
      </div>
      <button
        type="submit"
        disabled={!joinCode.trim() || !name.trim() || status === 'joining'}
        className="w-full rounded bg-emerald-700 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {status === 'joining' ? 'Joining…' : 'Join'}
      </button>
      {status === 'not_found' && <p className="mt-2 text-xs text-red-400">That join code wasn't recognized.</p>}
      {status === 'unreachable' && (
        <p className="mt-2 text-xs text-amber-300">Can't reach the hub right now — try again once connected.</p>
      )}
    </form>
  )
}

function StatusPanel({ householdId, displayName, roster, pendingCount, submit, leave }: UseHouseholdCheckin) {
  return (
    <div className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Household check-in</h3>
        <button onClick={leave} className="text-xs text-slate-400 underline">
          {householdId} · leave
        </button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => submit('safe')}
          className="rounded border border-emerald-700 bg-emerald-900/40 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/70"
        >
          I'm safe
        </button>
        <button
          type="button"
          onClick={() => submit('need_help')}
          className="rounded border border-red-700 bg-red-900/40 py-2 text-sm font-semibold text-red-200 hover:bg-red-900/70"
        >
          I need help
        </button>
      </div>

      {pendingCount > 0 && (
        <p className="mb-3 text-xs text-sky-300">
          {pendingCount} check-in{pendingCount === 1 ? '' : 's'} pending sync…
        </p>
      )}

      {roster === null ? (
        <p className="text-xs text-slate-500">Loading household status…</p>
      ) : roster.length === 0 ? (
        <p className="text-xs text-slate-500">No one in your household has checked in yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {roster.map((m) => (
            <li key={m.displayName} className="flex items-center justify-between">
              <span className={m.displayName === displayName ? 'font-semibold text-slate-100' : 'text-slate-300'}>
                {m.displayName}
              </span>
              <span className={m.status === 'safe' ? 'text-emerald-400' : 'text-red-400'}>
                {STATUS_LABEL[m.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
