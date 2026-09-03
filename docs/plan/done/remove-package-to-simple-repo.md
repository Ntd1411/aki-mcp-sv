# Remove standalone packaging; repo is git clone + npm start

> status: done · 2026-09-03

**Done means:** `scripts/build/` gone; no `package` npm script; tag workflow publishes CHANGELOG notes only (no launcher/payload assets); README/panel copy is clone-only; `hasGit` Download fallback gone; this plan in `docs/plan/done/`; CHANGELOG `[Unreleased]` `Removed`. MCP server, connectors, tools, `npm start` stay.

## Already gone (do not redo)

- `CLAUDE.md` Release process: already notes-only (`CHANGELOG.md` + GitHub Release, no package/smoke-test).
- `dist/` not in the tree (gitignored only).
- `docs/feat/`, `docs/ref/`: no launcher/package copy.
- `package.json` already `"private": true`; no `publishConfig`, no `bin`, no npm publish.
- `.github/workflows/ci.yml`: `npm test` + syntax check; keep.
- `public/favicon/manifest.json` `"display": "standalone"` is PWA display, not packaging; keep.
- `scripts/streamable-bridge.test.js` "standalone test" means the test process exits itself; keep.

## Remaining (this run)

| Path | Action |
|---|---|
| `scripts/build/` (10 files: `package.js`, `targets.js`, `payload.js`, `launchers.js`, `checksum.js`, `node-checksums.js`, `release-gate.js`, `smoke-test.js`, `launcher-templates/posix.js`, `launcher-templates/windows.js`) | delete |
| `package.json` `"package"` script | delete that key |
| `.github/workflows/release.yml` | keep tag trigger; drop build/smoke-test/asset-gate jobs; `gh release create` from CHANGELOG section only, no `dist/*` |
| `.gitignore` `dist/` comment naming `scripts/build/package.js` | drop the packaging comment; keep `dist/` ignore |
| `README.md` Install/Run/Requirements/Directory layout/Configuration launcher copy | clone + `npm install` + `npm start` only |
| `scripts/config-page.js` `hasGit` ? Pull : Download | always Pull & restart; drop `hasGit` param |
| `scripts/panel.js` `hasGit` pass-through; `pullUpdate()` "download the latest zip" | stop passing `hasGit`; error says clone the repo |
| `docs/plan/2.0.0-improve.md` item 3 (single-executable / `!hasGit` HTTP branch) | cancel; move plan to `done/` |
| `docs/research/standalone-newbie-user-flow-audit-aug16.md` | add `Status: superseded by` this plan (launcher UX no longer a product surface). Do not edit the body. |
| `docs/index.md` | point moved plans; do not delete historical `plan/done/standalone-*` or mixed research index lines |
| `CHANGELOG.md` `[Unreleased]` | `Removed` |

## Keep as history (do not delete)

- `docs/plan/done/standalone-packaging.md`, `standalone-release-delivery.md`, `standalone-newbie-ux-followups.md`
- `docs/research/akiflow-council-v018-ingress-standalone-env.md` (ingress + `.env` conclusions still hold; only I2 was packaging — no wholesale supersede)
- Released CHANGELOG blocks that describe past launcher assets
- Existing GitHub Release assets already published (remote; this repo stops producing new ones)

## Out of this repo

`akimcp.top` install/download UI is a different project. Not edited here.

## Checklist

- [x] Delete `scripts/build/`
- [x] Drop `package` script; slim `release.yml`; tidy `.gitignore`
- [x] README + panel `hasGit` dual path
- [x] Cancel `2.0.0-improve.md` item 3; move that plan and this plan to `done/`; update `docs/index.md`
- [x] Supersede stamp on the newbie-flow research doc
- [x] CHANGELOG `[Unreleased]` `Removed`
