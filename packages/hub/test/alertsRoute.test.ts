import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk/base";
import type Database from "better-sqlite3";
import type { Express } from "express";
import { CURRENT_VERSION, Hazard, encodePacket, toHex, type AlertBundle } from "@ligtas/core";
import { openDb } from "../src/db.js";
import { AlertService } from "../src/alertService.js";
import { createServer } from "../src/server.js";

const issuer = Keypair.random();

let db: Database.Database;
let app: Express;
let server: ReturnType<Express["listen"]>;
let baseUrl: string;

beforeEach(async () => {
  db = openDb(":memory:");
  app = createServer(new AlertService(db, new Map([[0, issuer.publicKey()]])), db, "http://localhost:5173");
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function signedPacketHex(sequence: number, severity = 2): string {
  return toHex(
    encodePacket(
      {
        version: CURRENT_VERSION,
        hazard: Hazard.RIVER_FLOOD,
        severity,
        issuerIndex: 0,
        purokBitmap: 0b1100,
        issuedAt: Math.floor(Date.now() / 1000),
        sequence,
        waterLevelCm: 210,
      },
      issuer,
    ),
  );
}

describe("GET /alerts CORS", () => {
  // The resident PWA polls this from another origin; without the header the
  // browser blocks it from reading the response even though the hub answers.
  it("allows the configured PWA origin", async () => {
    const res = await fetch(`${baseUrl}/alerts`, { headers: { Origin: "http://localhost:5173" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("vary")).toContain("Origin");
  });

  it("does not echo back an unrecognized origin", async () => {
    const res = await fetch(`${baseUrl}/alerts`, { headers: { Origin: "http://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("GET /alerts", () => {
  it("serves an empty live bundle before anything is ingested", async () => {
    const bundle = (await (await fetch(`${baseUrl}/alerts`)).json()) as AlertBundle;
    expect(bundle.source).toBe("live");
    expect(bundle.alerts).toEqual([]);
  });

  it("includes an accepted alert, and only accepted ones", async () => {
    const good = signedPacketHex(1);
    const post = (packetHex: string) =>
      fetch(`${baseUrl}/alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packetHex }),
      });

    expect((await post(good)).status).toBe(201);
    // Signed by a key the hub does not know: rejected, must never reach the feed.
    const forged = toHex(
      encodePacket(
        {
          version: CURRENT_VERSION,
          hazard: Hazard.RIVER_FLOOD,
          severity: 3,
          issuerIndex: 0,
          purokBitmap: 0b1100,
          issuedAt: Math.floor(Date.now() / 1000),
          sequence: 2,
          waterLevelCm: 300,
        },
        Keypair.random(),
      ),
    );
    expect((await post(forged)).status).toBe(200);

    const bundle = (await (await fetch(`${baseUrl}/alerts`)).json()) as AlertBundle;
    expect(bundle.alerts.map((a) => a.packetHex)).toEqual([good]);
    expect(bundle.issuers).toEqual([{ issuerIndex: 0, issuerPublicKey: issuer.publicKey() }]);
  });
});
