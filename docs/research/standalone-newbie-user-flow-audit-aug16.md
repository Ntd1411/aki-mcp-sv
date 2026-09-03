# Standalone newbie user-flow audit

Status: superseded by `docs/plan/done/remove-package-to-simple-repo.md` (launcher UX is no longer a product surface)

**Start time:** 2026-08-16

**Initial purpose:** After shipping 1.9.2 (renamed `-payload.*` assets, short OS-picker release note), owner asked for a full newbie walkthrough — zero prior knowledge of MCP/OAuth/Tailscale/Node — from landing on the GitHub repo through a working Claude web connection, to catch remaining drift/UX-crisis points the prior README pass (1.9.1 → 1.9.2, commit `792ea40`) might have missed. Audited against repo state at commit `944b90b` (README/CHANGELOG only, before this doc's own fixes below).

**Strategy:** Delegated the walkthrough to `agy --model gemini-3.7-flash-high --mode plan` (read-only, per `agent.A5` — discovery goes to the wide-context worker, not done inline) with a fully-specified persona prompt: absolute newbie, step-by-step, assume nothing, read README.md/CHANGELOG.md/all launcher templates/config-page.js/panel-client.js/oauth.js/http.js/start.js/release.yml in that order, flag confusion points / doc gaps / panic triggers at every step. Findings then individually re-verified against the actual source (not trusted as-is — worker output is a diagnostic signal, `agent.B2`) before any fix.

**Checklist:**
1. Ran the agy walkthrough (8 stages: README read order → Releases asset picking → OS security gates → launcher bootstrap → control panel → Claude web OAuth → instructions setup).
2. Verified `README.md:132-146` (standalone section) directly — confirmed pre-fix state matched the worker's read.
3. Verified `scripts/config-page.js:267` (Save/Apply two-step) directly — worker's claim did not match; a helptext already exists.
4. Verified `scripts/oauth.js:247` (passphrase confirm-page copy) directly — worker's claim held.
5. Cross-checked against `CLAUDE.md`'s "Permanently removed: native folder picker stays removed" to rule the Add-folder-has-no-Browse-button item in/out.

**Result:**

| # | Finding | Class (`docs.C4`) | Verification | Decision |
|---|---|---|---|---|
| 1 | Linux launcher step had no `chmod +x` — downloaded files aren't executable by default, so the README's literal command fails | Wrong | Verified: `README.md:137` (pre-fix) showed bare `./aki-mcp-sv-<version>-linux.run` | **Action** — fixed, `README.md:137` |
| 2 | No mention that browsers flag `.command`/`.cmd`/`.run` downloads with a warning dialog | Incomplete | Verified: no such text anywhere in README | **Action** — fixed, `README.md:140-144` |
| 3 | No Windows SmartScreen guidance at all | Incomplete | Verified: grep for "SmartScreen"/"protected your PC" — zero hits pre-fix | **Action** — fixed, `README.md:142` |
| 4 | macOS Gatekeeper guidance (`README.md:142`, pre-fix) led with right-click-Open, which Apple removed as an option on macOS 15+; only fallback offered was the `xattr` command, with no signpost that it's the one that always works | Stale | Verified against known macOS 15 Gatekeeper behavior (System Settings → Privacy & Security → Open Anyway replaces the removed context-menu bypass) | **Action** — fixed, `README.md:141` |
| 5 | No warning that closing the terminal/console window kills the running server (it's not just a progress log) | Incomplete | Verified: no such text anywhere pre-fix | **Action** — fixed, `README.md:143` |
| 6 | Version badge (`README.md:6`) read `1.9.1` after the repo had already moved to `1.9.2` | Stale | Verified directly | **Action** — fixed |
| 7 | OAuth confirm-page copy (`scripts/oauth.js:247`, pre-fix) told the user to go find `~/.aki/mcpsv/passphrase.txt`, when the same passphrase is already shown copyable in control-panel section 1 — a newbie doesn't know what `~` means or how to reveal a hidden file | Incomplete | Verified directly, line quoted above | **Action** — fixed, `scripts/oauth.js:247` |
| 8 | No guidance for a standalone user on how to start the server again after a reboot/closed terminal | Incomplete | Verified: no such text anywhere pre-fix | **Action** — fixed, `README.md:145` |
| 9 | GitHub's own "Code" button → "Download ZIP" sits above the Releases link and produces an unrunnable source archive with no launcher — a newbie's first instinct on any repo page | Incomplete | Structural GitHub UI behavior, not something this repo's code affects; only the README's own wording can steer around it | **Action** — fixed (one clause added), `README.md:132` |
| 10 | Claimed: "Save" + "Apply to file tools" two-step for folder changes is unexplained and silently drops the connector's access to a newly added folder | — | **False positive** — `scripts/config-page.js:267` already carries an explicit helptext stating exactly this | **No action** — already correct, no fix needed |
| 11 | Claimed: Add-folder field is a bare text input with no OS folder-picker/Browse button | Cosmetic (by design) | `CLAUDE.md` § OS-agnostic: "native folder picker stays removed" (Chrome 136 remote-debugging block was the reason it was pulled once already) | **No action** — deliberate, already documented project decision; re-adding it would revisit a decision already reversed once |
| 12 | Default allowed root is the whole `$HOME` (Desktop/Documents/Downloads/Photos, not just projects), which can read as alarming to a privacy-conscious newbie | Incomplete | `README.md:163` already states this plainly and explains why (only folder guaranteed to exist) | **No action** — transparency already present; narrowing the *default* is a product/security tradeoff, not a doc gap — sits under `METHOD-proportionality.md`, owner's call, not something to change unasked |
| 13 | README's first ~120 lines are theory/comparison/architecture before any install step; a newbie must scroll past all of it to find "how do I get this running" | Incomplete | Verified: `README.md:12-123` (Why this exists → Architecture → Requirements → Directory layout) all precede `## Install` | **No action (this pass)** — real finding, but reordering/trimming a README's top-level structure is a broad edit under `agent.B3` (visible, structural) — flagged in the paired plan doc for owner sign-off, not auto-applied |
| 14 | Whether Claude's Custom Connectors feature requires a paid tier (Free vs Pro) isn't stated, and a newbie on Free might hit a wall with no explanation | Incomplete | **Unverified** — this is Anthropic product policy, external and time-varying; no reliable source in this repo to confirm current tier gating (`coding.A3` — source-of-truth priority gives local code/docs no authority here) | **No action** — cannot verify; would need a live check against claude.ai, not something to guess into the README |
| 15 | When Tailscale Funnel desyncs (a known, already-documented issue — `README.md:192-199`), the error a newbie actually sees is a generic "Failed to connect" on claude.ai itself, with nothing pointing back to the README's fix | Incomplete | Verified: the diagnosis steps exist in README but nothing surfaces them at the point of failure (claude.ai, not this repo's UI) | **No action (this pass)** — real gap, but the fix (surfacing a hint inside claude.ai's own error) is outside this repo's control; the only lever here is more README text, which doesn't reach a user already on claude.ai — filed as a known limitation, not scheduled |

**Decision:**
- **Action** items (1–9) — implemented directly in this session: `README.md` (multiple sections), `scripts/oauth.js:247`, `CHANGELOG.md` `[Unreleased]`.
- **No action** items (10–15) — reasons stated per row above; two (13, 15) are real findings deliberately left unscheduled per `docs.B2`, not oversights.
- **Cross-references:** `README.md`, `scripts/oauth.js`, `CHANGELOG.md`, `CLAUDE.md` (folder-picker precedent), `docs/research/claude-ai-oauth-connector.md` (Funnel desync root cause, referenced by finding 15).
- **Action doc:** `docs/plan/standalone-newbie-ux-followups.md` (sequences items 13 and 15, the two left open).
