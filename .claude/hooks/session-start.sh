#!/bin/bash
set -euo pipefail

# SessionStart hook — Claude Code na web (środowisko zdalne).
#
# Instaluje zależności przez `npm ci` (npm clean-install) — DOKŁADNIE tak, jak
# robi to build Cloudflare Pages. Dzięki temu konflikty peer-dependencies oraz
# rozjazd package.json/package-lock ujawniają się od razu na starcie sesji,
# a nie dopiero przy deployu na produkcję.
#
# Świadomie NIE używamy `npm install` — jest pobłażliwe dla peer-deps (tylko
# ostrzega), więc przepuściłoby konflikt, który `npm ci` (i Cloudflare) odrzuca.

# Uruchamiaj tylko w zdalnym środowisku, nie na lokalnej maszynie dewelopera.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

echo "[session-start] npm ci — ścisła instalacja zależności (jak build Cloudflare)…"
npm ci --no-audit --no-fund
echo "[session-start] Zależności gotowe."
