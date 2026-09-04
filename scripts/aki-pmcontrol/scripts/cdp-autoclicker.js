/**
 * Postman CDP Automation & Aki Controller UI (Full English, Horizontal Trigger, No Reload Icons)
 */
(function () {
  if (window.__pmMasterInterval) {
    clearInterval(window.__pmMasterInterval);
  }

  const existingAkiPanel = document.getElementById('aki-control-panel');
  window.__pmAkiPanelOpen = !!(
    window.__pmAkiPanelOpen
    || (existingAkiPanel && existingAkiPanel.classList.contains('aki-open'))
  );

  const AUTO_CLICK_IGNORES = ['cancel', 'reject', 'deny', 'delete', 'close', 'back', 'remove', 'reset'];

  // New Window = newRequesterWindow. New Browser Tab is NOT that — it is
  // NavigationService.transitionTo('build.browser-tab') via rspack module.g.
  const PM_EVENT_NEW_REQUESTER_WINDOW = 'newRequesterWindow';

  // Prompt + procedure: docs/ref/postman-permission-popup-test.md
  const PERMISSION_CARD_ROOT = '.tool-approval-wrapper, .tool-approval-single-item';

  const AUTO_CLICK_TARGETS = [
    {
      configKey: 'autoApprove',
      statKey: 'approveCount',
      statLabel: 'Approve',
      badgeId: 'aki-badge-approve',
      checkboxId: 'aki-opt-approve',
      rowLabel: 'Auto click <strong>Approve / Allow</strong>',
      keywords: ['approve', 'allow'],
      matchExact: false,
      classifyText: null,
      classifyRank: 4
    },
    {
      configKey: 'autoContinue',
      statKey: 'continueCount',
      statLabel: 'Continue',
      badgeId: 'aki-badge-continue',
      checkboxId: 'aki-opt-continue',
      rowLabel: 'Auto click <strong>Continue</strong>',
      keywords: ['continue'],
      matchExact: false,
      classifyText: 'continue',
      classifyRank: 1
    },
    {
      configKey: 'autoRun',
      statKey: 'runCount',
      statLabel: 'Run',
      badgeId: 'aki-badge-run',
      checkboxId: 'aki-opt-run',
      rowLabel: 'Auto click <strong>Run (Dialog / Modal)</strong>',
      keywords: ['run'],
      matchExact: true,
      classifyText: 'run',
      classifyRank: 2
    },
    {
      configKey: 'autoRetry',
      statKey: 'retryCount',
      statLabel: 'Retry',
      badgeId: 'aki-badge-retry',
      checkboxId: 'aki-opt-retry',
      rowLabel: 'Auto click <strong>Try again</strong>',
      keywords: ['try again'],
      matchExact: false,
      classifyText: 'try again',
      classifyRank: 3
    }
  ];

  class AutoClickManager {
    constructor(targets) {
      this.targets = targets;
      this.stats = this._hydrateStats();
    }

    // Merges defaults into whatever survives a non-navigation re-injection (daemon restart,
    // AKI_UI_V rebuild) instead of an all-or-nothing `||` — a field added after __pmStats
    // already existed in the page used to stay `undefined` forever until a full page reload.
    _hydrateStats() {
      const defaults = {};
      this.targets.forEach((t) => { defaults[t.statKey] = 0; });
      window.__pmStats = Object.assign(defaults, window.__pmStats || {});
      return window.__pmStats;
    }

    defaultConfig() {
      const cfg = {};
      this.targets.forEach((t) => { cfg[t.configKey] = true; });
      return cfg;
    }

    persistedConfig(config) {
      const cfg = {};
      this.targets.forEach((t) => { cfg[t.configKey] = config[t.configKey]; });
      return cfg;
    }

    updateBadges() {
      this.targets.forEach((t) => {
        const el = document.getElementById(t.badgeId);
        if (el) el.textContent = this.stats[t.statKey];
      });
    }

    renderRows(config) {
      return this.targets.map((t) => `
          <div class="aki-row">
            <label class="aki-label">
              <input type="checkbox" id="${t.checkboxId}" ${config[t.configKey] ? 'checked' : ''}>
              <span>${t.rowLabel}</span>
            </label>
            <span id="${t.badgeId}" class="aki-badge">${this.stats[t.statKey]}</span>
          </div>`).join('\n');
    }

    bindRows(panelEl, config, onChange) {
      this.targets.forEach((t) => {
        const cb = panelEl.querySelector(`#${t.checkboxId}`);
        if (!cb) return;
        cb.onchange = (e) => {
          config[t.configKey] = e.target.checked;
          onChange();
        };
      });
    }

    // Which stat bucket a click counts toward, by priority (continue > run > try again > approve
    // fallback) — independent of which config flag made the button clickable, same as the
    // original if/continue-else-run-else-retry-else-approve chain.
    _classify(text) {
      const hit = this.targets
        .filter((t) => t.classifyText)
        .sort((a, b) => a.classifyRank - b.classifyRank)
        .find((t) => text.includes(t.classifyText));
      return hit || this.targets.find((t) => t.classifyText === null) || this.targets[0];
    }

    matchPrimary(text) {
      return this.targets
        .filter((t) => t.keywords)
        .sort((a, b) => a.classifyRank - b.classifyRank)
        .find((t) => t.keywords.some((kw) => (t.matchExact ? text === kw : (text === kw || text.includes(kw)))))
        || null;
    }
  }

  const autoClicker = new AutoClickManager(AUTO_CLICK_TARGETS);
  window.__pmAutoClicker = autoClicker;

  // Cancel slot of the same pending surface — only when copy is this folder dialog.
  const AUTO_REJECT_PICK_FOLDER = {
    configKey: 'autoRejectPickFolder',
    statKey: 'rejectPickFolderCount',
    badgeId: 'aki-badge-reject-folder',
    checkboxId: 'aki-opt-reject-folder',
    rowLabel: 'Auto <strong>reject</strong> "Connect a local folder"',
    bodyNeedle: 'connect a local folder to this workspace'
  };
  if (typeof window.__pmStats[AUTO_REJECT_PICK_FOLDER.statKey] !== 'number') {
    window.__pmStats[AUTO_REJECT_PICK_FOLDER.statKey] = 0;
  }

  function updateRejectFolderBadge() {
    const el = document.getElementById(AUTO_REJECT_PICK_FOLDER.badgeId);
    if (el) el.textContent = window.__pmStats[AUTO_REJECT_PICK_FOLDER.statKey];
  }

  function renderRejectFolderRow(cfg) {
    const t = AUTO_REJECT_PICK_FOLDER;
    return `
          <div class="aki-row">
            <label class="aki-label">
              <input type="checkbox" id="${t.checkboxId}" ${cfg[t.configKey] ? 'checked' : ''}>
              <span>${t.rowLabel}</span>
            </label>
            <span id="${t.badgeId}" class="aki-badge">${window.__pmStats[t.statKey]}</span>
          </div>`;
  }

  function buttonLabel(btn) {
    return (btn.getAttribute('aria-label') || btn.innerText || btn.textContent || '').trim().toLowerCase();
  }

  function isDeclineButton(btn) {
    const text = buttonLabel(btn);
    return !!text && AUTO_CLICK_IGNORES.some((kw) => text === kw || text.includes(kw));
  }

  function slotButton(card, kind) {
    const buttons = [...card.querySelectorAll('button')].filter((b) => isVisible(b) && !b.disabled);
    if (kind === 'decline') return buttons.find(isDeclineButton) || null;
    return buttons.find((b) => autoClicker.matchPrimary(buttonLabel(b)))
      || (card.matches(PERMISSION_CARD_ROOT) ? buttons.find((b) => !isDeclineButton(b)) : null);
  }

  function reactOnClick(node) {
    if (!node) return false;
    const key = Object.keys(node).find((k) => k.startsWith('__reactProps$'));
    const fn = key && node[key] && node[key].onClick;
    if (typeof fn !== 'function') return false;
    fn.call(node, {
      preventDefault() {},
      stopPropagation() {},
      persist() {},
      target: node,
      currentTarget: node,
      type: 'click',
      bubbles: true,
      button: 0,
      nativeEvent: { isTrusted: true, target: node }
    });
    return true;
  }

  function press(el) {
    if (reactOnClick(el)) return;
    for (const child of el.children) {
      if (reactOnClick(child)) return;
    }
    el.click();
  }

  function permissionCards() {
    const wrappers = [...document.querySelectorAll(PERMISSION_CARD_ROOT)];
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
      .filter((d) => !d.querySelector(PERMISSION_CARD_ROOT));
    return [...wrappers, ...dialogs].filter((el) => isVisible(el) && !el.closest('#aki-control-panel'));
  }

  function cardCopy(card) {
    return (card.innerText || card.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function creditArm() {
    const armed = window.__pmArmedCard;
    if (!armed) return;
    if (armed.el && armed.el.isConnected) return;
    window.__pmArmedCard = null;
    if (armed.kind === 'folder') {
      window.__pmStats[AUTO_REJECT_PICK_FOLDER.statKey]++;
      console.log(`[⚡ AutoRun] folder card gone (Stats: rejectPickFolder=${window.__pmStats[AUTO_REJECT_PICK_FOLDER.statKey]})`);
      updateRejectFolderBadge();
      return;
    }
    const bucket = autoClicker._classify(armed.label);
    autoClicker.stats[bucket.statKey]++;
    const summary = autoClicker.targets.map((t) => `${t.statLabel}=${autoClicker.stats[t.statKey]}`).join(', ');
    console.log(`[⚡ AutoRun] permission card gone: "${armed.label}" (Stats: ${summary})`);
    autoClicker.updateBadges();
  }

  // docs/ref/postman-permission-popup-test.md
  function tickPermissionCards(cfg) {
    if (window.__pmPendingAgentSwitch) return;
    creditArm();

    permissionCards().forEach((card) => {
      const copy = cardCopy(card);
      const folderIntent = cfg[AUTO_REJECT_PICK_FOLDER.configKey] && copy.toLowerCase().includes(AUTO_REJECT_PICK_FOLDER.bodyNeedle);
      if (folderIntent) {
        const decline = slotButton(card, 'decline');
        if (!decline) return;
        window.__pmArmedCard = { kind: 'folder', copy, label: buttonLabel(decline), el: card };
        press(decline);
        if (!card.isConnected) creditArm();
        return;
      }

      const confirm = slotButton(card, 'confirm');
      if (!confirm) return;
      const label = buttonLabel(confirm);
      const row = autoClicker.matchPrimary(label);
      const allowed = row ? cfg[row.configKey] : (card.matches(PERMISSION_CARD_ROOT) && cfg.autoApprove);
      if (!allowed) return;
      window.__pmArmedCard = { kind: 'confirm', copy, label, el: card };
      press(confirm);
      if (!card.isConnected) creditArm();
    });
  }

  function triggerPostman(eventName) {
    const mediator = window.pm && window.pm.mediator;
    if (!mediator || typeof mediator.trigger !== 'function') return false;
    mediator.trigger(eventName);
    return true;
  }

  // Live-caught: agent openBrowserPage → rspack 946554.g(url, {forceNew}) →
  // transitionTo('build.browser-tab', {}, {url: encodeURIComponent(url)}, {tabOptions:{forceNew}}).
  // Module id is hashed per Postman build; find by the unique route string.
  function webpackRequire() {
    if (typeof window.__akiReq === 'function') return window.__akiReq;
    const chunks = window.rspackChunk_postman_app_renderer;
    if (!chunks || typeof chunks.push !== 'function') return null;
    const id = Date.now();
    chunks.push([
      [id],
      { [id]: function (e, t, r) { window.__akiReq = r; } },
      function (req) { window.__akiReq = req; req(id); }
    ]);
    return typeof window.__akiReq === 'function' ? window.__akiReq : null;
  }

  function openNewBrowserTab() {
    const req = webpackRequire();
    if (!req) return false;
    if (typeof window.__akiOpenBrowserTab === 'function') {
      window.__akiOpenBrowserTab('about:blank', { forceNew: true });
      return true;
    }
    const chunks = window.rspackChunk_postman_app_renderer;
    if (!chunks) return false;
    for (const item of chunks) {
      const mods = item && item[1];
      if (!mods) continue;
      for (const mid of Object.keys(mods)) {
        const src = Function.prototype.toString.call(mods[mid]);
        if (!src.includes('build.browser-tab') || !src.includes('transitionTo')) continue;
        const mod = req(mid);
        if (mod && typeof mod.g === 'function') {
          window.__akiOpenBrowserTab = mod.g;
          mod.g('about:blank', { forceNew: true });
          return true;
        }
      }
    }
    return false;
  }

  function loadConfig() {
    let baseConfig = {
      ...autoClicker.defaultConfig(),
      autoRejectPickFolder: true,
      autoInjectInstruction: true,
      showAllTeams: false,
      isPinned: true
    };

    if (window.__pmInitialConfig && typeof window.__pmInitialConfig === 'object') {
      baseConfig = { ...baseConfig, ...window.__pmInitialConfig };
    }
    if (typeof baseConfig.isPinned !== 'boolean') baseConfig.isPinned = true;

    return baseConfig;
  }

  let config = loadConfig();
  config.instruction = typeof window.__pmInitialInstruction === 'string' ? window.__pmInitialInstruction : '';

  function syncAndSaveConfig(extra = {}) {
    const persistData = {
      ...autoClicker.persistedConfig(config),
      autoRejectPickFolder: config.autoRejectPickFolder,
      autoInjectInstruction: config.autoInjectInstruction,
      isPinned: config.isPinned,
      ...extra
    };

    if (typeof window.__cdpSaveAkiConfig === 'function') {
      window.__cdpSaveAkiConfig(JSON.stringify(persistData));
    }
  }

  window.__pmOnDocumentClick = function (e) {
    const panel = document.getElementById('aki-control-panel');
    if (!panel || !panel.classList.contains('aki-open') || config.isPinned) return;
    if (e.target.closest('#aki-control-panel') || e.target.closest('#aki-vertical-trigger')) return;
    togglePanel(false);
  };
  if (!window.__pmGlobalClickBound) {
    document.addEventListener('click', (e) => {
      if (typeof window.__pmOnDocumentClick === 'function') window.__pmOnDocumentClick(e);
    });
    window.__pmGlobalClickBound = true;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function readPostmanAgentMode() {
    try {
      const raw = localStorage.getItem('agentModeSettings');
      if (!raw) return { thinking: true, autorun: true };
      const s = JSON.parse(raw);
      return {
        thinking: s.thinkingToggleEnabled !== false,
        autorun: s.autoRun !== false
      };
    } catch (e) {
      return { thinking: true, autorun: true };
    }
  }

  function agentSwitchOpenBtn(kind) {
    const chat = document.querySelector('[data-testid="ai-chat-container"]');
    if (!chat) return null;
    if (kind === 'thinking') {
      const btns = [...chat.querySelectorAll('[data-testid="aether-menu-button"][aria-haspopup="menu"]')].filter(isVisible);
      return btns.find((b) => /claude|gpt|auto|sonnet|opus|model/i.test(b.getAttribute('aria-label') || b.innerText || '')) || btns[0] || null;
    }
    return chat.querySelector('[data-testid="ai-chat-input-settings-button"]');
  }

  function findChatInput() {
    const chat = document.querySelector('[data-testid="ai-chat-container"]');
    if (!chat) return null;
    return chat.querySelector('[data-testid="ai-chat-input-editor"] [contenteditable="true"]');
  }

  function isChatEmpty(container) {
    const list = container.querySelector('[data-testid="ai-chat-conversation-container"]');
    if (!list) return true;
    return !list.textContent || !list.textContent.trim();
  }

  function submitChatInput(inputEl) {
    const chat = inputEl.closest('[data-testid="ai-chat-container"]');
    const sendBtn = chat && chat.querySelector('.ai-chat-input-send-button');
    if (sendBtn) press(sendBtn);
  }

  function agentSwitchItem(kind) {
    if (kind === 'thinking') {
      const menu = document.querySelector('[data-testid="ai-chat-model-menu"]');
      const scope = menu ? [...menu.querySelectorAll('[role="menuitem"]')] : [...document.querySelectorAll('[role="menuitem"]')];
      return scope.find((el) => /enable extended thinking/i.test((el.textContent || '').trim())) || null;
    }
    return [...document.querySelectorAll('[role="menuitem"]')].find((el) => ((el.innerText || el.textContent || '').trim() === 'Auto-run')) || null;
  }

  function closeAgentMenuIfOpened(kind) {
    if (!window.__pmAgentMenuOpened) return;
    const btn = agentSwitchOpenBtn(kind);
    if (btn && btn.getAttribute('aria-expanded') === 'true') btn.click();
    window.__pmAgentMenuOpened = false;
  }

  function applyPendingAgentSwitch() {
    const pending = window.__pmPendingAgentSwitch;
    if (!pending) return;
    pending.ticks = (pending.ticks || 0) + 1;
    if (pending.ticks > 12) {
      closeAgentMenuIfOpened(pending.kind);
      window.__pmPendingAgentSwitch = null;
      return;
    }

    const live = readPostmanAgentMode();
    const current = pending.kind === 'thinking' ? live.thinking : live.autorun;
    if (current === pending.want) {
      closeAgentMenuIfOpened(pending.kind);
      window.__pmPendingAgentSwitch = null;
      return;
    }

    const item = agentSwitchItem(pending.kind);
    const input = item && item.querySelector('input[data-testid="aether-toggle-switch"][type="checkbox"]');
    if (input) {
      if (input.checked !== pending.want) input.click();
      return;
    }

    const btn = agentSwitchOpenBtn(pending.kind);
    if (!btn) return;
    if (btn.getAttribute('aria-expanded') !== 'true') {
      btn.click();
      window.__pmAgentMenuOpened = true;
    }
  }

  function handleStartupSequence() {
    if (window.__pmStartupSequenceDone) return;

    const toggleBtn = document.querySelector('button[data-testid="toggle-right-sidebar"]');
    if (!toggleBtn || !isVisible(toggleBtn)) return;

    const svgUse = toggleBtn.querySelector('svg use, use');
    const href = svgUse ? (svgUse.getAttribute('href') || svgUse.getAttribute('xlink:href') || '') : '';
    if (href.includes('hidden')) {
      console.log('[⚡ AutoRun] Startup: Opening AI Chat Panel...');
      toggleBtn.click();
    }

    renderAkiWidget();
    const panel = document.getElementById('aki-control-panel');
    if (panel) {
      console.log('[⚡ AutoRun] Startup: Opening Aki Control Panel...');
      togglePanel(true);
      window.__pmStartupSequenceDone = true;
    }
  }

  function ruleInfo() {
    return (window.__pmUpdateInfo && window.__pmUpdateInfo.rule) || {};
  }

  function instructionPrefix() {
    const r = ruleInfo();
    let line = `[akidevrule ${r.current || 'not installed'}]`;
    if (r.state === 'missing') line += ' ⚠ akidevrule not installed — install in this panel first.';
    else if (r.state === 'update') line += ` ⚠ update available (${r.current} → ${r.latest}) — install in this panel, then Send Now again.`;
    return line;
  }

  function teamAddonsUrl(team) {
    const host = String((team && team.slug) || '').replace(/[^a-zA-Z0-9-]/g, '');
    return host ? `https://${host}.postman.co/billing/add-ons/overview` : '';
  }

  function quotaFillClass(pct) {
    return pct >= 90 ? 'aki-fill-error' : pct >= 70 ? 'aki-fill-warn' : 'aki-fill-ok';
  }

  function quotaPct(q) {
    return q ? Math.min(100, Math.max(0, q.percent || 0)) : 0;
  }

  function quotaLabel(q) {
    return q ? `${q.used.toLocaleString()} / ${q.limit.toLocaleString()}` : 'unavailable';
  }

  function quotaFill(q) {
    return q ? quotaFillClass(quotaPct(q)) : '';
  }

  function akiSpriteHref(symbolId) {
    const sample = document.querySelector('.status-bar use, .sb__item use');
    const raw = sample
      ? (sample.getAttribute('href') || sample.getAttribute('xlink:href') || '')
      : '';
    const base = raw.includes('#') ? raw.slice(0, raw.indexOf('#')) : '';
    return `${base}#${symbolId}`;
  }

  function akiIcon(symbolId, size) {
    const href = akiSpriteHref(symbolId);
    const s = size || 16;
    return `<svg class="aki-icon" width="${s}" height="${s}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><use href="${href}" xlink:href="${href}"></use></svg>`;
  }

  function akiPinIcon(filled) {
    if (document.querySelector('.status-bar use, .sb__item use')) {
      return akiIcon(filled ? 'icon-action-pin-fill-small' : 'icon-action-pin-stroke-small');
    }
    return `<svg class="aki-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M10.26 3.06a.75.75 0 0 1 .68.2l2 2a.75.75 0 0 1-.12 1.15L6.32 9.91a.75.75 0 0 1-.98-.2L3.76 6.56a.75.75 0 0 1 .2-.98l6.3-2.52z"/><path d="M5.15 10.15a.5.5 0 0 1 .7 0L3.35 13.35a.5.5 0 1 1-.7-.7l2.5-2.5z" opacity="${filled ? '1' : '0.7'}"/></svg>`;
  }

  function teamViewLink(team) {
    const href = teamAddonsUrl(team);
    if (!href) return '';
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" data-aki-team-view class="aki-view">View</a>`;
  }

  function getActiveUsageTeam() {
    const data = window.__pmUsageData;
    if (!data || !data.success || !Array.isArray(data.teams) || data.teams.length === 0) return null;
    const currentTeamId = new URLSearchParams(window.location.search).get('teamId');
    return data.teams.find(t => String(t.team_id) === String(currentTeamId)) || data.teams[0];
  }

  function renderStatusBarUsage() {
    const el = document.getElementById('aki-status-bar-usage');
    if (!el) return;

    const team = getActiveUsageTeam();
    if (!team || !team.quota) {
      el.classList.add('aki-sb-empty');
      el.innerHTML = '<span class="aki-sb-team">Credits</span><span class="aki-sb-bar"></span>';
      return;
    }

    const pct = Math.min(100, Math.max(0, team.quota.percent || 0));
    el.classList.remove('aki-sb-empty');
    el.innerHTML = `
      <span class="aki-sb-team">${team.name || team.slug || 'Team'}</span>
      <span class="aki-sb-bar"><span class="aki-sb-fill ${quotaFillClass(pct)}" style="width: ${pct}%;"></span></span>
      <span class="aki-sb-credits">${team.quota.used.toLocaleString()} / ${team.quota.limit.toLocaleString()}</span>
    `;
  }

  function renderUsageContent() {
    renderStatusBarUsage();

    const box = document.getElementById('aki-usage-box');
    if (!box) return;

    const data = window.__pmUsageData;
    if (!data || !data.success || !Array.isArray(data.teams)) {
      box.innerHTML = `
        <div class="aki-row">
          <span class="aki-section-label">AI CREDITS QUOTA</span>
          <span class="aki-muted">Synchronizing...</span>
        </div>
      `;
      return;
    }

    const currentTeamId = new URLSearchParams(window.location.search).get('teamId');
    const activeTeam = getActiveUsageTeam() || data.teams[0];

    let allTeamsHTML = '';
    if (config.showAllTeams) {
      allTeamsHTML = `
        <div class="aki-all-teams">
          ${data.teams.map(t => {
            const isCur = String(t.team_id) === String(currentTeamId);
            const pct = quotaPct(t.quota);
            return `
              <div class="aki-team ${isCur ? 'aki-team-cur' : ''}">
                <div class="aki-row aki-team-head">
                  <span class="aki-team-name-wrap">
                    <span class="aki-team-name">${t.name || t.slug}</span>
                    ${teamViewLink(t)}
                  </span>
                  <span class="aki-muted aki-nowrap">${quotaLabel(t.quota)}${t.quota ? ` (${pct}%)` : ''}</span>
                </div>
                <div class="aki-bar-track aki-bar-sm">
                  <div class="aki-sb-fill ${quotaFill(t.quota)}" style="width: ${pct}%;"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    const actPct = quotaPct(activeTeam.quota);

    box.innerHTML = `
      <div>
        <div class="aki-row aki-usage-head">
          <div class="aki-team-name-wrap">
            <span class="aki-section-label">${activeTeam.name || activeTeam.slug}</span>
            ${teamViewLink(activeTeam)}
            <span class="aki-tag">Active</span>
          </div>
          <span class="aki-quota">${quotaLabel(activeTeam.quota)}${activeTeam.quota ? ` (${actPct}%)` : ''}</span>
        </div>
        <div class="aki-bar-track">
          <div class="aki-sb-fill ${quotaFill(activeTeam.quota)}" style="width: ${actPct}%;"></div>
        </div>
        <div class="aki-row aki-usage-foot">
          <button id="aki-toggle-all-teams" class="aki-text-btn">
            ${config.showAllTeams ? 'Collapse' : `View all ${data.teams.length} teams`}
          </button>
          <span class="aki-muted">${data.updatedAt || ''}</span>
        </div>
        ${allTeamsHTML}
      </div>
    `;

    const toggleAll = box.querySelector('#aki-toggle-all-teams');
    if (toggleAll) toggleAll.onclick = (e) => {
      e.stopPropagation();
      config.showAllTeams = !config.showAllTeams;
      renderUsageContent();
    };

    box.querySelectorAll('[data-aki-team-view]').forEach((link) => {
      link.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(link.href, '_blank');
      };
    });
  }

  window.__pmRenderUsageBox = renderUsageContent;

  const PANEL_WIDTH = 350;
  const ANCHOR_GAP = 4;
  const VIEWPORT_PAD = 8;
  const AKI_UI_V = 'aether14';

  function togglePanel(forcedState) {
    const panel = document.getElementById('aki-control-panel');
    const trigger = document.getElementById('aki-vertical-trigger');
    if (!panel) return;

    const next = (typeof forcedState === 'boolean') ? forcedState : !panel.classList.contains('aki-open');
    panel.classList.toggle('aki-open', next);
    if (trigger) trigger.classList.toggle('aki-trigger-active', next);
    window.__pmAkiPanelOpen = next;
    if (next) renderUsageContent();
    positionAkiWidget();
  }

  function positionAkiWidget() {
    const trigger = document.getElementById('aki-vertical-trigger');
    const panel = document.getElementById('aki-control-panel');
    if (!trigger || !panel) return;

    const anchor = trigger.getBoundingClientRect();
    if (anchor.width <= 0 || anchor.height <= 0) return;

    const left = Math.min(
      Math.max(VIEWPORT_PAD, anchor.left),
      window.innerWidth - PANEL_WIDTH - VIEWPORT_PAD
    );
    const bottom = anchor.top - ANCHOR_GAP;
    panel.style.left = `${left}px`;
    panel.style.top = `${bottom}px`;
    panel.style.maxHeight = `${Math.max(0, bottom - VIEWPORT_PAD)}px`;
  }

  function injectAkiStyles() {
    const css = `
      .status-bar-container.status-bar {
        position: relative;
      }
      #aki-status-bar-slot {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 1;
        height: 100%;
        min-width: 0;
        pointer-events: none;
      }
      .status-bar-container.status-bar > #aki-status-bar-slot {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        z-index: 1;
        flex: none;
      }
      #aki-vertical-trigger {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        align-self: center;
        height: var(--size-s);
        padding: 0 var(--spacing-s);
        background: var(--button-primary-background-color, var(--base-color-brand));
        border: none;
        border-radius: var(--border-radius-default);
        cursor: pointer;
        user-select: none;
        pointer-events: auto;
        font-family: var(--text-family-default);
        font-size: var(--text-size-s);
        font-weight: var(--text-weight-medium);
        color: var(--button-primary-content-color, var(--content-color-constant));
        white-space: nowrap;
        flex-shrink: 0;
      }
      #aki-vertical-trigger:hover,
      #aki-vertical-trigger.aki-trigger-active {
        background: var(--button-primary-hover-background-color, var(--highlight-background-color-brand));
      }
      #aki-status-bar-usage {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-s);
        height: 100%;
        max-height: var(--size-s);
        max-width: 100%;
        padding: 0 var(--spacing-s);
        box-sizing: border-box;
        background: var(--background-color-tertiary);
        border: var(--border-width-default) solid var(--border-color-default);
        border-radius: var(--border-radius-default);
        font-family: var(--text-family-default);
        font-size: var(--text-size-s);
        line-height: var(--line-height-s);
        color: var(--content-color-secondary);
        white-space: nowrap;
        overflow: hidden;
      }
      #aki-status-bar-usage.aki-sb-empty {
        color: var(--content-color-tertiary);
      }
      #aki-status-bar-usage .aki-sb-team {
        font-weight: var(--text-weight-medium);
        color: var(--content-color-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 140px;
      }
      #aki-status-bar-usage.aki-sb-empty .aki-sb-team {
        color: var(--content-color-tertiary);
        font-weight: var(--text-weight-regular);
      }
      #aki-status-bar-usage .aki-sb-bar {
        width: 72px;
        height: var(--border-width-xl);
        background: var(--highlight-background-color-transparent);
        border-radius: var(--border-radius-s);
        overflow: hidden;
        flex-shrink: 0;
      }
      .aki-sb-fill {
        display: block;
        height: 100%;
      }
      .aki-fill-ok { background-color: var(--base-color-success); }
      .aki-fill-warn { background-color: var(--base-color-warning); }
      .aki-fill-error { background-color: var(--base-color-error); }
      #aki-status-bar-usage .aki-sb-credits {
        font-variant-numeric: tabular-nums;
        color: var(--content-color-tertiary);
        flex-shrink: 0;
      }
      #aki-control-panel {
        position: fixed;
        overflow-y: auto;
        z-index: 9999999;
        opacity: 0;
        pointer-events: none;
        transform: translateY(-90%);
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
        background: var(--popover-background-color, var(--background-color-primary));
        border: var(--border-width-default) solid var(--popover-outline-color, var(--border-color-default));
        border-bottom-width: var(--border-width-l);
        border-bottom-color: var(--content-color-brand);
        border-radius: var(--border-radius-l);
        box-shadow: var(--popover-box-shadow, var(--shadow-default));
        font-family: var(--text-family-default);
        font-size: var(--text-size-m);
        color: var(--content-color-primary);
        padding: var(--spacing-m);
        box-sizing: border-box;
      }
      #aki-control-panel.aki-open {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(-100%);
      }
      #aki-control-panel .aki-icon {
        display: block;
        fill: currentColor;
      }
      #aki-control-panel .aki-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: var(--border-width-default) solid var(--border-color-default);
        padding-bottom: var(--spacing-s);
        margin-bottom: var(--spacing-m);
      }
      #aki-control-panel .aki-title {
        font-size: var(--text-size-l);
        font-weight: var(--text-weight-bold);
        color: var(--content-color-primary);
      }
      #aki-control-panel .aki-head-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-s);
      }
      #aki-control-panel .aki-pin {
        background: none;
        border: var(--border-width-default) solid transparent;
        border-radius: var(--border-radius-default);
        color: var(--content-color-tertiary);
        cursor: pointer;
        padding: 1px var(--spacing-xs);
        display: inline-flex;
        align-items: center;
      }
      #aki-control-panel .aki-pin.is-pinned {
        background: var(--background-color-brand);
        border-color: var(--content-color-brand);
        color: var(--content-color-brand);
      }
      #aki-control-panel .aki-stack {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-s);
        font-size: var(--text-size-m);
        margin-bottom: var(--spacing-m);
      }
      #aki-control-panel .aki-stack.aki-rule {
        border-top: var(--border-width-default) solid var(--border-color-default);
        padding-top: var(--spacing-s);
      }
      #aki-control-panel .aki-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      #aki-control-panel .aki-label {
        display: flex;
        align-items: center;
        gap: var(--spacing-s);
        cursor: pointer;
      }
      #aki-control-panel .aki-badge {
        color: var(--content-color-brand);
        font-weight: var(--text-weight-medium);
        font-size: var(--text-size-m);
      }
      #aki-control-panel input[type="checkbox"] {
        accent-color: var(--base-color-brand);
      }
      #aki-control-panel .aki-section-label {
        font-size: var(--text-size-s);
        font-weight: var(--text-weight-bold);
        color: var(--content-color-brand);
      }
      #aki-control-panel .aki-help {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        margin-left: 4px;
        border-radius: 50%;
        background: var(--background-color-tertiary);
        color: var(--content-color-tertiary);
        font-size: 10px;
        font-weight: var(--text-weight-bold);
        cursor: help;
        vertical-align: middle;
      }
      #aki-usage-box {
        margin-bottom: var(--spacing-m);
        padding: var(--spacing-s);
        background: var(--background-color-secondary);
        border-radius: var(--border-radius-default);
      }
      #aki-control-panel .aki-btn {
        background: var(--button-primary-background-color, var(--base-color-brand));
        color: var(--button-primary-content-color, var(--content-color-constant));
        border: none;
        border-radius: var(--border-radius-s);
        padding: 3px var(--spacing-s);
        font-family: var(--text-family-default);
        font-size: var(--text-size-xs);
        font-weight: var(--text-weight-bold);
        cursor: pointer;
      }
      #aki-control-panel .aki-btn:hover {
        background: var(--button-primary-hover-background-color, var(--highlight-background-color-brand));
      }
      #aki-install-rule-status {
        font-size: var(--text-size-xs);
        color: var(--content-color-tertiary);
        line-height: 1.4;
        min-height: 14px;
      }
      #aki-control-panel .aki-ok { color: var(--content-color-success); }
      #aki-control-panel .aki-err { color: var(--content-color-error); }
      #aki-control-panel .aki-muted {
        color: var(--content-color-tertiary);
        font-size: var(--text-size-xs);
      }
      #aki-control-panel .aki-view {
        color: var(--content-color-tertiary);
        font-size: var(--text-size-xs);
        font-weight: var(--text-weight-medium);
        text-decoration: none;
        border: var(--border-width-default) solid var(--border-color-default);
        border-radius: var(--border-radius-s);
        padding: 0 var(--spacing-xs);
        line-height: var(--line-height-xs);
        cursor: pointer;
        flex-shrink: 0;
      }
      #aki-control-panel .aki-tag {
        font-size: var(--text-size-xs);
        background: var(--background-color-brand);
        color: var(--content-color-brand);
        padding: 1px var(--spacing-xs);
        border-radius: var(--border-radius-s);
      }
      #aki-control-panel .aki-team-name-wrap {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        min-width: 0;
      }
      #aki-control-panel .aki-team-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #aki-control-panel .aki-team-cur {
        background: var(--background-color-brand);
        border-left: var(--border-width-l) solid var(--content-color-brand);
        padding-left: var(--spacing-xs);
      }
      #aki-control-panel .aki-team-cur .aki-team-name {
        color: var(--content-color-brand);
        font-weight: var(--text-weight-bold);
      }
      #aki-control-panel .aki-bar-track {
        background: var(--highlight-background-color-transparent);
        height: 6px;
        border-radius: 3px;
        overflow: hidden;
        margin-bottom: var(--spacing-xs);
      }
      #aki-control-panel .aki-bar-track.aki-bar-sm {
        height: var(--border-width-xl);
        border-radius: var(--border-radius-s);
        margin-bottom: 0;
      }
      #aki-control-panel .aki-text-btn {
        background: none;
        border: none;
        color: var(--content-color-tertiary);
        cursor: pointer;
        padding: 0;
        text-decoration: underline;
        font-family: inherit;
        font-size: inherit;
      }
      #aki-control-panel .aki-all-teams {
        max-height: 130px;
        overflow-y: auto;
        margin-top: var(--spacing-s);
        border-top: var(--border-width-default) solid var(--border-color-default);
        padding-top: var(--spacing-xs);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        font-size: var(--text-size-xs);
      }
      #aki-control-panel .aki-team-head,
      #aki-control-panel .aki-usage-head {
        margin-bottom: 2px;
        gap: var(--spacing-xs);
      }
      #aki-control-panel .aki-usage-foot {
        font-size: var(--text-size-xs);
      }
      #aki-control-panel .aki-nowrap { flex-shrink: 0; }
      #aki-control-panel .aki-textarea {
        width: 100%;
        box-sizing: border-box;
        margin-top: var(--spacing-xs);
        padding: var(--spacing-xs);
        background: var(--background-color-secondary);
        border: var(--border-width-default) solid var(--border-color-default);
        border-radius: var(--border-radius-default);
        color: var(--content-color-primary);
        font-family: monospace;
        font-size: var(--text-size-xs);
        line-height: 1.4;
        resize: vertical;
        min-height: 90px;
      }
    `;
    let style = document.getElementById('aki-injected-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'aki-injected-styles';
      document.head.appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
  }

  function findStatusBar() {
    return document.querySelector('.status-bar-container.status-bar');
  }

  // Live Postman bar (12.25): first .sb-section = left (sidebar, Git, Terminal, Console);
  // .sb-section--center = native empty center; last .sb-section = right (Globals, Vault, Tools).
  function findLeftStatusSection() {
    const bar = findStatusBar();
    if (!bar) return null;
    const sections = [...bar.querySelectorAll(':scope > .sb-section')];
    return sections.find((s) => !s.classList.contains('sb-section--center')) || sections[0] || null;
  }

  function findCenterStatusHost() {
    const bar = findStatusBar();
    if (!bar) return null;
    return bar.querySelector(':scope > .sb-section.sb-section--center') || bar;
  }

  function renderRuleStatus() {
    const status = document.getElementById('aki-install-rule-status');
    const btn = document.getElementById('aki-btn-install-rule');
    if (!status || !btn) return;
    if (btn.dataset.busy === '1') return;
    if (status.dataset.sticky === '1') return;

    const r = ruleInfo();
    const state = r.state || 'unknown';
    const current = r.current ? String(r.current) : '';
    const latest = r.latest ? String(r.latest) : '';
    status.dataset.state = state;
    status.classList.remove('aki-err');

    if (state === 'missing') {
      btn.className = 'aki-btn';
      btn.textContent = 'Install';
      status.innerHTML = '<span class="aki-err">not installed</span>'
        + (latest ? `<span class="aki-muted"> · latest ${latest}</span>` : '');
      return;
    }
    if (state === 'update') {
      btn.className = 'aki-btn';
      btn.textContent = 'Update';
      status.innerHTML = `<span>${current} → ${latest}</span>`;
      return;
    }
    if (state === 'unknown') {
      btn.className = 'aki-text-btn';
      btn.textContent = 'Install / update';
      status.innerHTML = (current ? `<span class="aki-muted">${current} · </span>` : '')
        + '<span class="aki-muted">update check failed</span>';
      return;
    }

    btn.className = 'aki-text-btn';
    btn.textContent = 'Install / update';
    status.innerHTML = current ? `<span class="aki-muted">${current}</span>` : '';
  }

  window.__pmRenderRuleStatus = renderRuleStatus;

  function renderAkiWidget() {
    if (!document.body) return;
    injectAkiStyles();

    const leftSection = findLeftStatusSection();
    let akiTrigger = document.getElementById('aki-vertical-trigger');
    if (leftSection) {
      if (!akiTrigger) {
        akiTrigger = document.createElement('button');
        akiTrigger.id = 'aki-vertical-trigger';
        akiTrigger.type = 'button';
        akiTrigger.innerHTML = '<span>Aki Control Panel</span>';
      }
      akiTrigger.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePanel();
      };
      if (leftSection.firstElementChild !== akiTrigger) {
        leftSection.insertBefore(akiTrigger, leftSection.firstElementChild);
      }
    }

    const centerHost = findCenterStatusHost();
    if (centerHost) {
      let slot = document.getElementById('aki-status-bar-slot');
      if (!slot) {
        slot = document.createElement('div');
        slot.id = 'aki-status-bar-slot';
      }
      if (slot.parentElement !== centerHost) centerHost.appendChild(slot);
      let usageEl = document.getElementById('aki-status-bar-usage');
      if (!usageEl) {
        usageEl = document.createElement('div');
        usageEl.id = 'aki-status-bar-usage';
      }
      if (usageEl.parentElement !== slot) slot.appendChild(usageEl);
    }

    let panel = document.getElementById('aki-control-panel');
    if (panel && panel.dataset.akiUi !== AKI_UI_V) {
      window.__pmAkiPanelOpen = panel.classList.contains('aki-open') || window.__pmAkiPanelOpen;
      panel.remove();
      panel = null;
    }
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'aki-control-panel';
      panel.dataset.akiUi = AKI_UI_V;
      panel.style.width = `${PANEL_WIDTH}px`;

      const agentMode = readPostmanAgentMode();
      panel.innerHTML = `
        <div class="aki-head">
          <span class="aki-title">Aki Postman Control Panel</span>
          <div class="aki-head-actions">
            <button type="button" id="aki-btn-new-window" class="aki-btn">NEW WINDOW</button>
            <button type="button" id="aki-btn-new-browser-tab" class="aki-btn">NEW BROWSER TAB</button>
            <button type="button" id="aki-panel-pin" class="aki-pin${config.isPinned ? ' is-pinned' : ''}" title="Pin panel (stay open when clicking outside)">${akiPinIcon(config.isPinned)}</button>
          </div>
        </div>

        <div class="aki-stack">
          ${autoClicker.renderRows(config)}
          ${renderRejectFolderRow(config)}
        </div>

        <div id="aki-usage-box"></div>

        <div class="aki-stack aki-rule">
          <div class="aki-section-label">CHAT AGENT</div>
          <div class="aki-row">
            <label class="aki-label">
              <input type="checkbox" id="aki-opt-thinking" ${agentMode.thinking ? 'checked' : ''}>
              <span><strong>Thinking</strong> (high)</span>
            </label>
          </div>
          <div class="aki-row">
            <label class="aki-label">
              <input type="checkbox" id="aki-opt-autorun" ${agentMode.autorun ? 'checked' : ''}>
              <span><strong>Auto-run</strong> (agent tool calls)</span>
            </label>
          </div>
        </div>

        <div class="aki-stack aki-rule">
          <div class="aki-row">
            <span class="aki-section-label">AKI DEV RULE</span>
            <button type="button" id="aki-btn-install-rule" class="aki-btn">Install</button>
          </div>
          <div id="aki-install-rule-status" data-state="unknown"></div>
        </div>

        <div class="aki-stack aki-rule">
          <div class="aki-row">
            <span class="aki-section-label">ANTI-BOT<span class="aki-help" title="Sites can check navigator.webdriver to tell a browser is automated. Protected = Postman was launched with the flag that hides it. Unprotected = it wasn't (still works fine, just detectable).">?</span></span>
          </div>
          <div id="aki-stealth-status">${navigator.webdriver
            ? '<span class="aki-err">Unprotected</span><br><span class="aki-muted">Quit Postman fully (Cmd+Q), then npm start / npm run launch to fix.</span>'
            : '<span class="aki-ok">Protected</span>'}</div>
        </div>

        <div class="aki-stack aki-rule">
          <div class="aki-row">
            <span class="aki-section-label">PROMPT INSTRUCTION</span>
            <button type="button" id="aki-btn-send-instruction" class="aki-btn">SEND NOW</button>
          </div>
          <div class="aki-row">
            <label class="aki-label">
              <input type="checkbox" id="aki-opt-auto-inject" ${config.autoInjectInstruction ? 'checked' : ''}>
              <span>Auto-inject into each new chat</span>
            </label>
          </div>
          <textarea id="aki-instruction-textarea" class="aki-textarea">${escapeHtml(config.instruction)}</textarea>
        </div>
      `;

      document.body.appendChild(panel);

      panel.onclick = (e) => e.stopPropagation();

      panel.querySelector('#aki-btn-new-window').onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerPostman(PM_EVENT_NEW_REQUESTER_WINDOW);
      };

      panel.querySelector('#aki-btn-new-browser-tab').onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openNewBrowserTab();
      };

      autoClicker.bindRows(panel, config, syncAndSaveConfig);
      const rejectFolderCb = panel.querySelector(`#${AUTO_REJECT_PICK_FOLDER.checkboxId}`);
      if (rejectFolderCb) {
        rejectFolderCb.onchange = (e) => {
          config[AUTO_REJECT_PICK_FOLDER.configKey] = e.target.checked;
          syncAndSaveConfig();
        };
      }

      const instructionTextarea = panel.querySelector('#aki-instruction-textarea');
      if (instructionTextarea) {
        instructionTextarea.onchange = (e) => {
          config.instruction = e.target.value;
          if (typeof window.__cdpSaveInstruction === 'function') window.__cdpSaveInstruction(config.instruction);
        };
      }
      const autoInjectCb = panel.querySelector('#aki-opt-auto-inject');
      if (autoInjectCb) {
        autoInjectCb.onchange = (e) => {
          config.autoInjectInstruction = e.target.checked;
          syncAndSaveConfig();
        };
      }
    }

    const pinBtn = panel.querySelector('#aki-panel-pin');
    if (pinBtn) {
      pinBtn.type = 'button';
      const pinned = !!config.isPinned;
      if (pinBtn.classList.contains('is-pinned') !== pinned) {
        pinBtn.classList.toggle('is-pinned', pinned);
        pinBtn.innerHTML = akiPinIcon(pinned);
      }
      pinBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        config.isPinned = !config.isPinned;
        pinBtn.classList.toggle('is-pinned', config.isPinned);
        pinBtn.innerHTML = akiPinIcon(config.isPinned);
        syncAndSaveConfig();
      };
    }

    const liveMode = readPostmanAgentMode();
    const thinkingCb = panel.querySelector('#aki-opt-thinking');
    if (thinkingCb) {
      if (!window.__pmPendingAgentSwitch && thinkingCb.checked !== liveMode.thinking) {
        thinkingCb.checked = liveMode.thinking;
      }
      thinkingCb.onchange = (e) => {
        window.__pmPendingAgentSwitch = { kind: 'thinking', want: e.target.checked };
        applyPendingAgentSwitch();
      };
    }
    const autorunCb = panel.querySelector('#aki-opt-autorun');
    if (autorunCb) {
      if (!window.__pmPendingAgentSwitch && autorunCb.checked !== liveMode.autorun) {
        autorunCb.checked = liveMode.autorun;
      }
      autorunCb.onchange = (e) => {
        window.__pmPendingAgentSwitch = { kind: 'autorun', want: e.target.checked };
        applyPendingAgentSwitch();
      };
    }

    const sendBtn = panel.querySelector('#aki-btn-send-instruction');
    if (sendBtn && !window.__pmSendInFlight) {
      sendBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        sendAiPrompt(config.instruction);
      };
    }

    const installBtn = panel.querySelector('#aki-btn-install-rule');
    if (installBtn) {
      installBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (installBtn.dataset.busy === '1') return;
        installBtn.dataset.busy = '1';
        const status = document.getElementById('aki-install-rule-status');
        if (status) {
          status.dataset.sticky = '';
          status.textContent = 'Installing...';
        }
        try {
          if (typeof window.__cdpInstallAkiRule === 'function') window.__cdpInstallAkiRule('');
          else if (status) {
            status.dataset.sticky = '1';
            status.textContent = 'Install binding not ready. Restart the daemon.';
            installBtn.dataset.busy = '';
          }
        } catch (err) {
          if (status) {
            status.dataset.sticky = '1';
            status.textContent = 'Error: ' + ((err && err.message) || err);
          }
          installBtn.dataset.busy = '';
        }
      };
    }

    const open = !!window.__pmAkiPanelOpen;
    if (open !== panel.classList.contains('aki-open')) {
      togglePanel(open);
    } else {
      const trigger = document.getElementById('aki-vertical-trigger');
      if (trigger) trigger.classList.toggle('aki-trigger-active', open);
    }
    renderStatusBarUsage();
    renderRuleStatus();
  }

  window.__pmRenderInstallRuleResult = function () {
    const panel = document.getElementById('aki-control-panel');
    if (!panel) return;
    const btn = panel.querySelector('#aki-btn-install-rule');
    const status = panel.querySelector('#aki-install-rule-status');
    const r = window.__pmInstallRuleResult || {};
    if (btn) btn.dataset.busy = '';
    if (!status) return;
    if (r.ok) {
      status.dataset.sticky = '';
      renderRuleStatus();
      return;
    }
    status.dataset.sticky = '1';
    status.textContent = r.msg || 'Failed';
    status.classList.add('aki-err');
  };

  async function sendAiPrompt(text) {
    if (window.__pmSendInFlight || !text || !text.trim()) return false;
    const input = findChatInput();
    if (!input) return false;
    window.__pmSendInFlight = true;
    const btn = document.getElementById('aki-btn-send-instruction');
    const oldLabel = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = 'SENDING…'; }
    try {
      const full = instructionPrefix() + '\n\n' + text;
      // Lexical editor (contenteditable, not textarea/input): a synthetic InputEvent
      // ('beforeinput') is ignored by Lexical's own handler (no getTargetRanges()); the
      // browser's native execCommand pipeline is what Lexical actually listens to. Lexical's
      // DOM reconciliation after execCommand is not synchronous with this script tick — a
      // double rAF wait (live-confirmed) is needed before the button reads the typed state.
      input.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, full);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      submitChatInput(input);
      return true;
    } finally {
      window.__pmSendInFlight = false;
      if (btn) { btn.disabled = false; btn.textContent = oldLabel; }
    }
  }

  let armedForNewChat = false;
  function checkAndInjectInstruction() {
    if (!config.autoInjectInstruction || window.__pmSendInFlight) return;
    const chat = document.querySelector('[data-testid="ai-chat-container"]');
    const empty = chat && isChatEmpty(chat);
    if (!empty) { armedForNewChat = true; return; }
    if (!armedForNewChat) return;
    armedForNewChat = false;
    sendAiPrompt(config.instruction);
  }

  function runLoop() {
    handleStartupSequence();
    renderAkiWidget();
    positionAkiWidget();
    applyPendingAgentSwitch();
    tickPermissionCards(config);
    checkAndInjectInstruction();
  }

  window.__pmMasterInterval = setInterval(runLoop, 400);
  runLoop();
})();
