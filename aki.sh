#!/usr/bin/env bash
# AKI MCP switch — starts and stops the stack as one unit.
#
# Usage:
#   ./aki.sh            # toggle
#   ./aki.sh start|stop|restart|status
#   ./aki.sh tray [--autostart]   # show the tray icon (needs PyQt6)
#   ./aki.sh install [--no-tray]  # install or refresh the systemd unit, then start the tray
#   ./aki.sh up                   # install if needed, start the stack, show the tray
#
# All configuration lives in .env, which start.js loads by itself. This script only reads the
# ports back out of it for status reporting, so there is exactly one place to edit.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$REPO_ROOT/.env"
USER_DIR="$HOME/.aki/mcpsv"
STATE_FILE="$USER_DIR/run-pids.json"
PANEL_URL_FILE="$USER_DIR/panel-url.txt"
LOG_DIR="$USER_DIR/logs"
UNIT_NAME="aki-mcp.service"
UNIT_PATH="$HOME/.config/systemd/user/$UNIT_NAME"

mkdir -p "$LOG_DIR"

# Read a KEY=value out of .env by hand rather than sourcing it: a stray command in a config
# file should never get to run with this script's privileges.
read_env() {
  local key="$1" fallback="${2:-}" value=""
  if [[ -f "$ENV_FILE" ]]; then
    value=$(sed -nE "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*\"?([^\"#]*)\"?.*/\1/p" "$ENV_FILE" | tail -n1)
    value="${value%"${value##*[![:space:]]}"}"   # strip trailing whitespace
  fi
  printf '%s' "${value:-$fallback}"
}

GATEKEEPER_PORT="$(read_env GATEKEEPER_PORT 9999)"
PANEL_PORT="$(read_env PANEL_PORT 9998)"
PUBLIC_ORIGIN="$(read_env PUBLIC_ORIGIN)"

# start.js publishes the panel URL with its per-boot token; the bare port only 403s.
panel_url() {
  if [[ -s "$PANEL_URL_FILE" ]]; then
    head -n1 "$PANEL_URL_FILE"
  else
    printf 'http://127.0.0.1:%s/ (not running — no token yet)' "$PANEL_PORT"
  fi
}

# scripts/install.sh installs a systemd --user unit. When that unit exists it owns the
# stack, so this script delegates instead of spawning a second copy behind its back.
use_systemd() { [[ -f "$UNIT_PATH" ]]; }

state_pid() {
  [[ -f "$STATE_FILE" ]] || return 0
  sed -nE 's/.*"node"[[:space:]]*:[[:space:]]*"?([0-9]+)"?.*/\1/p' "$STATE_FILE" | head -n1
}

test_alive() { [[ -n "${1:-}" ]] && kill -0 "$1" 2>/dev/null; }

is_running() {
  # An inactive unit is not proof of a stopped stack: a stack started with nohup before the
  # unit existed still holds the ports. Fall through to the pid file rather than lying.
  if use_systemd && [[ "$(systemctl --user is-active "$UNIT_NAME" 2>/dev/null)" == "active" ]]; then
    return 0
  fi
  test_alive "$(state_pid)"
}

get_status() {
  if use_systemd; then
    systemctl --user status --no-pager "$UNIT_NAME" || true
  else
    local pid; pid="$(state_pid)"
    echo "NodePid:   ${pid:-none}"
    echo "NodeAlive: $(test_alive "$pid" && echo true || echo false)"
  fi
  local listening=false
  if command -v ss &>/dev/null && ss -ltn "sport = :${GATEKEEPER_PORT}" 2>/dev/null | grep -q LISTEN; then
    listening=true
  fi
  echo "Listening: $listening (port $GATEKEEPER_PORT)"
  echo "PanelUrl:  $(panel_url)"
  echo "Origin:    ${PUBLIC_ORIGIN:-<none>}"
}

start_stack() {
  if use_systemd; then
    systemctl --user start "$UNIT_NAME"
    echo "ON   ${PUBLIC_ORIGIN}/mcp  (systemd: $UNIT_NAME)"
    return 0
  fi

  if is_running; then
    echo "already running" >&2
    return 1
  fi

  local stamp; stamp=$(date +%Y%m%d-%H%M%S)
  cd "$REPO_ROOT"   # start.js reads .env relative to the working directory

  # setsid gives the stack its own process group, which is what makes `kill -- -PID` below a
  # complete stop: npm, node and cloudflared all go down together, with no pkill guesswork.
  setsid nohup npm start > "$LOG_DIR/mcp-$stamp.log" 2> "$LOG_DIR/mcp-$stamp.err.log" < /dev/null &
  local pid=$!

  printf '{"node": "%s", "started": "%s"}\n' "$pid" "$(date -Iseconds)" > "$STATE_FILE"

  echo "  mcp server  pid $pid"
  echo "ON   ${PUBLIC_ORIGIN}/mcp"
  echo "logs $LOG_DIR"
}

stop_stack() {
  if use_systemd; then
    systemctl --user stop "$UNIT_NAME"

    # A stack started with nohup before the unit existed is invisible to systemd, so
    # `systemctl stop` reports success while the process keeps serving. Reap it here.
    local legacy; legacy="$(state_pid)"
    if test_alive "$legacy"; then
      echo "reaping pre-systemd stack (pid $legacy)"
      kill -TERM -- "-$legacy" 2>/dev/null || kill -TERM "$legacy" 2>/dev/null || true
      for _ in $(seq 1 15); do test_alive "$legacy" || break; sleep 1; done
      test_alive "$legacy" && kill -9 -- "-$legacy" 2>/dev/null || true
    fi
    rm -f "$STATE_FILE"
    echo "OFF"
    return 0
  fi

  local pid; pid="$(state_pid)"
  if test_alive "$pid"; then
    # SIGTERM to the whole group: start.js's own handler tears down cloudflared and the
    # Postman daemon, so give it a few seconds before escalating.
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 10); do test_alive "$pid" || break; sleep 1; done
    test_alive "$pid" && kill -9 -- "-$pid" 2>/dev/null || true
  fi

  # No global `pkill cloudflared` here on purpose: it would also kill unrelated tunnels
  # running on this machine. The process group above already covers our own.
  rm -f "$STATE_FILE"
  echo "OFF"
}

