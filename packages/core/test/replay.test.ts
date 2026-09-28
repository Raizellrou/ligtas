import { describe, expect, it } from "vitest";
import { ReplayGuard } from "../src/replay.js";

describe("ReplayGuard", () => {
  it("accepts the first packet seen from an issuer", () => {
    const guard = new ReplayGuard();
    expect(guard.evaluate("hash-a", 0, 1)).toBe("accept");
  });

  it("accepts strictly increasing sequence numbers from the same issuer", () => {
    const guard = new ReplayGuard();
    guard.evaluate("hash-a", 0, 1);
    expect(guard.evaluate("hash-b", 0, 2)).toBe("accept");
    expect(guard.evaluate("hash-c", 0, 3)).toBe("accept");
  });

  it("treats the same alertHash arriving twice as a duplicate, not a replay", () => {
    // Simulates a multi-hop mesh: the same legitimate packet reaches this
    // node by two different paths. PRD §5.4 — this must not be rejected as
    // an attack.
    const guard = new ReplayGuard();
    guard.evaluate("hash-a", 0, 5);
    expect(guard.evaluate("hash-a", 0, 5)).toBe("duplicate");
  });

  it("rejects a resent old packet as a replay, distinct from a duplicate", () => {
    const guard = new ReplayGuard();
    guard.evaluate("hash-a", 0, 5);
    // Different hash (an attacker replaying an old *body* under a new
    // wrapper isn't realistic since the hash is derived from the body, but
    // the guard's replay check must fire on sequence alone regardless of
    // hash, since an attacker resending the exact old packet is exactly the
    // "duplicate" path above — this covers the sequence check in isolation.
    expect(guard.evaluate("hash-different", 0, 4)).toBe("replay");
    expect(guard.evaluate("hash-different-2", 0, 5)).toBe("replay");
  });

  it("tracks sequence numbers independently per issuer", () => {
    const guard = new ReplayGuard();
    guard.evaluate("hash-a", 0, 100);
    // Issuer 1 has never sent anything, so sequence 1 is its first and newest.
    expect(guard.evaluate("hash-b", 1, 1)).toBe("accept");
  });

  it("expires seen-hash entries after the TTL, allowing dedupe state to age out", () => {
    const guard = new ReplayGuard({ seenHashTtlMs: 1000 });
    const t0 = 1_000_000;
    guard.evaluate("hash-a", 0, 1, t0);
    // Still within TTL: duplicate.
    expect(guard.evaluate("hash-a", 0, 1, t0 + 500)).toBe("duplicate");
    // Past TTL: hash forgotten, but sequence rule still fires since 1 <= lastSeq(0)=1.
    expect(guard.evaluate("hash-a", 0, 1, t0 + 1500)).toBe("replay");
  });

  describe("restoreSequence", () => {
    it("makes a fresh guard behave as if it had already seen that sequence", () => {
      const guard = new ReplayGuard();
      guard.restoreSequence(0, 5);
      expect(guard.evaluate("hash-old", 0, 5)).toBe("replay");
      expect(guard.evaluate("hash-older", 0, 3)).toBe("replay");
      expect(guard.evaluate("hash-new", 0, 6)).toBe("accept");
    });

    it("tracks restored state independently per issuer", () => {
      const guard = new ReplayGuard();
      guard.restoreSequence(0, 10);
      // Issuer 1 has no restored history, so its first sequence is still fresh.
      expect(guard.evaluate("hash-a", 1, 1)).toBe("accept");
    });

    it("never lowers a sequence the guard already has, from organic use or a prior restore", () => {
      const guard = new ReplayGuard();
      guard.evaluate("hash-a", 0, 9); // organic: lastSeq(0) = 9
      guard.restoreSequence(0, 3); // a lower restore must not weaken this
      expect(guard.evaluate("hash-b", 0, 5)).toBe("replay");

      guard.restoreSequence(0, 20); // a higher restore still raises the bar
      expect(guard.evaluate("hash-c", 0, 12)).toBe("replay");
      expect(guard.evaluate("hash-d", 0, 21)).toBe("accept");
    });
  });
});
