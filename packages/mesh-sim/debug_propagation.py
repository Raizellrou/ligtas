import time
from meshtastic import mesh_pb2
import driver


def inner_payload(raw):
    """Unwraps the SIMULATOR_APP envelope -- see run_relay_test.py's
    inner_payload for why this exists. A naive `payload == expected_bytes`
    here is always False even for a genuine match; this is the fix."""
    if raw is None:
        return None
    data = mesh_pb2.Data()
    try:
        data.ParseFromString(raw)
    except Exception:
        return None
    return data.payload


driver.reset_container()
driver.install_topology()
sim = driver.build_sim()

try:
    print("Waiting for interfaces to settle and role config to apply...")
    time.sleep(15)

    alert = driver.emit_alert(mode="genuine", sequence=1)
    packet_bytes = bytes.fromhex(alert["packetHex"])
    print(f"Sending {len(packet_bytes)} bytes from node 0...")
    sim.get_node_iface_by_id(0).sendData(packet_bytes, destinationId="^all", portNum=driver.PRIVATE_APP_PORT, wantAck=False)

    print("Waiting 20s, then dumping sim.messages...")
    for i in range(4):
        time.sleep(5)
        print(f"  ...{(i+1)*5}s, {len(sim.messages)} message events so far")

    print(f"\nsim.messages has {len(sim.messages)} entries")
    for i, m in enumerate(sim.messages):
        decoded = m.packet.get("decoded", {})
        payload = decoded.get("payload")
        print(f"\n--- message {i} ---")
        print("  portnum:", decoded.get("portnum"))
        print("  payload type:", type(payload), "len:", len(payload) if payload is not None else None)
        print("  inner payload matches ours:", inner_payload(payload) == packet_bytes if payload is not None else "N/A")
        print("  transmitter nodeid:", getattr(m, "transmitter", "NONE").nodeid if hasattr(m, "transmitter") else "NO ATTR")
        print("  receivers:", [r.nodeid for r in m.receivers] if hasattr(m, "receivers") else "NO ATTR")
        if payload is not None and len(payload) < 100:
            print("  payload hex:", payload.hex() if isinstance(payload, (bytes, bytearray)) else payload)

    print("\n--- per-node relay stats ---")
    for n in sim.nodes:
        print(f"  node {n.nodeid}: numPacketsTx={n.numPacketsTx} numPacketsRx={n.numPacketsRx} "
              f"numRxDupe={n.numRxDupe} numTxRelay={n.numTxRelay} numTxRelayCanceled={n.numTxRelayCanceled}")
finally:
    sim.close_nodes()
