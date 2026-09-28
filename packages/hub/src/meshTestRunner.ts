import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AlertBundle } from "@ligtas/core";

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/hub/dist -> packages/hub -> packages -> repo root (same three
// levels whether this runs from dist/ at runtime or src/ under a test
// runner -- both sit one level under packages/hub).
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const MESH_SIM_DIR = join(REPO_ROOT, "packages", "mesh-sim");

const SCRIPT_PATHS = {
  bridge: join(MESH_SIM_DIR, "bridge_to_hub.py"),
  "relay-proof": join(MESH_SIM_DIR, "run_relay_test.py"),
} as const;

export type MeshTestScript = keyof typeof SCRIPT_PATHS;
const VALID_SCRIPTS: MeshTestScript[] = ["bridge", "relay-proof"];

export function isMeshTestScript(value: unknown): value is MeshTestScript {
  return typeof value === "string" && (VALID_SCRIPTS as string[]).includes(value);
}

export interface MeshTestConfig {
  /** The hub's own port -- bridge_to_hub.py POSTs back to this same process. */
  port: number;
  enabled: boolean;
  meshtasticatorPath?: string;
  demoIssuerSecret?: string;
  demoIssuerIndex?: string;
}

function meshtasticatorPath(config: MeshTestConfig): string {
  // Mirrors packages/mesh-sim/driver.py's own default exactly: a sibling
  // "Meshtasticator" directory next to this repo, not inside it.
  return config.meshtasticatorPath ?? resolve(REPO_ROOT, "..", "Meshtasticator");
}

function venvPython(config: MeshTestConfig): string {
  // Windows venv layout, matching the path hardcoded in three places already
  // (bridge_to_hub.py, run_relay_test.py, docs/ONBOARDING.md Section 4.3).
  return join(meshtasticatorPath(config), ".venv", "Scripts", "python.exe");
}

export function scratchBundlePath(jobId: string): string {
  return join(REPO_ROOT, "packages", "hub", "demo-runs", `${jobId}.json`);
}

export interface Capabilities {
  available: boolean;
  reasons: string[];
}

/**
 * Deliberately does not check Docker itself -- a live `docker ps` probe is
 * one more thing that can be subtly wrong (wrong context, permissions) and
 * would just be re-deriving what the job's own log output tells you anyway
 * the moment it actually tries to run. Reporting a wrong "available: true"
 * is worse than reporting a real failure once the job starts.
 */
export function getCapabilities(config: MeshTestConfig): Capabilities {
  const reasons: string[] = [];
  if (!config.enabled) {
    reasons.push("Set LIGTAS_ENABLE_MESH_ORCHESTRATION=1 on the hub to turn this on.");
  }
  const meshtasticator = meshtasticatorPath(config);
  if (!existsSync(meshtasticator)) {
    reasons.push(`Meshtasticator checkout not found at ${meshtasticator} -- see docs/ONBOARDING.md Section 4.3.`);
  }
  const python = venvPython(config);
  if (!existsSync(python)) {
    reasons.push(`Meshtasticator's venv Python not found at ${python} -- set it up per docs/ONBOARDING.md Section 4.3.`);
  }
  if (!config.demoIssuerSecret) {
    reasons.push("LIGTAS_DEMO_ISSUER_SECRET is not set on the hub -- required by bridge_to_hub.py.");
  }
  return { available: reasons.length === 0, reasons };
}

export type JobStatus = "running" | "passed" | "failed" | "error";

export interface RelayProofSummary {
  kind: "relay-proof";
  checks: { name: string; passed: boolean }[];
  passed: number;
  total: number;
}

export interface BridgeSummary {
  kind: "bridge";
  bundle: AlertBundle;
}

export type JobSummary = RelayProofSummary | BridgeSummary;

interface Job {
  id: string;
  script: MeshTestScript;
  proc: ChildProcessWithoutNullStreams;
  lines: string[];
  status: JobStatus;
  summary?: JobSummary;
  error?: string;
}

// One job at a time, in-process, gone on restart -- same ephemerality as
// drain.ts's own `inFlight` module-level guard, not persisted anywhere.
// These are exclusive Docker-using jobs, so a second request while one is
// running is refused outright rather than coalesced like drainOutbox does.
let currentJob: Job | null = null;

export function startJob(config: MeshTestConfig, script: MeshTestScript): { jobId: string } | { error: string } {
  const caps = getCapabilities(config);
  if (!caps.available) {
    return { error: `mesh test unavailable: ${caps.reasons.join(" ")}` };
  }
  if (currentJob && currentJob.status === "running") {
    return { error: `a mesh test (${currentJob.script}) is already running -- wait for it to finish` };
  }

  const id = randomUUID();
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (script === "bridge") {
    const scratchPath = scratchBundlePath(id);
    mkdirSync(dirname(scratchPath), { recursive: true });
    env.LIGTAS_HUB_URL = `http://localhost:${config.port}`;
    env.LIGTAS_DEMO_ISSUER_SECRET = config.demoIssuerSecret;
    if (config.demoIssuerIndex) env.LIGTAS_DEMO_ISSUER_INDEX = config.demoIssuerIndex;
    env.LIGTAS_CAPTURE_OUTPUT = scratchPath;
  }

  // spawn (never exec/shell) so the space in this machine's own repo path
  // (and any space in a Meshtasticator checkout path) never needs manual
  // shell-quoting -- args pass through as an argv array, not a shell string.
  const proc = spawn(venvPython(config), [SCRIPT_PATHS[script]], { cwd: MESH_SIM_DIR, env });
  const job: Job = { id, script, proc, lines: [], status: "running" };
  currentJob = job;

  const onData = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.length > 0) job.lines.push(line);
    }
  };
  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);

  proc.on("close", (code) => {
    if (code !== 0) {
      job.status = "error";
      job.error = `${script} exited with code ${code}`;
      return;
    }
    try {
      const summary = buildSummary(job);
      job.summary = summary;
      job.status = summary.kind === "relay-proof" && summary.passed < summary.total ? "failed" : "passed";
    } catch (err) {
      job.status = "error";
      job.error = (err as Error).message;
    }
  });

  proc.on("error", (err) => {
    job.status = "error";
    job.error = `failed to launch ${script}: ${err.message}`;
  });

  return { jobId: id };
}

