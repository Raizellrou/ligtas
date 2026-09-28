import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDb } from "../src/db.js";
import { seedHouseholds } from "../src/households.js";
import { getRoster, isCheckinStatus, submitCheckin } from "../src/checkins.js";

describe("checkins", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(":memory:");
    seedHouseholds(db, [{ householdId: "hh-001", purok: 1, stellarAddress: "GDUMMY", joinCode: "BLU-482" }]);
  });

  it("inserts a new check-in and the roster reflects it", () => {
    const roster = submitCheckin(db, "hh-001", "Dad", "safe", "c-1", 1000);
    expect(roster).toEqual([{ displayName: "Dad", status: "safe", updatedAt: 1000 }]);
    expect(getRoster(db, "hh-001")).toEqual(roster);
  });

  it("does not reapply a resubmit carrying the same clientCheckinId as the stored row", () => {
    submitCheckin(db, "hh-001", "Dad", "safe", "c-1", 1000);
    // Same clientCheckinId, different status -- simulates a queued PWA retry
    // after a dropped response, which must not be mistaken for a new tap.
    const roster = submitCheckin(db, "hh-001", "Dad", "need_help", "c-1", 2000);
    expect(roster).toEqual([{ displayName: "Dad", status: "safe", updatedAt: 1000 }]);
  });

  it("applies a genuinely new clientCheckinId as a real update", () => {
    submitCheckin(db, "hh-001", "Dad", "safe", "c-1", 1000);
    const roster = submitCheckin(db, "hh-001", "Dad", "need_help", "c-2", 2000);
    expect(roster).toEqual([{ displayName: "Dad", status: "need_help", updatedAt: 2000 }]);
  });

  it("tracks two different display names in one household independently", () => {
    submitCheckin(db, "hh-001", "Dad", "safe", "c-1", 1000);
    const roster = submitCheckin(db, "hh-001", "Mom", "need_help", "c-2", 1500);
    expect(roster).toEqual([
      { displayName: "Dad", status: "safe", updatedAt: 1000 },
      { displayName: "Mom", status: "need_help", updatedAt: 1500 },
    ]);
  });

  it("rejects an invalid status value", () => {
    expect(isCheckinStatus("safe")).toBe(true);
    expect(isCheckinStatus("need_help")).toBe(true);
    expect(isCheckinStatus("fine")).toBe(false);
    expect(isCheckinStatus(undefined)).toBe(false);
  });
});

// The one migration path a fresh :memory: db (openDb's normal test setup)
// never exercises on its own, since a brand-new db always takes the "table
// doesn't exist yet" branch of CREATE TABLE IF NOT EXISTS. :memory: can't be
// reopened across connections, so this uses a real temp file to reproduce
// "an existing hub.sqlite from before this feature shipped."
describe("households join_code migration", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ligtas-hub-test-"));
    dbPath = join(dir, "hub.sqlite");
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("adds join_code to a pre-existing households table without losing rows", () => {
    const pre = new Database(dbPath);
    pre.exec(`
      CREATE TABLE households (
        household_id    TEXT PRIMARY KEY,
        purok           INTEGER NOT NULL,
        stellar_address TEXT NOT NULL
      );
    `);
    pre.prepare("INSERT INTO households (household_id, purok, stellar_address) VALUES (?, ?, ?)").run(
      "hh-001",
      1,
      "GDUMMY",
    );
    pre.close();

    const migrated = openDb(dbPath);
    const columns = migrated.prepare("PRAGMA table_info(households)").all() as { name: string }[];
    expect(columns.some((c) => c.name === "join_code")).toBe(true);

    const row = migrated
      .prepare("SELECT household_id, purok, stellar_address, join_code FROM households WHERE household_id = ?")
      .get("hh-001");
    expect(row).toEqual({ household_id: "hh-001", purok: 1, stellar_address: "GDUMMY", join_code: null });
    migrated.close();
  });
});
