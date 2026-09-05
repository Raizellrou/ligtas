import { useState } from 'react'
import { useSimulation } from './lib/useSimulation'
import { ResidentView } from './views/ResidentView'
import { TesterView } from './views/TesterView'
import { HowItWorksView } from './views/HowItWorksView'

type Role = 'resident' | 'tester' | 'how'

const ROLE_STORAGE_KEY = 'ligtas.role'

const ROLES: { id: Role; label: string }[] = [
  { id: 'resident', label: 'Resident' },
  { id: 'tester', label: 'Tester' },
  { id: 'how', label: 'How it works' },
]

function App() {
  const [role, setRoleState] = useState<Role>(() => {
    const stored = localStorage.getItem(ROLE_STORAGE_KEY)
    return stored === 'tester' || stored === 'how' ? stored : 'resident'
  })
  const sim = useSimulation()

  function setRole(next: Role) {
    localStorage.setItem(ROLE_STORAGE_KEY, next)
    setRoleState(next)
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-2xl p-4">
        <header className="mb-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h1 className="text-xl font-bold">LIGTAS</h1>
            <span className="text-[10px] uppercase tracking-wide text-slate-500">Testnet demo</span>
          </div>
          <nav className="flex gap-1 rounded-lg bg-slate-900 p-1" aria-label="Role">
            {ROLES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRole(r.id)}
                aria-current={role === r.id}
                className={`flex-1 rounded px-3 py-2 text-sm font-medium transition-colors ${
                  role === r.id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </nav>
        </header>

        {sim.error && <p className="mb-4 text-sm text-red-400">Failed to load alerts: {sim.error}</p>}

        {sim.offline && role !== 'how' && (
          <p className="mb-4 rounded border border-sky-700 bg-sky-900/40 p-2 text-xs text-sky-200">
            Offline — showing the last alerts this device received.
          </p>
        )}

        {sim.bundle?.source === 'captured' && role !== 'how' && (
          <p className="mb-4 rounded border border-amber-700 bg-amber-900/40 p-2 text-xs text-amber-200">
            Demo data, not a live hub. {sim.bundle.captureNote}
          </p>
        )}

        {role === 'resident' && <ResidentView alerts={sim.evaluated} />}
        {role === 'tester' && <TesterView sim={sim} />}
        {role === 'how' && <HowItWorksView />}
      </div>
    </div>
  )
}

export default App
