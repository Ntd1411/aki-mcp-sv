#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import cp from 'node:child_process';
import { register, getDaemonStatus } from '../scripts/postman-mcp.js';
import { ROUTES } from '../scripts/panel.js';

// Read-only by default: importing/registering the tool must never spawn or assume a daemon.
let handler;
register({ registerTool: (name, _def, fn) => { assert.equal(name, 'postman_status'); handler = fn; } });
const before = JSON.parse((await handler()).content[0].text);
assert.equal(before.running, false, 'importing the module must not spawn or assume a daemon');
assert.equal(before.pid, null);

// Mocked so no real process (and never real Postman) launches from this test. `kill` mirrors
// Node's real ChildProcess: `.killed` flips and `exitCode` settles, which is what the quit
// handler waits for before returning stopped.
let killCount = 0;
const spawnMock = mock.method(cp, 'spawn', () => ({
  pid: 4242,
  exitCode: null,
  killed: false,
  on() { return this; },
  off() { return this; },
  kill() { killCount += 1; this.killed = true; this.exitCode = 0; return true; },
}));

const first = await ROUTES['POST /api/postman-launch']();
assert.equal(first.running, true);
assert.equal(first.pid, 4242);
assert.equal(spawnMock.mock.calls.length, 1, 'POST /api/postman-launch must spawn the daemon');
assert.equal(killCount, 0, 'launch must not kill');

const second = await ROUTES['POST /api/postman-launch']();
assert.equal(second.running, true);
assert.equal(second.pid, 4242);
assert.equal(spawnMock.mock.calls.length, 1, 'a live daemon must not be spawned twice');
assert.match(second.message, /already running/);

assert.deepEqual(getDaemonStatus().pid, 4242);

const quit = await ROUTES['POST /api/postman-quit']();
assert.equal(quit.running, false, 'quit handler must return not-running only after kill');
assert.equal(quit.pid, null);
assert.equal(killCount, 1, 'POST /api/postman-quit must kill the spawned child');
assert.equal(getDaemonStatus().running, false, 'status must be not-running right after quit');
assert.equal(getDaemonStatus().pid, null);

const idle = await ROUTES['POST /api/postman-quit']();
assert.equal(idle.running, false);
assert.equal(idle.pid, null);
assert.equal(killCount, 1, 'quit when not running must not fake a kill');
assert.equal(spawnMock.mock.calls.length, 1);

console.log('postman-mcp.test.js: ok');
