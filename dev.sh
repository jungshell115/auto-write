#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.yml"
BACKEND_DIR="$ROOT_DIR/backend"
VENV_DIR="$BACKEND_DIR/.venv"
LOCAL_PID_FILE="$ROOT_DIR/.local_api.pid"
LOCAL_LOG_FILE="$ROOT_DIR/.local_api.log"

cmd="${1:-}"

case "$cmd" in
  up)
    docker compose -f "$COMPOSE_FILE" up -d --build
    ;;
  down)
    docker compose -f "$COMPOSE_FILE" down
    ;;
  restart)
    docker compose -f "$COMPOSE_FILE" down
    docker compose -f "$COMPOSE_FILE" up -d --build
    ;;
  logs)
    docker compose -f "$COMPOSE_FILE" logs -f "${2:-}"
    ;;
  ps)
    docker compose -f "$COMPOSE_FILE" ps
    ;;
  health)
    curl -sS -i -m 2 http://localhost:8000/health
    ;;
  local-up)
    if [ ! -d "$VENV_DIR" ]; then
      python3 -m venv "$VENV_DIR"
    fi
    "$VENV_DIR/bin/pip" install -r "$BACKEND_DIR/requirements.txt" >/dev/null
    (
      cd "$BACKEND_DIR"
      set -a
      if [ -f ".env" ]; then
        . ".env"
      fi
      set +a
      nohup "$VENV_DIR/bin/uvicorn" api.main:app --host 0.0.0.0 --port 8000 >"$LOCAL_LOG_FILE" 2>&1 &
      echo $! >"$LOCAL_PID_FILE"
    )
    for i in {1..15}; do
      if curl -sS -m 1 http://localhost:8000/health >/dev/null 2>&1; then
        exit 0
      fi
      sleep 1
    done
    if [ -f "$LOCAL_LOG_FILE" ]; then
      tail -n 200 "$LOCAL_LOG_FILE"
    fi
    exit 1
    ;;
  local-down)
    if [ -f "$LOCAL_PID_FILE" ]; then
      kill "$(cat "$LOCAL_PID_FILE")" 2>/dev/null || true
      rm -f "$LOCAL_PID_FILE"
    fi
    ;;
  local-logs)
    if [ -f "$LOCAL_LOG_FILE" ]; then
      tail -n 200 "$LOCAL_LOG_FILE"
    fi
    ;;
  *)
    echo "Usage: $0 {up|down|restart|logs [service]|ps|health|local-up|local-down|local-logs}"
    exit 2
    ;;
esac
