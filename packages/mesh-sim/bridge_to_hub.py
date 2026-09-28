"""
The real Track A -> Track B join: observes what arrives at the hub node's
own client interface -- exactly what a real hub app would see if it could
speak Meshtastic directly -- and POSTs it to the actual packages/hub
server. This is PRD Section 5.5's wire boundary made real, not simulated:
the bytes that cross into /alert are byte-for-byte what the sensor signed.

Subscribes to the plain "meshtastic.receive" topic, not
"meshtastic.receive.simulator" -- that distinction matters. The
'.simulator' topic (used by InteractiveSim itself, and by
run_relay_test.py's inner_payload helper) is the orchestrator's internal
radio-relay bookkeeping, where payloads arrive double-wrapped in a
SIMULATOR_APP envelope. Plain "meshtastic.receive" is the normal decoded
client-API event -- what a real connected app sees -- and its payload is
already the raw application bytes, no unwrapping needed.

Requires packages/hub running separately (pnpm --filter @ligtas/hub start,
or node dist/index.js after building) and reachable at HUB_URL.

Run with Meshtasticator's own venv Python:
  <meshtasticator>/.venv/Scripts/python.exe bridge_to_hub.py
"""
import json
import os
import time

import requests
from pubsub import pub

import driver
from driver import emit_alert

HUB_NODE_ID = 3  # sensor=0, relay A=1, relay B=2, hub=3 -- see topology.yaml
HUB_URL = os.environ.get("LIGTAS_HUB_URL", "http://localhost:3001")
# Must be the secret for the public key in packages/hub/config/issuers.json --
# emit_alert with no --issuer-secret signs with a fresh random keypair the
# hub has never heard of, which is a "rejected_signature" every time, not a
# "genuine" alert. Never hardcode this; the hub's demo issuer secret is
# generated per session and passed in, never committed.
ISSUER_SECRET = os.environ["LIGTAS_DEMO_ISSUER_SECRET"]
# Must match the issuerIndex ISSUER_SECRET's public key is actually
# registered under in packages/hub/config/issuers.json -- defaults to 0
# (the original demo issuer) but the config supports more than one entry,
# so this is overridable rather than hardcoded. Getting this wrong signs a
# packet with issuer N's key while its issuerIndex byte claims a different
# issuer, which the hub correctly verifies against the wrong public key and
# rejects as rejected_signature -- including "genuine" alerts.
ISSUER_INDEX = int(os.environ.get("LIGTAS_DEMO_ISSUER_INDEX", "0"))
# The hub only ever persists *accepted* alerts (alertService.ts's ingest()
# never inserts a rejected packet), so GET /alerts can't supply the
# forged/replay entries a captured demo bundle needs. This script captures
# every packet it observes crossing the mesh -- accepted or not -- straight
# from its own on_receive callback, and writes them to a bundle file itself.
CAPTURE_OUTPUT = os.environ.get(
    "LIGTAS_CAPTURE_OUTPUT",
    os.path.join(driver.REPO_ROOT, "apps", "pwa", "public", "alert-bundle.json"),
)
ISSUERS_CONFIG = os.path.join(driver.REPO_ROOT, "packages", "hub", "config", "issuers.json")

posted_hashes = set()
captured_alerts = []  # AlertBundleEntry[] in receive order -- see docs/alert-bundle.schema.json
current_label = None  # set right before each sendData so on_receive can tag what it captures


def on_receive(packet, interface):
    hub_iface = sim.get_node_iface_by_id(HUB_NODE_ID)
    if interface is not hub_iface:
        return
    decoded = packet.get("decoded", {})
    if decoded.get("portnum") != "PRIVATE_APP":
        return
    payload: bytes = decoded.get("payload")
    if payload is None or len(payload) != 84:
        return

    packet_hex = payload.hex()
    if packet_hex in posted_hashes:
        return  # already bridged this exact packet -- avoid a duplicate POST for a duplicate radio reception
    posted_hashes.add(packet_hex)
    captured_alerts.append(
        {"packetHex": packet_hex, "receivedAt": int(time.time()), "demoLabel": current_label}
    )

    print(f"\n[bridge] hub node received {len(payload)} bytes -- POSTing to {HUB_URL}/alert")
    try:
        resp = requests.post(f"{HUB_URL}/alert", json={"packetHex": packet_hex}, timeout=5)
        print(f"[bridge] hub responded {resp.status_code}: {resp.json()}")
    except requests.RequestException as e:
        print(f"[bridge] POST failed: {e} -- is packages/hub running at {HUB_URL}?")


