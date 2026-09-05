#!/usr/bin/env python3
"""AKI MCP tray icon for KDE Plasma - the Linux counterpart of scripts/tray.ps1.

Every action delegates to systemd (preferred) or aki.sh, so the tray never becomes
a second implementation of start/stop.

Usage:
    ./aki.sh tray                 normal launch
    ./aki.sh tray --autostart     also bring the MCP stack up
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from PyQt6.QtCore import QTimer, Qt
from PyQt6.QtGui import QColor, QIcon, QPainter, QPen, QPixmap
from PyQt6.QtNetwork import QLocalServer, QLocalSocket
from PyQt6.QtWidgets import QApplication, QMenu, QSystemTrayIcon

REPO_ROOT = Path(__file__).resolve().parent.parent
SWITCH_SCRIPT = REPO_ROOT / "aki.sh"
ENV_FILE = REPO_ROOT / ".env"
LOGO_PATH = REPO_ROOT / "public" / "obs-tray.svg"

USER_DIR = Path.home() / ".aki" / "mcpsv"
STATE_FILE = USER_DIR / "run-pids.json"
# start.js writes this on every boot: the panel token is regenerated each time, so the bare
# host:port only ever gets a 403.
PANEL_URL_FILE = USER_DIR / "panel-url.txt"
LOG_DIR = USER_DIR / "logs"
TRAY_LOG = LOG_DIR / "tray.log"

UNIT_NAME = "aki-mcp.service"
UNIT_PATH = Path.home() / ".config" / "systemd" / "user" / UNIT_NAME
AUTOSTART_PATH = Path.home() / ".config" / "autostart" / "aki-mcp-tray.desktop"
# aki.sh is the single Linux entry point; "tray" is its subcommand for this script.
LAUNCHER = REPO_ROOT / "aki.sh"
LAUNCHER_ARGS = "tray"

# Cloudflare's edge needs a moment to drop the old connector; restarting too fast serves 502s.
RESTART_DELAY_MS = 6000
SINGLE_INSTANCE_KEY = "aki-mcp-tray"


def log(message):
    """A hidden launch shows no console, so any failure has to surface by itself."""
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with TRAY_LOG.open("a", encoding="utf-8") as handle:
            handle.write(f"[{stamp}] {message}\n")
    except OSError:
        pass


def read_env(key, fallback=""):
    """.env is the single source of truth start.js itself loads, so read it rather than aki.sh.

    Parsed by hand instead of sourced: a config file must never execute anything here.
    """
    try:
        text = ENV_FILE.read_text(encoding="utf-8")
    except OSError:
        return fallback
    match = None
    for found in re.finditer(rf'^[ \t]*{key}[ \t]*=[ \t]*"?([^"#\n]*)"?', text, re.MULTILINE):
        match = found  # last assignment wins, the way a shell would treat it
    return match.group(1).strip() if match else fallback


class Backend:
    """systemd owns the stack when the unit is installed; aki.sh covers a plain clone.

    Auto-detecting instead of hardcoding keeps a single source of truth either way:
    whatever started the stack is also what reports on it and what stops it.
    """

    def __init__(self):
        self.systemd = UNIT_PATH.exists()

    def _systemctl(self, *args, check_output=False):
        cmd = ["systemctl", "--user", *args]
        if check_output:
            result = subprocess.run(cmd, capture_output=True, text=True)
            return result.stdout.strip()
        subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return ""

    def _script(self, action):
        subprocess.Popen(
            ["bash", str(SWITCH_SCRIPT), action],
            cwd=str(REPO_ROOT),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )

    def is_running(self):
        if self.systemd and self._systemctl("is-active", UNIT_NAME, check_output=True) == "active":
            return True
        # An inactive unit is not proof of a stopped stack: a stack started with nohup before
        # the unit existed still holds the ports, and showing it as stopped is a lie the user
        # cannot act on. Reading /proc is the cheap equivalent of `kill -0`, with no signal sent.
        try:
            pid = json.loads(STATE_FILE.read_text(encoding="utf-8")).get("node")
        except (OSError, ValueError):
            return False
        return bool(pid) and Path(f"/proc/{pid}").exists()

    def start(self):
        self._systemctl("start", UNIT_NAME) if self.systemd else self._script("start")

    def stop(self):
        # aki.sh stop reaps a pre-systemd nohup stack too, which plain `systemctl stop` cannot.
        self._script("stop")

    def is_enabled_at_login(self):
        if self.systemd:
            return self._systemctl("is-enabled", UNIT_NAME, check_output=True) == "enabled"
        # Without systemd the only lever is the autostart entry carrying --autostart.
        return AUTOSTART_PATH.exists() and "--autostart" in AUTOSTART_PATH.read_text(encoding="utf-8")

    def set_enabled_at_login(self, enabled):
        if self.systemd:
            self._systemctl("enable" if enabled else "disable", UNIT_NAME)
        else:
            write_autostart(True, enabled)


def write_autostart(show_icon, with_autostart):
    """Showing the icon at login and starting the server at login are two separate decisions."""
    if not show_icon:
        AUTOSTART_PATH.unlink(missing_ok=True)
        return
    AUTOSTART_PATH.parent.mkdir(parents=True, exist_ok=True)
    exec_line = f"{LAUNCHER} {LAUNCHER_ARGS}" + (" --autostart" if with_autostart else "")
    AUTOSTART_PATH.write_text(
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=AKI MCP\n"
        "Comment=AKI MCP server tray icon\n"
        f"Exec={exec_line}\n"
        f"Icon={LOGO_PATH}\n"
        "Terminal=false\n"
        "X-GNOME-Autostart-enabled=true\n"
        # Plasma restores the tray before the systray host is ready otherwise, and the icon is dropped.
        "X-KDE-autostart-phase=2\n",
        encoding="utf-8",
    )


def status_icon(running):
    """The project logo with a status dot burned into the corner: readable at 16px."""
    pixmap = QPixmap(32, 32)
    pixmap.fill(Qt.GlobalColor.transparent)

    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)

    base = QPixmap(str(LOGO_PATH)) if LOGO_PATH.exists() else QPixmap()
    if not base.isNull():
        painter.drawPixmap(0, 0, 32, 32, base)
    else:
        # Last-resort mark, so a missing logo still leaves a usable tray icon.
        painter.setBrush(QColor(40, 44, 52))
        painter.setPen(Qt.PenStyle.NoPen)
        painter.drawEllipse(0, 0, 32, 32)
        painter.setPen(QColor("white"))
        font = painter.font()
        font.setPixelSize(18)
        font.setBold(True)
        painter.setFont(font)
        painter.drawText(pixmap.rect(), Qt.AlignmentFlag.AlignCenter, "A")

    status_size = 6
    status_x = 32 - status_size - 5
    status_y = 32 - status_size - 5

    painter.setBrush(QColor(46, 204, 113) if running else QColor(231, 76, 60))
    painter.setPen(QPen(QColor("white"), 1))
    painter.drawEllipse(status_x, status_y, status_size, status_size)
    painter.end()

    return QIcon(pixmap)


class Tray:
    def __init__(self, app, autostart):
        self.app = app
        self.backend = Backend()
        self.last_running = None

        self.panel_port = read_env("PANEL_PORT", "9998")
        self.origin = read_env("PUBLIC_ORIGIN").rstrip("/")
        self.mcp_url = f"{self.origin}/mcp" if self.origin else ""

        self.icon_running = status_icon(True)
        self.icon_stopped = status_icon(False)

        self.tray = QSystemTrayIcon(self.icon_stopped)
        self.menu = QMenu()

        # The header doubles as the copy button: pasting the MCP URL into a client is by far
        # the most frequent thing anyone does with this stack.
        self.header = self.menu.addAction("MCP")
        self.header.setToolTip("Click to copy the MCP URL")
        font = self.header.font()
        font.setBold(True)
        self.header.setFont(font)
        self.header.triggered.connect(self.copy_url)

        self.menu.addSeparator()
        self.act_start = self.menu.addAction("Start")
        self.act_start.triggered.connect(self.backend.start)
        self.act_stop = self.menu.addAction("Stop")
        self.act_stop.triggered.connect(self.backend.stop)
        self.act_restart = self.menu.addAction("Restart")
        self.act_restart.triggered.connect(self.restart)

        self.menu.addSeparator()
        self.act_settings = self.menu.addAction("Settings...")
        self.act_settings.triggered.connect(self.open_panel)
        self.menu.addAction("Open logs folder").triggered.connect(self.open_logs)

        self.menu.addSeparator()
        self.act_show_at_login = self.menu.addAction("Show icon at startup")
        self.act_show_at_login.setCheckable(True)
        self.act_show_at_login.triggered.connect(self.toggle_show_at_login)
        self.act_server_at_login = self.menu.addAction("Start server at startup")
        self.act_server_at_login.setCheckable(True)
        self.act_server_at_login.triggered.connect(self.toggle_server_at_login)

        self.menu.addSeparator()
        self.menu.addAction("Exit").triggered.connect(self.quit)

        self.menu.aboutToShow.connect(self.update)
        self.tray.setContextMenu(self.menu)
        # Plasma opens the menu on left click by itself; a middle click is a handy toggle.
        self.tray.activated.connect(self.on_activated)

        # The first run installs the autostart entry by itself, so the icon is simply there
        # after a reboot. Starting the server stays opt-in.
        marker = USER_DIR / "tray-installed"
        if not marker.exists():
            USER_DIR.mkdir(parents=True, exist_ok=True)
            marker.touch()
            if not AUTOSTART_PATH.exists():
                write_autostart(True, False)
                log("Installed the autostart entry (icon only).")

        self.update()
        self.tray.show()

        self.timer = QTimer()
        self.timer.setInterval(3000)
        self.timer.timeout.connect(self.update)
        self.timer.start()
        log(f"Tray started (backend={'systemd' if self.backend.systemd else 'aki.sh'}).")

        if autostart and not self.backend.is_running():
            self.backend.start()

    def panel_url(self):
        """The tokenised URL start.js published this boot, or nothing if the stack is down."""
        try:
            url = PANEL_URL_FILE.read_text(encoding="utf-8").strip()
        except OSError:
            return ""
        return url

    def on_activated(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.MiddleClick:
            self.backend.stop() if self.backend.is_running() else self.backend.start()

    def copy_url(self):
        if not self.mcp_url:
            return
        # QClipboard needs the app to stay alive on Wayland - the tray always does.
        self.app.clipboard().setText(self.mcp_url)
        self.tray.showMessage("AKI MCP", f"Copied {self.mcp_url}", self.icon_running, 2000)

    def restart(self):
        self.backend.stop()
        QTimer.singleShot(RESTART_DELAY_MS, self.backend.start)

    def open_panel(self):
        url = self.panel_url()
        if not url:
            self.tray.showMessage(
                "AKI MCP",
                "Start the server first - the panel token only exists while it runs.",
                self.icon_stopped,
                3000,
            )
            return
        self.open_path(url)

    def open_path(self, target):
        subprocess.Popen(
            ["xdg-open", target],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )

    def open_logs(self):
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        self.open_path(str(LOG_DIR))

    def toggle_show_at_login(self):
        write_autostart(not AUTOSTART_PATH.exists(), self.backend.is_enabled_at_login())

    def toggle_server_at_login(self):
        enabled = not self.backend.is_enabled_at_login()
        # Wanting the server at login implies wanting the icon there too.
        if enabled and not AUTOSTART_PATH.exists():
            write_autostart(True, False)
        self.backend.set_enabled_at_login(enabled)

    def update(self):
        running = self.backend.is_running()

        if self.last_running != running:
            self.tray.setIcon(self.icon_running if running else self.icon_stopped)
            self.last_running = running

        state = "running" if running else "stopped"
        self.tray.setToolTip(f"MCP - {state}")
        self.header.setText(f"MCP - {state} - {self.origin}" if self.origin else f"MCP - {state}")
        # Nothing to copy without an origin, and a dead item explains itself better than a silent click.
        self.header.setEnabled(bool(self.mcp_url))
        self.act_start.setEnabled(not running)
        self.act_stop.setEnabled(running)
        self.act_restart.setEnabled(running)
        # The panel is only reachable with the token of the current boot.
        self.act_settings.setEnabled(bool(self.panel_url()))
        self.act_show_at_login.setChecked(AUTOSTART_PATH.exists())
        self.act_server_at_login.setChecked(self.backend.is_enabled_at_login())

    def quit(self):
        self.tray.hide()
        log("Tray exited.")
        self.app.quit()


def main():
    app = QApplication(sys.argv)
    # Without this the tray dies as soon as the balloon message closes: no window is ever shown.
    app.setQuitOnLastWindowClosed(False)
    app.setApplicationName("AKI MCP")
    app.setDesktopFileName("aki-mcp-tray")

    # QLocalServer is the portable stand-in for the Windows named mutex.
    probe = QLocalSocket()
    probe.connectToServer(SINGLE_INSTANCE_KEY)
    if probe.waitForConnected(200):
        log("Another tray instance is already running.")
        return 0
    server = QLocalServer()
    QLocalServer.removeServer(SINGLE_INSTANCE_KEY)
    server.listen(SINGLE_INSTANCE_KEY)

    if not QSystemTrayIcon.isSystemTrayAvailable():
        log("FAILED: no system tray available on this session.")
        print("No system tray available - is the Plasma panel running?", file=sys.stderr)
        return 1

    tray = Tray(app, autostart="--autostart" in sys.argv)
    _ = tray  # keep a reference: the tray dies with its Python object
    return app.exec()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:  # a hidden launch has no console to print to
        log(f"FAILED: {error!r}")
        if os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"):
            subprocess.run(["kdialog", "--error", f"MCP tray failed to start:\n{error}"], check=False)
        raise