# The tray lives here too rather than in its own launcher script: it is three lines of
# preflight, and one entry point per platform is easier to document than four.
launch_tray() {
  if ! python3 -c 'import PyQt6.QtWidgets' 2>/dev/null; then
    echo "PyQt6 is missing. Install it with:  sudo pacman -S --needed python-pyqt6" >&2
    return 1
  fi
  # setsid detaches the tray from this shell, so closing the terminal never takes the icon with it.
  setsid -f python3 "$REPO_ROOT/scripts/tray.py" "$@"
}

# Installation lives in its own script because it writes outside the repo (systemd unit,
# desktop entry). Only the delegation lives here, so there is one command to remember.
run_install() { "$REPO_ROOT/scripts/install.sh" "$@"; }

# The unit merely existing is not enough: a unit left over from another checkout points
# WorkingDirectory at that other repo, and `systemctl start` would happily boot the wrong
# copy. Comparing the path is what makes `up` heal that case instead of repeating it.
needs_install() {
  [[ -f "$UNIT_PATH" ]] || return 0
  ! grep -qx "WorkingDirectory=$REPO_ROOT" "$UNIT_PATH"
}

# One command for a fresh machine, and safe to re-run: install.sh and start_stack are both
# idempotent, and tray.py holds a single-instance lock.
bring_up() {
  if needs_install; then
    echo "installing systemd unit for $REPO_ROOT"
    run_install "$@"
  fi
  is_running || start_stack
  launch_tray || true
  echo "PanelUrl:  $(panel_url)"
}

case "${1:-toggle}" in
  start)   start_stack ;;
  stop)    stop_stack ;;
  status)  get_status ;;
  tray)    shift; launch_tray "$@" ;;
  install) shift; run_install "$@" ;;
  up)      shift; bring_up "$@" ;;
  restart)
    stop_stack
    # Cloudflare's edge needs a moment to drop the old connector; restarting too fast serves 502s.
    sleep 6
    start_stack
    ;;
  toggle)
    if is_running; then stop_stack; else start_stack; fi
    ;;
  *)
    echo "Usage: $0 {up|start|stop|restart|status|toggle|tray|install}" >&2
    exit 1
    ;;
esac
