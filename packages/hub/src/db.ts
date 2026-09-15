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
-- PRD; not something field nodes or the PWA ever see. join_code is added
-- separately below via ALTER TABLE (see openDb) since this table predates
-- the household check-in feature and IF NOT EXISTS won't retrofit a column
-- onto a table that already exists on disk.
CREATE TABLE IF NOT EXISTS households (
  household_id    TEXT PRIMARY KEY,
  purok           INTEGER NOT NULL,
  stellar_address TEXT NOT NULL
);

-- Household safety check-in: per-member status, keyed by (household, name)
-- so each phone that joins a household gets its own row rather than one
-- shared flag. client_checkin_id is the PWA's offline-queue entry id,
-- reused here purely as an idempotency key -- a dropped-response retry of
-- the same queued tap must not be mistaken for a genuine second update.
CREATE TABLE IF NOT EXISTS checkins (
  household_id      TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  status              TEXT NOT NULL,
  updated_at          INTEGER NOT NULL,
  client_checkin_id   TEXT NOT NULL,
  PRIMARY KEY (household_id, display_name)
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
  migrateHouseholdsJoinCode(db);
  return db;
}

/**
 * This codebase otherwise has no migration framework -- schema changes are
 * additive-only via idempotent CREATE TABLE IF NOT EXISTS. households is the
 * first table to need a column added after already shipping, so a small
 * guarded ALTER TABLE stands in rather than inventing a whole migration
 * system for one column.
 */
function migrateHouseholdsJoinCode(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(households)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "join_code")) {
    db.exec("ALTER TABLE households ADD COLUMN join_code TEXT");
  }
}
