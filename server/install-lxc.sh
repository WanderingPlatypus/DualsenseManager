#!/usr/bin/env bash
# Installs the PadBench server on a Debian/Ubuntu LXC or VM (run as root from the unpacked padbench folder).
set -euo pipefail
APP_DIR=/opt/padbench
DATA_DIR=/var/lib/padbench
SRC="$(cd "$(dirname "$0")/.." && pwd)"

apt-get update
apt-get install -y curl ca-certificates openssl
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id padbench >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin padbench
mkdir -p "$APP_DIR" "$DATA_DIR"
cp -r "$SRC/server" "$SRC/web" "$SRC/package.json" "$APP_DIR/"

# Self-signed certificate so Chrome/Edge on the LAN can use WebHID over https://<ip>:8443
if [ ! -f "$DATA_DIR/cert.pem" ]; then
  IP=$(hostname -I | awk '{print $1}')
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$DATA_DIR/key.pem" -out "$DATA_DIR/cert.pem" \
    -subj "/CN=padbench" -addext "subjectAltName=IP:${IP},DNS:padbench,DNS:padbench.local"
fi
chown -R padbench:padbench "$DATA_DIR"

cat > /etc/systemd/system/padbench.service <<UNIT
[Unit]
Description=PadBench controller database
After=network-online.target
Wants=network-online.target

[Service]
User=padbench
Environment=PORT=8080
Environment=HTTPS_PORT=8443
Environment=DATA_DIR=$DATA_DIR
# Environment=PADBENCH_TOKEN=change-me
ExecStart=/usr/bin/node --no-warnings $APP_DIR/server/server.js
Restart=always

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now padbench
sleep 1
IP=$(hostname -I | awk '{print $1}')
echo
echo "PadBench is running:"
echo "  http://$IP:8080   (Firefox, and the sync address for the Windows app)"
echo "  https://$IP:8443  (Chrome/Edge with full controller access — accept the certificate warning once)"
echo "Data and daily backups: $DATA_DIR"
