import { useState } from 'react'
import { useSimulation } from './lib/useSimulation'
import { useHouseholdCheckin } from './lib/useHouseholdCheckin'
import { activeEvacuation } from './lib/activeEvacuation'
import { sinceLabel } from './lib/freshness'
import { useLiveLocation } from './lib/useLiveLocation'
import { useNow } from './lib/useNow'
import { useOnline } from './lib/useOnline'
import { readDismissedAlert } from './useDismissedAlert'
import { readPersistedPurok } from './usePersistedPurok'
import { ResidentView } from './views/ResidentView'
import { TesterView } from './views/TesterView'
import { HowItWorksView } from './views/HowItWorksView'
import { SplashScreen } from './views/SplashScreen'

type Role = 'resident' | 'tester' | 'how'

const ROLE_STORAGE_KEY = 'ligtas.role'

// Resident and How-it-works are real, peer-level surfaces of the product.
// Simulator is not a third one -- it's a stand-in for hardware that doesn't
// physically exist in this project, kept separate below so it doesn't read
// as an equal option a real user would pick.
const PRIMARY_ROLES: { id: Role; label: string }[] = [
  { id: 'resident', label: 'Resident' },
  { id: 'how', label: 'How it works' },
]

function App() {
  const [role, setRoleState] = useState<Role>(() => {
    const stored = localStorage.getItem(ROLE_STORAGE_KEY)
    return stored === 'tester' || stored === 'how' ? stored : 'resident'
  })
  const [showSplash, setShowSplash] = useState(true)
  const sim = useSimulation()
  const checkin = useHouseholdCheckin()
  // Lives here, not in a view: a running walk simulation must survive the
  // resident switching to the Tester tab to raise the river.
  const liveLocation = useLiveLocation()
  const now = useNow()
  // Out of touch if the page could not load fresh alerts OR the browser has
  // since lost its network -- sim.offline alone only reflects the moment of load.
  const online = useOnline()
  const offline = sim.offline || !online

  function setRole(next: Role) {
    localStorage.setItem(ROLE_STORAGE_KEY, next)
    setRoleState(next)
  }

  // An evacuation must never wait behind the splash, or behind whichever tab
  // the resident happened to leave the app on. Both are settled here, while
  // rendering, so there is no frame of the wrong screen. The role is switched
  // for this session only (not persisted): the resident's saved tab comes back
  // next time. The simulator tab is left alone -- a tester sending a Tier 3
  // should not be pulled off their own controls.
  const evacuation = activeEvacuation(sim.evaluated, readPersistedPurok(), readDismissedAlert())
  if (evacuation !== null && showSplash) setShowSplash(false)
  if (evacuation !== null && role === 'how') setRoleState('resident')

  if (showSplash) return <SplashScreen onContinue={() => setShowSplash(false)} />

  return (
    <div className="min-h-screen bg-bg text-ink">
      <div className="mx-auto max-w-2xl p-4">
        <header className="mb-4">
          <div className="mb-3 flex items-baseline justify-between">
            <div className="flex items-center gap-2">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="4.5" stroke="var(--color-accent)" strokeWidth="1.8" />
                <g stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="12" y1="1.5" x2="12" y2="4.5" />
                  <line x1="12" y1="19.5" x2="12" y2="22.5" />
                  <line x1="1.5" y1="12" x2="4.5" y2="12" />
                  <line x1="19.5" y1="12" x2="22.5" y2="12" />
                  <line x1="4.4" y1="4.4" x2="6.5" y2="6.5" />
                  <line x1="17.5" y1="17.5" x2="19.6" y2="19.6" />
                  <line x1="4.4" y1="19.6" x2="6.5" y2="17.5" />
                  <line x1="17.5" y1="6.5" x2="19.6" y2="4.4" />
                </g>
              </svg>
              <h1 className="font-display text-xl font-bold">Ligtas</h1>
            </div>
            <span className="text-xs uppercase tracking-wide text-ink-3">Testnet demo</span>
          </div>
          <nav className="flex gap-1 rounded-lg bg-surface border border-border p-1" aria-label="Role">
            {PRIMARY_ROLES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRole(r.id)}
                aria-current={role === r.id}
                className={`flex-1 rounded px-3 py-2 text-sm font-medium transition-colors ${
                  role === r.id ? 'bg-accent text-ink' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {r.label}
              </button>
            ))}
          </nav>
        </header>

        {sim.error && <p className="mb-4 text-sm text-danger">Failed to load alerts: {sim.error}</p>}

        {offline && role !== 'how' && (
          <p className="mb-4 rounded border border-info bg-info-bg p-2 text-xs text-info">
            Offline — showing the last alerts this device received
            {sim.checkedAt !== null && <> (checked {sinceLabel(sim.checkedAt, now)})</>}.
          </p>
        )}

        {sim.bundle?.source === 'captured' && role !== 'how' && (
          <p className="mb-4 rounded border border-accent bg-accent-bg p-2 text-xs text-accent-deep">
            Demo data, not a live hub. {sim.bundle.captureNote}
          </p>
        )}

        {checkin.pendingCount > 0 && role !== 'how' && (
          <p className="mb-4 rounded border border-info bg-info-bg p-2 text-xs text-info">
            {checkin.pendingCount} check-in{checkin.pendingCount === 1 ? '' : 's'} pending sync.
          </p>
        )}

        {role === 'resident' && (
          <ResidentView
            alerts={sim.evaluated}
            historicalCount={sim.historicalCount}
            checkin={checkin}
            liveLocation={liveLocation}
            offline={offline}
            checkedAt={sim.checkedAt}
            liveFeed={sim.bundle?.source === 'live'}
          />
        )}
        {role === 'tester' && <TesterView sim={sim} liveLocation={liveLocation} />}
        {role === 'how' && <HowItWorksView />}

        <div className="mt-10 border-t border-border pt-3 text-center">
          <button
            onClick={() => setRole('tester')}
            className={`text-xs underline ${role === 'tester' ? 'font-semibold text-ink-2' : 'text-ink-3 hover:text-ink-2'}`}
          >
            {role === 'tester' ? 'Viewing the simulator' : 'Open the simulator (stands in for the sensor hardware)'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
