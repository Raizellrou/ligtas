import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";

/**
 * Registry entry shape -- PRD Section 4, layer L5: household ID -> purok ->
 * Stellar address, populated ahead of any disaster. Same JSON-config
 * pattern as issuers.ts's AlertBundleIssuer list, for the same reason: a
 * reproducible demo needs committed, non-secret seed data.
 */
export interface HouseholdRecord {
  householdId: string;
  purok: number;
  stellarAddress: string;
}

export function loadHouseholds(path: string): HouseholdRecord[] {
  return JSON.parse(readFileSync(path, "utf-8")) as HouseholdRecord[];
}

/**
 * Idempotent by design (INSERT OR REPLACE, keyed on household_id) so this
 * can run on every hub startup without caring whether the table is already
 * populated -- the registry file on disk is always the source of truth.
 */
export function seedHouseholds(db: Database.Database, households: HouseholdRecord[]): void {
  const insert = db.prepare(
    "INSERT OR REPLACE INTO households (household_id, purok, stellar_address) VALUES (?, ?, ?)",
  );
  const insertAll = db.transaction((rows: HouseholdRecord[]) => {
    for (const row of rows) insert.run(row.householdId, row.purok, row.stellarAddress);
  });
  insertAll(households);
}

/**
 * Households whose purok bit is set in an alert's purokBitmap. Mirrors
 * apps/pwa/src/lib/instructions.ts's purokBitSet (bit n set = purok n+1
 * affected, per the packet spec, LIGTAS-PRD.md Section 5.1) -- duplicated
 * rather than shared because that helper lives in an app, not a package,
 * and this one-line formula is cheaper to keep in sync by hand than to
 * relocate into packages/core for a single caller on each side.
 */
export function matchingHouseholds(
  db: Database.Database,
  purokBitmap: number,
): { householdId: string; stellarAddress: string }[] {
  return db
    .prepare<[number], { householdId: string; stellarAddress: string }>(
      `SELECT household_id AS householdId, stellar_address AS stellarAddress
         FROM households
        WHERE (? & (1 << (purok - 1))) != 0`,
    )
    .all(purokBitmap);
}
