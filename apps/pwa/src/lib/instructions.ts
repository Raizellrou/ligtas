import { Hazard, Severity, type AlertBody } from '@ligtas/core'

const HAZARD_LABEL: Record<number, string> = {
  [Hazard.TEST]: 'Test alert',
  [Hazard.RIVER_FLOOD]: 'River flood',
  [Hazard.FLASH_FLOOD]: 'Flash flood',
  [Hazard.STORM_SURGE]: 'Storm surge',
}

const SEVERITY_LABEL: Record<number, string> = {
  [Severity.TIER_1]: 'Tier 1',
  [Severity.TIER_2]: 'Tier 2',
  [Severity.TIER_3]: 'Tier 3',
}

export function hazardLabel(hazard: number): string {
  return HAZARD_LABEL[hazard] ?? `Unknown hazard (${hazard})`
}

/**
 * How loudly the app should speak for a given severity. One shared
 * definition so the alert card, the full-screen takeover and the map's
 * urgent state can't disagree about whether something is an evacuation.
 * Only "evacuate" (Tier 3) earns a takeover -- interrupting a resident for
 * "monitor conditions" trains them to tap through the one that matters.
 */
export type AlertLevel = 'watch' | 'prepare' | 'evacuate'

export function alertLevel(severity: number): AlertLevel {
  if (severity >= Severity.TIER_3) return 'evacuate'
  if (severity === Severity.TIER_2) return 'prepare'
  return 'watch'
}

/**
 * Placeholder evacuation copy, deterministic from hazard + severity. Real
 * per-barangay instruction text (which route) is a Stage 4+ concern once a
 * registry exists. `destination` is the resident's computed nearest center;
 * without it the Tier 3 line can't name a real place, so it falls back to
 * the generic wording.
 */
export function instructionFor(body: AlertBody, destination?: string): string {
  const hazard = hazardLabel(body.hazard)
  if (body.severity >= Severity.TIER_3) {
    const where = destination ?? 'the designated elementary school'
    return `${hazard}: Evacuate now to ${where}. Do not wait for the siren to stop.`
  }
  if (body.severity === Severity.TIER_2) {
    return `${hazard}: Prepare to evacuate. Gather essentials and move to higher ground if you are near the river.`
  }
  return `${hazard}: Monitor conditions. No evacuation needed yet.`
}

export function severityLabel(severity: number): string {
  return SEVERITY_LABEL[severity] ?? `Unknown (${severity})`
}

export function purokBitSet(purokBitmap: number, purokNumber: number): boolean {
  return (purokBitmap & (1 << (purokNumber - 1))) !== 0
}
