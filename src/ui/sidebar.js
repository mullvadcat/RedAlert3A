// Fixed 200px Steel Sidebar UI + Canvas 2D Production Icon Grid + Localized HUD Sync (L2 UI Layer).
// Strictly uses textContent / createElement / Canvas 2D fillText (zero innerHTML / unsafe DOM sinks).

import { ENTITY_DEFS, FACTIONS, PLAYER_COLORS } from '../core/config.js';
import { getLocale, onLocaleChange, t, toggleLocale } from '../core/i18n.js';
import { getBuildableItemsForTab } from '../gameplay/production.js';

const GRID_COLS = 2;
const CELL_W = 86;
const CELL_H = 68;
const CELL_GAP = 6;
const PAD_X = 3;
const PAD_Y = 4;

function drawUnitSilhouette(ctx, def, cx, cy, accentColor) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#9aaec4';
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.6;

  if (def.isBuilding) {
    // Structural architectural icon
    const w = 34;
    const h = 24;
    ctx.fillStyle = '#3a4a5e';
    ctx.fillRect(-w * 0.5, -h * 0.5 + 3, w, h);
    ctx.strokeRect(-w * 0.5, -h * 0.5 + 3, w, h);
    ctx.fillStyle = accentColor;
    if (def.id === 'conyard') {
      ctx.fillRect(-10, -8, 20, 14);
      ctx.fillStyle = '#e5a93c';
      ctx.fillRect(4, -14, 7, 9);
    } else if (def.id === 'power_plant' || def.id === 'nuclear_reactor') {
      ctx.beginPath();
      ctx.arc(-6, 1, 7, 0, Math.PI * 2);
      ctx.arc(7, 1, 7, 0, Math.PI * 2);
      ctx.fill();
    } else if (def.id === 'refinery') {
      ctx.fillRect(-13, -7, 12, 14);
      ctx.fillStyle = '#e84838';
      ctx.fillRect(2, -4, 11, 10);
    } else if (def.id === 'war_factory') {
      ctx.fillRect(-14, -9, 28, 12);
      ctx.fillStyle = '#1b2636';
      ctx.fillRect(-9, 1, 18, 9);
    } else {
      ctx.fillRect(-8, -9, 16, 12);
    }
  } else if (def.category === 'infantry') {
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.arc(0, -8, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c4d4e6';
    ctx.fillRect(-5, -2, 10, 14);
    ctx.fillStyle = '#6d8299';
    ctx.fillRect(3, 0, 10, 3);
  } else if (def.category === 'air') {
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(15, 6);
    ctx.lineTo(4, 4);
    ctx.lineTo(0, 12);
    ctx.lineTo(-4, 4);
    ctx.lineTo(-15, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (def.category === 'naval') {
    ctx.beginPath();
    ctx.moveTo(-16, 2);
    ctx.lineTo(0, -10);
    ctx.lineTo(16, 2);
    ctx.lineTo(12, 10);
    ctx.lineTo(-12, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = accentColor;
    ctx.fillRect(-4, -5, 8, 7);
  } else {
    // Vehicle / Harvester / Tank
    ctx.fillStyle = '#2d3a4a';
    ctx.fillRect(-15, -9, 30, 18);
    ctx.strokeRect(-15, -9, 30, 18);
    ctx.fillStyle = accentColor;
    ctx.fillRect(-9, -6, 16, 12);
    ctx.fillStyle = '#d8e3ef';
    ctx.fillRect(2, -2, 16, 4);
  }

  ctx.restore();
}

export function createSidebarUI(state, uiState, handlers) {
  const dom = {
    creditsLabel: document.getElementById('sidebar-credits-label'),
    creditsValue: document.getElementById('sidebar-credits-value'),
    powerFill: document.getElementById('power-meter-fill'),
    powerDemand: document.getElementById('power-meter-demand'),
    factionBadge: document.getElementById('hud-faction-badge'),
    powerBadge: document.getElementById('hud-power-badge'),
    perfBadge: document.getElementById('hud-perf-badge'),
    statusMsg: document.getElementById('hud-status-msg'),
    btnRepair: document.getElementById('btn-tool-repair'),
    btnSell: document.getElementById('btn-tool-sell'),
    btnLang: document.getElementById('btn-tool-lang'),
    btnHelp: document.getElementById('btn-tool-help'),
    tabButtons: Array.from(document.querySelectorAll('#sidebar-tabs .tab-btn')),
    subtabsWrap: document.getElementById('sidebar-subtabs'),
    subtabButtons: Array.from(document.querySelectorAll('#sidebar-subtabs .subtab-btn')),
    doctrineButtons: Array.from(document.querySelectorAll('#doctrine-bar .doctrine-btn')),
    gridCanvas: document.getElementById('production-grid-canvas'),
    selectionSummary: document.getElementById('selection-summary'),
    commandHints: document.getElementById('command-hints'),
    tooltip: document.getElementById('sidebar-tooltip'),
    tooltipTitle: document.getElementById('tooltip-title'),
    tooltipCost: document.getElementById('tooltip-cost'),
    tooltipDesc: document.getElementById('tooltip-desc'),
    noRadarOverlay: document.getElementById('minimap-no-radar'),
    victoryModal: document.getElementById('victory-modal'),
    victoryTitle: document.getElementById('victory-title'),
    victorySummary: document.getElementById('victory-summary'),
    victoryStats: document.getElementById('victory-stats'),
    btnRestart: document.getElementById('btn-restart-match'),
    btnDismiss: document.getElementById('btn-dismiss-modal')
  };

  const gridCtx = dom.gridCanvas.getContext('2d');
  let displayedItems = [];
  let hoveredTypeId = null;
  let noticeTimer = 0;

  function applyStaticTranslations() {
    document.documentElement.lang = getLocale();
    document.title = t('app.title');
    dom.creditsLabel.textContent = t('hud.credits');
    dom.btnRepair.textContent = t('tool.repair');
    dom.btnSell.textContent = t('tool.sell');
    dom.btnLang.textContent = t('tool.lang');
    dom.btnHelp.textContent = t('tool.help');
    dom.noRadarOverlay.textContent = t('hud.noRadar');
    dom.btnRestart.textContent = t('victory.restart');
    dom.btnDismiss.textContent = t('victory.dismiss');

    for (const btn of dom.tabButtons) {
      btn.textContent = t(`tab.${btn.dataset.tab}`);
    }
    for (const btn of dom.subtabButtons) {
      btn.textContent = t(`subtab.${btn.dataset.subtab}`);
    }
    for (const btn of dom.doctrineButtons) {
      btn.textContent = t(`doctrine.${btn.dataset.doctrine}`);
    }
    refreshTooltip();
  }

  function refreshTooltip() {
    if (!hoveredTypeId) {
      dom.tooltip.hidden = true;
      return;
    }
    const def = ENTITY_DEFS[hoveredTypeId];
    if (!def) {
      dom.tooltip.hidden = true;
      return;
    }
    dom.tooltip.hidden = false;
    dom.tooltipTitle.textContent = t(`unit.${def.id}.name`);
    dom.tooltipCost.textContent = `${t('sidebar.costPrefix')}${def.cost}`;
    dom.tooltipDesc.textContent = t(`unit.${def.id}.desc`);
  }

  function setStatusNotice(keyOrText, durationSec = 4.0) {
    if (!keyOrText) return;
    const translated = keyOrText.startsWith('hud.') || keyOrText.startsWith('unit.')
      ? t(keyOrText)
      : keyOrText;
    dom.statusMsg.textContent = translated;
    noticeTimer = durationSec;
  }

  function showVictoryModal(winnerTeamId) {
    const human = state.players[0];
    const won = winnerTeamId === (human?.teamId ?? 0);
    dom.victoryModal.hidden = false;
    dom.victoryTitle.textContent = won ? t('victory.winTitle') : t('victory.loseTitle');
    dom.victorySummary.textContent = won ? t('victory.winSummary') : t('victory.loseSummary');
    dom.victoryStats.textContent = t('victory.statsFormat', {
      seconds: (state.tickCount / 30).toFixed(1),
      ticks: state.tickCount,
      killed: Math.round(human?.stats?.killedValue ?? 0),
      produced: human?.stats?.produced ?? 0,
      lost: human?.stats?.lost ?? 0
    });
  }

  function getQueueEntryForType(player, queueKey, typeId) {
    const q = player.queues?.[queueKey];
    if (!q) return null;
    if (queueKey === 'main' || queueKey === 'defense') {
      return q.typeId === typeId ? { active: q, totalCount: 1 } : null;
    }
    let totalCount = 0;
    let first = null;
    for (let i = 0; i < q.length; i++) {
      if (q[i].typeId === typeId) {
        totalCount += q[i].count;
        if (!first) first = q[i];
      }
    }
    return first ? { active: first, totalCount, isHead: q[0]?.typeId === typeId } : null;
  }

  function renderProductionGrid(player) {
    displayedItems = getBuildableItemsForTab(
      state,
      0,
      uiState.activeTab,
      uiState.activeTab === 'air_naval' ? uiState.activeSubTab : null
    );

    const rows = Math.max(4, Math.ceil(displayedItems.length / GRID_COLS));
    const neededH = Math.max(280, PAD_Y * 2 + rows * (CELL_H + CELL_GAP));
    if (dom.gridCanvas.height !== neededH) {
      dom.gridCanvas.height = neededH;
    }

    const w = dom.gridCanvas.width;
    const h = dom.gridCanvas.height;
    gridCtx.clearRect(0, 0, w, h);

    const accent = FACTIONS[player.factionId]?.color ?? PLAYER_COLORS[0].hex;

    for (let i = 0; i < displayedItems.length; i++) {
      const def = displayedItems[i];
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const x = PAD_X + col * (CELL_W + CELL_GAP);
      const y = PAD_Y + row * (CELL_H + CELL_GAP);

      const qInfo = getQueueEntryForType(player, uiState.activeTab, def.id);
      const isPlacing = uiState.placementTypeId === def.id;
      const isHovered = hoveredTypeId === def.id;

      // Cell frame
      gridCtx.fillStyle = isPlacing ? '#193b2e' : (isHovered ? '#1a2738' : '#111926');
      gridCtx.fillRect(x, y, CELL_W, CELL_H);
      gridCtx.strokeStyle = isPlacing ? '#3ddc84' : (qInfo ? '#f5b342' : '#2a394e');
      gridCtx.lineWidth = isPlacing ? 2 : 1;
      gridCtx.strokeRect(x + 0.5, y + 0.5, CELL_W - 1, CELL_H - 1);

      // Silhouette graphic
      drawUnitSilhouette(gridCtx, def, x + CELL_W * 0.5, y + 27, accent);

      // Clockwise radial production progress sweep
      if (qInfo) {
        const item = qInfo.active;
        const pct = item.totalTicks > 0 ? Math.min(1, item.progressTicks / item.totalTicks) : 1;
        if (item.status !== 'READY' && (qInfo.isHead !== false)) {
          gridCtx.save();
          gridCtx.beginPath();
          gridCtx.moveTo(x + CELL_W * 0.5, y + CELL_H * 0.5);
          gridCtx.arc(
            x + CELL_W * 0.5,
            y + CELL_H * 0.5,
            Math.max(CELL_W, CELL_H),
            -Math.PI * 0.5 + pct * Math.PI * 2,
            Math.PI * 1.5
          );
          gridCtx.closePath();
          gridCtx.fillStyle = 'rgba(4, 7, 12, 0.58)';
          gridCtx.fill();
          gridCtx.restore();
        }

        // Top-right badge: READY / PAUSED / Count
        gridCtx.font = 'bold 10px sans-serif';
        gridCtx.textAlign = 'right';
        if (item.status === 'READY') {
          gridCtx.fillStyle = '#3ddc84';
          gridCtx.fillRect(x + CELL_W - 42, y + 2, 40, 14);
          gridCtx.fillStyle = '#06120c';
          gridCtx.fillText(t('sidebar.status.ready'), x + CELL_W - 4, y + 12);
        } else if (item.status === 'PAUSED') {
          gridCtx.fillStyle = '#f5b342';
          gridCtx.fillRect(x + CELL_W - 44, y + 2, 42, 14);
          gridCtx.fillStyle = '#181004';
          gridCtx.fillText(t('sidebar.status.paused'), x + CELL_W - 4, y + 12);
        } else if (qInfo.totalCount > 0) {
          gridCtx.fillStyle = '#2d7eff';
          gridCtx.fillRect(x + CELL_W - 22, y + 2, 20, 14);
          gridCtx.fillStyle = '#ffffff';
          gridCtx.fillText(`${qInfo.totalCount}`, x + CELL_W - 4, y + 12);
        }
      }

      // Cost pill top-left
      gridCtx.font = 'bold 10px monospace';
      gridCtx.textAlign = 'left';
      gridCtx.fillStyle = 'rgba(7, 11, 18, 0.8)';
      gridCtx.fillRect(x + 2, y + 2, 38, 13);
      gridCtx.fillStyle = '#f5b342';
      gridCtx.fillText(`$${def.cost}`, x + 4, y + 12);

      // Localized short label bottom bar
      gridCtx.fillStyle = 'rgba(7, 11, 18, 0.88)';
      gridCtx.fillRect(x + 1, y + CELL_H - 16, CELL_W - 2, 15);
      gridCtx.fillStyle = '#dce6f2';
      gridCtx.font = '600 11px sans-serif';
      gridCtx.textAlign = 'center';
      gridCtx.fillText(t(`unit.${def.id}.short`), x + CELL_W * 0.5, y + CELL_H - 5, CELL_W - 6);
    }
  }

  function update(dtSec, telemetry) {
    const player = state.players[0];
    if (!player) return;

    // 1. Credits & Power Meter
    dom.creditsValue.textContent = `$${Math.floor(player.credits)}`;
    const maxCap = Math.max(100, player.powerProduced, player.powerConsumed);
    const fillPct = Math.min(100, Math.round((player.powerProduced / maxCap) * 100));
    const demandPct = Math.min(100, Math.round((player.powerConsumed / maxCap) * 100));
    dom.powerFill.style.height = `${fillPct}%`;
    dom.powerFill.style.background = player.powerState === 'green'
      ? 'var(--green)'
      : (player.powerState === 'yellow' ? 'var(--amber)' : 'var(--danger)');
    dom.powerDemand.style.bottom = `${demandPct}%`;

    // 2. Top HUD Pills
    dom.factionBadge.textContent = t(`faction.${player.factionId}`);
    dom.powerBadge.textContent = `${t('hud.power')} ${player.powerProduced}/${player.powerConsumed} · ${t(`hud.power.${player.powerState}`)}`;
    dom.perfBadge.textContent = `${t('hud.drawCalls')}: ${telemetry.drawCalls} | ${t('hud.fps')}: ${telemetry.fps} | ${t('hud.tick')}: ${state.tickCount}`;

    if (noticeTimer > 0) {
      noticeTimer = Math.max(0, noticeTimer - dtSec);
      if (noticeTimer === 0) dom.statusMsg.textContent = '';
    }

    // 3. Tool & Tab active states
    dom.btnRepair.classList.toggle('active', uiState.cursorMode === 'repair');
    dom.btnSell.classList.toggle('active', uiState.cursorMode === 'sell');
    dom.subtabsWrap.hidden = uiState.activeTab !== 'air_naval';
    for (const btn of dom.tabButtons) {
      btn.classList.toggle('active', btn.dataset.tab === uiState.activeTab);
    }
    for (const btn of dom.subtabButtons) {
      btn.classList.toggle('active', btn.dataset.subtab === uiState.activeSubTab);
    }

    // 4. Minimap radar status
    const hasRadar = state.entities.some((e) => e.alive && e.playerId === 0 && e.typeId === 'airforce_radar');
    dom.noRadarOverlay.hidden = uiState.noFog ? true : (hasRadar && !player.isLowPower);

    // 5. Selection footer
    const selCount = uiState.selectedIds.size;
    if (selCount === 0) {
      dom.selectionSummary.textContent = t('hud.selectionNone');
    } else if (selCount === 1) {
      const onlyId = uiState.selectedIds.values().next().value;
      const ent = state.entityById.get(onlyId);
      dom.selectionSummary.textContent = ent
        ? `${t(`unit.${ent.typeId}.name`)} (${Math.ceil(ent.hp)}/${ent.maxHp})`
        : t('hud.selectionCount', { count: 1 });
    } else {
      dom.selectionSummary.textContent = t('hud.selectionCount', { count: selCount });
    }
    dom.commandHints.textContent = uiState.placementTypeId ? t('hud.hintsPlace') : t('hud.hintsDefault');

    // 6. Canvas 2D Icon Grid
    renderProductionGrid(player);
  }

  function hitTestGrid(clientX, clientY) {
    const rect = dom.gridCanvas.getBoundingClientRect();
    const scaleX = dom.gridCanvas.width / Math.max(1, rect.width);
    const scaleY = dom.gridCanvas.height / Math.max(1, rect.height);
    const gx = (clientX - rect.left) * scaleX;
    const gy = (clientY - rect.top) * scaleY;
    for (let i = 0; i < displayedItems.length; i++) {
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const x = PAD_X + col * (CELL_W + CELL_GAP);
      const y = PAD_Y + row * (CELL_H + CELL_GAP);
      if (gx >= x && gx <= x + CELL_W && gy >= y && gy <= y + CELL_H) {
        return displayedItems[i];
      }
    }
    return null;
  }

  // Event listeners
  dom.gridCanvas.addEventListener('mousemove', (e) => {
    const item = hitTestGrid(e.clientX, e.clientY);
    const nextId = item?.id ?? null;
    if (nextId !== hoveredTypeId) {
      hoveredTypeId = nextId;
      refreshTooltip();
    }
  });
  dom.gridCanvas.addEventListener('mouseleave', () => {
    hoveredTypeId = null;
    refreshTooltip();
  });
  dom.gridCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
  dom.gridCanvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const item = hitTestGrid(e.clientX, e.clientY);
    if (!item) return;

    const player = state.players[0];
    const q = player.queues?.[uiState.activeTab];

    if (e.button === 0) {
      if ((uiState.activeTab === 'main' || uiState.activeTab === 'defense') && q && q.typeId === item.id && q.status === 'READY') {
        uiState.placementTypeId = item.id;
        uiState.cursorMode = 'default';
        setStatusNotice('hud.status.ready', 3.0);
        return;
      }
      handlers.enqueue({
        playerId: 0,
        type: 'START_PROD',
        queueKey: uiState.activeTab,
        typeId: item.id,
        count: e.shiftKey ? 5 : 1
      });
    } else if (e.button === 2) {
      if (uiState.placementTypeId === item.id) {
        uiState.placementTypeId = null;
        return;
      }
      handlers.enqueue({
        playerId: 0,
        type: 'CANCEL_PROD',
        queueKey: uiState.activeTab,
        typeId: item.id,
        count: e.shiftKey ? 5 : 1
      });
    }
  });

  for (const btn of dom.tabButtons) {
    btn.addEventListener('click', () => {
      uiState.activeTab = btn.dataset.tab;
    });
  }
  for (const btn of dom.subtabButtons) {
    btn.addEventListener('click', () => {
      uiState.activeSubTab = btn.dataset.subtab;
    });
  }
  dom.btnRepair.addEventListener('click', () => {
    uiState.placementTypeId = null;
    uiState.cursorMode = uiState.cursorMode === 'repair' ? 'default' : 'repair';
  });
  dom.btnSell.addEventListener('click', () => {
    uiState.placementTypeId = null;
    uiState.cursorMode = uiState.cursorMode === 'sell' ? 'default' : 'sell';
  });
  dom.btnLang.addEventListener('click', () => {
    toggleLocale();
  });
  dom.btnHelp.addEventListener('click', () => {
    setStatusNotice(uiState.isBench ? 'hud.status.benchActive' : 'hud.hintsDefault', 6.0);
  });
  dom.btnRestart.addEventListener('click', () => {
    window.location.reload();
  });
  dom.btnDismiss.addEventListener('click', () => {
    dom.victoryModal.hidden = true;
  });

  onLocaleChange(() => applyStaticTranslations());
  applyStaticTranslations();

  return {
    update,
    setStatusNotice,
    showVictoryModal,
    isModalOpen: () => !dom.victoryModal.hidden
  };
}
