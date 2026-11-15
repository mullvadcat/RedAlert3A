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

  const drawMetallicPlate = (x, y, w, h, topCol = '#53677e', botCol = '#2a3748') => {
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, topCol);
    grad.addColorStop(1, botCol);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#7b93ad';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(x, y, w, h);
  };

  if (def.isBuilding) {
    // Isometric concrete plinth
    ctx.fillStyle = '#253140';
    ctx.beginPath();
    ctx.moveTo(-24, 6);
    ctx.lineTo(0, -4);
    ctx.lineTo(24, 6);
    ctx.lineTo(0, 16);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#52657a';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (def.id === 'conyard') {
      drawMetallicPlate(-16, -9, 20, 17, '#4f647d', '#24303e');
      drawMetallicPlate(0, -3, 16, 13, '#3c4c60', '#1c2632');
      // Industrial yellow gantry crane + faction roof beacon
      ctx.strokeStyle = '#e5a93c';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(6, 4);
      ctx.lineTo(6, -15);
      ctx.lineTo(19, -9);
      ctx.stroke();
      ctx.fillStyle = accentColor;
      ctx.fillRect(-13, -7, 8, 5);
    } else if (def.id === 'power_plant' || def.id === 'nuclear_reactor') {
      drawMetallicPlate(-17, -4, 34, 13, '#44556a', '#232e3b');
      // Cooling turbines / containment dome
      for (const tx of def.id === 'nuclear_reactor' ? [0] : [-8, 8]) {
        const r = def.id === 'nuclear_reactor' ? 11 : 6.5;
        ctx.fillStyle = '#324152';
        ctx.beginPath();
        ctx.arc(tx, -3, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#6f859e';
        ctx.stroke();
        ctx.fillStyle = def.id === 'nuclear_reactor' ? '#5cff7a' : accentColor;
        ctx.beginPath();
        ctx.arc(tx, -3, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (def.id === 'refinery') {
      drawMetallicPlate(-18, -11, 16, 20, '#4f6277', '#253240');
      drawMetallicPlate(-2, -1, 20, 11, '#39495c', '#1e2834');
      // Ore hopper glow + caution stripes
      ctx.fillStyle = '#e84838';
      ctx.fillRect(1, 2, 13, 6);
      ctx.fillStyle = '#e5a93c';
      ctx.fillRect(-16, 6, 12, 3);
      ctx.fillStyle = accentColor;
      ctx.fillRect(-14, -8, 10, 4);
    } else if (def.id === 'war_factory') {
      drawMetallicPlate(-20, -10, 40, 18, '#4e6075', '#232e3c');
      // Dark assembly bay doors & twin roof vents
      ctx.fillStyle = '#0e151f';
      ctx.fillRect(-10, -2, 20, 11);
      ctx.fillStyle = accentColor;
      ctx.fillRect(-16, -9, 32, 3);
      ctx.fillStyle = '#e5a93c';
      ctx.fillRect(-12, 8, 24, 2);
    } else if (def.category === 'defense') {
      drawMetallicPlate(-11, 0, 22, 12, '#4c5f75', '#253140');
      ctx.fillStyle = accentColor;
      if (def.id === 'prism_tower') {
        ctx.beginPath();
        ctx.moveTo(-6, 2); ctx.lineTo(0, -16); ctx.lineTo(6, 2); ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff5aa';
        ctx.beginPath(); ctx.arc(0, -14, 4, 0, Math.PI * 2); ctx.fill();
      } else if (def.id === 'tesla_coil') {
        ctx.strokeStyle = '#68d5ff';
        ctx.lineWidth = 2;
        for (const ry of [-4, -9, -14]) {
          ctx.beginPath(); ctx.ellipse(0, ry, 7, 2.5, 0, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.fillStyle = '#b6f0ff';
        ctx.beginPath(); ctx.arc(0, -16, 3.5, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillRect(-5, -8, 10, 9);
        ctx.fillStyle = '#d4e2f0';
        ctx.fillRect(0, -6, 15, 3);
      }
    } else {
      drawMetallicPlate(-16, -10, 32, 19, '#51657b', '#222d3a');
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.arc(0, -4, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (def.category === 'infantry') {
    // Tactical trooper silhouette with helmet & weapon
    ctx.fillStyle = '#364556';
    ctx.fillRect(-5, -1, 10, 14);
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.arc(-1, -7, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9be8ff';
    ctx.fillRect(0, -9, 4.5, 2.5);
    ctx.fillStyle = '#cfdbe8';
    ctx.fillRect(2, 1, 14, 2.8);
  } else if (def.category === 'air') {
    if (def.id === 'kirov') {
      // Heavy Kirov rigid airship silhouette
      ctx.fillStyle = '#5a363c';
      ctx.beginPath();
      ctx.ellipse(0, -1, 21, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = accentColor;
      ctx.stroke();
      ctx.fillStyle = '#2a3340';
      ctx.fillRect(-10, 7, 20, 4);
      ctx.fillStyle = '#f5b342';
      ctx.beginPath();
      ctx.arc(14, -2, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Swept-wing strike jet / gunship
      ctx.fillStyle = '#55687e';
      ctx.beginPath();
      ctx.moveTo(20, 0);
      ctx.lineTo(-4, -14);
      ctx.lineTo(-10, -14);
      ctx.lineTo(-4, -3);
      ctx.lineTo(-18, -6);
      ctx.lineTo(-14, 0);
      ctx.lineTo(-18, 6);
      ctx.lineTo(-4, 3);
      ctx.lineTo(-10, 14);
      ctx.lineTo(-4, 14);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = accentColor;
      ctx.stroke();
      ctx.fillStyle = '#8ce8ff';
      ctx.fillRect(4, -2, 7, 4);
    }
  } else if (def.category === 'naval') {
    // Cruiser / Carrier naval silhouette
    ctx.fillStyle = '#3f5166';
    ctx.beginPath();
    ctx.moveTo(-22, 4);
    ctx.lineTo(-14, -7);
    ctx.lineTo(15, -7);
    ctx.lineTo(23, 2);
    ctx.lineTo(16, 9);
    ctx.lineTo(-18, 9);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = accentColor;
    ctx.stroke();
    drawMetallicPlate(-8, -11, 14, 7, '#647b96', '#334254');
    ctx.fillStyle = '#dce7f2';
    ctx.fillRect(8, -6, 10, 2.5);
  } else {
    // Detailed sloped-armor tank / harvester / MCV silhouette
    // Dark track assembly + road wheels
    ctx.fillStyle = '#18202a';
    ctx.fillRect(-19, 3, 38, 8);
    ctx.fillStyle = '#56697e';
    for (let wx = -14; wx <= 14; wx += 7) {
      ctx.beginPath();
      ctx.arc(wx, 7, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Sloped hull chassis
    ctx.fillStyle = '#4f6279';
    ctx.beginPath();
    ctx.moveTo(-18, 3);
    ctx.lineTo(-14, -4);
    ctx.lineTo(16, -4);
    ctx.lineTo(20, 3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    if (def.id === 'harvester') {
      ctx.fillStyle = '#e5a93c';
      ctx.fillRect(-12, -10, 16, 7);
      ctx.fillStyle = '#e84838';
      ctx.fillRect(14, 0, 8, 9);
    } else if (def.id === 'mcv') {
      ctx.fillStyle = '#e5a93c';
      ctx.fillRect(-13, -11, 20, 8);
      ctx.fillStyle = '#80e5ff';
      ctx.fillRect(9, -8, 5, 4);
    } else {
      // Chamfered combat turret + main barrel(s)
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.moveTo(-9, -4);
      ctx.lineTo(-6, -11);
      ctx.lineTo(7, -11);
      ctx.lineTo(11, -4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#dce6f2';
      ctx.fillRect(8, -9.5, 16, 2.8);
      if (def.id === 'apocalypse') {
        ctx.fillRect(8, -6.0, 15, 2.6);
      }
    }
  }

  ctx.restore();
}

export function createSidebarUI(initialState, uiState, handlers) {
  let state = initialState;
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

  // Dynamic superweapon countdown strip inserted cleanly below credits row (hidden until built)
  const swStripEl = document.createElement('div');
  swStripEl.id = 'sidebar-superweapon-strip';
  swStripEl.hidden = true;
  swStripEl.style.display = 'none';
  swStripEl.style.flexDirection = 'column';
  swStripEl.style.gap = '2px';
  const creditsRow = document.getElementById('sidebar-credits-row');
  if (creditsRow && creditsRow.parentNode) {
    creditsRow.parentNode.insertBefore(swStripEl, creditsRow.nextSibling);
  }
  const swRowPool = new Map();

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

    // 4b. Superweapon cooldown placeholder strip
    let activeSwCount = 0;
    const swMap = player.superweapons ?? {};
    for (const [swId, swState] of Object.entries(swMap)) {
      const hasBuilding = state.entities.some((e) => e.alive && e.playerId === 0 && e.typeId === swId);
      let row = swRowPool.get(swId);
      if (!hasBuilding && !swState) {
        if (row) row.hidden = true;
        continue;
      }
      activeSwCount++;
      if (!row) {
        row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.fontSize = '10px';
        row.style.padding = '2px 6px';
        row.style.background = '#101824';
        row.style.border = '1px solid var(--steel-border)';
        row.style.cursor = 'pointer';
        row.dataset.swId = swId;
        row.addEventListener('click', () => {
          const curSw = state.players?.[0]?.superweapons?.[swId];
          const rem = typeof curSw === 'number' ? curSw : (curSw?.remainingTicks ?? 999);
          if (rem > 0 || state.players?.[0]?.isLowPower) {
            setStatusNotice('hud.status.swNotReady', 2.5);
            return;
          }
          if (uiState.pendingPower?.kind === 'superweapon' && uiState.pendingPower.id === swId) {
            uiState.pendingPower = null;
            return;
          }
          uiState.placementTypeId = null;
          uiState.cursorMode = 'default';
          uiState.pendingPower = { kind: 'superweapon', id: swId, sourceX: null, sourceZ: null };
          setStatusNotice(swId === 'chrono_sphere' ? 'hud.status.chronoSourceFirst' : 'hud.status.selectTarget', 4.0);
        });
        const lbl = document.createElement('span');
        const val = document.createElement('span');
        row.appendChild(lbl);
        row.appendChild(val);
        swStripEl.appendChild(row);
        swRowPool.set(swId, row);
      }
      row.hidden = false;
      row.firstChild.textContent = t(`unit.${swId}.short`);
      const remTicks = typeof swState === 'number' ? swState : (swState?.remainingTicks ?? 0);
      const sec = Math.max(0, Math.ceil(remTicks / 30));
      const mm = Math.floor(sec / 60);
      const ss = String(sec % 60).padStart(2, '0');
      row.lastChild.textContent = remTicks <= 0 ? t('sidebar.status.ready') : `${mm}:${ss}`;
      row.lastChild.style.color = remTicks <= 0 ? 'var(--green)' : 'var(--amber)';
      const isArmed = uiState.pendingPower?.kind === 'superweapon' && uiState.pendingPower.id === swId;
      row.style.borderColor = isArmed ? 'var(--green)' : 'var(--steel-border)';
    }
    swStripEl.hidden = activeSwCount === 0;
    swStripEl.style.display = activeSwCount > 0 ? 'flex' : 'none';

    // Update doctrine buttons cooldowns & active highlight
    for (const btn of dom.doctrineButtons) {
      const key = btn.dataset.doctrine;
      const cdTicks = player.doctrines?.[key] ?? 0;
      const isArmed = uiState.pendingPower?.kind === 'doctrine' && uiState.pendingPower.id === key;
      btn.style.borderColor = isArmed ? 'var(--green)' : '';
      if (cdTicks > 0) {
        const sec = Math.ceil(cdTicks / 30);
        btn.textContent = `${t(`doctrine.${key}`)} (${sec}s)`;
        btn.style.opacity = '0.6';
      } else {
        btn.textContent = t(`doctrine.${key}`);
        btn.style.opacity = '1';
      }
    }

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
    if (uiState.pendingPower) {
      dom.commandHints.textContent =
        uiState.pendingPower.id === 'chrono_sphere' && uiState.pendingPower.sourceX === null
          ? t('hud.status.chronoSourceFirst')
          : t('hud.status.selectTarget');
    } else {
      dom.commandHints.textContent = uiState.placementTypeId ? t('hud.hintsPlace') : t('hud.hintsDefault');
    }

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
  for (const btn of dom.doctrineButtons) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.doctrine;
      if (!key) return;
      if (uiState.pendingPower?.kind === 'doctrine' && uiState.pendingPower.id === key) {
        uiState.pendingPower = null;
        return;
      }
      uiState.placementTypeId = null;
      uiState.cursorMode = 'default';
      uiState.pendingPower = { kind: 'doctrine', id: key, sourceX: null, sourceZ: null };
      setStatusNotice('hud.status.selectTarget', 4.0);
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
    isModalOpen: () => !dom.victoryModal.hidden,
    setState: (nextState) => { state = nextState; }
  };
}
