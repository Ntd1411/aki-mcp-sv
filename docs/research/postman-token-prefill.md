# Postman token prefill

**Start time:** 2026-09-02

**Initial purpose:** Decide whether the Postman tab still needs a Generate click to mint/copy MCP JSON, and whether access tokens must be labeled by provider. Context: Postman AI Agent has no OAuth redirect and no persistent system prompt; `tokens.json` is `{access, refresh}` only; access entries are `{expires}` with no `clientId`; `verifyBearer` checks map membership and expiry, not which client minted the token. Owner words (immutable): we control the server; a Generate click looks surplus and raises "unlimited trash"; picking any unexpired access might be "another provider's"; unlabeled rows look like a data-clarity gap. Constraint: two-way door (panel copy + GET mint-when-empty). Do not rewrite OAuth. Do not bind `/mcp` to a client. Do not add a dedicated Postman `clientId` (filter would be a schema change). Do not GC still-valid access. Do not clean DCR clients.

## Strategy
`METHOD-deep-think` at `/akithink` depth on a two-way door (`think.A1`): goal chain, facts vs constraints vs assumptions, five critique lenses plus a sixth cheapest-sufficient-control pass, brief techbiz (shipped product), severity gate (`think.B5`) so token-labeling and OAuth rewrite stay unpromoted unless a correctness bug appears. Model at session: Cursor Grok 4.6 (Opus/Fable recommended, not blocking). Owner chốt: six passes then implement; research Decision → Action only (no paired `docs/plan/` for this one reversible copy change).

## Checklist
- [x] Size the door (panel copy + GET mint-when-empty; not OAuth)
- [x] Module 1 goal chain against pinned owner words
- [x] Module 2 facts / real constraints / assumptions (`tokens.json` shape, Postman has no redirect, DCR reconnects are the real bloat)
- [x] Six adversarial passes (steelman keep-button, attack prefill-on-GET, inversion, pre-mortem, second-order, cheapest sufficient control)
- [x] Module 4 techbiz brief; Module 5 severity (do not promote labeling or OAuth rewrite)
- [x] Converge; implement; sync README / CHANGELOG `[Unreleased]` / this record / index; `npm test`

## Result

**Goal chain.** Immediate: Postman JSON is already filled when the panel opens. Intermediate: one copy-paste into Connected Accounts, no `tokens.json` hunt, no extra click. Ultimate: the panel is the minting UI, so the correct bearer is automatic (`pattern.A8`). Tension: "tường minh data" (label `clientId`/`via` on access) vs do not rewrite `tokens.json`; "no unlimited trash" vs mint on GET when the store is empty. Resolved: labeling is for reading the file by eye, not for Postman; GET mint-when-empty is one access+refresh, same as the first Generate click.

**Facts.** `getOrIssueAccessToken()` already returns a still-valid access token and only calls `mintTokens` when none is valid (`ACCESS_TTL_S` = 365 days). Generate was a POST to `/api/access-token` that called the same function. That POST had one caller: `generatePostman` in `public/panel-client.js`. The panel loopback `TOKEN` is a different secret and must not be the MCP bearer. DCR reconnects (`oauth-dcr-clients.json`) are the real stored-client bloat, not access rows.

**Assumptions rejected.** "GET mint-when-empty creates unlimited trash" is false while reuse holds. "Any unexpired access is another provider's token, so Postman must not use it" is false: `verifyBearer` is client-agnostic; a Claude-minted access used as Postman's bearer does not steal Claude's session. "Need provider labels for Postman to be correct" is false.

