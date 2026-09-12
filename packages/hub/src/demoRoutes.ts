import { Router } from "express";
import { getCapabilities, getStatus, isKnownJob, isMeshTestScript, startJob, type MeshTestConfig } from "./meshTestRunner.js";

/**
 * Dev-only orchestration surface: lets the PWA's Tester tab click-drive the
 * real mesh-sim scripts instead of a terminal. Mounted only when
 * LIGTAS_ENABLE_MESH_ORCHESTRATION is set (see index.ts) -- the route does
 * not exist at all otherwise, not merely gated per-request.
 *
 * The hub's other routes (/alert, /alerts, /drain, /health) have no auth
 * today, matching this project's threat model (the hub only ever sits on a
 * barangay's own local network). This router spawns local processes, which
 * is categorically more sensitive, so it gets its own explicit opt-in gate
 * rather than quietly inheriting that same "no auth" default.
 *
 * CORS is scoped to this router alone -- a Vite dev server on a different
 * port needs it to poll these routes, but /alert/etc. shouldn't have their
 * cross-origin exposure changed by a feature that has nothing to do with
 * them.
 */
export function createDemoRouter(config: MeshTestConfig, pwaOrigin: string): Router {
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

  router.get("/mesh-test/capabilities", (_req, res) => {
    res.json(getCapabilities(config));
  });

  router.post("/mesh-test/run", (req, res) => {
    const script = req.body?.script;
    if (!isMeshTestScript(script)) {
      res.status(400).json({ error: "script must be 'bridge' or 'relay-proof'" });
      return;
    }
    const result = startJob(config, script);
    if ("error" in result) {
      res.status(409).json(result);
      return;
    }
    res.status(202).json(result);
  });

  router.get("/mesh-test/:jobId/status", (req, res) => {
    const after = Number(req.query.after ?? 0);
    const result = getStatus(req.params.jobId, Number.isFinite(after) ? after : 0);
    if (!isKnownJob(result)) {
      res.status(404).json(result);
      return;
    }
    res.json(result);
  });

  return router;
}
