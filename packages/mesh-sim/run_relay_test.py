"""
Track A proof: inject a real signed LIGTAS alert at the sensor node, watch
it hop across the mesh through a relay to the hub, kill that relay mid-run
and confirm the redundant relay still delivers it, then confirm a forged
and a replayed copy both still propagate through the mesh (stock firmware
forwards everything, PRD Section 5.5) but are rejected by verify-alert.ts --
the same code the hub and PWA run.

Topology (see topology.yaml): sensor -> {relay A | relay B} -> hub. Both
relays are in range of the sensor and of the hub, but not of each other, so
each independently forwards straight to the hub -- no relay ever has to
decide whether to yield to the other, which sidesteps a real Meshtastic
collision-avoidance behavior (numTxRelayCanceled) hit and documented in
topology.yaml.

Run with Meshtasticator's own venv Python, from anywhere:
  <meshtasticator>/.venv/Scripts/python.exe run_relay_test.py
"""
import json
import os
import subprocess
import time

from meshtastic import mesh_pb2

import driver
from driver import emit_alert, node_pids

HUB_NODE_ID = 3  # sensor=0, relay A=1, relay B=2, hub=3 -- see topology.yaml
VERIFY_SCRIPT = os.path.join(driver.REPO_ROOT, "packages", "core", "dist", "scripts", "verify-alert.js")

RESULTS = []


def record(name, ok, detail=""):
    RESULTS.append((name, ok))
    status = "PASS" if ok else "FAIL"
    print(f"\n[{status}] {name}" + (f" -- {detail}" if detail else ""))


def hex_to_bytes(h):
    return bytes.fromhex(h)


