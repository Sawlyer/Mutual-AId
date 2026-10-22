#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PID=""
FRONTEND_PID=""

stop_servers() {
  trap - INT TERM EXIT
  [[ -z "$FRONTEND_PID" ]] || kill "$FRONTEND_PID" 2>/dev/null || true
  [[ -z "$BACKEND_PID" ]] || kill "$BACKEND_PID" 2>/dev/null || true
  [[ -z "$FRONTEND_PID" ]] || wait "$FRONTEND_PID" 2>/dev/null || true
  [[ -z "$BACKEND_PID" ]] || wait "$BACKEND_PID" 2>/dev/null || true
}

trap stop_servers INT TERM EXIT

for command_name in npm uv; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Commande requise introuvable : %s\n' "$command_name" >&2
    exit 1
  fi
done

cd "$ROOT_DIR"
if [[ ! -d node_modules ]]; then
  printf 'Installation des dépendances frontend…\n'
  npm install
fi
if [[ ! -f .env.local ]]; then cp .env.example .env.local; fi
if [[ ! -f backend/.env ]]; then cp backend/.env.example backend/.env; fi

printf 'Démarrage du backend FastAPI (http://127.0.0.1:8000)…\n'
(cd backend && uv run --group dev uvicorn app.main:app --reload --host 127.0.0.1 --port 8000) &
BACKEND_PID=$!

printf 'Démarrage du frontend Vite…\n'
npm run dev -- --host 127.0.0.1 &
FRONTEND_PID=$!

printf '\nMutual-AId démarre. Ctrl+C arrête le frontend et le backend.\n'
wait -n "$BACKEND_PID" "$FRONTEND_PID"
exit_code=$?
exit "$exit_code"
