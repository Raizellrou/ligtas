import { useState } from 'react'

const STORAGE_KEY = 'ligtas.dismissedAlert'

/**
 * Remembers which evacuation takeover the resident already acknowledged, by
 * the alert's own hash rather than its position in the list: positions get
 * reused after the simulator's Reset, so an index would let a stale
 * dismissal silently swallow the next real alert. sessionStorage, so it
 * survives a reload and switching tabs within one app session, but a fresh
 * app open shows an active evacuation again.
 */
/** The dismissed alert's key, read straight from storage, for code that has no dismissal state of its own. */
export function readDismissedAlert(): string | null {
  return sessionStorage.getItem(STORAGE_KEY)
}

export function useDismissedAlert(): { dismissed: string | null; dismiss: (key: string) => void } {
  const [dismissed, setDismissed] = useState<string | null>(readDismissedAlert)

  function dismiss(key: string) {
    sessionStorage.setItem(STORAGE_KEY, key)
    setDismissed(key)
  }

  return { dismissed, dismiss }
}
