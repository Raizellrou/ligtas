// "How old is this?" for a phone that is often offline. Everything here takes
// `nowMs` as a parameter so it can be tested, and every time is in
// MILLISECONDS -- careful at the call sites: alert `issuedAt` is unix seconds,
// the hub's check-in `updatedAt` is already milliseconds.

/** After this long without hearing from the source, "no alert" stops being reassuring. A judgement call, not from the PRD. */
export const CHECK_STALE_AFTER_S = 3 * 3600

/** With a live hub feed polled every few seconds, ten silent minutes already means the phone is out of touch. */
export const CHECK_STALE_LIVE_AFTER_S = 10 * 60

/** How long without a successful check before "no alert" stops being reassuring, for this kind of feed. */
export function checkStaleAfter(live: boolean): number {
  return live ? CHECK_STALE_LIVE_AFTER_S : CHECK_STALE_AFTER_S
}

/** An alert older than this gets a "check whether it still applies" note. Also a judgement call. */
export const ALERT_OLD_AFTER_S = 12 * 3600

// A timestamp a little ahead of the phone's clock is ordinary skew; further
// ahead means one of the two clocks is wrong and any "N min ago" would be a lie.
const FUTURE_TOLERANCE_S = 300

/** Whole seconds since `thenMs`, or null when `thenMs` is in the future beyond clock skew. */
export function ageSeconds(thenMs: number, nowMs: number): number | null {
  const diff = Math.floor((nowMs - thenMs) / 1000)
  if (diff < -FUTURE_TOLERANCE_S) return null
  return Math.max(0, diff)
}

export function formatAge(seconds: number): string {
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.floor(hours / 24)} days ago`
}

/** "3:42 PM" today, "12 Sep, 3:42 PM" on any other day. */
export function formatClock(thenMs: number, nowMs: number, locale?: string): string {
  const then = new Date(thenMs)
  const time = then.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  if (then.toDateString() === new Date(nowMs).toDateString()) return time
  return `${then.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}, ${time}`
}

/**
 * "25 min ago · 3:42 PM". The clock time is there because a relative age is
 * only as right as this phone's clock; when the timestamp is impossible
 * (in the future) the relative part is dropped and only the clock time remains.
 */
export function whenLabel(thenMs: number, nowMs: number, locale?: string): string {
  const age = ageSeconds(thenMs, nowMs)
  const clock = formatClock(thenMs, nowMs, locale)
  return age === null ? clock : `${formatAge(age)} · ${clock}`
}

/** For "Checked ___": "5 min ago", or "at 3:42 PM" when the timestamp is impossible. */
export function sinceLabel(thenMs: number, nowMs: number, locale?: string): string {
  const age = ageSeconds(thenMs, nowMs)
  return age === null ? `at ${formatClock(thenMs, nowMs, locale)}` : formatAge(age)
}

export function isStale(seconds: number | null, thresholdS: number): boolean {
  return seconds !== null && seconds >= thresholdS
}
