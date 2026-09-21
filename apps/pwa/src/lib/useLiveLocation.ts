import { useEffect, useRef, useState } from 'react'
import { MAP_META } from './evacuationCenters'
import { unitsToLatLon } from './geo'

export interface LivePosition {
  lat: number
  lon: number
  /** Metres. */
  accuracy: number
}

export type LocationStatus = 'off' | 'locating' | 'active' | 'denied' | 'insecure' | 'unsupported' | 'simulated'

export interface WalkSimulation {
  active: boolean
  paused: boolean
  /** 0 to 1. */
  progress: number
  speed: number
}

export interface LiveLocation {
  status: LocationStatus
  position: LivePosition | null
  /** A non-fatal note while waiting for a fix, e.g. "no GPS fix yet". */
  hint: string | null
  /** Ask for the phone's location. Call from a user tap, never at load. */
  start(): void
  stop(): void
  simulation: WalkSimulation
  simulateWalk(path: [number, number][], speed: number): void
  pauseSimulation(): void
  resumeSimulation(): void
  setSimulationSpeed(speed: number): void
  stopSimulation(): void
}

const OPT_IN_KEY = 'ligtas.locationOptIn'
const WALK_METERS_PER_SECOND = 80 / 60 // the same ~80 m/min pace the walk times use
const TICK_MS = 500
const SIM_ACCURACY_M = 8

interface WalkRun {
  points: [number, number][]
  /** Metres walked at each point. */
  cumulative: number[]
  total: number
}

function buildRun(points: [number, number][]): WalkRun {
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    cumulative.push(cumulative[i - 1] + Math.hypot(bx - ax, by - ay) * MAP_META.projection.mpu)
  }
  return { points, cumulative, total: cumulative[cumulative.length - 1] }
}

function pointAt(run: WalkRun, walked: number): [number, number] {
  if (walked >= run.total) return run.points[run.points.length - 1]
  let i = 1
  while (i < run.cumulative.length - 1 && run.cumulative[i] < walked) i++
  const span = run.cumulative[i] - run.cumulative[i - 1]
  const t = span === 0 ? 0 : (walked - run.cumulative[i - 1]) / span
  const [ax, ay] = run.points[i - 1]
  const [bx, by] = run.points[i]
  return [ax + (bx - ax) * t, ay + (by - ay) * t]
}

/**
 * The resident's position on the map, from real GPS or from the walk
 * simulator -- both produce the same {lat, lon, accuracy}, so everything
 * downstream (projection, snapping, rerouting, drawing) is one code path.
 *
 * GPS needs no internet: the browser reads the phone's GPS chip. It does need
 * the user's permission and a secure page (https or localhost). The position
 * lives only in this hook's state; it is never sent anywhere.
 */
export function useLiveLocation(): LiveLocation {
  const [status, setStatus] = useState<LocationStatus>('off')
  const [position, setPosition] = useState<LivePosition | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [simulation, setSimulation] = useState<WalkSimulation>({ active: false, paused: false, progress: 0, speed: 10 })

  const watchId = useRef<number | null>(null)
  const timer = useRef<number | null>(null)
  const run = useRef<WalkRun | null>(null)
  const walked = useRef(0)
  const speed = useRef(10)
  const paused = useRef(false)

  function clearWatch() {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    watchId.current = null
  }

  function clearTimer() {
    if (timer.current !== null) window.clearInterval(timer.current)
    timer.current = null
  }

  function forgetOptIn() {
    try {
      localStorage.removeItem(OPT_IN_KEY)
    } catch {
      // Storage can be blocked; the opt-in is only a convenience.
    }
  }

  function startGps() {
    clearTimer()
    run.current = null
    setSimulation((s) => ({ ...s, active: false, paused: false, progress: 0 }))
    if (!window.isSecureContext) {
      setPosition(null)
      setStatus('insecure')
      return
    }
    if (!('geolocation' in navigator)) {
      setPosition(null)
      setStatus('unsupported')
      return
    }
    clearWatch()
    setStatus('locating')
    setHint(null)
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        setPosition({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy })
        setStatus('active')
        setHint(null)
        try {
          localStorage.setItem(OPT_IN_KEY, '1')
        } catch {
          // See forgetOptIn.
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          clearWatch()
          forgetOptIn()
          setPosition(null)
          setStatus('denied')
        } else {
          // Unavailable or timed out: the watch keeps trying, so just say so.
          setHint('No GPS fix yet. Try outdoors or near a window.')
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
    )
  }

  function stopGps() {
    clearWatch()
    forgetOptIn()
    setPosition(null)
    setHint(null)
    setStatus('off')
  }

  function emitSimulated() {
    const r = run.current
    if (r === null) return
    const [x, y] = pointAt(r, walked.current)
    setPosition({ ...unitsToLatLon(x, y, MAP_META.projection), accuracy: SIM_ACCURACY_M })
    setSimulation((s) => ({ ...s, progress: r.total === 0 ? 1 : Math.min(1, walked.current / r.total) }))
  }

  function tick() {
    const r = run.current
    if (r === null || paused.current) return
    walked.current = Math.min(r.total, walked.current + WALK_METERS_PER_SECOND * speed.current * (TICK_MS / 1000))
    emitSimulated()
    if (walked.current >= r.total) {
      clearTimer()
      setSimulation((s) => ({ ...s, active: false, paused: false, progress: 1 }))
    }
  }

  function simulateWalk(path: [number, number][], walkSpeed: number) {
    if (path.length < 2) return
    clearWatch()
    clearTimer()
    run.current = buildRun(path)
    walked.current = 0
    speed.current = walkSpeed
    paused.current = false
    setHint(null)
    setStatus('simulated')
    setSimulation({ active: true, paused: false, progress: 0, speed: walkSpeed })
    emitSimulated()
    timer.current = window.setInterval(tick, TICK_MS)
  }

  function pauseSimulation() {
    paused.current = true
    setSimulation((s) => ({ ...s, paused: true }))
  }

  function resumeSimulation() {
    paused.current = false
    setSimulation((s) => ({ ...s, paused: false }))
  }

  function setSimulationSpeed(next: number) {
    speed.current = next
    setSimulation((s) => ({ ...s, speed: next }))
  }

  function stopSimulation() {
    clearTimer()
    run.current = null
    walked.current = 0
    setSimulation((s) => ({ ...s, active: false, paused: false, progress: 0 }))
    setPosition(null)
    setStatus('off')
  }

  // Resume tracking on the next open if the resident already allowed it, so
  // the app is useful mid-emergency without another prompt. Asks nothing new:
  // only starts when the browser says permission is already granted.
  useEffect(() => {
    let live = true
    try {
      if (localStorage.getItem(OPT_IN_KEY) === '1' && 'permissions' in navigator) {
        navigator.permissions
          .query({ name: 'geolocation' })
          .then((result) => {
            if (live && result.state === 'granted') startGps()
          })
          .catch(() => {})
      }
    } catch {
      // Storage or the Permissions API unavailable: the resident taps to start.
    }
    return () => {
      live = false
      clearWatch()
      clearTimer()
    }
  }, [])

  return {
    status,
    position,
    hint,
    start: startGps,
    stop: stopGps,
    simulation,
    simulateWalk,
    pauseSimulation,
    resumeSimulation,
    setSimulationSpeed,
    stopSimulation,
  }
}
