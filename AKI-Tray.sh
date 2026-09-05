#!/usr/bin/env bash
# Shows the AKI MCP tray icon. The Linux counterpart of AKI-Tray.bat.
# Pass --autostart to also bring the MCP stack up.
#
#   ./AKI-Tray.sh              normal launch
#   ./AKI-Tray.sh --autostart  launch and start the server

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! python3 -c 'import PyQt6.QtWidgets' 2>/dev/null; then
  echo "PyQt6 is missing. Install it with:  sudo pacman -S --needed python-pyqt6" >&2
  exit 1
fi

# setsid detaches the tray from this shell, so closing the terminal never takes the icon with it.
exec setsid -f python3 "$REPO_ROOT/scripts/tray.py" "$@"
