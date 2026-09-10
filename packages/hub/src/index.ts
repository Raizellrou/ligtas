import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Keypair } from "@stellar/stellar-sdk/base";
import { openDb } from "./db.js";
import { loadIssuers } from "./issuers.js";
import { loadHouseholds, seedHouseholds } from "./households.js";
import { AlertService } from "./alertService.js";
import { createServer, type DrainConfig } from "./server.js";
import { drainOutbox } from "./drain.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);
const DB_PATH = process.env.LIGTAS_DB_PATH ?? join(HERE, "..", "hub.sqlite");
const ISSUERS_PATH = process.env.LIGTAS_ISSUERS_PATH ?? join(HERE, "..", "config", "issuers.json");
const HOUSEHOLDS_PATH = process.env.LIGTAS_HOUSEHOLDS_PATH ?? join(HERE, "..", "config", "households.json");
// The hub's own Stellar account -- distinct from the field issuer keys in
// issuers.json, which only ever verify alert signatures. This is the
// account PRD Section 7's anchor payment is sent from and to. Optional:
// without it the hub still does everything except drain the outbox, which
// only matters once connectivity returns anyway (PRD Section 6.2).
const HUB_STELLAR_SECRET = process.env.LIGTAS_HUB_STELLAR_SECRET;
const DRAIN_INTERVAL_MS = Number(process.env.LIGTAS_DRAIN_INTERVAL_MS ?? 60_000);

const db = openDb(DB_PATH);
const issuers = loadIssuers(ISSUERS_PATH);
const households = loadHouseholds(HOUSEHOLDS_PATH);
seedHouseholds(db, households);
const alerts = new AlertService(db, issuers);

let drainConfig: DrainConfig | undefined;
if (HUB_STELLAR_SECRET) {
  const issuer = Keypair.fromSecret(HUB_STELLAR_SECRET);
  drainConfig = { db, issuer };
  setInterval(() => {
    drainOutbox(db, issuer)
      .then((summary) => {
        if (summary.anchors.length > 0 || summary.payouts.length > 0) console.log(`[drain] ${JSON.stringify(summary)}`);
      })
      .catch((err) => console.error("[drain] run failed:", err));
  }, DRAIN_INTERVAL_MS);
}

const app = createServer(alerts, drainConfig);

app.listen(PORT, () => {
  console.log(
    `hub listening on :${PORT} (db: ${DB_PATH}, ${issuers.size} issuer(s) loaded, ${households.length} household(s) loaded, ` +
      `drain: ${drainConfig ? `every ${DRAIN_INTERVAL_MS}ms` : "disabled -- no LIGTAS_HUB_STELLAR_SECRET"})`,
  );
});
