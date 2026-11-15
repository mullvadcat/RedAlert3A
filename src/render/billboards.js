// Single Draw Call GPU Instanced Tactical Billboards & Selection Rings:
// Zero DOM health bars! Renders selection rings, segmented HP bars, veterancy (↑/★),
// iron curtain status & harvester cargo pips (0/1/2) in 1 single drawElementsInstanced call.

import { PLAYER_COLORS } from '../core/config.js';

const MAX_BILLBOARDS = 2048;
const FLOATS_PER_INST = 12; // worldPos(3), scaleW/H(2), kind(1), hpRatio(1), vet(1), cargo(1), selected(1), team(1), iron(1)

const BILLBOARD_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aQuad; // -0.5..0.5

layout(location = 1) in vec4 iPosScaleX; // xyz: worldPos, w: width
layout(location = 2) in vec4 iStyle;     // x: height, y: kind (0=ring, 1=bar), z: hpRatio, w: selected
layout(location = 3) in vec4 iMeta;      // x: veterancy, y: cargo, z: teamIdx, w: ironCurtain

uniform mat4 uViewProj;
uniform vec3 uCamRight;
uniform vec3 uCamUp;

out vec2 vUv;
out vec4 vStyle;
out vec4 vMeta;

void main() {
  vUv = aQuad + 0.5;
  vStyle = iStyle;
  vMeta = iMeta;

  vec3 center = iPosScaleX.xyz;
  float w = iPosScaleX.w;
  float h = iStyle.x;
  vec3 worldPos;

  if (iStyle.y < 0.5) {
    // Kind 0: Ground-projected selection ring lifted slightly with footprint radius to avoid uneven terrain clipping
    float lift = 0.24 + min(0.28, max(w, h) * 0.018);
    worldPos = center + vec3(aQuad.x * w, lift, aQuad.y * h);
  } else {
    // Kind 1: Camera-facing overhead HUD bar + cargo pips + veterancy
    worldPos = center + uCamRight * (aQuad.x * w) + uCamUp * (aQuad.y * h);
  }

  gl_Position = uViewProj * vec4(worldPos, 1.0);
}`;

const BILLBOARD_FS = `#version 300 es
precision highp float;

in vec2 vUv;
in vec4 vStyle; // x: h, y: kind, z: hpRatio, w: selected
in vec4 vMeta;  // x: vet, y: cargo, z: teamIdx, w: iron

out vec4 outColor;

