#!/usr/bin/env bash
# End-to-end: condivisione del database e layout responsive.
# Condivisione: Playwright (Chromium) contro l'app compilata, con Google, Drive e Worker simulati.
# Non è tra i test di `npm test` perché serve un browser: `npm run e2e` (richiede `playwright` installato, anche globale).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$(mktemp -d)"
trap 'pkill -f "vite preview --outDir $OUT" 2>/dev/null || true; rm -rf "$OUT"' EXIT
KEY="B$(python3 -c "print('a'*86)")"
# la chiave API del Picker è impostata ma NON valida: il Picker, se si aprisse, fallirebbe; il test verifica che non venga mai aperto
VITE_PUSH_URL=http://localhost:8788 VITE_VAPID_PUBLIC_KEY="$KEY" VITE_GOOGLE_CLIENT_ID=test.apps.googleusercontent.com \
  VITE_GOOGLE_API_KEY=CHIAVE-NON-VALIDA VITE_GOOGLE_APP_ID=123456789 npx vite build --outDir "$OUT" --emptyOutDir >/dev/null
npx vite preview --outDir "$OUT" --port 4174 --strictPort >/dev/null 2>&1 &
sleep 2
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
node e2e/share.e2e.cjs
node e2e/responsive.e2e.cjs
