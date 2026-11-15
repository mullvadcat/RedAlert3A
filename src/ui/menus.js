// Skirmish Configuration Lobby & Post-Match/Campaign Navigation Overlay (Pure safe DOM).
// Uses strictly document.createElement + textContent (zero innerHTML / unsafe HTML sinks).

import { FACTIONS } from '../core/config.js';
import { onLocaleChange, t } from '../core/i18n.js';
import { createDefaultCampaignProfile, isMissionUnlocked } from '../core/save.js';
import { CAMPAIGN_MISSIONS } from '../story/campaigns/index.js';
import { SKIRMISH_MAPS, getSkirmishMapById } from '../world/skirmishMaps.js';

export function createLobbyMenu(uiState, options = {}) {
  const viewportEl = document.getElementById('viewport-container');
  const topBarEl = document.getElementById('hud-top-bar');
  if (!viewportEl || !topBarEl) {
    return {
      open: () => {},
      close: () => {},
      isOpen: () => false,
      setProfile: () => {}
    };
  }

  let profile = options.profile ?? createDefaultCampaignProfile();
  let activeTab = options.initialTab === 'campaign' ? 'campaign' : 'skirmish';

  // Top-bar clickable Lobby pill
  const btnOpen = document.createElement('button');
  btnOpen.id = 'btn-open-lobby';
  btnOpen.type = 'button';
  btnOpen.className = 'hud-pill hud-btn-pill';
  topBarEl.appendChild(btnOpen);

  // Modal Overlay
  const modal = document.createElement('div');
  modal.id = 'lobby-modal';
  modal.hidden = !options.openInitially;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  uiState.lobbyOpen = !modal.hidden;

  const card = document.createElement('div');
  card.className = 'modal-card lobby-card';
  modal.appendChild(card);

  const titleEl = document.createElement('h2');
  card.appendChild(titleEl);

  const tabBar = document.createElement('div');
  tabBar.className = 'modal-actions';
  tabBar.style.marginBottom = '10px';
  const btnTabSkirmish = document.createElement('button');
  btnTabSkirmish.type = 'button';
  const btnTabCampaign = document.createElement('button');
  btnTabCampaign.type = 'button';
  tabBar.appendChild(btnTabSkirmish);
  tabBar.appendChild(btnTabCampaign);
  card.appendChild(tabBar);

  const formEl = document.createElement('div');
  formEl.className = 'lobby-grid';
  card.appendChild(formEl);

  const campaignPanel = document.createElement('div');
  campaignPanel.className = 'lobby-campaign-list';
  campaignPanel.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;max-height:260px;overflow-y:auto;margin-bottom:10px;';
  card.appendChild(campaignPanel);

  function addRow(labelKey, selectEl) {
    const row = document.createElement('label');
    row.className = 'lobby-row';
    const lbl = document.createElement('span');
    lbl.className = 'lobby-label';
    lbl.dataset.i18n = labelKey;
    row.appendChild(lbl);
    row.appendChild(selectEl);
    formEl.appendChild(row);
    return { row, lbl, selectEl };
  }

  const mapSelect = document.createElement('select');
  for (const m of SKIRMISH_MAPS) {
    const opt = document.createElement('option');
    opt.value = m.id;
    mapSelect.appendChild(opt);
  }
  if (options.initialMapId) mapSelect.value = options.initialMapId;
  addRow('menu.map', mapSelect);

  const factionSelect = document.createElement('select');
  for (const fid of [FACTIONS.abyssal.id, FACTIONS.crimson.id]) {
    const opt = document.createElement('option');
    opt.value = fid;
    factionSelect.appendChild(opt);
  }
  if (options.initialFactionId) factionSelect.value = options.initialFactionId;
  addRow('menu.faction', factionSelect);

  const creditsSelect = document.createElement('select');
  for (const amt of [5000, 10000, 30000]) {
    const opt = document.createElement('option');
    opt.value = String(amt);
    opt.textContent = `$${amt.toLocaleString('en-US')}`;
    creditsSelect.appendChild(opt);
  }
  creditsSelect.value = '10000';
  addRow('menu.credits', creditsSelect);

  const modeSelect = document.createElement('select');
  const slotModes = [
    { value: '1v1', key: 'menu.slot1v1', minPlayers: 2 },
    { value: '3ffa', key: 'menu.slot3Ffa', minPlayers: 3 },
    { value: '2v2', key: 'menu.slot2v2', minPlayers: 4 },
    { value: '4ffa', key: 'menu.slot4Ffa', minPlayers: 4 }
  ];
  for (const sm of slotModes) {
    const opt = document.createElement('option');
    opt.value = sm.value;
    opt.dataset.i18n = sm.key;
    modeSelect.appendChild(opt);
  }
  addRow('menu.aiCount', modeSelect);

  const diffSelect = document.createElement('select');
  for (const d of ['easy', 'normal', 'hard']) {
    const opt = document.createElement('option');
    opt.value = d;
    opt.dataset.i18n = `menu.${d}`;
    diffSelect.appendChild(opt);
  }
  diffSelect.value = 'normal';
  addRow('menu.aiDiff', diffSelect);

  // Actions row
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const btnStart = document.createElement('button');
  btnStart.type = 'button';
  btnStart.id = 'btn-lobby-launch';
  const btnSaveCp = document.createElement('button');
  btnSaveCp.type = 'button';
  btnSaveCp.id = 'btn-save-checkpoint';
  const btnLoadCp = document.createElement('button');
  btnLoadCp.type = 'button';
  btnLoadCp.id = 'btn-load-checkpoint';
  const btnClose = document.createElement('button');
  btnClose.type = 'button';
  btnClose.id = 'btn-lobby-close';
  actions.appendChild(btnStart);
  actions.appendChild(btnSaveCp);
  actions.appendChild(btnLoadCp);
  actions.appendChild(btnClose);
  card.appendChild(actions);

  viewportEl.appendChild(modal);

  function renderCampaignList() {
    while (campaignPanel.firstChild) campaignPanel.removeChild(campaignPanel.firstChild);
    for (const m of CAMPAIGN_MISSIONS) {
      const unlocked = isMissionUnlocked(profile, m.id);
      const clearedDiff = profile?.clearedMissions?.[m.id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.disabled = !unlocked;
      btn.style.cssText = 'text-align:left;padding:6px 8px;border:1px solid #355070;border-radius:4px;background:#101c2d;color:#e2e8f0;cursor:pointer;font-size:12px;';
      if (!unlocked) btn.style.opacity = '0.45';
      const statusTxt = clearedDiff
        ? `[${t('menu.cleared')}]`
        : (unlocked ? '' : `[${t('menu.locked')}]`);
      btn.textContent = `${t(m.titleKey)} ${statusTxt}`.trim();
      btn.addEventListener('click', () => {
        if (!unlocked) return;
        close();
        if (typeof options.onLaunchCampaign === 'function') {
          options.onLaunchCampaign(m.id, diffSelect.value || 'normal');
        }
      });
      campaignPanel.appendChild(btn);
    }
  }

  function syncTabs() {
    formEl.hidden = activeTab !== 'skirmish';
    campaignPanel.hidden = activeTab !== 'campaign';
    btnStart.hidden = activeTab !== 'skirmish';
    if (activeTab === 'campaign') renderCampaignList();
  }

  function syncModeOptionsWithMap() {
    const blueprint = getSkirmishMapById(mapSelect.value);
    const maxP = blueprint.maxPlayers ?? 2;
    for (let i = 0; i < modeSelect.options.length; i++) {
      const opt = modeSelect.options[i];
      const spec = slotModes[i];
      opt.disabled = spec.minPlayers > maxP;
    }
    if (modeSelect.selectedOptions[0]?.disabled) {
      modeSelect.value = '1v1';
    }
  }

  function applyTranslations() {
    btnOpen.textContent = t('menu.lobbyBtn');
    titleEl.textContent = activeTab === 'campaign' ? t('menu.campaignTab') : t('menu.skirmish');
    btnTabSkirmish.textContent = t('menu.skirmishTab');
    btnTabCampaign.textContent = t('menu.campaignTab');
    btnStart.textContent = t('menu.start');
    btnSaveCp.textContent = t('menu.saveCheckpoint');
    btnLoadCp.textContent = t('menu.loadCheckpoint');
    btnClose.textContent = t('menu.resume');

    for (const lbl of formEl.querySelectorAll('.lobby-label')) {
      lbl.textContent = t(lbl.dataset.i18n);
    }
    for (let i = 0; i < mapSelect.options.length; i++) {
      const m = SKIRMISH_MAPS[i];
      mapSelect.options[i].textContent = t(m.nameKey);
    }
    for (const opt of factionSelect.options) {
      opt.textContent = t(`faction.${opt.value}`);
    }
    for (const opt of modeSelect.options) {
      opt.textContent = t(opt.dataset.i18n);
    }
    for (const opt of diffSelect.options) {
      opt.textContent = t(opt.dataset.i18n);
    }
    syncTabs();
  }

  function open() {
    syncModeOptionsWithMap();
    syncTabs();
    modal.hidden = false;
    uiState.lobbyOpen = true;
  }

  function close() {
    modal.hidden = true;
    uiState.lobbyOpen = false;
  }

  btnTabSkirmish.addEventListener('click', () => {
    activeTab = 'skirmish';
    applyTranslations();
  });
  btnTabCampaign.addEventListener('click', () => {
    activeTab = 'campaign';
    applyTranslations();
  });
  btnSaveCp.addEventListener('click', () => {
    if (typeof options.onSaveCheckpoint === 'function') options.onSaveCheckpoint();
  });
  btnLoadCp.addEventListener('click', () => {
    if (typeof options.onLoadCheckpoint === 'function') {
      options.onLoadCheckpoint();
      close();
    }
  });

  mapSelect.addEventListener('change', syncModeOptionsWithMap);
  btnOpen.addEventListener('click', () => (modal.hidden ? open() : close()));
  btnClose.addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !modal.hidden) close();
  });

  btnStart.addEventListener('click', () => {
    const mapBlueprint = getSkirmishMapById(mapSelect.value);
    const humanFaction = factionSelect.value;
    const rivalFaction = humanFaction === 'abyssal' ? 'crimson' : 'abyssal';
    const credits = Number(creditsSelect.value) || 10000;
    const diff = diffSelect.value || 'normal';
    const mode = modeSelect.value;

    const totalPlayers =
      mode === '1v1' ? 2 : (mode === '3ffa' ? 3 : Math.min(4, mapBlueprint.maxPlayers ?? 2));
    const players = [];
    for (let i = 0; i < totalPlayers; i++) {
      const teamId = mode === '2v2' ? (i < 2 ? 0 : 1) : i;
      const factionId =
        i === 0
          ? humanFaction
          : (mode === '2v2' ? (i < 2 ? humanFaction : rivalFaction) : (i % 2 === 1 ? rivalFaction : humanFaction));
      players.push({
        playerId: i,
        teamId,
        factionId,
        isHuman: i === 0,
        aiDifficulty: i === 0 ? null : diff,
        credits
      });
    }

    close();
    if (typeof options.onLaunchSkirmish === 'function') {
      options.onLaunchSkirmish({
        mapBlueprint,
        players,
        startingCredits: credits,
        factionId: humanFaction,
        aiDifficulty: diff,
        skirmishFairStart: true
      });
    }
  });

  onLocaleChange(applyTranslations);
  syncModeOptionsWithMap();
  applyTranslations();

  return {
    open,
    close,
    isOpen: () => !modal.hidden,
    setProfile(nextProfile) {
      profile = nextProfile ?? profile;
      if (activeTab === 'campaign') renderCampaignList();
    }
  };
}
