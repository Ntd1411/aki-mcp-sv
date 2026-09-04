#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mcpRoot = path.join(repoRoot, 'scripts/aki-pmcontrol');
const labRoot = path.resolve(repoRoot, '../aiobox/labs/aki-pmcontrol');
const COPIED = [
  'index.js',
  'scripts/cdp-autoclicker.js',
  'scripts/cdp-usage.js',
  'scripts/daemon-pid.js',
  'scripts/postman-paths.js',
  'scripts/postman-session.js',
  'scripts/update-check.js',
  'data/aki-postman-instruction.md',
];
if (existsSync(labRoot)) {
  for (const rel of COPIED) {
    const mcpSrc = readFileSync(path.join(mcpRoot, rel), 'utf8');
    const labSrc = readFileSync(path.join(labRoot, rel), 'utf8');
    assert.equal(mcpSrc, labSrc, `${rel} must stay byte-identical (lab origin)`);
  }
}

const mcpSrc = readFileSync(path.join(mcpRoot, 'scripts/cdp-autoclicker.js'), 'utf8');

assert.match(mcpSrc, /const PERMISSION_CARD_ROOT = '\.tool-approval-wrapper, \.tool-approval-single-item'/);
assert.match(mcpSrc, /function tickPermissionCards/);
assert.match(mcpSrc, /function slotButton/);
assert.match(mcpSrc, /function press/);
assert.match(mcpSrc, /function creditArm/);
assert.match(mcpSrc, /tickPermissionCards\(config\)/);
assert.match(mcpSrc, /window\.__pmArmedCard/);
assert.match(mcpSrc, /permission card gone/);
assert.match(mcpSrc, /matchPrimary/);
assert.match(mcpSrc, /keywords: \['approve', 'allow'\]/);
assert.doesNotMatch(mcpSrc, /autoClicker\.tick\(/);
assert.doesNotMatch(mcpSrc, /dataset\.clicked/);
assert.doesNotMatch(mcpSrc, /acceptAllToolCall/);
assert.doesNotMatch(mcpSrc, /tickAutoAcceptToolCalls/);
assert.doesNotMatch(mcpSrc, /hasVisibleToolApproval/);
assert.doesNotMatch(mcpSrc, /Create workspace/);
assert.doesNotMatch(mcpSrc, /!card\.matches\(PERMISSION_CARD_ROOT\)/);

assert.match(mcpSrc, /const PM_EVENT_NEW_REQUESTER_WINDOW = 'newRequesterWindow'/);
assert.match(mcpSrc, /triggerPostman\(PM_EVENT_NEW_REQUESTER_WINDOW\)/);
assert.equal(
  (mcpSrc.match(/triggerPostman\(PM_EVENT_NEW_REQUESTER_WINDOW\)/g) || []).length,
  1,
  'New Window alone fires newRequesterWindow',
);
assert.match(mcpSrc, /function openNewBrowserTab/);
assert.match(mcpSrc, /build\.browser-tab/);
assert.match(mcpSrc, /openNewBrowserTab\(\)/);
assert.match(mcpSrc, /mod\.g\('about:blank', \{ forceNew: true \}\)/);

assert.doesNotMatch(mcpSrc, /structuralSelector/);
assert.doesNotMatch(mcpSrc, /no browser-tab mediator event found/);
assert.doesNotMatch(mcpSrc, /\/browser\/i/);
assert.doesNotMatch(mcpSrc, /rejectAllToolCall/);
assert.doesNotMatch(mcpSrc, /MCP_POSTMAN_CDP/);
assert.doesNotMatch(mcpSrc, /Input\.dispatchKeyEvent/);

console.log('aki-pmcontrol-copy.test.js: ok');
