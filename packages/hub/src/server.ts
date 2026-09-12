import express, { type Express } from "express";
import type { Keypair } from "@stellar/stellar-sdk/base";
import type Database from "better-sqlite3";
import { AlertService } from "./alertService.js";
import { drainOutbox } from "./drain.js";
import { createDemoRouter } from "./demoRoutes.js";
import type { MeshTestConfig } from "./meshTestRunner.js";

export interface DrainConfig {
  db: Database.Database;
  issuer: Keypair;
}

export interface DemoConfig {
  meshTest: MeshTestConfig;
  pwaOrigin: string;
}

export function createServer(alerts: AlertService, drain?: DrainConfig, demo?: DemoConfig): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // The wire boundary PRD Section 5.5 left open: packages/mesh-sim POSTs
  // the raw packet hex it observed arriving at the hub node in the mesh.
  // Nothing above this line has any idea what LoRa or Meshtastic are.
  app.post("/alert", (req, res) => {
    const packetHex = req.body?.packetHex;
    if (typeof packetHex !== "string") {
      res.status(400).json({ decision: "malformed", reason: "expected { packetHex: string }" });
      return;
    }
    const result = alerts.ingest(packetHex);
    const status = result.decision === "accepted" ? 201 : result.decision === "malformed" ? 400 : 200;
    res.status(status).json(result);
  });

  app.get("/alerts", (_req, res) => {
    res.json(alerts.toBundle());
  });

  // PRD Section 6.2 -- drains the outbox to Stellar Testnet. Manual trigger
  // for demos/tests; index.ts also runs this on an interval when a hub
  // Stellar secret is configured.
  app.post("/drain", async (_req, res) => {
    if (!drain) {
      res.status(503).json({ error: "drain not configured -- set LIGTAS_HUB_STELLAR_SECRET" });
      return;
    }
    const summary = await drainOutbox(drain.db, drain.issuer);
    res.json(summary);
  });

  if (demo) {
    app.use("/demo", createDemoRouter(demo.meshTest, demo.pwaOrigin));
  }

  return app;
}
