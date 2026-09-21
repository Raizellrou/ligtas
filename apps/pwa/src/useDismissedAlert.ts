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
export function useDismissedAlert(): { dismissed: string | null; dismiss: (key: string) => void } {
  const [dismissed, setDismissed] = useState<string | null>(() => sessionStorage.getItem(STORAGE_KEY))

  function dismiss(key: string) {
    sessionStorage.setItem(STORAGE_KEY, key)
    setDismissed(key)
  }

  return { dismissed, dismiss }
}
