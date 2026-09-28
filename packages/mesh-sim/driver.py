"""
mesh-sim: drives Meshtasticator's own orchestrator to inject a real signed
LIGTAS alert packet (built by packages/core) at the sensor node and observe
it hop across the mesh to the hub. See PRD Section 5.5 for why this is
Python and why it reuses Meshtasticator's InteractiveSim rather than
reimplementing radio propagation.

Requires:
  - Docker Desktop running
  - This script run with Meshtasticator's own venv Python, since it imports
    Meshtasticator's own lib.interactive module directly:
      <meshtasticator>/.venv/Scripts/python.exe driver.py

Env:
  MESHTASTICATOR_PATH  path to the Meshtasticator checkout.
                        Defaults to a sibling "Meshtasticator" directory
                        next to this repo (../../../Meshtasticator from here).
"""
import json
import os
import shutil
import subprocess
import sys
import time
import types

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(THIS_DIR, "..", ".."))
CORE_EMIT_SCRIPT = os.path.join(REPO_ROOT, "packages", "core", "dist", "scripts", "emit-alert.js")

MESHTASTICATOR_PATH = os.environ.get(
    "MESHTASTICATOR_PATH",
    os.path.abspath(os.path.join(REPO_ROOT, "..", "Meshtasticator")),
)

CONTAINER_NAME = "Meshtastic"
PRIVATE_APP_PORT = 256  # PortNum range 256-511 is reserved for private/custom apps.


def emit_alert(mode="genuine", **kwargs):
    """Calls into packages/core (Node) to build and sign a real alert packet.
    packages/core is the only place that ever signs a packet -- this script
    only ever moves the bytes it's handed back."""
    if not os.path.exists(CORE_EMIT_SCRIPT):
        raise SystemExit(
            f"{CORE_EMIT_SCRIPT} not found. Build it first:\n"
            f"  cd {os.path.join(REPO_ROOT, 'packages', 'core')} && "
            f"..\\..\\node_modules\\.bin\\tsc -p tsconfig.json"
        )
    args = ["node", CORE_EMIT_SCRIPT, "--mode", mode]
    for key, value in kwargs.items():
        args += [f"--{key.replace('_', '-')}", str(value)]
    result = subprocess.run(args, capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def reset_container():
    """Removes any leftover container from a previous run so node ports
    don't collide -- InteractiveSim always names its container 'Meshtastic'."""
    import docker

    client = docker.from_env()
    try:
        existing = client.containers.get(CONTAINER_NAME)
        print(f"Removing leftover '{CONTAINER_NAME}' container from a previous run...")
        existing.stop()
    except docker.errors.NotFound:
        pass


def install_topology():
    """Copies our deterministic 5-node layout into Meshtasticator's
    out/nodeConfig.yaml, where its --from-file loader expects it."""
    out_dir = os.path.join(MESHTASTICATOR_PATH, "out")
    os.makedirs(out_dir, exist_ok=True)
    shutil.copyfile(
        os.path.join(THIS_DIR, "topology.yaml"),
        os.path.join(out_dir, "nodeConfig.yaml"),
    )


def build_sim():
    """Boots Meshtasticator's InteractiveSim directly via its Python API --
    not via interactiveSim.py's CLI, which needs a live terminal for its
    (Cmd) prompt and can't be driven from here. Returns the live sim."""
    if MESHTASTICATOR_PATH not in sys.path:
        sys.path.insert(0, MESHTASTICATOR_PATH)
    os.chdir(MESHTASTICATOR_PATH)  # InteractiveSim reads out/nodeConfig.yaml relative to cwd

    from lib.interactive import InteractiveSim

    args = types.SimpleNamespace(
        script=False,
        docker=True,
        forward=False,
        collisions=False,
        from_file=True,
        nrNodes=0,  # ignored when from_file is set
        verbose=False,
    )
    print("Booting 4-node topology in Docker (sensor, relay A, relay B, hub)...")
    return InteractiveSim(args)


def node_pids(container):
    """Maps nodeid -> host PID of its meshtasticd process, by reading the
    container's own /proc -- used to kill a specific relay for the
    node-failure test. There's no supported API for this; it's the same
    information 'docker exec ... ps' would show, read directly."""
    exit_code, output = container.exec_run(
        ["sh", "-c", "for p in /proc/[0-9]*; do tr '\\0' ' ' < $p/cmdline; echo \" [$p]\"; done"]
    )
    pids = {}
    for line in output.decode(errors="replace").splitlines():
        for nodeid in range(8):
            if f"/home/node{nodeid} " in line and "meshtasticd -s -d" in line:
                pid = line.strip().split("[/proc/")[-1].rstrip("]")
                pids[nodeid] = pid
    return pids
