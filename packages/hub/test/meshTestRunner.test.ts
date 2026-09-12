import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { getCapabilities, getStatus, isKnownJob, scratchBundlePath, startJob, type MeshTestConfig } from "../src/meshTestRunner.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

function emitLines(proc: FakeChildProcess, lines: string[]): void {
  proc.stdout.emit("data", Buffer.from(lines.join("\n") + "\n"));
}

let meshtasticatorPath: string;

function baseConfig(overrides: Partial<MeshTestConfig> = {}): MeshTestConfig {
  return { port: 3001, enabled: true, meshtasticatorPath, demoIssuerSecret: "SDEMO", ...overrides };
}

beforeEach(() => {
  vi.mocked(spawn).mockReset();
  meshtasticatorPath = mkdtempSync(join(tmpdir(), "ligtas-meshtasticator-"));
  mkdirSync(join(meshtasticatorPath, ".venv", "Scripts"), { recursive: true });
  writeFileSync(join(meshtasticatorPath, ".venv", "Scripts", "python.exe"), "");
});

afterEach(() => {
  rmSync(meshtasticatorPath, { recursive: true, force: true });
});

describe("getCapabilities", () => {
  it("is unavailable with a reason when the feature flag is off", () => {
    const caps = getCapabilities(baseConfig({ enabled: false }));
    expect(caps.available).toBe(false);
    expect(caps.reasons.some((r) => r.includes("LIGTAS_ENABLE_MESH_ORCHESTRATION"))).toBe(true);
  });

  it("is unavailable with a reason when the Meshtasticator venv doesn't exist", () => {
    const caps = getCapabilities(baseConfig({ meshtasticatorPath: join(meshtasticatorPath, "does-not-exist") }));
    expect(caps.available).toBe(false);
    expect(caps.reasons.some((r) => r.includes("Meshtasticator"))).toBe(true);
  });

  it("is unavailable with a reason when the demo issuer secret is unset", () => {
    const caps = getCapabilities(baseConfig({ demoIssuerSecret: undefined }));
    expect(caps.available).toBe(false);
    expect(caps.reasons.some((r) => r.includes("LIGTAS_DEMO_ISSUER_SECRET"))).toBe(true);
  });

  it("is available once every requirement is met", () => {
    const caps = getCapabilities(baseConfig());
    expect(caps).toEqual({ available: true, reasons: [] });
  });
});

