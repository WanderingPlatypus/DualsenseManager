#!/usr/bin/env bash
# Run this in the Proxmox host shell (Datacenter > your node > Shell).
# It creates a small Debian 12 container named "padbench" and installs the PadBench server in it.
set -euo pipefail

REPO="${PADBENCH_REPO:-https://github.com/WanderingPlatypus/DualsenseManager.git}"
CTID="${CTID:-$(pvesh get /cluster/nextid)}"
BRIDGE="${BRIDGE:-vmbr0}"
ROOT_STORE="${STORAGE:-$(pvesm status --content rootdir | awk 'NR>1 && $3=="active" {print $1; exit}')}"
TMPL_STORE="${TEMPLATE_STORAGE:-$(pvesm status --content vztmpl | awk 'NR>1 && $3=="active" {print $1; exit}')}"

echo "Creating container $CTID on storage $ROOT_STORE (templates on $TMPL_STORE, network $BRIDGE, DHCP)"
pveam update >/dev/null
TEMPLATE=$(pveam available --section system | awk '/debian-12-standard/ {print $2}' | sort -V | tail -1)
if ! pveam list "$TMPL_STORE" | grep -q "$TEMPLATE"; then
  pveam download "$TMPL_STORE" "$TEMPLATE"
fi

pct create "$CTID" "$TMPL_STORE:vztmpl/$TEMPLATE" \
  --hostname padbench --cores 1 --memory 512 --swap 256 \
  --rootfs "$ROOT_STORE:4" \
  --net0 "name=eth0,bridge=$BRIDGE,ip=dhcp" \
  --unprivileged 1 --features nesting=1 --onboot 1 --start 1

echo "Waiting for the container to get an address…"
for i in $(seq 1 30); do
  IP=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')
  [ -n "${IP:-}" ] && pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1 && break
  sleep 2
done

pct exec "$CTID" -- bash -c "apt-get update -qq && apt-get install -y -qq git ca-certificates >/dev/null && git clone --depth 1 '$REPO' /opt/padbench-src && bash /opt/padbench-src/server/install-lxc.sh"

IP=$(pct exec "$CTID" -- hostname -I | awk '{print $1}')
echo
echo "Done. Container $CTID (padbench) is at $IP"
echo "  Windows app sync address: http://$IP:8080"
echo "  Chrome/Edge with full controller access: https://$IP:8443"
echo "Tip: reserve $IP for this container in your router so it never changes."
echo "To update later: pct exec $CTID -- bash /opt/padbench-src/server/update.sh"
