import { describe, expect, it } from 'vitest'
import {
  ALERT_OLD_AFTER_S,
  CHECK_STALE_AFTER_S,
  ageSeconds,
  checkStaleAfter,
  formatAge,
  formatClock,
  isStale,
  sinceLabel,
  whenLabel,
} from '../src/lib/freshness'

const NOW = new Date(2026, 8, 21, 15, 42, 0).getTime() // local time, so clock text is timezone-proof
const secondsAgo = (s: number) => NOW - s * 1000

describe('formatAge', () => {
  it.each([
    [0, 'just now'],
    [59, 'just now'],
    [60, '1 min ago'],
    [59 * 60 + 59, '59 min ago'],
    [3600, '1 h ago'],
    [47 * 3600 + 59 * 60, '47 h ago'],
    [48 * 3600, '2 days ago'],
    [9 * 86400, '9 days ago'],
  ])('%i s -> %s', (seconds, text) => {
    expect(formatAge(seconds)).toBe(text)
  })
})

describe('ageSeconds', () => {
  it('measures whole seconds', () => {
    expect(ageSeconds(secondsAgo(90), NOW)).toBe(90)
  })

  it('treats a little clock skew into the future as "now"', () => {
    expect(ageSeconds(NOW + 120_000, NOW)).toBe(0)
  })

  it('returns null for a timestamp well in the future -- a wrong clock, so no age is claimed', () => {
    expect(ageSeconds(NOW + 3 * 3600 * 1000, NOW)).toBeNull()
  })

  it('takes milliseconds: alert issuedAt is seconds and must be converted by the caller', () => {
    const issuedAtSeconds = Math.floor(secondsAgo(600) / 1000)
    expect(ageSeconds(issuedAtSeconds * 1000, NOW)).toBe(600)
    // Passing raw seconds by mistake would look like 1970 -- decades old, not 10 minutes.
    expect(ageSeconds(issuedAtSeconds, NOW)).toBeGreaterThan(50 * 365 * 86400)
  })
})

describe('checkStaleAfter', () => {
  it('judges a polled live feed far more strictly than the static one', () => {
    expect(checkStaleAfter(true)).toBe(10 * 60)
    expect(checkStaleAfter(false)).toBe(CHECK_STALE_AFTER_S)
    expect(checkStaleAfter(true)).toBeLessThan(checkStaleAfter(false))
  })
})

describe('isStale', () => {
  it('is stale at exactly the threshold, not before', () => {
    expect(isStale(CHECK_STALE_AFTER_S - 1, CHECK_STALE_AFTER_S)).toBe(false)
    expect(isStale(CHECK_STALE_AFTER_S, CHECK_STALE_AFTER_S)).toBe(true)
  })

  it('never calls an unknown age stale', () => {
    expect(isStale(null, ALERT_OLD_AFTER_S)).toBe(false)
  })
})

describe('formatClock / whenLabel', () => {
  it('shows just the time for today', () => {
    expect(formatClock(secondsAgo(25 * 60), NOW, 'en-US')).toBe('3:17 PM')
  })

  it('adds the date for another day', () => {
    expect(formatClock(new Date(2026, 8, 12, 9, 5).getTime(), NOW, 'en-US')).toBe('Sep 12, 9:05 AM')
  })

  it('pairs the relative age with the clock time', () => {
    expect(whenLabel(secondsAgo(25 * 60), NOW, 'en-US')).toBe('25 min ago · 3:17 PM')
  })

  it('drops the relative age when the timestamp is impossible', () => {
    expect(whenLabel(NOW + 5 * 3600 * 1000, NOW, 'en-US')).toBe('8:42 PM')
  })

  it('sinceLabel reads after "Checked", falling back to a clock time', () => {
    expect(sinceLabel(secondsAgo(300), NOW, 'en-US')).toBe('5 min ago')
    expect(sinceLabel(NOW + 5 * 3600 * 1000, NOW, 'en-US')).toBe('at 8:42 PM')
  })
})
