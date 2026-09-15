#!/usr/bin/env bash
# Installs Hermes Console as a systemd service for the current user.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
PY="$(command -v python3)"
HERMES="$(command -v hermes || echo "$HOME/.local/bin/hermes")"
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

if [ ! -f "$DIR/server/console.env" ]; then
  echo "Run first: python3 $DIR/server/hermes_console.py init" >&2
  exit 1
fi

$SUDO tee /etc/systemd/system/hermes-console.service >/dev/null <<EOF
[Unit]
Description=Hermes Console (web app for Hermes Agent)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$DIR/server
Environment=HOME=$HOME
Environment=PATH=$(dirname "$HERMES"):/usr/local/bin:/usr/bin:/bin
Environment=HERMES_BIN=$HERMES
ExecStart=$PY $DIR/server/hermes_console.py serve
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

$SUDO systemctl daemon-reload
$SUDO systemctl enable --now hermes-console
sleep 1
$SUDO systemctl --no-pager --lines=5 status hermes-console || true
PORT="$(grep -E '^CONSOLE_PORT=' "$DIR/server/console.env" | cut -d= -f2 || true)"
echo
echo "Hermes Console is running on port ${PORT:-8787}."
