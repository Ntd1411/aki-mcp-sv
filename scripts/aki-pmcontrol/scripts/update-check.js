'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const https = require('https');

const RULES_DIR = path.join(os.homedir(), '.aki', 'akidevrule');
const RULE_CHANGELOG = path.join(RULES_DIR, 'CHANGELOG.md');
const RULE_INDEX = path.join(RULES_DIR, 'index.md');
const RULE_CHANGELOG_URL = 'https://raw.githubusercontent.com/lacvietanh/akidevrule/master/CHANGELOG.md';

function parseChangelogVersion(text) {
  const m = text && text.match(/^##\s*\[(\d+\.\d+\.\d+)\]/m);
  return m ? m[1] : null;
}

function cmpSemver(a, b) {
  if (!a || !b) return 0;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function isInstalled() {
  return fs.existsSync(RULE_CHANGELOG) || fs.existsSync(RULE_INDEX);
}

function isUnreleasedOnly(text) {
  return !!(text && !parseChangelogVersion(text) && /^##\s*\[Unreleased\]/m.test(text));
}

function readLocalRule() {
  try {
    const text = fs.readFileSync(RULE_CHANGELOG, 'utf8');
    return { current: parseChangelogVersion(text), unreleasedOnly: isUnreleasedOnly(text) };
  } catch (e) {
    return { current: null, unreleasedOnly: false };
  }
}

function getLocalVersions() {
  const local = readLocalRule();
  return {
    current: local.current,
    installed: isInstalled(),
    unreleasedOnly: local.unreleasedOnly,
  };
}

function classifyRule(rule) {
  if (!rule.installed) return 'missing';
  if (rule.unreleasedOnly) return 'ahead';
  if (!rule.latest) return 'unknown';
  if (rule.updateAvailable) return 'update';
  if (rule.current && cmpSemver(rule.current, rule.latest) > 0) return 'ahead';
  if (rule.current && rule.latest && cmpSemver(rule.current, rule.latest) === 0) return 'current';
  return 'unknown';
}

function snapshot(current, latest, local) {
  const rule = {
    current,
    latest,
    updateAvailable: cmpSemver(current, latest) < 0,
    installed: local.installed,
    unreleasedOnly: !!local.unreleasedOnly,
  };
  rule.state = classifyRule(rule);
  return { rule };
}

function localSnapshot() {
  const local = getLocalVersions();
  return snapshot(local.current, null, local);
}

function refreshLocalVersions(updateInfo) {
  if (!updateInfo || !updateInfo.rule) return updateInfo;
  const local = getLocalVersions();
  updateInfo.rule.current = local.current;
  updateInfo.rule.installed = local.installed;
  updateInfo.rule.unreleasedOnly = local.unreleasedOnly;
  updateInfo.rule.updateAvailable = cmpSemver(local.current, updateInfo.rule.latest) < 0;
  updateInfo.rule.state = classifyRule(updateInfo.rule);
  return updateInfo;
}

function fetchText(url, timeoutMs, redirectsLeft) {
  if (redirectsLeft === undefined) redirectsLeft = 3;
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const req = https.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'aki-pmcontrol' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        return done(fetchText(new URL(res.headers.location, url).toString(), timeoutMs, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return done(null);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
      res.on('error', () => done(null));
    });
    req.on('timeout', () => { req.destroy(); done(null); });
    req.on('error', () => done(null));
  });
}

async function checkForUpdate({ timeoutMs = 3000 } = {}) {
  const local = getLocalVersions();
  const ruleLog = await fetchText(RULE_CHANGELOG_URL, timeoutMs);
  return snapshot(local.current, parseChangelogVersion(ruleLog), local);
}

module.exports = {
  RULES_DIR,
  RULE_CHANGELOG,
  RULE_CHANGELOG_URL,
  parseChangelogVersion,
  cmpSemver,
  classifyRule,
  getLocalVersions,
  localSnapshot,
  refreshLocalVersions,
  checkForUpdate,
};
