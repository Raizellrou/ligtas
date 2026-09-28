import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { Keypair } from "@stellar/stellar-sdk/base";
import { CURRENT_VERSION, Hazard, encodePacket, toHex } from "@ligtas/core";
import { openDb } from "../src/db.js";
import { AlertService } from "../src/alertService.js";

// AlertService's ReplayGuard is restored from the `alerts` table at
// construction (packages/core's replay-guard-persistence gap, PRD §12), so
// this needs a real file a second instance can reopen -- ":memory:" would
// not survive that and would defeat the point of the test.
let dir: string;
let dbPath: string;
let openDbs: Database.Database[];
const issuer = Keypair.random();
const otherIssuer = Keypair.random();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ligtas-alertservice-test-"));
  dbPath = join(dir, "hub.sqlite");
  openDbs = [];
});

afterEach(() => {
  // Windows holds a file lock on an open better-sqlite3 handle (plus its
  // WAL/SHM files); the directory can't be removed until every handle this
  // test opened is closed, unlike on Linux/macOS where an unlinked-but-open
  // file is silently fine.
  for (const db of openDbs) db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Opens the shared test db and builds an AlertService against it, tracking the handle for cleanup. */
function service(issuers: Map<number, string>): AlertService {
  const db = openDb(dbPath);
  openDbs.push(db);
  return new AlertService(db, issuers);
}

function signedPacketHex(signer: Keypair, sequence: number, issuerIndex = 0): string {
  return toHex(
    encodePacket(
      {
        version: CURRENT_VERSION,
        hazard: Hazard.RIVER_FLOOD,
        severity: 2,
        issuerIndex,
        purokBitmap: 0b1100,
        issuedAt: Math.floor(Date.now() / 1000),
        sequence,
        waterLevelCm: 200,
      },
      signer,
    ),
  );
}

describe("AlertService restores replay state from history on construction", () => {
  it("rejects a sequence already accepted before a restart, but still accepts a newer one", () => {
    const issuers = new Map([[0, issuer.publicKey()]]);

    const before = service(issuers);
    expect(before.restoredIssuerCount).toBe(0); // nothing accepted yet
    expect(before.ingest(signedPacketHex(issuer, 3)).decision).toBe("accepted");

    // Simulates a restart: a fresh AlertService, fresh ReplayGuard, same db file.
    const after = service(issuers);
    expect(after.restoredIssuerCount).toBe(1);

    expect(after.ingest(signedPacketHex(issuer, 3)).decision).toBe("rejected_replay");
    expect(after.ingest(signedPacketHex(issuer, 2)).decision).toBe("rejected_replay");
    expect(after.ingest(signedPacketHex(issuer, 4)).decision).toBe("accepted");
  });

  it("tracks restored history independently per issuer", () => {
    const issuers = new Map([
      [0, issuer.publicKey()],
      [1, otherIssuer.publicKey()],
    ]);

    const before = service(issuers);
    before.ingest(signedPacketHex(issuer, 5, 0));

    const after = service(issuers);
    expect(after.restoredIssuerCount).toBe(1); // only issuer 0 has history
    // Issuer 1 has no history restored, so its first sequence is still fresh.
    expect(after.ingest(signedPacketHex(otherIssuer, 1, 1)).decision).toBe("accepted");
  });

  it("skips a pubkey no longer in the current issuer config, without throwing", () => {
    const before = service(new Map([[0, issuer.publicKey()]]));
    before.ingest(signedPacketHex(issuer, 7));

    // "Restart" with a config that dropped issuer 0 entirely.
    const after = service(new Map([[0, otherIssuer.publicKey()]]));
    expect(after.restoredIssuerCount).toBe(0);
  });
});
