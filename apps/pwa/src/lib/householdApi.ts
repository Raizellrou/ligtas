import { HUB_URL } from './hubUrl'
import type { CheckinStatus } from './checkinQueue'

export interface MemberCheckin {
  displayName: string
  status: CheckinStatus
  updatedAt: number
}

type Unreachable = 'unreachable'

export async function resolveJoinCode(joinCode: string): Promise<{ householdId: string } | 'not_found' | Unreachable> {
  try {
    const res = await fetch(`${HUB_URL}/household/resolve/${encodeURIComponent(joinCode)}`)
    if (res.status === 404) return 'not_found'
    if (!res.ok) return 'unreachable'
    return (await res.json()) as { householdId: string }
  } catch {
    return 'unreachable'
  }
}

export interface HouseholdStatus {
  members: MemberCheckin[]
  stellarAddress: string | undefined
}

export async function fetchHouseholdStatus(householdId: string): Promise<HouseholdStatus | Unreachable> {
  try {
    const res = await fetch(`${HUB_URL}/household/${encodeURIComponent(householdId)}/status`)
    if (!res.ok) return 'unreachable'
    return (await res.json()) as HouseholdStatus
  } catch {
    return 'unreachable'
  }
}

export async function submitCheckinToHub(
  householdId: string,
  entry: { displayName: string; status: CheckinStatus; clientCheckinId: string },
): Promise<MemberCheckin[] | Unreachable> {
  try {
    const res = await fetch(`${HUB_URL}/household/${encodeURIComponent(householdId)}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    })
    if (!res.ok) return 'unreachable'
    const data = (await res.json()) as { members: MemberCheckin[] }
    return data.members
  } catch {
    return 'unreachable'
  }
}
