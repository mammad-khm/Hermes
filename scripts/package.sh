#!/usr/bin/env bash
# Builds the web app and packages everything the server needs into dist/hermes-console.tar.gz
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/web"
npm run build

STAGE="$(mktemp -d)"
mkdir -p "$STAGE/server" "$STAGE/web" "$STAGE/deploy"
cp "$ROOT/server/hermes_console.py" "$STAGE/server/"
cp "$ROOT/server/console.env.example" "$STAGE/server/"
cp -R "$ROOT/web/dist" "$STAGE/web/dist"
cp "$ROOT/deploy/install-service.sh" "$STAGE/deploy/"
cp "$ROOT/README.md" "$STAGE/"

mkdir -p "$ROOT/dist"
tar -czf "$ROOT/dist/hermes-console.tar.gz" -C "$STAGE" .
rm -rf "$STAGE"
echo "Created $ROOT/dist/hermes-console.tar.gz"
