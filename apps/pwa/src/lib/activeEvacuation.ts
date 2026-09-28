import type { AlertBody } from '@ligtas/core'
import { latestRelevantAlert, type EvaluatedAlert } from './evaluateBundle'
import { alertLevel } from './instructions'

export interface ActiveEvacuation {
  alert: EvaluatedAlert
  body: AlertBody
  /** Identifies this alert for dismissal: its hash, since list positions are reused after a simulator Reset. */
  key: string
}

/**
 * The evacuation, if any, that should take over a resident's screen right now:
 * the newest accepted alert for their purok, only if it is a Tier 3
 * ("evacuate") and they have not already acknowledged that exact alert. The
 * newest alert wins, so a later lower-tier alert reads as de-escalation.
 *
 * One definition shared by App (to skip the splash) and ResidentView (to show
 * the takeover), so the two cannot disagree about whether an evacuation is on.
 */
export function activeEvacuation(
  alerts: EvaluatedAlert[] | null,
  purok: number | null,
  dismissedKey: string | null,
): ActiveEvacuation | null {
  if (alerts === null || purok === null) return null
  const alert = latestRelevantAlert(alerts, purok)
  if (alert?.body === undefined) return null
  if (alertLevel(alert.body.severity) !== 'evacuate') return null
  const key = alert.alertHashHex ?? String(alert.index)
  return key === dismissedKey ? null : { alert, body: alert.body, key }
}