void main() {
  if (vStyle.y < 0.5) {
    // Selection ring on XZ plane with crisp inner band + subtle outer tactical halo
    vec2 p = vUv * 2.0 - 1.0;
    float d = length(p);
    float ring = smoothstep(0.96, 0.89, d) * smoothstep(0.78, 0.85, d);
    float glow = smoothstep(1.0, 0.88, d) * smoothstep(0.70, 0.86, d) * 0.28;
    float alpha = clamp(ring * 0.95 + glow, 0.0, 1.0);
    if (alpha < 0.03) discard;
    vec3 col = vMeta.w > 0.5 ? vec3(0.98, 0.28, 0.22) : vec3(0.28, 0.96, 0.62);
    outColor = vec4(col, alpha);
    return;
  }

  float hp = clamp(vStyle.z, 0.0, 1.0);
  int vet = int(vMeta.x + 0.5);
  int cargo = int(vMeta.y + 0.5);

  // Upper band (vUv.y > 0.55): cargo pips / veterancy / iron bar
  if (vUv.y > 0.52) {
    if (vMeta.w > 0.5 && vUv.x < 0.72) {
      outColor = vec4(1.0, 0.22, 0.22, 0.95);
      return;
    }
    // Veterancy star/chevron on right side
    if (vet > 0 && vUv.x > 0.76) {
      vec3 vc = vet == 2 ? vec3(1.0, 0.85, 0.2) : vec3(0.85, 0.92, 1.0);
      outColor = vec4(vc, 0.95);
      return;
    }
    // Harvester 2-slot cargo pips
    if (cargo >= 0 && vUv.x < 0.45 && vUv.y < 0.9) {
      float slot = floor(vUv.x / 0.22);
      float filled = step(slot + 0.5, float(cargo));
      float inner = step(0.03, fract(vUv.x / 0.22) * 0.22) * step(0.58, vUv.y) * step(vUv.y, 0.88);
      if (inner > 0.5) {
        outColor = filled > 0.5 ? vec4(0.98, 0.68, 0.2, 0.98) : vec4(0.15, 0.18, 0.24, 0.82);
        return;
      }
    }
    discard;
  }

  // Lower band (vUv.y <= 0.45): Segmented health bar
  if (vUv.y < 0.08 || vUv.y > 0.45) discard;
  if (vUv.x < 0.02 || vUv.x > 0.98 || vUv.y < 0.11 || vUv.y > 0.42) {
    outColor = vec4(0.04, 0.06, 0.09, 0.88);
    return;
  }

  float fillX = (vUv.x - 0.02) / 0.96;
  // Subtle segment tick marks every 20%
  if (fract(fillX * 5.0) < 0.06 && fillX > 0.04 && fillX < 0.96) {
    outColor = vec4(0.06, 0.08, 0.12, 0.92);
    return;
  }

  if (fillX <= hp) {
    vec3 barCol = hp > 0.55 ? vec3(0.24, 0.90, 0.48) : (hp > 0.28 ? vec3(0.96, 0.78, 0.22) : vec3(0.94, 0.24, 0.22));
    outColor = vec4(barCol, 0.96);
  } else {
    outColor = vec4(0.14, 0.16, 0.20, 0.78);
  }
}`;

export function createBillboardRenderer(gl, compileProgram) {
  const prog = compileProgram(gl, BILLBOARD_VS, BILLBOARD_FS);
  const loc = {
    uViewProj: gl.getUniformLocation(prog, 'uViewProj'),
    uCamRight: gl.getUniformLocation(prog, 'uCamRight'),
    uCamUp: gl.getUniformLocation(prog, 'uCamUp')
  };

  const vao = gl.createVertexArray();
  const quadVbo = gl.createBuffer();
  const ibo = gl.createBuffer();
  const instVbo = gl.createBuffer();
  const instData = new Float32Array(MAX_BILLBOARDS * FLOATS_PER_INST);

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, instVbo);
  gl.bufferData(gl.ARRAY_BUFFER, instData.byteLength, gl.DYNAMIC_DRAW);
  const stride = FLOATS_PER_INST * 4;
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16); gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 32); gl.vertexAttribDivisor(3, 1);
  gl.bindVertexArray(null);

  let count = 0;

  function sync(state, selectedIds, alpha) {
    count = 0;
    const entities = state.entities;
    for (let i = 0; i < entities.length && count < MAX_BILLBOARDS - 1; i++) {
      const ent = entities[i];
      if (!ent.alive) continue;
      const isSelected = selectedIds.has(ent.id);
      const hpRatio = ent.hp / Math.max(1, ent.maxHp);
      const ix = ent.isBuilding ? ent.x : ent.prevX + (ent.x - ent.prevX) * alpha;
      const iy = ent.isBuilding ? ent.y : ent.prevY + (ent.y - ent.prevY) * alpha;
      const iz = ent.isBuilding ? ent.z : ent.prevZ + (ent.z - ent.prevZ) * alpha;

      // Ground selection ring when selected
      if (isSelected) {
        const off = count++ * FLOATS_PER_INST;
        const ringSpan = ent.isBuilding ? Math.max(ent.footprintW, ent.footprintH) * 2.25 : (ent.radius ?? 1.2) * 2.8;
        instData[off + 0] = ix;
        instData[off + 1] = iy;
        instData[off + 2] = iz;
        instData[off + 3] = ringSpan;
        instData[off + 4] = ringSpan;
        instData[off + 5] = 0; // kind=0 ring
        instData[off + 6] = hpRatio;
        instData[off + 7] = 1;
        instData[off + 8] = ent.veterancy;
        instData[off + 9] = -1;
        instData[off + 10] = ent.playerId % 4;
        instData[off + 11] = ent.ironCurtainTicks > 0 ? 1 : 0;
      }

      // Draw HP bar when selected, damaged, or harvester/veteran
      if (isSelected || hpRatio < 0.99 || ent.veterancy > 0 || ent.typeId === 'harvester') {
        const off = count++ * FLOATS_PER_INST;
        const smallUnit = !ent.isBuilding && (ent.radius ?? 1.0) < 0.85;
        const barW = ent.isBuilding ? Math.max(3.0, ent.footprintW * 1.15) : Math.max(smallUnit ? 1.18 : 2.1, (ent.radius ?? 1.0) * 1.8);
        const barH = smallUnit ? 0.42 : 0.62;
        const yOff = ent.isBuilding ? 3.8 : (smallUnit ? 1.85 : 2.35);
        instData[off + 0] = ix;
        instData[off + 1] = iy + yOff;
        instData[off + 2] = iz;
        instData[off + 3] = barW;
        instData[off + 4] = barH;
        instData[off + 5] = 1; // kind=1 billboard bar
        instData[off + 6] = hpRatio;
        instData[off + 7] = isSelected ? 1 : 0;
        instData[off + 8] = ent.veterancy;
        instData[off + 9] = ent.typeId === 'harvester' ? ent.cargoCount : -1;
        instData[off + 10] = ent.playerId % 4;
        instData[off + 11] = ent.ironCurtainTicks > 0 ? 1 : 0;
      }
    }

    if (count > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, instVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instData.subarray(0, count * FLOATS_PER_INST));
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
  }

  function render(ctx) {
    if (count === 0) return;
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniformMatrix4fv(loc.uViewProj, false, ctx.viewProj);
    gl.uniform3fv(loc.uCamRight, ctx.camRight);
    gl.uniform3fv(loc.uCamUp, ctx.camUp);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, count);
    ctx.calls++;
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  return {
    get activeCount() { return count; },
    sync,
    render,
    dispose() {
      gl.deleteProgram(prog);
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(quadVbo);
      gl.deleteBuffer(ibo);
      gl.deleteBuffer(instVbo);
    }
  };
}
