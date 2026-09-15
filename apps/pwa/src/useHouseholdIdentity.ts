import { useState } from 'react'

const HOUSEHOLD_ID_KEY = 'ligtas.household.id'
const DISPLAY_NAME_KEY = 'ligtas.household.displayName'

/**
 * A resident joins a household once; it persists across visits, same
 * localStorage pattern as usePersistedPurok. The two values are set and
 * cleared together -- a household id with no display name (or vice versa)
 * is never a valid joined state.
 */
export interface HouseholdIdentity {
  householdId: string | null
  displayName: string | null
  setIdentity: (householdId: string, displayName: string) => void
  clearIdentity: () => void
}

export function useHouseholdIdentity(): HouseholdIdentity {
  const [identity, setIdentityState] = useState<{ householdId: string; displayName: string } | null>(() => {
    const householdId = localStorage.getItem(HOUSEHOLD_ID_KEY)
    const displayName = localStorage.getItem(DISPLAY_NAME_KEY)
    return householdId && displayName ? { householdId, displayName } : null
  })

  function setIdentity(householdId: string, displayName: string) {
    localStorage.setItem(HOUSEHOLD_ID_KEY, householdId)
    localStorage.setItem(DISPLAY_NAME_KEY, displayName)
    setIdentityState({ householdId, displayName })
  }

  function clearIdentity() {
    localStorage.removeItem(HOUSEHOLD_ID_KEY)
    localStorage.removeItem(DISPLAY_NAME_KEY)
    setIdentityState(null)
  }

  return {
    householdId: identity?.householdId ?? null,
    displayName: identity?.displayName ?? null,
    setIdentity,
    clearIdentity,
  }
}
