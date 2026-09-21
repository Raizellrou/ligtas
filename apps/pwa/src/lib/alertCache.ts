import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AlertBundle } from '@ligtas/core'
import type { QueuedCheckin } from './checkinQueue'

/** A bundle plus when THIS device fetched it (ms). Older installs stored the bare bundle; see loadCachedBundle. */
export interface CachedBundle {
  bundle: AlertBundle
  fetchedAt: number
}

interface LigtasDB extends DBSchema {
  bundle: {
    key: 'latest'
    value: CachedBundle | AlertBundle
  }
  checkinQueue: {
    key: string
    value: QueuedCheckin
  }
}

const DB_NAME = 'ligtas-pwa'
const DB_VERSION = 2
const STORE_NAME = 'bundle'
const LATEST_KEY = 'latest'
const CHECKIN_QUEUE_STORE = 'checkinQueue'

let dbPromise: Promise<IDBPDatabase<LigtasDB>> | null = null

// Exported so checkinQueue.ts shares this same database handle/schema
// instead of opening a second connection with its own upgrade logic.
export function getDB(): Promise<IDBPDatabase<LigtasDB>> {
  dbPromise ??= openDB<LigtasDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) db.createObjectStore(STORE_NAME)
      if (oldVersion < 2) db.createObjectStore(CHECKIN_QUEUE_STORE, { keyPath: 'id' })
    },
  })
  return dbPromise
}

export { CHECKIN_QUEUE_STORE }

/**
 * Persists the most recently fetched captured bundle so a resident who goes
 * offline still sees the last alert they received rather than a blank
 * screen (PRD Section 8, G4). Only the network-sourced bundle is cached
 * here -- tester broadcasts already persist in localStorage, and those
 * aren't a "received" alert this cache needs to survive for.
 */
export async function cacheBundle(bundle: AlertBundle, fetchedAt: number): Promise<void> {
  const db = await getDB()
  await db.put(STORE_NAME, { bundle, fetchedAt }, LATEST_KEY)
}

export async function loadCachedBundle(): Promise<CachedBundle | null> {
  const db = await getDB()
  const stored = await db.get(STORE_NAME, LATEST_KEY)
  if (stored === undefined) return null
  if ('bundle' in stored) return stored
  // Stored by an earlier build, before fetch time was recorded: the bundle's
  // own export time is the best (and an honest, older) stand-in.
  return { bundle: stored, fetchedAt: stored.generatedAt * 1000 }
}
