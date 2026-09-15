import { useEffect, useRef, useState } from 'react'
import type { AlertBundle } from '@ligtas/core'
import { evaluateBundle } from '../lib/evaluateBundle'
import { HUB_URL } from '../lib/hubUrl'

const POLL_MS = 1500

type ScriptKey = 'bridge' | 'relay-proof'
type TerminalStatus = 'passed' | 'failed' | 'error'
type JobStatus = 'running' | TerminalStatus

interface Capabilities {
  available: boolean
  reasons: string[]
}

interface RelayProofSummary {
  kind: 'relay-proof'
  checks: { name: string; passed: boolean }[]
  passed: number
  total: number
}

interface BridgeSummary {
  kind: 'bridge'
  bundle: AlertBundle
}

type JobSummary = RelayProofSummary | BridgeSummary

interface StatusResponse {
  status: JobStatus
  newLines: string[]
  nextIndex: number
  summary?: JobSummary
  error?: string
}

interface JobState {
  script: ScriptKey
  status: JobStatus
  lines: string[]
  summary?: JobSummary
  error?: string
}

const SCRIPT_LABEL: Record<ScriptKey, string> = {
  bridge: 'Run bridge_to_hub.py',
  'relay-proof': 'Run run_relay_test.py',
}

/**
 * The click-driven alternative to running packages/mesh-sim's scripts from
 * a terminal (docs/ONBOARDING.md Section 4.3). Talks to the hub's own
 * /demo/mesh-test/* routes, which only exist when a real local hub has
 * LIGTAS_ENABLE_MESH_ORCHESTRATION set -- on the hosted/Vercel build there
 * is no hub to reach at all, so this renders nothing rather than a broken
 * button (see the capabilities fetch below).
 */
export function LiveMeshPanel() {
  const [caps, setCaps] = useState<Capabilities | 'unreachable' | null>(null)
  const [job, setJob] = useState<JobState | null>(null)
  const pollHandle = useRef<number | null>(null)
  const afterRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    fetch(`${HUB_URL}/demo/mesh-test/capabilities`)
      .then((r) => (r.ok ? (r.json() as Promise<Capabilities>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!cancelled) setCaps(data)
      })
      .catch(() => {
        if (!cancelled) setCaps('unreachable')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(
    () => () => {
      if (pollHandle.current !== null) window.clearInterval(pollHandle.current)
    },
    [],
  )

  function stopPolling() {
    if (pollHandle.current !== null) {
      window.clearInterval(pollHandle.current)
      pollHandle.current = null
    }
  }

  function run(script: ScriptKey) {
    stopPolling()
    afterRef.current = 0
    setJob({ script, status: 'running', lines: [] })

    fetch(`${HUB_URL}/demo/mesh-test/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script }),
    })
      .then((r) => r.json() as Promise<{ jobId?: string; error?: string }>)
      .then((data) => {
        if (!data.jobId) {
          setJob({ script, status: 'error', lines: [], error: data.error ?? 'failed to start' })
          return
        }
        const jobId = data.jobId
        pollHandle.current = window.setInterval(() => poll(jobId), POLL_MS)
      })
      .catch((err: unknown) => {
        setJob({ script, status: 'error', lines: [], error: String(err) })
      })
  }

  function poll(jobId: string) {
    fetch(`${HUB_URL}/demo/mesh-test/${jobId}/status?after=${afterRef.current}`)
      .then((r) => r.json() as Promise<StatusResponse | { error: string }>)
      .then((data) => {
        // Not 'error' in data -- a real StatusResponse also carries an
        // optional `error` field (the job's own failure message), so that
        // key alone can't tell "unknown job id" apart from "status update
        // for a job that happened to fail". Only a real StatusResponse has
        // `status` at all.
        if (!('status' in data)) {
          stopPolling()
          setJob((prev) => (prev ? { ...prev, status: 'error', error: data.error } : prev))
          return
        }
        afterRef.current = data.nextIndex
        setJob((prev) => (prev ? { ...prev, status: data.status, lines: [...prev.lines, ...data.newLines], summary: data.summary, error: data.error } : prev))
        if (data.status !== 'running') stopPolling()
      })
      .catch(() => {
        // Transient poll failure -- the next tick retries; nothing new to show yet.
      })
  }

  if (caps === null || caps === 'unreachable') return null

  const running = job?.status === 'running'

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="mb-1 text-sm font-semibold text-slate-200">Live mesh demo</h3>
      <p className="mb-3 text-xs text-slate-500">
        Runs the real Docker-simulated LoRa mesh via <code className="text-slate-400">packages/mesh-sim</code>, not
        signed in this browser like the broadcasts above.
      </p>

      {!caps.available ? (
        <ul className="space-y-1 text-xs text-amber-300">
          {caps.reasons.map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => run('bridge')}
              disabled={running}
              className="rounded border border-emerald-700 bg-emerald-900/40 p-3 text-left text-sm font-semibold text-slate-100 hover:bg-emerald-900/70 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {SCRIPT_LABEL.bridge}
              <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
                Real mesh, real hub, real accepted/forged/replayed alerts
              </span>
            </button>
            <button
              type="button"
              onClick={() => run('relay-proof')}
              disabled={running}
              className="rounded border border-sky-700 bg-sky-900/40 p-3 text-left text-sm font-semibold text-slate-100 hover:bg-sky-900/70 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {SCRIPT_LABEL['relay-proof']}
              <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
                Multi-hop delivery, a relay killed mid-run, forged/replay rejection
              </span>
            </button>
          </div>

          {job && (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-slate-400">
                {SCRIPT_LABEL[job.script]} — <span className="font-mono">{job.status}</span>
              </p>
              {job.lines.length > 0 && (
                <pre className="max-h-56 overflow-auto rounded bg-slate-950 p-2 text-[10px] text-slate-400">
                  {job.lines.join('\n')}
                </pre>
              )}
              {job.error && <p className="text-xs text-red-400">{job.error}</p>}
              {job.summary?.kind === 'relay-proof' && <RelayProofResult summary={job.summary} />}
              {job.summary?.kind === 'bridge' && <BridgeResult bundle={job.summary.bundle} />}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function RelayProofResult({ summary }: { summary: RelayProofSummary }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-slate-300">
        {summary.passed}/{summary.total} checks passed
      </p>
      <ul className="space-y-1 text-xs">
        {summary.checks.map((c) => (
          <li key={c.name} className={c.passed ? 'text-emerald-400' : 'text-red-400'}>
            {c.passed ? '✓' : '✕'} {c.name}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The real mesh-produced packets get re-verified with the same
 * decode/verify path (evaluateBundle) the Resident tab and the static
 * captured bundle already use -- the hub's own accept/reject report isn't
 * just trusted at face value here either.
 */
function BridgeResult({ bundle }: { bundle: AlertBundle }) {
  const evaluated = evaluateBundle(bundle)
  return (
    <ul className="space-y-1 text-xs">
      {evaluated.map((a) => (
        <li key={a.index} className="text-slate-300">
          <span className="font-mono">{a.outcome}</span> — {a.demoLabel ?? `seq ${a.body?.sequence ?? '?'}`}
        </li>
      ))}
    </ul>
  )
}