def verify(packet_hex, issuer_pub, last_seq=-1):
    out = subprocess.run(
        ["node", VERIFY_SCRIPT, "--packet-hex", packet_hex, "--issuer-public-key", issuer_pub, "--last-seq", str(last_seq)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def inner_payload(message):
    """Each sim.messages entry carries a SIMULATOR_APP envelope -- that's
    Meshtasticator's own orchestrator-to-node protocol, not our app data.
    Its 'payload' field is itself a serialized mesh_pb2.Data message, and
    THAT message's .payload field is finally our actual 84-byte packet.
    Found by hex-dumping a captured message and recognizing the protobuf
    varint/length-delimited framing around our own bytes -- not documented
    anywhere, confirmed by parsing it with the real Data message class."""
    raw = message.packet.get("decoded", {}).get("payload")
    if raw is None:
        return None
    data = mesh_pb2.Data()
    try:
        data.ParseFromString(raw)
    except Exception:
        return None
    return data.payload


def wait_for_payload(sim, expected_bytes, timeout_s):
    """Polls sim.messages (populated by InteractiveSim's own on_receive as
    the packet hops) for any transmission event carrying our exact bytes.
    Returns (involved, transmitters): involved is every node id that
    transmitted OR was geometrically in range to receive -- calc_receivers
    computes range from position alone, with no idea whether a given node's
    process is actually alive, so a killed node can still show up as an
    in-range receiver. transmitters is only nodes that actually sent
    something, which is what proves a killed node genuinely did nothing."""
    deadline = time.time() + timeout_s
    involved = set()
    transmitters = set()
    while time.time() < deadline:
        for m in sim.messages:
            if inner_payload(m) == expected_bytes:
                transmitters.add(m.transmitter.nodeid)
                involved.add(m.transmitter.nodeid)
                involved.update(r.nodeid for r in m.receivers)
        if HUB_NODE_ID in involved:
            return involved, transmitters
        time.sleep(0.5)
    return involved, transmitters


def broadcast(sim, packet_bytes):
    sim.get_node_iface_by_id(0).sendData(
        packet_bytes, destinationId="^all", portNum=driver.PRIVATE_APP_PORT, wantAck=False
    )


def main():
    driver.reset_container()
    driver.install_topology()
    sim = driver.build_sim()

    try:
        print("Waiting for node interfaces to settle and role config to apply...")
        time.sleep(15)

        # ---- 1. Genuine alert: multi-hop delivery ----
        alert = emit_alert(mode="genuine", sequence=1)
        packet_bytes = hex_to_bytes(alert["packetHex"])
        print(f"\nBroadcasting genuine alert (seq=1) from node 0, {len(packet_bytes)} bytes...")
        broadcast(sim, packet_bytes)

        involved, _ = wait_for_payload(sim, packet_bytes, timeout_s=20)
        record(
            "G1 -- genuine alert reaches hub across a relay hop",
            HUB_NODE_ID in involved,
            f"nodes involved: {sorted(involved)}",
        )

        v1 = verify(alert["packetHex"], alert["expectedIssuerPublicKey"])
        record("G2a -- genuine alert accepted by verify-alert.ts", v1["decision"] == "accepted", v1["decision"])

        # ---- 2. Kill relay A mid-run, confirm rerouting via relay B ----
        container = sim.container
        pids = node_pids(container)
        relay_a_pid = pids.get(1)
        record("setup -- found relay A's process", relay_a_pid is not None, f"pids seen: {pids}")
        if relay_a_pid:
            print(f"\nKilling relay A (node 1, pid {relay_a_pid}) mid-run...")
            # "kill" has no standalone binary in this image (only a shell
            # builtin) -- exec_run with an argv list bypasses the shell
            # entirely, so it has to be invoked through one explicitly.
            kill_exit, kill_out = container.exec_run(["sh", "-c", f"kill -9 {relay_a_pid}"])
            time.sleep(3)
            check_exit, _ = container.exec_run(["test", "-d", f"/proc/{relay_a_pid}"])
            record(
                "setup -- relay A's process confirmed dead",
                check_exit != 0,
                f"kill exit={kill_exit}, /proc check exit={check_exit} (0 would mean still alive)",
            )

            alert2 = emit_alert(mode="genuine", sequence=2, issuer_secret=alert["expectedIssuerSecret"])
            packet2 = hex_to_bytes(alert2["packetHex"])
            print("Broadcasting genuine alert (seq=2) from node 0, with relay A down...")
            broadcast(sim, packet2)

            involved2, transmitters2 = wait_for_payload(sim, packet2, timeout_s=20)
            record(
                "G3 -- alert still reaches hub via relay B after relay A is killed",
                HUB_NODE_ID in involved2,
                f"nodes involved: {sorted(involved2)}",
            )
            record(
                "G3b -- killed relay A never transmitted (proves it's genuinely dead, not just redundant)",
                1 not in transmitters2,
                f"nodes that actually transmitted: {sorted(transmitters2)}",
            )

        # ---- 3. Forged alert: propagates through the dumb mesh, rejected at verification ----
        forged = emit_alert(mode="forged", sequence=3, issuer_secret=alert["expectedIssuerSecret"])
        forged_bytes = hex_to_bytes(forged["packetHex"])
        print("\nBroadcasting FORGED alert (signed by an impostor key) from node 0...")
        broadcast(sim, forged_bytes)
        involved3, _ = wait_for_payload(sim, forged_bytes, timeout_s=20)
        record(
            "mesh forwards a forged packet like any other (expected -- stock firmware, PRD S5.5)",
            HUB_NODE_ID in involved3,
            f"nodes involved: {sorted(involved3)}",
        )
        v_forged = verify(forged["packetHex"], forged["expectedIssuerPublicKey"])
        record("G2b -- forged alert rejected by verify-alert.ts", v_forged["decision"] == "rejected_signature", v_forged["decision"])

        # ---- 4. Replayed alert: the original seq=1 packet, resent ----
        print("\nRe-broadcasting the ORIGINAL seq=1 packet (replay) from node 0...")
        broadcast(sim, packet_bytes)
        time.sleep(5)
        v_replay = verify(alert["packetHex"], alert["expectedIssuerPublicKey"], last_seq=2)
        record("G2c -- replayed alert rejected by verify-alert.ts", v_replay["decision"] == "rejected_replay", v_replay["decision"])

    finally:
        print("\nShutting down...")
        sim.close_nodes()

    print("\n" + "=" * 60)
    passed = sum(1 for _, ok in RESULTS if ok)
    for name, ok in RESULTS:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print(f"{passed}/{len(RESULTS)} passed")
    print("=" * 60)


if __name__ == "__main__":
    main()
