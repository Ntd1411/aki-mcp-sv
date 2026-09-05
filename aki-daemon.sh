#!/usr/bin/env bash
# Chạy AKI MCP server ở chế độ daemon (background), không cần systemd.
# Usage: ./aki-daemon.sh {start|stop|restart|status}
#
# Config nằm hết trong .env — start.js tự nạp file đó, script này không export gì cả.
# Nếu đã chạy scripts/install-tray.sh thì dùng ./aki.sh (nó uỷ quyền cho systemd) thay vì file này.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$REPO_ROOT/.env"
USER_DIR="$HOME/.aki/mcpsv"
PID_FILE="$USER_DIR/daemon.pid"
PANEL_URL_FILE="$USER_DIR/panel-url.txt"
LOG_DIR="$USER_DIR/logs"

mkdir -p "$LOG_DIR"

# Đọc KEY=value từ .env bằng sed thay vì source: file config không được phép chạy lệnh ở đây.
read_env() {
  local key="$1" fallback="${2:-}" value=""
  if [[ -f "$ENV_FILE" ]]; then
    value=$(sed -nE "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*\"?([^\"#]*)\"?.*/\1/p" "$ENV_FILE" | tail -n1)
    value="${value%"${value##*[![:space:]]}"}"
  fi
  printf '%s' "${value:-$fallback}"
}

PUBLIC_ORIGIN="$(read_env PUBLIC_ORIGIN)"
PANEL_PORT="$(read_env PANEL_PORT 9998)"

# start.js ghi panel URL kèm token mỗi lần boot; chỉ host:port thì bị 403.
panel_url() {
  if [[ -s "$PANEL_URL_FILE" ]]; then head -n1 "$PANEL_URL_FILE"; else printf '(chưa chạy)'; fi
}

read_pid() { [[ -f "$PID_FILE" ]] && cat "$PID_FILE" || true; }

is_running() {
  local pid; pid="$(read_pid)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

start_daemon() {
  if is_running; then
    echo "Server đang chạy rồi (PID: $(read_pid))"
    return 0
  fi

  cd "$REPO_ROOT"   # start.js đọc .env theo working directory

  local stamp; stamp=$(date +%Y%m%d-%H%M%S)
  local stdout_log="$LOG_DIR/daemon-$stamp.log"
  local stderr_log="$LOG_DIR/daemon-$stamp.err.log"

  echo "Đang khởi động AKI MCP server..."

  # setsid cho stack một process group riêng, nhờ đó `kill -- -PID` bên dưới dừng được
  # cả npm, node và cloudflared cùng lúc mà không phải pkill đoán mò.
  setsid nohup npm start > "$stdout_log" 2> "$stderr_log" < /dev/null &
  local pid=$!
  echo "$pid" > "$PID_FILE"

  # Đợi 2 giây để phát hiện crash ngay lúc boot
  sleep 2

  if is_running; then
    echo "✓ Server đã khởi động thành công"
    echo "  PID:    $pid"
    echo "  Panel:  $(panel_url)"
    echo "  Origin: ${PUBLIC_ORIGIN:-<none>}/mcp"
    echo "  Logs:   $stdout_log"
  else
    echo "✗ Server khởi động thất bại, xem log:"
    echo "  $stderr_log"
    rm -f "$PID_FILE"
    return 1
  fi
}

stop_daemon() {
  if ! is_running; then
    echo "Server không chạy"
    rm -f "$PID_FILE"
    return 0
  fi

  local pid; pid="$(read_pid)"
  echo "Đang dừng server (PID: $pid)..."

  # SIGTERM cho cả group: handler trong start.js tự tear down cloudflared và Postman daemon,
  # nên cho nó vài giây trước khi mạnh tay.
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 10); do is_running || break; sleep 1; done

  if is_running; then
    echo "Buộc dừng..."
    kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
  fi

  # Không pkill cloudflared toàn máy: sẽ giết cả tunnel khác không liên quan.
  rm -f "$PID_FILE"
  echo "✓ Server đã dừng"
}

status_daemon() {
  if ! is_running; then
    echo "Server không chạy"
    return 1
  fi
  local pid; pid="$(read_pid)"
  echo "Server đang chạy"
  echo "  PID:    $pid"
  echo "  Panel:  $(panel_url)"
  echo "  Origin: ${PUBLIC_ORIGIN:-<none>}/mcp"
  if command -v ps &>/dev/null; then
    echo "  Memory: $(ps -o rss= -p "$pid" 2>/dev/null | awk '{printf "%.1f MB", $1/1024}')"
  fi
}

case "${1:-start}" in
  start)   start_daemon ;;
  stop)    stop_daemon ;;
  restart)
    stop_daemon
    # Cloudflare cần chút thời gian để nhả connector cũ; restart quá nhanh sẽ ra 502.
    sleep 6
    start_daemon
    ;;
  status)  status_daemon ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac
