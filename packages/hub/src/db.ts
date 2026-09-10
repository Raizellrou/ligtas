import Database from "better-sqlite3";

/**
 * Outbox schema per PRD Section 6.1. raw body and signature are stored
 * verbatim rather than only parsed fields, so the hash and the signature
 * remain independently re-verifiable years later from the database alone.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS alerts (
  alert_hash     TEXT PRIMARY KEY,
  body           BLOB NOT NULL,
  signature      BLOB NOT NULL,
  issuer_pubkey  TEXT NOT NULL,
  sequence       INTEGER NOT NULL,
  hazard         INTEGER NOT NULL,
  severity       INTEGER NOT NULL,
  purok_bitmap   INTEGER NOT NULL,
  issued_at      INTEGER NOT NULL,
  received_at    INTEGER NOT NULL,
  anchor_status  TEXT NOT NULL DEFAULT 'pending',
  anchor_tx      TEXT,
  payout_status  TEXT NOT NULL DEFAULT 'none',
  payout_tx      TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT
);

-- Registry (PRD Section 4, layer L5): household -> purok -> Stellar address,
-- populated ahead of any disaster. Off-chain and local to this hub, per the
-- PRD; not something field nodes or the PWA ever see.
CREATE TABLE IF NOT EXISTS households (
  household_id    TEXT PRIMARY KEY,
  purok           INTEGER NOT NULL,
  stellar_address TEXT NOT NULL
);
`;

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  // WAL + NORMAL can lose the last committed transactions on sudden power
  // loss -- exactly the failure this system exists to survive, since a
  // field hub has no UPS. FULL costs write throughput this workload
  // (~1 alert per event) never needs. See LIGTAS-PRD.md Section 6.1.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  db.exec(SCHEMA);
  return db;
}