function buildSummary(job: Job): JobSummary {
  if (job.script === "relay-proof") {
    return parseRelayProofOutput(job.lines);
  }
  const scratchPath = scratchBundlePath(job.id);
  if (!existsSync(scratchPath)) {
    throw new Error("bridge_to_hub.py finished but never wrote its captured bundle -- check the log for where it stopped.");
  }
  const bundle = JSON.parse(readFileSync(scratchPath, "utf8")) as AlertBundle;
  return { kind: "bridge", bundle };
}

// record()'s live per-check print carries an optional free-text
// " -- {detail}" suffix, which makes it ambiguous to parse back apart from
// a name that can itself legitimately contain " -- " (e.g. "G1 -- genuine
// alert reaches hub across a relay hop"). Its *final* re-printed block
// (bracketed by a "="*60 line and the "N/M passed" line) has no such
// suffix -- RESULTS only ever stores (name, ok), detail is print-only and
// never carried into that reprint -- so that's the block this parses.
const CHECK_LINE = /^\s*\[(PASS|FAIL)\]\s+(.+)$/;
const SUMMARY_LINE = /^(\d+)\/(\d+)\s+passed$/;

function parseRelayProofOutput(lines: string[]): RelayProofSummary {
  const summaryIndex = lines.findIndex((line) => SUMMARY_LINE.test(line.trim()));
  if (summaryIndex === -1) {
    throw new Error("run_relay_test.py finished but its pass/fail summary line was never seen in the output.");
  }
  const summaryMatch = SUMMARY_LINE.exec(lines[summaryIndex].trim())!;
  const passed = Number(summaryMatch[1]);
  const total = Number(summaryMatch[2]);

  const checks: { name: string; passed: boolean }[] = [];
  for (let i = summaryIndex - 1; i >= 0; i--) {
    const match = CHECK_LINE.exec(lines[i]);
    if (!match) break;
    checks.unshift({ name: match[2].trim(), passed: match[1] === "PASS" });
  }
  if (checks.length === 0) {
    throw new Error("run_relay_test.py finished but no PASS/FAIL checklist preceded its summary line.");
  }

  return { kind: "relay-proof", checks, passed, total };
}

export interface JobStatusResponse {
  status: JobStatus;
  newLines: string[];
  nextIndex: number;
  summary?: JobSummary;
  error?: string;
}

export function getStatus(jobId: string, after: number): JobStatusResponse | { error: string } {
  if (!currentJob || currentJob.id !== jobId) {
    return { error: "unknown job id -- it may have been superseded by a newer run" };
  }
  return {
    status: currentJob.status,
    newLines: currentJob.lines.slice(after),
    nextIndex: currentJob.lines.length,
    summary: currentJob.summary,
    error: currentJob.error,
  };
}

/**
 * A real JobStatusResponse also carries an optional `error` field -- the
 * job's own failure message, e.g. "exited with code 1" -- so `"error" in
 * result` alone can't tell "unknown job id" apart from "status update for a
 * job that happened to fail". `status` only ever appears on the real
 * response. Caught live: a relay-proof run that failed fast (no Docker
 * running) had its very first successful poll misreported as a 404 because
 * of exactly this ambiguity.
 */
export function isKnownJob(result: JobStatusResponse | { error: string }): result is JobStatusResponse {
  return "status" in result;
}
