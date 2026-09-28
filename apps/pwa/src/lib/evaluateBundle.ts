import {
  ReplayGuard,
  alertHash,
  bytesFromHex,
  decodePacket,
  toHex,
  verifyBody,
  type AlertBody,
  type AlertBundle,
} from '@ligtas/core'
import { purokBitSet } from './instructions'

/**
 * What actually happened to one alert, independent of its bundle demoLabel.
 * The PWA never reads demoLabel to decide this -- see packages/core/src/bundle.ts
 * for why that would defeat the point of shipping raw signed bytes.
 */
export type AlertOutcome =
  | 'accepted'
  | 'rejected_signature'
  | 'rejected_unknown_issuer'
  | 'rejected_replay'
  | 'duplicate'

export interface EvaluatedAlert {
  index: number
  receivedAt: number
  demoLabel?: string
  outcome: AlertOutcome
  /** Present whenever the packet at least decoded structurally, even if verification failed -- useful for showing what a forged packet *claimed*. */
  body?: AlertBody
  alertHashHex?: string
}

/**
 * Runs every alert in a bundle through the real verification and replay
 * path, in bundle order (required -- see AlertBundle.alerts docs). This is
 * the same decision packages/hub will make; the PWA doesn't get a second,
 * looser standard just because it's running in a browser.
 */
export function evaluateBundle(bundle: AlertBundle): EvaluatedAlert[] {
  const issuerByIndex = new Map(bundle.issuers.map((i) => [i.issuerIndex, i.issuerPublicKey]))
  const guard = new ReplayGuard()
  const results: EvaluatedAlert[] = []

  for (const [index, entry] of bundle.alerts.entries()) {
    const packet = bytesFromHex(entry.packetHex)
    const { body, signature } = decodePacket(packet)
    const bodyBytes = packet.subarray(0, 20)

    const issuerPublicKey = issuerByIndex.get(body.issuerIndex)
    if (issuerPublicKey === undefined) {
      results.push({ index, receivedAt: entry.receivedAt, demoLabel: entry.demoLabel, outcome: 'rejected_unknown_issuer', body })
      continue
    }

    if (!verifyBody(bodyBytes, signature, issuerPublicKey)) {
      results.push({ index, receivedAt: entry.receivedAt, demoLabel: entry.demoLabel, outcome: 'rejected_signature', body })
      continue
    }

    const hashHex = toHex(alertHash(bodyBytes))
    const decision = guard.evaluate(hashHex, body.issuerIndex, body.sequence)
    const outcome: AlertOutcome = decision === 'accept' ? 'accepted' : decision === 'duplicate' ? 'duplicate' : 'rejected_replay'

    results.push({ index, receivedAt: entry.receivedAt, demoLabel: entry.demoLabel, outcome, body, alertHashHex: hashHex })
  }

  return results
}

/**
 * The most recent accepted alert that actually applies to a given purok --
 * shared by ResidentView's AlertList (the red instruction banner) and
 * EvacuationMap (urgent styling), so the two surfaces can't silently
 * disagree about what's currently active for this resident.
 */
export function latestRelevantAlert(alerts: EvaluatedAlert[], purok: number): EvaluatedAlert | undefined {
  return alerts.filter((a) => a.outcome === 'accepted' && a.body && purokBitSet(a.body.purokBitmap, purok)).at(-1)
}
