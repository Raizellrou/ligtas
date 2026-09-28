import { CHECKIN_QUEUE_STORE, getDB } from './alertCache'

export type CheckinStatus = 'safe' | 'need_help'

export interface QueuedCheckin {
  id: string
  householdId: string
  displayName: string
  status: CheckinStatus
  queuedAt: number
}

/**
 * id doubles as the hub's idempotency key (clientCheckinId) -- generated
 * once here, carried through every retry of this same queued tap, so a
 * dropped-response resend never applies twice.
 */
export async function enqueueCheckin(entry: Omit<QueuedCheckin, 'id' | 'queuedAt'>): Promise<QueuedCheckin> {
  const queued: QueuedCheckin = { ...entry, id: crypto.randomUUID(), queuedAt: Date.now() }
  const db = await getDB()
  await db.put(CHECKIN_QUEUE_STORE, queued)
  return queued
}

/** idb's key order is UUID-lexical, not insertion order, so this sorts explicitly to drain in tap order. */
export async function listQueuedCheckins(): Promise<QueuedCheckin[]> {
  const db = await getDB()
  const all = await db.getAll(CHECKIN_QUEUE_STORE)
  return all.sort((a, b) => a.queuedAt - b.queuedAt)
}

export async function removeQueuedCheckin(id: string): Promise<void> {
  const db = await getDB()
  await db.delete(CHECKIN_QUEUE_STORE, id)
}
