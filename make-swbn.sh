#!/bin/bash
# Package dist/ as a signed Web Bundle (.swbn) for installing FreeRDP Web as an Isolated Web App
# without the dev server. The app identity (isolated-app://<ID>/) is derived from the signing
# key: keep the key private and use the same one for every release (version must increase).
set -euo pipefail
cd "$(dirname "$0")"
KEY=${KEY:-$HOME/.config/freerdp-web/iwa-signing-key.pem}
[ -f "$KEY" ] || { echo "no signing key at $KEY (openssl genpkey -algorithm ed25519 -out $KEY)"; exit 1; }
VERSION=$(python3 -c 'import json; print(json.load(open("dist/.well-known/manifest.webmanifest"))["version"])')
# wbn-dump-id prints colour codes even when piped: strip them
ID=$(npx -y -p wbn-sign wbn-dump-id -k "$KEY" | sed 's/\x1b\[[0-9;]*m//g' | tr -d '[:space:]')
STAGE=out/bundle; rm -rf "$STAGE"; mkdir -p "$STAGE"
cp -r dist/. "$STAGE/"; find "$STAGE" -name '*.gz' -delete      # the bundle stores files itself
npx -y wbn --dir "$STAGE" --baseURL "isolated-app://$ID/" -o out/freerdp-web.wbn >/dev/null
npx -y -p wbn-sign wbn-sign -i out/freerdp-web.wbn -k "$KEY" -o "out/freerdp-web-$VERSION.swbn"
rm -f out/freerdp-web.wbn
ls -la "out/freerdp-web-$VERSION.swbn"
echo "app: isolated-app://$ID/  version $VERSION"
