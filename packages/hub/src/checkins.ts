import type Database from "better-sqlite3";

export type CheckinStatus = "safe" | "need_help";

export interface MemberCheckin {
  displayName: string;
  status: CheckinStatus;
  updatedAt: number;
}

const MAX_DISPLAY_NAME_LENGTH = 40;

export function isCheckinStatus(value: unknown): value is CheckinStatus {
  return value === "safe" || value === "need_help";
}

/** Trims and length-caps a resident-typed display name; empty/too-long input is rejected by the caller. */
export function normalizeDisplayName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_DISPLAY_NAME_LENGTH) return undefined;
  return trimmed;
}

/**
 * Upserts one member's status. clientCheckinId is the PWA offline queue
 * entry's own id, reused purely as an idempotency key: if the stored row
 * already has this exact id, this call is a retried duplicate POST (e.g. the
 * response was lost while offline and the queue resends it later) and must
 * not be reapplied -- otherwise a stale queued tap could silently overwrite
 * a newer status the resident has since submitted from another session.
 * Returns the household's full roster either way.
 */
export function submitCheckin(
  db: Database.Database,
  householdId: string,
  displayName: string,
  status: CheckinStatus,
  clientCheckinId: string,
  now: number,
): MemberCheckin[] {
  const existing = db
    .prepare<[string, string], { client_checkin_id: string }>(
      "SELECT client_checkin_id FROM checkins WHERE household_id = ? AND display_name = ?",
    )
    .get(householdId, displayName);

  if (!existing || existing.client_checkin_id !== clientCheckinId) {
    db.prepare(
      `INSERT INTO checkins (household_id, display_name, status, updated_at, client_checkin_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (household_id, display_name)
       DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at, client_checkin_id = excluded.client_checkin_id`,
    ).run(householdId, displayName, status, now, clientCheckinId);
  }

  return getRoster(db, householdId);
}

export function getRoster(db: Database.Database, householdId: string): MemberCheckin[] {
  return db
    .prepare<[string], { displayName: string; status: CheckinStatus; updatedAt: number }>(
      `SELECT display_name AS displayName, status, updated_at AS updatedAt
         FROM checkins WHERE household_id = ? ORDER BY display_name`,
    )
    .all(householdId);
}
