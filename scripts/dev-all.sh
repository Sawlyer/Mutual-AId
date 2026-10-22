#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_PID=""
FRONTEND_PID=""

stop_servers() {
  trap - INT TERM EXIT
  for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
    [[ -z "$pid" ]] || kill -TERM "$pid" 2>/dev/null || true
  done
  for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
    [[ -z "$pid" ]] || wait "$pid" 2>/dev/null || true
  done
}

port_is_open() {
  local host="$1" port="$2"
  curl --silent --max-time 1 "http://${host}:${port}/" -o /dev/null
}

backend_is_healthy() {
  curl --fail --silent --show-error --max-time 2 \
    "http://${BACKEND_HOST}:${BACKEND_PORT}/api/health" -o /dev/null
}

frontend_is_healthy() {
  curl --fail --silent --show-error --max-time 2 \
    "http://${FRONTEND_HOST}:${FRONTEND_PORT}/" -o /dev/null
}

for command_name in npm uv curl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Commande requise introuvable : %s\n' "$command_name" >&2
    exit 1
  fi
done

if port_is_open "$BACKEND_HOST" "$BACKEND_PORT" || port_is_open "$FRONTEND_HOST" "$FRONTEND_PORT"; then
  if backend_is_healthy && frontend_is_healthy; then
    printf 'Mutual-AId est déjà démarré :\n  Frontend : http://%s:%s\n  Backend  : http://%s:%s\n' \
      "$FRONTEND_HOST" "$FRONTEND_PORT" "$BACKEND_HOST" "$BACKEND_PORT"
    exit 0
  fi

  printf 'Un port requis est déjà utilisé, mais les deux services Mutual-AId ne répondent pas correctement.\n' >&2
  printf 'Ports attendus : frontend %s, backend %s. Arrêtez le processus qui occupe le port puis relancez.\n' \
    "$FRONTEND_PORT" "$BACKEND_PORT" >&2
  exit 1
fi

cd "$ROOT_DIR"
if [[ ! -d node_modules ]]; then
  printf 'Installation des dépendances frontend…\n'
  npm ci
fi
if [[ ! -f .env.local ]]; then cp .env.example .env.local; fi
if [[ ! -f backend/.env ]]; then cp backend/.env.example backend/.env; fi

printf 'Préparation des dépendances backend…\n'
(cd backend && uv sync --group dev --locked)

trap stop_servers INT TERM EXIT

printf 'Démarrage du backend FastAPI (http://%s:%s)…\n' "$BACKEND_HOST" "$BACKEND_PORT"
(
  cd "$ROOT_DIR/backend"
  exec .venv/bin/uvicorn app.main:app --reload --host "$BACKEND_HOST" --port "$BACKEND_PORT"
) &
BACKEND_PID=$!

printf 'Démarrage du frontend Vite (http://%s:%s)…\n' "$FRONTEND_HOST" "$FRONTEND_PORT"
(
  cd "$ROOT_DIR"
  VITE_API_PROXY_TARGET="http://${BACKEND_HOST}:${BACKEND_PORT}" \
    exec ./node_modules/.bin/vite --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" --strictPort
) &
FRONTEND_PID=$!

printf '\nMutual-AId démarre. Ctrl+C arrête le frontend et le backend.\n'
if wait -n "$BACKEND_PID" "$FRONTEND_PID"; then
  exit_code=0
else
  exit_code=$?
fi
exit "$exit_code"
