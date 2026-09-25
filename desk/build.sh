#!/usr/bin/env bash
# Rebuild this app and publish its output as the bundle's app source.
#
#   ./desk/build.sh
#
# `apps/open-loops-desk/source/` is a prebuilt static site — index.html and its assets, no
# package.json — and that is why a fresh pod imports in seconds: with a package.json
# there, every import runs npm and a Vite build that needs three VITE_LEMMA_* values a
# fresh pod has never had, fails at the app step (imported last), and takes the
# schedules and grants down with it. Built output is uploaded as-is.
#
# Nothing pod-specific may be baked in. The host injects window.__LEMMA_CONFIG__ when
# it serves the app, so the same bytes serve any pod. But Vite inlines VITE_LEMMA_*
# from the environment AND from .env files on disk, and this repository is public —
# so the variables are unset and any .env file is moved aside for the build.
set -euo pipefail
cd "$(dirname "$0")"
OUT="../apps/open-loops-desk/source"
ENVS=(.env.local .env .env.production .env.production.local)

[ -d node_modules ] || npm ci
restore() { for f in "${ENVS[@]}"; do [ -f "$f.build-aside" ] && mv "$f.build-aside" "$f"; done; return 0; }
trap restore EXIT
for f in "${ENVS[@]}"; do [ -f "$f" ] && mv "$f" "$f.build-aside"; done
env -u VITE_LEMMA_API_URL -u VITE_LEMMA_AUTH_URL -u VITE_LEMMA_POD_ID \
    -u VITE_LEMMA_APP_NAME -u VITE_LEMMA_APP_BASE_PATH \
    npm run build

rm -rf "$OUT"
mkdir -p "$OUT"
cp -R dist/. "$OUT"/

# A pod id or an internal host in the shipped bundle would be published, so fail loudly.
if grep -rqE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|asur\.work' "$OUT"; then
  echo "refusing: build output contains a uuid or an internal host" >&2
  exit 1
fi
echo "wrote $OUT"
