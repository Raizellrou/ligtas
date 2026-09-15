import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AlertBundle } from '@ligtas/core'
import type { QueuedCheckin } from './checkinQueue'

interface LigtasDB extends DBSchema {
  bundle: {
    key: 'latest'
    value: AlertBundle
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
export async function cacheBundle(bundle: AlertBundle): Promise<void> {
  const db = await getDB()
  await db.put(STORE_NAME, bundle, LATEST_KEY)
}

export async function loadCachedBundle(): Promise<AlertBundle | null> {
  const db = await getDB()
  const bundle = await db.get(STORE_NAME, LATEST_KEY)
  return bundle ?? null
}
