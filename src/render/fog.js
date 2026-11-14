// GPU Dual-Channel Fog of War texture uploader (5 Hz sync from CPU bitmask fogGrids).
// RG8 texture: R = Explored/Visible luminance, G = Anti-stealth Detected pulse.

import { MAP_SIZE } from '../world/map.js';
import { FOG_DETECTED, FOG_EXPLORED, FOG_VISIBLE } from '../gameplay/fogCpu.js';

export function createGpuFog(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const uploadData = new Uint8Array(MAP_SIZE * MAP_SIZE * 2);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, MAP_SIZE, MAP_SIZE, 0, gl.RG, gl.UNSIGNED_BYTE, uploadData);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);

  let lastSyncTick = -999;

  function sync(cpuGrid, tickCount, force = false) {
    if (!cpuGrid) return;
    // Strict 5 Hz GPU upload cadence (every 6 simulation ticks at 30 Hz)
    if (!force && tickCount - lastSyncTick < 6) return;
    lastSyncTick = tickCount;

    for (let i = 0, len = cpuGrid.length; i < len; i++) {
      const m = cpuGrid[i];
      let lum = 18; // Unexplored dark shroud
      if (m & FOG_VISIBLE) {
        lum = 255;
      } else if (m & FOG_EXPLORED) {
        lum = 112;
      }
      const dst = i * 2;
      // Exponential smooth blend on R channel eliminates harsh frame popping at 5 Hz
      uploadData[dst] = Math.round(uploadData[dst] * 0.35 + lum * 0.65);
      uploadData[dst + 1] = (m & FOG_DETECTED) ? 255 : 0;
    }

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAP_SIZE, MAP_SIZE, gl.RG, gl.UNSIGNED_BYTE, uploadData);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  return {
    texture: tex,
    sync,
    reset() {
      lastSyncTick = -999;
    },
    dispose() {
      gl.deleteTexture(tex);
    }
  };
}