driver.reset_container()
driver.install_topology()
sim = driver.build_sim()
pub.subscribe(on_receive, "meshtastic.receive")

try:
    print("Waiting for node interfaces to settle and role config to apply...")
    time.sleep(15)

    print(f"\nBridge live. Watching hub node {HUB_NODE_ID}'s client interface, POSTing to {HUB_URL}.")

    current_label = "genuine -- tier 2, puroks 3 and 4"
    alert = emit_alert(mode="genuine", sequence=1, issuer_secret=ISSUER_SECRET, issuer_index=ISSUER_INDEX)
    print(f"Broadcasting genuine alert (seq=1) from node 0...")
    sim.get_node_iface_by_id(0).sendData(
        bytes.fromhex(alert["packetHex"]), destinationId="^all", portNum=driver.PRIVATE_APP_PORT, wantAck=False
    )
    time.sleep(10)

    current_label = "genuine -- tier 2, water risen further"
    escalation = emit_alert(mode="genuine", sequence=2, issuer_secret=ISSUER_SECRET, water_level=220, issuer_index=ISSUER_INDEX)
    print(f"\nBroadcasting genuine escalation alert (seq=2) from node 0...")
    sim.get_node_iface_by_id(0).sendData(
        bytes.fromhex(escalation["packetHex"]), destinationId="^all", portNum=driver.PRIVATE_APP_PORT, wantAck=False
    )
    time.sleep(10)

    current_label = "forged -- signed by an impostor key, not the issuer above"
    forged = emit_alert(mode="forged", sequence=3, issuer_secret=ISSUER_SECRET, issuer_index=ISSUER_INDEX)
    print(f"\nBroadcasting FORGED alert (seq=3) from node 0...")
    sim.get_node_iface_by_id(0).sendData(
        bytes.fromhex(forged["packetHex"]), destinationId="^all", portNum=driver.PRIVATE_APP_PORT, wantAck=False
    )
    time.sleep(10)

    current_label = "replay -- sequence 1 again (already superseded by sequence 2), different body/hash from alert 0"
    replay = emit_alert(mode="genuine", sequence=1, issuer_secret=ISSUER_SECRET, issuer_index=ISSUER_INDEX)
    print(f"\nBroadcasting REPLAY alert (seq=1 again) from node 0...")
    sim.get_node_iface_by_id(0).sendData(
        bytes.fromhex(replay["packetHex"]), destinationId="^all", portNum=driver.PRIVATE_APP_PORT, wantAck=False
    )
    time.sleep(10)

    print(f"\n[bridge] fetching {HUB_URL}/alerts to confirm what actually landed...")
    live_bundle = requests.get(f"{HUB_URL}/alerts", timeout=5).json()
    print(f"[bridge] hub reports {len(live_bundle['alerts'])} accepted alert(s) in its bundle.")
    if len(live_bundle["alerts"]) != 2:
        print(
            f"[bridge] WARNING: expected exactly 2 accepted alerts (the two genuine ones), "
            f"got {len(live_bundle['alerts'])} -- check the hub's console log for rejections."
        )

    with open(ISSUERS_CONFIG) as f:
        issuers = json.load(f)

    captured_bundle = {
        "schemaVersion": 1,
        "generatedAt": int(time.time()),
        "source": "captured",
        "captureNote": (
            f"Captured {time.strftime('%Y-%m-%d')} from a live Meshtasticator run via "
            "bridge_to_hub.py against a real running packages/hub. The two genuine alerts "
            "were accepted and stored by the hub; the forged and replayed packets crossed "
            "the mesh identically (stock Meshtastic firmware forwards any payload) but were "
            "rejected on signature/sequence -- their bytes are this script's own record of "
            "what it broadcast, since the hub never persists a rejected packet."
        ),
        "issuers": issuers,
        "alerts": captured_alerts,
    }
    with open(CAPTURE_OUTPUT, "w") as f:
        json.dump(captured_bundle, f, indent=2)
        f.write("\n")
    print(f"[bridge] wrote captured bundle ({len(captured_alerts)} alerts) to {CAPTURE_OUTPUT}")

finally:
    print("\nShutting down...")
    sim.close_nodes()