describe("startJob / getStatus", () => {
  it("refuses to start when capabilities aren't met", () => {
    const result = startJob(baseConfig({ enabled: false }), "relay-proof");
    expect(result).toHaveProperty("error");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("refuses a second job while one is already running", () => {
    const first = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(first as never);
    const started = startJob(baseConfig(), "relay-proof");
    expect(started).toHaveProperty("jobId");

    const second = startJob(baseConfig(), "relay-proof");
    expect(second).toEqual({ error: expect.stringContaining("already running") });
    expect(spawn).toHaveBeenCalledTimes(1);

    first.emit("close", 0); // settle the job so it doesn't leak "running" into later tests
  });

  it("accumulates stdout and returns only new lines via `after`", () => {
    const proc = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(proc as never);
    const { jobId } = startJob(baseConfig(), "relay-proof") as { jobId: string };

    emitLines(proc, ["first line", "second line"]);
    const firstPoll = getStatus(jobId, 0);
    expect(firstPoll).toMatchObject({ status: "running", newLines: ["first line", "second line"], nextIndex: 2 });

    emitLines(proc, ["third line"]);
    const secondPoll = getStatus(jobId, 2);
    expect(secondPoll).toMatchObject({ status: "running", newLines: ["third line"], nextIndex: 3 });

    proc.emit("close", 0); // settle the job so it doesn't leak "running" into later tests
  });

  it("reports an unknown job id once superseded by a newer run", () => {
    const first = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(first as never);
    const { jobId } = startJob(baseConfig(), "relay-proof") as { jobId: string };
    first.emit("close", 0);

    const second = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(second as never);
    startJob(baseConfig(), "relay-proof");

    expect(getStatus(jobId, 0)).toEqual({ error: expect.stringContaining("unknown job id") });

    second.emit("close", 0); // settle the job so it doesn't leak "running" into later tests
  });

  describe("relay-proof job", () => {
    it("parses PASS/FAIL lines and the summary line into a checklist, status passed when all pass", () => {
      const proc = new FakeChildProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as never);
      const { jobId } = startJob(baseConfig(), "relay-proof") as { jobId: string };

      emitLines(proc, [
        "Waiting for node interfaces to settle...",
        "[PASS] G1 -- genuine alert reaches hub across a relay hop -- nodes involved: [0, 1, 3]",
        "[PASS] G2a -- genuine alert accepted by verify-alert.ts",
        "============================================================",
        "  [PASS] G1 -- genuine alert reaches hub across a relay hop",
        "  [PASS] G2a -- genuine alert accepted by verify-alert.ts",
        "2/2 passed",
        "============================================================",
      ]);
      // Regression check: the live narration line above deliberately reuses
      // " -- " both inside a check's own name AND before its free-text
      // detail, which is exactly the ambiguity the parser must resolve by
      // preferring the clean final block over the live lines.
      proc.emit("close", 0);

      const result = getStatus(jobId, 0);
      expect(result).toMatchObject({
        status: "passed",
        summary: {
          kind: "relay-proof",
          passed: 2,
          total: 2,
          checks: [
            { name: "G1 -- genuine alert reaches hub across a relay hop", passed: true },
            { name: "G2a -- genuine alert accepted by verify-alert.ts", passed: true },
          ],
        },
      });
    });

    it("reports status failed (not error) when the script completes but not every check passed", () => {
      const proc = new FakeChildProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as never);
      const { jobId } = startJob(baseConfig(), "relay-proof") as { jobId: string };

      emitLines(proc, [
        "[PASS] check one",
        "[FAIL] check two -- something didn't match",
        "============================================================",
        "  [PASS] check one",
        "  [FAIL] check two",
        "1/2 passed",
        "============================================================",
      ]);
      proc.emit("close", 0);

      const result = getStatus(jobId, 0);
      expect(result).toMatchObject({
        status: "failed",
        summary: { passed: 1, total: 2, checks: [{ name: "check one", passed: true }, { name: "check two", passed: false }] },
      });
    });

    it("surfaces status error with the exit code when the process exits non-zero", () => {
      const proc = new FakeChildProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as never);
      const { jobId } = startJob(baseConfig(), "relay-proof") as { jobId: string };

      emitLines(proc, ["Traceback (most recent call last):", "CalledProcessError: ..."]);
      proc.emit("close", 1);

      const result = getStatus(jobId, 0);
      expect(result).toMatchObject({ status: "error", error: expect.stringContaining("exited with code 1") });
      // Regression: a real, known job's status response also carries an
      // `error` field once the job itself has failed -- isKnownJob must
      // still say true here, not be fooled into treating it like the
      // "unknown job id" shape (which also just has an `error` field).
      expect(isKnownJob(result)).toBe(true);
    });
  });

  it("isKnownJob distinguishes a real (possibly failed) status response from the unknown-job-id shape", () => {
    expect(isKnownJob({ status: "error", newLines: [], nextIndex: 0, error: "something failed" })).toBe(true);
    expect(isKnownJob({ error: "unknown job id -- it may have been superseded by a newer run" })).toBe(false);
  });

  describe("bridge job", () => {
    it("reads back its scratch bundle file on a clean exit", () => {
      const proc = new FakeChildProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as never);
      const { jobId } = startJob(baseConfig(), "bridge") as { jobId: string };

      const scratchPath = scratchBundlePath(jobId);
      const bundle = {
        schemaVersion: 1,
        generatedAt: 1,
        source: "captured",
        captureNote: "test fixture",
        issuers: [],
        alerts: [{ packetHex: "00", receivedAt: 1, demoLabel: "genuine" }],
      };
      writeFileSync(scratchPath, JSON.stringify(bundle));
      proc.emit("close", 0);
      rmSync(scratchPath, { force: true });

      const result = getStatus(jobId, 0);
      expect(result).toMatchObject({ status: "passed", summary: { kind: "bridge", bundle } });
    });

    it("surfaces status error when the process exits clean but never wrote the scratch file", () => {
      const proc = new FakeChildProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as never);
      const { jobId } = startJob(baseConfig(), "bridge") as { jobId: string };

      proc.emit("close", 0);

      const result = getStatus(jobId, 0);
      expect(result).toMatchObject({ status: "error", error: expect.stringContaining("never wrote its captured bundle") });
    });

    it("passes the demo issuer secret and a scratch LIGTAS_CAPTURE_OUTPUT through to the child process env", () => {
      const proc = new FakeChildProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as never);
      startJob(baseConfig({ demoIssuerSecret: "SSPECIFIC" }), "bridge");

      const [, , options] = vi.mocked(spawn).mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
      expect(options.env.LIGTAS_DEMO_ISSUER_SECRET).toBe("SSPECIFIC");
      expect(options.env.LIGTAS_HUB_URL).toBe("http://localhost:3001");
      expect(options.env.LIGTAS_CAPTURE_OUTPUT).toContain("demo-runs");

      proc.emit("close", 0); // settle the job; no scratch file written here, so it lands on status 'error'
    });
  });
});
