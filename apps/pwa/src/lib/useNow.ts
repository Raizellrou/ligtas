import { useEffect, useState } from 'react'

/**
 * The current time in ms, refreshed every minute and whenever the tab comes
 * back into view (timers are throttled in the background), so "5 min ago"
 * keeps ageing while the screen stays open.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const handle = window.setInterval(tick, intervalMs)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(handle)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [intervalMs])
  return now
}
