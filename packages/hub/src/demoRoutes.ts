import { Router } from "express";
import { getCapabilities, getStatus, isKnownJob, isMeshTestScript, startJob, type MeshTestConfig } from "./meshTestRunner.js";

/**
 * Dev-only orchestration surface: lets the PWA's Tester tab click-drive the
 * real mesh-sim scripts instead of a terminal. This router is now always
 * mounted (see server.ts), but /mesh-test/run and /mesh-test/:jobId/status
 * are registered below only when LIGTAS_ENABLE_MESH_ORCHESTRATION is set
 * (see index.ts) -- those two routes do not exist at all otherwise, not
 * merely gated per-request.
 *
 * The hub's other routes (/alert, /alerts, /drain, /health) have no auth
 * today, matching this project's threat model (the hub only ever sits on a
 * barangay's own local network). Running/polling a mesh-test job spawns
 * local processes, which is categorically more sensitive, so those two get
 * their own explicit opt-in gate rather than quietly inheriting that same
 * "no auth" default.
 *
 * /mesh-test/capabilities is the one exception, mounted unconditionally: it
 * is pure and read-only (getCapabilities only checks env and paths with
 * existsSync, never spawns anything) and its response reveals no secret
 * values, only whether things are configured. When orchestration is off,
 * that "why it's off" list is exactly what LiveMeshPanel.tsx's
 * !caps.available branch is built to show -- which never worked before this
 * route existed unconditionally, because falling through to Express's
 * default 404 (no CORS header) made the browser report a CORS error
 * indistinguishable from "no hub reachable at all," so the panel rendered
 * nothing instead of that explanation.
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

  if (config.enabled) {
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
  }

  return router;
}
