import { useState } from 'react'

const STORAGE_KEY = 'ligtas.joinSkipped'

/**
 * Whether the resident chose to use the app without joining a household.
 * Joining needs the hub, and the alert card, the takeover and the evacuation
 * map all work without it -- so joining must never stand between a resident
 * and those. Only the family check-in needs a joined household. localStorage,
 * like the purok, so the choice survives an app restart.
 */
export function useJoinSkipped(): { skipped: boolean; skip: () => void; unskip: () => void } {
  const [skipped, setSkipped] = useState(() => localStorage.getItem(STORAGE_KEY) === '1')

  function skip() {
    localStorage.setItem(STORAGE_KEY, '1')
    setSkipped(true)
  }

  function unskip() {
    localStorage.removeItem(STORAGE_KEY)
    setSkipped(false)
  }

  return { skipped, skip, unskip }
}
