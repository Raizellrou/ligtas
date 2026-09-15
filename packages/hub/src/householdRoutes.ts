import { Router } from "express";
import type Database from "better-sqlite3";
import { findHouseholdByJoinCode, householdExists } from "./households.js";
import { getRoster, isCheckinStatus, normalizeDisplayName, submitCheckin } from "./checkins.js";

/**
 * Household safety check-in ("I'm safe" / "I need help"), the first PWA ->
 * hub write path in the system. No auth, same as every other route here
 * (/alert, /alerts, /drain, /health) -- matches this project's threat model
 * that the hub only ever sits on a barangay's own local network. Mounted
 * unconditionally at /household, unlike the opt-in /demo router, since it
 * has no external dependency (no Stellar secret, no local process spawning)
 * gating it.
 *
 * CORS is scoped to this router alone, same reasoning and shape as
 * demoRoutes.ts: the PWA (a different origin/port in dev) needs it to call
 * these routes at all, but /alert/etc. shouldn't have their cross-origin
 * exposure changed by a feature that has nothing to do with them.
 */
export function createHouseholdRouter(db: Database.Database, pwaOrigin: string): Router {
  const router = Router();

  router.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin === pwaOrigin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.status(204).end();
      return;
    }
    next();
  });

  router.get("/resolve/:joinCode", (req, res) => {
    const householdId = findHouseholdByJoinCode(db, req.params.joinCode);
    if (!householdId) {
      res.status(404).json({ error: "unknown join code" });
      return;
    }
    res.json({ householdId });
  });

  router.get("/:householdId/status", (req, res) => {
    const { householdId } = req.params;
    if (!householdExists(db, householdId)) {
      res.status(404).json({ error: "unknown household" });
      return;
    }
    res.json({ householdId, members: getRoster(db, householdId) });
  });

  router.post("/:householdId/checkin", (req, res) => {
    const { householdId } = req.params;
    if (!householdExists(db, householdId)) {
      res.status(404).json({ error: "unknown household" });
      return;
    }

    const displayName = normalizeDisplayName(req.body?.displayName);
    if (!displayName) {
      res.status(400).json({ error: "displayName must be a non-empty string, 40 characters or fewer" });
      return;
    }
    if (!isCheckinStatus(req.body?.status)) {
      res.status(400).json({ error: "status must be 'safe' or 'need_help'" });
      return;
    }
    const clientCheckinId = req.body?.clientCheckinId;
    if (typeof clientCheckinId !== "string" || clientCheckinId.length === 0) {
      res.status(400).json({ error: "clientCheckinId must be a non-empty string" });
      return;
    }

    const members = submitCheckin(db, householdId, displayName, req.body.status, clientCheckinId, Date.now());
    res.json({ householdId, members });
  });

  return router;
}
