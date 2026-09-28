import { useState } from 'react'

const STORAGE_KEY = 'ligtas.purok'

/**
 * Resident picks their purok once; it persists across visits. localStorage
 * for now -- PRD Section 8 calls for idb-backed cached alerts in Version 1's
 * offline hardening pass, at which point this may move alongside that, but
 * a single small integer doesn't need a database yet.
 */
export interface PersistedPurok {
  purok: number | null
  setPurok: (next: number) => void
  clearPurok: () => void
}

/** The persisted purok, read straight from storage, for code that has no purok state of its own. */
export function readPersistedPurok(): number | null {
  const stored = localStorage.getItem(STORAGE_KEY)
  const parsed = stored === null ? null : Number(stored)
  return parsed !== null && Number.isInteger(parsed) && parsed >= 1 && parsed <= 32 ? parsed : null
}

export function usePersistedPurok(): PersistedPurok {
  const [purok, setPurokState] = useState<number | null>(readPersistedPurok)

  function setPurok(next: number) {
    localStorage.setItem(STORAGE_KEY, String(next))
    setPurokState(next)
  }

  function clearPurok() {
    localStorage.removeItem(STORAGE_KEY)
    setPurokState(null)
  }

  return { purok, setPurok, clearPurok }
}
