import { describe, expect, it } from 'vitest'
import { activeEvacuation } from '../src/lib/activeEvacuation'
import type { AlertOutcome, EvaluatedAlert } from '../src/lib/evaluateBundle'

// Only the fields activeEvacuation reads are meaningful here.
function alert(
  index: number,
  severity: number,
  purokBitmap: number,
  extra: { outcome?: AlertOutcome; hash?: string | null } = {},
): EvaluatedAlert {
  return {
    index,
    receivedAt: 0,
    outcome: extra.outcome ?? 'accepted',
    alertHashHex: extra.hash === null ? undefined : (extra.hash ?? `hash-${index}`),
    body: { severity, purokBitmap } as EvaluatedAlert['body'],
  }
}

const PUROK_3_AND_4 = 0b1100

describe('activeEvacuation', () => {
  it('returns a Tier 3 alert that applies to the purok', () => {
    const result = activeEvacuation([alert(0, 3, PUROK_3_AND_4)], 4, null)
    expect(result?.key).toBe('hash-0')
    expect(result?.body.severity).toBe(3)
  })

  it('does not fire for Tier 1 or Tier 2', () => {
    expect(activeEvacuation([alert(0, 1, PUROK_3_AND_4)], 4, null)).toBeNull()
    expect(activeEvacuation([alert(0, 2, PUROK_3_AND_4)], 4, null)).toBeNull()
  })

  it('does not fire for a purok outside the alert', () => {
    expect(activeEvacuation([alert(0, 3, PUROK_3_AND_4)], 5, null)).toBeNull()
  })

  it('treats a later lower-tier alert as de-escalation', () => {
    const alerts = [alert(0, 3, PUROK_3_AND_4), alert(1, 1, PUROK_3_AND_4)]
    expect(activeEvacuation(alerts, 4, null)).toBeNull()
  })

  it('fires again when a new Tier 3 follows a de-escalation', () => {
    const alerts = [alert(0, 3, PUROK_3_AND_4), alert(1, 1, PUROK_3_AND_4), alert(2, 3, PUROK_3_AND_4)]
    expect(activeEvacuation(alerts, 4, null)?.key).toBe('hash-2')
  })

  it('stays quiet once that exact alert was dismissed, but not for a new one', () => {
    const first = [alert(0, 3, PUROK_3_AND_4)]
    expect(activeEvacuation(first, 4, 'hash-0')).toBeNull()
    const withNew = [...first, alert(1, 3, PUROK_3_AND_4)]
    expect(activeEvacuation(withNew, 4, 'hash-0')?.key).toBe('hash-1')
  })

  it('ignores alerts that were not accepted (forged, replayed, duplicate)', () => {
    for (const outcome of ['rejected_signature', 'rejected_unknown_issuer', 'rejected_replay', 'duplicate'] as const) {
      expect(activeEvacuation([alert(0, 3, PUROK_3_AND_4, { outcome })], 4, null)).toBeNull()
    }
  })

  it('returns nothing while alerts are still loading or no purok is chosen', () => {
    expect(activeEvacuation(null, 4, null)).toBeNull()
    expect(activeEvacuation([alert(0, 3, PUROK_3_AND_4)], null, null)).toBeNull()
  })

  it('falls back to the list index when an alert has no hash', () => {
    expect(activeEvacuation([alert(7, 3, PUROK_3_AND_4, { hash: null })], 4, null)?.key).toBe('7')
  })
})