### Six passes
1. **Steelman keep-the-button.** Minting is a side effect. Opening the panel to edit folders or allowlist should not write `tokens.json`. A click is informed consent for people who actually use Postman; everyone else never mints. TTL is 365 days, so a reload-to-refresh story is weak, but the consent story is the strongest case against prefill.
2. **Attack prefill-on-GET.** Empty store mints on panel open, including owners who never open Postman. Survives as the only real attack. Accepted: unauthenticated GET 403s before mint; authenticated GET is already the privileged loopback UI; first mint is one access+refresh, identical to the first Generate click; later GETs reuse.
3. **Inversion.** Prefill the loopback panel token → Postman 401s. Remove the button but leave "Generate first" → dead end. Mint a new token on every GET → unlimited trash (`getOrIssueAccessToken` prevents this). Keep Generate and prefill → two issuance UIs. Bind `verifyBearer` to a client → Postman 401s on a Claude-minted token and forces a schema change.
4. **Pre-mortem.** Six months later this is wrong because the panel HTML always contains a live MCP bearer (loopback + `?t=` is already the privileged surface; blast radius unchanged vs filling the chip via JS), or because some other client still POSTed `/api/access-token` (grep: only `generatePostman`).
5. **Second-order.** README, CHANGELOG `[Unreleased]`, and `oauth.test.js` all named Generate; leaving them would be docs Wrong. `docs/plan/manus-connect.md` is a different client and a hand-mint recipe; not this change.
6. **Cheapest sufficient control.** No extra guard. Delete Generate, `data-act="generatePostman"`, `generatePostman`, and `POST /api/access-token`. Keep `getOrIssueAccessToken` / `mintTokens` as the one issuance path. Keep the per-chat prompt `copyEl`. Do not label access rows. Do not rewrite the schema.

**Techbiz (brief).** Value is the filled JSON with zero extra click. Smallest solution is prefill plus deleting the surplus control. Cost is one map scan (and at most one mint) per authenticated panel GET.

**Severity.** Token-labeling and OAuth rewrite are not correctness bugs; not promoted. GET mint-when-empty does not override the MVP.

### Verification
- `scripts/oauth.test.js`: `getOrIssueAccessToken` reuses a valid token; GET `/?t=` HTML contains `Bearer <that token>` in `#postmanJson` and omits `generatePostman` / "Generate first"; panel loopback token is not a `verifyBearer` bearer; `POST /api/access-token` is 404.
- `npm test` passed 2026-09-02 (`streamable-bridge.test.js` + `oauth.test.js`).
- Panel visual click-copy in a real browser: **unverified** (no browser pass in this run).

### Corroborating links
- `scripts/oauth.js` `getOrIssueAccessToken` / `verifyBearer` / `mintTokens`
- `scripts/config-page.js` Postman tab (prefill)
- `scripts/panel.js` GET `/` (calls `getOrIssueAccessToken` after loopback-token check)
- README "Connecting from Postman"
- CHANGELOG `[Unreleased]` (prior Generate bullets, rewritten to prefill)
- CHANGELOG `[1.12.0]` Postman connector (released history; not edited)

## Decision

**Action.** Prefill Postman MCP JSON at authenticated GET `/` via `getOrIssueAccessToken()`. Remove the Generate button and the dead POST client path. Leave `verifyBearer` client-agnostic. Do not add provider labels. Do not rewrite `tokens.json`. Accept GET mint-when-empty.

Files this materialized in:
- `scripts/config-page.js` — Postman tab copy + filled `copyEl`
- `scripts/panel.js` — GET `/` passes `accessToken`; `POST /api/access-token` deleted
- `public/panel-client.js` — `generatePostman` deleted
- `scripts/oauth.test.js` — assertions follow the new flow
- `README.md` — Connecting from Postman
- `CHANGELOG.md` — `[Unreleased]` only
- `docs/index.md` — index line for this record

**Rejected/closed.** Keep Generate (surplus fetch of a token the GET already has). Bind `verifyBearer` to a client. Label `clientId`/`via` on access. Dedicated Postman `clientId`. DCR-client cleanup. GC of still-valid access. A paired `docs/plan/` for this one-item change.

**Cross-references.** README Connecting from Postman; CHANGELOG `[Unreleased]` and `[1.12.0]` Postman entries; `docs/feat/tools.md` (names Postman as a client, not the setup steps); `docs/ref/security-model.md` (token store, not Generate); `docs/plan/manus-connect.md` (different client, hand-mint).
