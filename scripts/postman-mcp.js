// local__postman_status (read-only) plus launchPostmanDaemon, the single spawn path for the
// Postman control daemon (scripts/aki-pmcontrol/). Launch is a panel action (POST /api/postman-launch,
// scripts/panel.js) triggered from the panel's Postman tab — never an env flag, never a boot-time
// default. `npm start` never calls launchPostmanDaemon. No CDP, no ensureRunning here either: that
// stays inside the daemon child, never this module.
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Default import, not `{ spawn }`: node:test's mock.method only intercepts the shared exports
// object a default import resolves to, not a named-import binding — postman-mcp.test.js relies on
// mocking this without spawning a real process.
import cp from 'node:child_process';
import { ok } from './mcp-tool.js';
import daemonPid from './aki-pmcontrol/scripts/daemon-pid.js';

const DATA_JSON_PATH = path.join(os.homedir(), '.aki', 'cdp-postman', 'data.json');
const NEW_WINDOW_FLAG_PATH = path.join(path.dirname(DATA_JSON_PATH), 'new-window.flag');
const DAEMON_SCRIPT_PATH = fileURLToPath(new URL('./aki-pmcontrol/index.js', import.meta.url));

let daemonProcess = null;

function readDataFile() {
  if (!existsSync(DATA_JSON_PATH)) return null;
  try {
    const data = JSON.parse(readFileSync(DATA_JSON_PATH, 'utf8'));
    return { updatedAt: statSync(DATA_JSON_PATH).mtime.toISOString(), everAttached: !!data.access_token };
  } catch {
    return null;
  }
}

function childRunning() {
  return !!daemonProcess && daemonProcess.exitCode === null && !daemonProcess.killed;
}

function filePidLive() {
  const pid = daemonPid.read();
  return pid && daemonPid.live(pid) ? pid : null;
}

export function getDaemonStatus() {
  if (childRunning()) return { running: true, pid: daemonProcess.pid, dataFile: readDataFile() };
  const pid = filePidLive();
  if (pid) return { running: true, pid, dataFile: readDataFile() };
  return { running: false, pid: null, dataFile: readDataFile() };
}

function whenChildSpawned(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = () => {
      if (settled) return;
      if (!child.pid || child.exitCode !== null || child.killed) {
        fail(new Error('daemon spawn produced no live pid'));
        return;
      }
      settled = true;
      detach();
      resolve();
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      detach();
      if (daemonProcess === child) daemonProcess = null;
      reject(err);
    };
    const onError = (e) => fail(new Error(`daemon failed to start: ${e.message}`));
    const onExit = (code) => fail(new Error(`daemon exited before it was running (code ${code})`));
    const detach = () => {
      child.off?.('error', onError);
      child.off?.('exit', onExit);
      child.off?.('spawn', succeed);
    };
    child.on('error', onError);
    child.on('exit', onExit);
    child.on('spawn', succeed);
    if (child.pid) queueMicrotask(succeed);
  });
}

function whenChildExits(child) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => reject(new Error('daemon did not exit after kill')), 8000);
    child.on('exit', () => { clearTimeout(timer); resolve(); });
  });
}

function whenPidDies(pid) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (!daemonPid.live(pid)) return resolve();
      if (Date.now() - started > 8000) return reject(new Error('daemon did not exit after kill'));
      setTimeout(tick, 50);
    };
    tick();
  });
}

// The one spawn path (pattern.A1): recognizes an already-alive child instead of starting a second,
// so N clicks on the panel button behave like one. Check + spawn + assign stay synchronous; only
// the confirmation waits, so two overlapping HTTP requests cannot both pass the liveness check.
export async function launchPostmanDaemon() {
  const before = getDaemonStatus();
  if (before.running) return { ...before, message: `already running (pid ${before.pid})` };

  const child = cp.spawn(process.execPath, [DAEMON_SCRIPT_PATH], { stdio: 'inherit', windowsHide: true });
  child.on('error', (e) => console.error(`[postman] daemon failed to start: ${e.message}`));
  child.on('exit', (code) => {
    if (daemonProcess === child) daemonProcess = null;
    console.log(`[postman] daemon exited (code ${code}) — Postman control unavailable`);
  });
  daemonProcess = child;
  await whenChildSpawned(child);
  const status = getDaemonStatus();
  if (!status.running || !status.pid) throw new Error('daemon did not stay running after spawn');
  return { ...status, message: `started (pid ${status.pid}) — attaching to Postman` };
}

export async function killPostmanDaemon() {
  const child = daemonProcess;
  if (child && child.exitCode === null && !child.killed) {
    if (!child.kill() && !child.killed) throw new Error('failed to signal daemon');
    await whenChildExits(child);
    if (daemonProcess === child) daemonProcess = null;
  } else {
    daemonProcess = null;
    const pid = filePidLive();
    if (!pid) return { running: false, pid: null, message: 'not running' };
    process.kill(pid, 'SIGTERM');
    await whenPidDies(pid);
  }
  const status = getDaemonStatus();
  if (status.running) throw new Error('daemon still running after kill');
  return { ...status, message: 'stopped' };
}

// Panel → daemon IPC for the "New window" panel button: drops a flag file next to data.json
// that the daemon's own 1s discover() loop already checks (scripts/aki-pmcontrol/index.js),
// so no new transport is needed for a request that only needs to happen, not carry data.
// This is the only writer of that file; the daemon is the only reader/deleter.
export function requestNewWindow() {
  const status = getDaemonStatus();
  if (!status.running) throw new Error('Postman daemon not running — launch it first');
  mkdirSync(path.dirname(NEW_WINDOW_FLAG_PATH), { recursive: true });
  writeFileSync(NEW_WINDOW_FLAG_PATH, '');
  return { ok: true, message: 'requested a new Postman window' };
}

export function register(server) {
  server.registerTool(
    'postman_status',
    {
      title: 'Postman Control Status',
      description:
        "Report whether the Postman control daemon (scripts/aki-pmcontrol/) is currently running, plus what its data.json last recorded (whether it has ever attached to Postman Desktop). Does not launch Postman and opens no connection to it — launch it from the panel's Postman tab.",
      inputSchema: {},
    },
    async () => ok(JSON.stringify(getDaemonStatus(), null, 2)),
  );
}
