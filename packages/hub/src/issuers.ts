import { readFileSync } from "node:fs";
import type { AlertBundleIssuer } from "@ligtas/core";

/**
 * The hub's cached authorised-issuer list -- PRD Section 5.1: field nodes
 * carry this provisioned ahead of time, not fetched at runtime. Same shape
 * as AlertBundleIssuer so the hub's GET /alerts can echo it straight back
 * into a bundle with no reshaping.
 */
export function loadIssuers(path: string): Map<number, string> {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as AlertBundleIssuer[];
  return new Map(raw.map((i) => [i.issuerIndex, i.issuerPublicKey]));
}
