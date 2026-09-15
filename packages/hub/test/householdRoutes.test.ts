import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { Express } from "express";
import { openDb } from "../src/db.js";
import { seedHouseholds } from "../src/households.js";
import { AlertService } from "../src/alertService.js";
import { createServer } from "../src/server.js";

let db: Database.Database;
let app: Express;
let server: ReturnType<Express["listen"]>;
let baseUrl: string;

beforeEach(async () => {
  db = openDb(":memory:");
  seedHouseholds(db, [{ householdId: "hh-001", purok: 1, stellarAddress: "GDUMMY", joinCode: "BLU-482" }]);
  app = createServer(new AlertService(db, new Map()), db, "http://localhost:5173");

  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("CORS", () => {
  // Caught live: without this header the browser blocks the PWA (a
  // different origin/port in dev) from ever reading the response, even
  // though the request itself reaches the hub fine.
  it("allows the configured PWA origin", async () => {
    const res = await fetch(`${baseUrl}/household/resolve/BLU-482`, {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("does not echo back an unrecognized origin", async () => {
    const res = await fetch(`${baseUrl}/household/resolve/BLU-482`, {
      headers: { Origin: "http://evil.example" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("GET /household/resolve/:joinCode", () => {
  it("resolves a known join code to its household id", async () => {
    const res = await fetch(`${baseUrl}/household/resolve/BLU-482`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ householdId: "hh-001" });
  });

  it("404s on an unknown join code", async () => {
    const res = await fetch(`${baseUrl}/household/resolve/ZZZ-999`);
    expect(res.status).toBe(404);
  });
});

describe("GET /household/:householdId/status", () => {
  it("returns an empty roster for a household with no check-ins yet", async () => {
    const res = await fetch(`${baseUrl}/household/hh-001/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ householdId: "hh-001", members: [] });
  });

  it("404s on an unknown household id", async () => {
    const res = await fetch(`${baseUrl}/household/hh-999/status`);
    expect(res.status).toBe(404);
  });
});

describe("POST /household/:householdId/checkin", () => {
  it("submits a check-in and returns the updated roster", async () => {
    const res = await fetch(`${baseUrl}/household/hh-001/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Dad", status: "safe", clientCheckinId: "c-1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { householdId: string; members: { displayName: string; status: string }[] };
    expect(body.householdId).toBe("hh-001");
    expect(body.members).toEqual([{ displayName: "Dad", status: "safe", updatedAt: expect.any(Number) }]);
  });

  it("400s on an invalid status", async () => {
    const res = await fetch(`${baseUrl}/household/hh-001/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Dad", status: "fine", clientCheckinId: "c-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("404s on an unknown household", async () => {
    const res = await fetch(`${baseUrl}/household/hh-999/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Dad", status: "safe", clientCheckinId: "c-1" }),
    });
    expect(res.status).toBe(404);
  });

  it("does not double-apply a resubmit of the same clientCheckinId", async () => {
    const submit = (status: string, clientCheckinId: string) =>
      fetch(`${baseUrl}/household/hh-001/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Dad", status, clientCheckinId }),
      }).then((r) => r.json() as Promise<{ members: { status: string }[] }>);

    await submit("safe", "c-1");
    // Simulates the PWA's queue re-POSTing the same entry after a dropped
    // response -- carries the same clientCheckinId, so it must not flip the
    // status even though the payload here asks for a different one.
    const retried = await submit("need_help", "c-1");
    expect(retried.members).toEqual([{ displayName: "Dad", status: "safe", updatedAt: expect.any(Number) }]);
  });
});
