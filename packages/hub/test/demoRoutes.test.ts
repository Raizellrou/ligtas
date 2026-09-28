import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { Express } from "express";
import { openDb } from "../src/db.js";
import { AlertService } from "../src/alertService.js";
import { createServer } from "../src/server.js";
import type { MeshTestConfig } from "../src/meshTestRunner.js";

const PWA_ORIGIN = "http://localhost:5173";

// getCapabilities (packages/hub/src/meshTestRunner.ts) requires a real venv
// python to report "available" -- same fake-venv setup meshTestRunner.test.ts
// uses, kept minimal here since this file only cares that the route reaches
// getCapabilities correctly, not that logic itself (already covered there).
let meshtasticatorPath: string;

beforeEach(() => {
  meshtasticatorPath = mkdtempSync(join(tmpdir(), "ligtas-demoroutes-test-"));
  mkdirSync(join(meshtasticatorPath, ".venv", "Scripts"), { recursive: true });
  writeFileSync(join(meshtasticatorPath, ".venv", "Scripts", "python.exe"), "");
});

let db: Database.Database;
let server: ReturnType<Express["listen"]>;
let baseUrl: string;

async function start(meshTest?: MeshTestConfig): Promise<void> {
  db = openDb(":memory:");
  const app = createServer(new AlertService(db, new Map()), db, PWA_ORIGIN, undefined, meshTest);
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(meshtasticatorPath, { recursive: true, force: true });
});

// The real bug this guards: GET /demo/mesh-test/capabilities used to only
// exist when orchestration was enabled, so the ordinary dev default (hub
// running, LIGTAS_ENABLE_MESH_ORCHESTRATION unset) fell through to Express's
// own 404 -- no CORS header -- which the browser reports as a CORS error
// indistinguishable from "no hub at all." LiveMeshPanel.tsx's whole
// `!caps.available` explanation box depends on this route actually answering.
describe("GET /demo/mesh-test/capabilities", () => {
  it("answers with the right CORS header even when orchestration is disabled", async () => {
    await start({ port: 0, enabled: false });
    const res = await fetch(`${baseUrl}/demo/mesh-test/capabilities`, { headers: { Origin: PWA_ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(PWA_ORIGIN);
    const body = (await res.json()) as { available: boolean; reasons: string[] };
    expect(body.available).toBe(false);
    expect(body.reasons.length).toBeGreaterThan(0);
  });

  it("answers with the right CORS header even with no meshTest config passed at all", async () => {
    await start(undefined);
    const res = await fetch(`${baseUrl}/demo/mesh-test/capabilities`, { headers: { Origin: PWA_ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(PWA_ORIGIN);
  });

  it("does not echo back an unrecognized origin", async () => {
    await start({ port: 0, enabled: false });
    const res = await fetch(`${baseUrl}/demo/mesh-test/capabilities`, { headers: { Origin: "http://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("reports available when enabled and every check passes", async () => {
    await start({ port: 0, enabled: true, meshtasticatorPath, demoIssuerSecret: "secret" });
    const body = (await (await fetch(`${baseUrl}/demo/mesh-test/capabilities`)).json()) as {
      available: boolean;
      reasons: string[];
    };
    expect(body).toEqual({ available: true, reasons: [] });
  });
});

// The sensitive routes must keep their existing all-or-nothing posture: this
// fix only carves out the read-only capabilities check, not these two.
describe("the orchestration routes stay gated exactly as before", () => {
  it("POST /demo/mesh-test/run does not exist when disabled", async () => {
    await start({ port: 0, enabled: false });
    const res = await fetch(`${baseUrl}/demo/mesh-test/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script: "bridge" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET /demo/mesh-test/x/status does not exist when disabled", async () => {
    await start({ port: 0, enabled: false });
    const res = await fetch(`${baseUrl}/demo/mesh-test/x/status`);
    expect(res.status).toBe(404);
  });

  it("POST /demo/mesh-test/run is mounted and validates its body when enabled", async () => {
    await start({ port: 0, enabled: true });
    const res = await fetch(`${baseUrl}/demo/mesh-test/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script: "not-a-real-script" }),
    });
    // 400 from the router's own validation, not a 404 -- proves the route exists.
    expect(res.status).toBe(400);
  });
});
