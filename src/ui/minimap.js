// 176x176 Interactive Canvas 2D Minimap / Radar (L2 UI Layer).
// Supports cached terrain base, live ore veins, fog shroud, unit/building blips,
// camera viewport frustum trapezoid, LMB camera pan & RMB move/attack-move dispatch.

import { MAP_SIZE, ORE_TYPE, TERRAIN, WORLD_SIZE } from '../world/map.js';
import { FACTIONS, PLAYER_COLORS } from '../core/config.js';
import { FOG_EXPLORED, FOG_VISIBLE } from '../gameplay/fogCpu.js';

export function createMinimapUI(state, uiState, camera, enqueue) {
  const canvas = document.getElementById('minimap-canvas');
  const ctx = canvas.getContext('2d');
  const size = canvas.width; // 176

  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = MAP_SIZE;
  baseCanvas.height = MAP_SIZE;
  const baseCtx = baseCanvas.getContext('2d');
  const imgData = baseCtx.createImageData(MAP_SIZE, MAP_SIZE);
  let lastTerrainId = null;

  function rebuildStaticTerrainLayer() {
    const map = state.map;
    if (!map) return;
    lastTerrainId = map.id;
    const px = imgData.data;
    for (let i = 0, len = MAP_SIZE * MAP_SIZE; i < len; i++) {
      const dst = i * 4;
      const t = map.terrain[i];
      if (t === TERRAIN.SEA) {
        px[dst] = 16; px[dst + 1] = 44; px[dst + 2] = 74; px[dst + 3] = 255;
      } else if (t === TERRAIN.SHALLOW) {
        px[dst] = 34; px[dst + 1] = 78; px[dst + 2] = 96; px[dst + 3] = 255;
      } else if (t === TERRAIN.CLIFF) {
        px[dst] = 68; px[dst + 1] = 64; px[dst + 2] = 60; px[dst + 3] = 255;
      } else if (t === TERRAIN.BRIDGE) {
        px[dst] = 115; px[dst + 1] = 122; px[dst + 2] = 132; px[dst + 3] = 255;
      } else {
        px[dst] = 48; px[dst + 1] = 66; px[dst + 2] = 42; px[dst + 3] = 255;
      }
    }
    baseCtx.putImageData(imgData, 0, 0);
  }

  function update() {
    if (!state.map) return;
    if (lastTerrainId !== state.map.id) rebuildStaticTerrainLayer();

    const scale = size / MAP_SIZE;
    ctx.drawImage(baseCanvas, 0, 0, size, size);

    const map = state.map;
    const fogGrid = state.fogGrids?.[0];
    const noFog = Boolean(uiState.noFog);

    // Paint ore crystals & fog mask on minimap (sampled every 2 cells for fast 2D frame time)
    for (let gz = 0; gz < MAP_SIZE; gz += 2) {
      const py = Math.floor(gz * scale);
      for (let gx = 0; gx < MAP_SIZE; gx += 2) {
        const idx = gz * MAP_SIZE + gx;
        const px = Math.floor(gx * scale);
        const fMask = fogGrid ? fogGrid[idx] : FOG_VISIBLE;

        if (!noFog && !(fMask & FOG_EXPLORED)) {
          ctx.fillStyle = 'rgba(4, 7, 12, 0.94)';
          ctx.fillRect(px, py, Math.ceil(scale * 2), Math.ceil(scale * 2));
          continue;
        }

        if (map.oreAmount[idx] > 0 && map.oreType[idx] !== ORE_TYPE.NONE) {
          ctx.fillStyle = map.oreType[idx] === ORE_TYPE.VIOLET ? '#b545ff' : '#ff4d2e';
          ctx.fillRect(px, py, 2, 2);
        }

        if (!noFog && !(fMask & FOG_VISIBLE)) {
          ctx.fillStyle = 'rgba(6, 10, 16, 0.45)';
          ctx.fillRect(px, py, Math.ceil(scale * 2), Math.ceil(scale * 2));
        }
      }
    }

    // Entities
    const wToMini = size / WORLD_SIZE;
    for (let i = 0; i < state.entities.length; i++) {
      const ent = state.entities[i];
      if (!ent.alive) continue;
      if (!noFog && ent.teamId !== 0 && ent.teamId !== 3 && fogGrid) {
        const gx = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(ent.x / 2)));
        const gz = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(ent.z / 2)));
        if (!(fogGrid[gz * MAP_SIZE + gx] & FOG_VISIBLE)) continue;
      }

      const color = ent.category === 'neutral'
        ? FACTIONS.neutral.color
        : (PLAYER_COLORS[ent.playerId % 4]?.hex ?? '#ffffff');
      const mx = ent.x * wToMini;
      const my = ent.z * wToMini;
      const sz = ent.isBuilding ? 4 : 2.5;
      ctx.fillStyle = color;
      ctx.fillRect(mx - sz * 0.5, my - sz * 0.5, sz, sz);
    }

    // Camera frustum rectangle
    const corners = camera.getViewRectBounds();
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < corners.length; i++) {
      const cx = corners[i].x * wToMini;
      const cy = corners[i].z * wToMini;
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function minimapEventToWorld(e) {
    const rect = canvas.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const v = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    return { x: u * WORLD_SIZE, z: v * WORLD_SIZE };
  }

  let isDragging = false;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const world = minimapEventToWorld(e);
    if (e.button === 0) {
      isDragging = true;
      camera.jumpTo(world.x, world.z);
    } else if (e.button === 2 && uiState.selectedIds.size > 0) {
      enqueue({
        playerId: 0,
        type: uiState.cursorMode === 'attackMove' ? 'ATTACK_MOVE' : 'MOVE',
        entityIds: Array.from(uiState.selectedIds),
        x: world.x,
        z: world.z
      });
      uiState.cursorMode = 'default';
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const world = minimapEventToWorld(e);
    camera.jumpTo(world.x, world.z);
  });
  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  return { update };
}
