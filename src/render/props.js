// Instanced Battlefield Scenery Props Renderer (Conifer Pines, Coastal Palms & Cliff Boulders).
// Renders strictly cosmetic static scenery in <= 3 Draw Calls with static shadow map support & GPU Fog.

import { CELL_SIZE, MAP_SIZE, TERRAIN } from '../world/map.js';
import { PCSS_GLSL } from './shadow.js';

const PROP_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;

// Per-instance: xyz = world pos, w = yawRad; vec4 iScale = (scale, swayPhase, tintShift, 0)
layout(location = 3) in vec4 iWorldYaw;
layout(location = 4) in vec4 iScaleInfo;

uniform mat4 uViewProj;
uniform mat4 uLightViewProj;
uniform float uTime;

out vec3 vWorldPos;
out vec3 vNormal;
out vec3 vColor;
out vec4 vShadowPos;

void main() {
  float c = cos(iWorldYaw.w);
  float s = sin(iWorldYaw.w);
  float sc = iScaleInfo.x;
  vec3 p = aPos * sc;

  // Subtle wind sway on upper foliage vertices
  float swayAmt = max(0.0, aPos.y - 0.8) * 0.045 * iScaleInfo.y;
  p.x += sin(uTime * 1.8 + iScaleInfo.z + iWorldYaw.x * 0.2) * swayAmt;
  p.z += cos(uTime * 1.5 + iScaleInfo.z + iWorldYaw.z * 0.2) * swayAmt;

  vec3 worldPos = iWorldYaw.xyz + vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  vWorldPos = worldPos;
  vNormal = normalize(vec3(aNormal.x * c + aNormal.z * s, aNormal.y, -aNormal.x * s + aNormal.z * c));
  vColor = aColor * (0.9 + 0.2 * iScaleInfo.z);
  vShadowPos = uLightViewProj * vec4(worldPos, 1.0);
  gl_Position = uViewProj * vec4(worldPos, 1.0);
}`;

const PROP_FS = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in vec3 vColor;
in vec4 vShadowPos;

uniform vec3 uLightDir;
uniform vec3 uCamPos;
uniform sampler2D uShadowMap;
uniform sampler2D uFogTex;
uniform float uWorldSize;
uniform float uNoFog;
uniform float uShadowTexelSize;

out vec4 outColor;

${PCSS_GLSL}

void main() {
  vec2 fogUv = clamp(vWorldPos.xz / uWorldSize, 0.0, 1.0);
  float fogVis = mix(texture(uFogTex, fogUv).r, 1.0, uNoFog);
  if (fogVis < 0.08) discard;

  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightDir);
  float NdotL = max(dot(N, L), 0.0);

  vec3 proj = (vShadowPos.xyz / vShadowPos.w) * 0.5 + 0.5;
  float shadow = sampleShadowPCSS(uShadowMap, proj, 0.0022, uShadowTexelSize);

  vec3 ambient = vColor * (0.24 + 0.16 * max(N.y, 0.0));
  vec3 direct = vColor * vec3(1.26, 1.18, 1.02) * NdotL * mix(0.20, 1.0, shadow);
  outColor = vec4((ambient + direct) * fogVis, 1.0);
}`;

const PROP_SHADOW_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 3) in vec4 iWorldYaw;
layout(location = 4) in vec4 iScaleInfo;
uniform mat4 uLightViewProj;
void main() {
  float c = cos(iWorldYaw.w);
  float s = sin(iWorldYaw.w);
  vec3 p = aPos * iScaleInfo.x;
  vec3 wp = iWorldYaw.xyz + vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  gl_Position = uLightViewProj * vec4(wp, 1.0);
}`;

const PROP_SHADOW_FS = `#version 300 es
precision highp float;
void main() {}`;

function createPropMeshBuilder() {
  const verts = []; // pos(3), nrm(3), col(3)
  const indices = [];
  let vCount = 0;

  function addTri(p0, p1, p2, col) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const base = vCount;
    for (const p of [p0, p1, p2]) {
      verts.push(p[0], p[1], p[2], nx, ny, nz, col[0], col[1], col[2]);
      vCount++;
    }
    indices.push(base, base + 1, base + 2);
  }

  function addCone(cx, y0, cz, rBot, rTop, h, segs, col) {
    const y1 = y0 + h;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const b0 = [cx + Math.cos(a0) * rBot, y0, cz + Math.sin(a0) * rBot];
      const b1 = [cx + Math.cos(a1) * rBot, y0, cz + Math.sin(a1) * rBot];
      if (rTop <= 0.02) {
        addTri(b0, [cx, y1, cz], b1, col);
      } else {
        const t0 = [cx + Math.cos(a0) * rTop, y1, cz + Math.sin(a0) * rTop];
        const t1 = [cx + Math.cos(a1) * rTop, y1, cz + Math.sin(a1) * rTop];
        addTri(b0, t0, t1, col);
        addTri(b0, t1, b1, col);
      }
      if (y0 > 0.05) {
        addTri([cx, y0, cz], b0, b1, [col[0] * 0.65, col[1] * 0.65, col[2] * 0.65]);
      }
    }
  }

  function addBoulder(rx, ry, rz, segs, col) {
    const rings = 4;
    const pts = [];
    for (let r = 0; r <= rings; r++) {
      const phi = (r / rings) * Math.PI;
      const sy = Math.cos(phi);
      const sr = Math.sin(phi);
      const row = [];
      for (let i = 0; i <= segs; i++) {
        const th = (i / segs) * Math.PI * 2;
        const wob = 0.85 + 0.22 * Math.sin(th * 3.0 + r * 1.7);
        row.push([
          Math.cos(th) * sr * rx * wob,
          (sy * 0.5 + 0.35) * ry * 2.0,
          Math.sin(th) * sr * rz * wob
        ]);
      }
      pts.push(row);
    }
    for (let r = 0; r < rings; r++) {
      for (let i = 0; i < segs; i++) {
        addTri(pts[r][i], pts[r + 1][i], pts[r + 1][i + 1], col);
        addTri(pts[r][i], pts[r + 1][i + 1], pts[r][i + 1], col);
      }
    }
  }

  return { addTri, addCone, addBoulder, build: () => ({ vertices: new Float32Array(verts), indices: new Uint16Array(indices), indexCount: indices.length }) };
}

function buildPineMesh() {
  const b = createPropMeshBuilder();
  b.addCone(0, 0, 0, 0.28, 0.14, 1.5, 7, [0.30, 0.20, 0.12]);
  b.addCone(0, 1.1, 0, 1.35, 0.18, 1.85, 8, [0.11, 0.30, 0.09]);
  b.addCone(0, 2.25, 0, 1.08, 0.14, 1.65, 8, [0.15, 0.38, 0.11]);
  b.addCone(0, 3.25, 0, 0.78, 0.01, 1.45, 8, [0.20, 0.46, 0.14]);
  return b.build();
}

function buildPalmMesh() {
  const b = createPropMeshBuilder();
  // Slightly leaning trunk segments
  const segs = 4;
  let ox = 0, oy = 0;
  for (let s = 0; s < segs; s++) {
    const nx = ox + 0.12 * (s + 1);
    const ny = oy + 0.92;
    b.addCone(ox, oy, 0, 0.22 - s * 0.025, 0.18 - s * 0.02, 0.95, 7, [0.42, 0.32, 0.20]);
    ox = nx * 0.45;
    oy = ny;
  }
  const crownX = ox, crownY = oy - 0.1;
  // 6 arching lush palm fronds
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const px = -sa, pz = ca;
    const tipX = crownX + ca * 1.95, tipZ = sa * 1.95, tipY = crownY - 0.42;
    const midX = crownX + ca * 1.05, midZ = sa * 1.05, midY = crownY + 0.42;
    const p0 = [crownX, crownY, 0];
    const p1L = [midX + px * 0.36, midY, midZ + pz * 0.36];
    const p1R = [midX - px * 0.36, midY, midZ - pz * 0.36];
    const p2 = [tipX, tipY, tipZ];
    b.addTri(p0, p1L, p2, [0.24, 0.54, 0.14]);
    b.addTri(p0, p2, p1R, [0.20, 0.46, 0.12]);
  }
  return b.build();
}

function buildRockMesh() {
  const b = createPropMeshBuilder();
  b.addBoulder(1.05, 0.72, 0.88, 7, [0.34, 0.29, 0.23]);
  return b.build();
}

export function createPropRenderer(gl, compileProgram) {
  const mainProg = compileProgram(gl, PROP_VS, PROP_FS);
  const shadowProg = compileProgram(gl, PROP_SHADOW_VS, PROP_SHADOW_FS);

  const loc = {
    uViewProj: gl.getUniformLocation(mainProg, 'uViewProj'),
    uLightViewProj: gl.getUniformLocation(mainProg, 'uLightViewProj'),
    uTime: gl.getUniformLocation(mainProg, 'uTime'),
    uLightDir: gl.getUniformLocation(mainProg, 'uLightDir'),
    uCamPos: gl.getUniformLocation(mainProg, 'uCamPos'),
    uShadowMap: gl.getUniformLocation(mainProg, 'uShadowMap'),
    uFogTex: gl.getUniformLocation(mainProg, 'uFogTex'),
    uWorldSize: gl.getUniformLocation(mainProg, 'uWorldSize'),
    uNoFog: gl.getUniformLocation(mainProg, 'uNoFog'),
    uShadowTexelSize: gl.getUniformLocation(mainProg, 'uShadowTexelSize')
  };
  const shadowLvpLoc = gl.getUniformLocation(shadowProg, 'uLightViewProj');

  const createBatch = (geom, maxInstances) => {
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const ibo = gl.createBuffer();
    const instVbo = gl.createBuffer();
    const instData = new Float32Array(maxInstances * 8);

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, geom.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, instVbo);
    gl.bufferData(gl.ARRAY_BUFFER, instData.byteLength, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(null);

    return { vao, vbo, ibo, instVbo, instData, indexCount: geom.indexCount, count: 0, maxInstances };
  };

  const batches = {
    pine: createBatch(buildPineMesh(), 360),
    palm: createBatch(buildPalmMesh(), 220),
    rock: createBatch(buildRockMesh(), 220)
  };

  let boundMapId = null;

  function syncMap(map) {
    if (!map) return;
    if (boundMapId === map.id) return;
    boundMapId = map.id;

    batches.pine.count = 0;
    batches.palm.count = 0;
    batches.rock.count = 0;

    let seed = ((map.blueprint?.seed ?? 1337) ^ 0x9e3779b9) >>> 0;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const spawns = map.spawns ?? [];
    const isGallery = map.id === 'gallery_showcase';

    const pushInst = (batch, wx, wy, wz, yaw, scale, sway, tint) => {
      if (batch.count >= batch.maxInstances) return;
      const off = batch.count++ * 8;
      batch.instData[off + 0] = wx;
      batch.instData[off + 1] = wy;
      batch.instData[off + 2] = wz;
      batch.instData[off + 3] = yaw;
      batch.instData[off + 4] = scale;
      batch.instData[off + 5] = sway;
      batch.instData[off + 6] = tint;
      batch.instData[off + 7] = 0;
    };

    // Sample deterministic tree clusters & coastal palms on scenic non-base, non-ore cells
    const step = isGallery ? 10 : 5;
    for (let gz = 8; gz < MAP_SIZE - 8; gz += step) {
      for (let gx = 8; gx < MAP_SIZE - 8; gx += step) {
        if (isGallery && gx > 110 && gx < 195 && gz > 110 && gz < 185) continue; // Keep unit showcase pad clear

        const jx = Math.min(MAP_SIZE - 4, Math.max(4, gx + Math.floor(rand() * 3) - 1));
        const jz = Math.min(MAP_SIZE - 4, Math.max(4, gz + Math.floor(rand() * 3) - 1));
        const idx = jz * MAP_SIZE + jx;
        const terr = map.terrain[idx];
        if (terr !== TERRAIN.LAND && terr !== TERRAIN.CLIFF) continue;
        if (map.oreType[idx] > 0 || map.buildingId[idx] !== 0) continue;

        let nearProtected = false;
        for (let s = 0; s < spawns.length; s++) {
          const dx = jx - spawns[s].gx;
          const dz = jz - spawns[s].gz;
          if (dx * dx + dz * dz < 676) { // Keep base clear (26 cells)
            nearProtected = true;
            break;
          }
        }
        if (nearProtected) continue;

        // Check nearby sea/shallow or cliff for biome-accurate placement
        let nearSea = false;
        let nearOre = false;
        for (let oz = -4; oz <= 4; oz += 2) {
          for (let ox = -4; ox <= 4; ox += 2) {
            const ni = (jz + oz) * MAP_SIZE + (jx + ox);
            const nt = map.terrain[ni];
            if (nt === TERRAIN.SHALLOW || nt === TERRAIN.SEA) nearSea = true;
            if (map.oreType[ni] > 0) nearOre = true;
          }
        }
        if (nearOre) continue;

        // Keep center strait lanes clean
        if (Math.abs(jx - 128) < 12 && Math.abs(jz - 128) < 22) continue;

        const elev = map.elevation[idx];
        const wx = (jx + 0.5 + (rand() - 0.5) * 0.7) * CELL_SIZE;
        const wz = (jz + 0.5 + (rand() - 0.5) * 0.7) * CELL_SIZE;
        const r = rand();

        if (terr === TERRAIN.CLIFF || (nearSea && r < 0.22)) {
          if (r < 0.72) {
            pushInst(batches.rock, wx, elev - 0.15, wz, rand() * Math.PI * 2, 0.75 + rand() * 0.9, 0.0, rand());
          }
        } else if (nearSea && r < 0.62) {
          pushInst(batches.palm, wx, elev - 0.05, wz, rand() * Math.PI * 2, 0.95 + rand() * 0.55, 1.0, rand());
        } else {
          // Cluster grove density via trig noise
          const grove = Math.sin(jx * 0.11) * Math.cos(jz * 0.11);
          if (grove > 0.12 && r < 0.68) {
            pushInst(batches.pine, wx, elev - 0.05, wz, rand() * Math.PI * 2, 0.9 + rand() * 0.65, 1.0, rand());
          }
        }
      }
    }

    for (const batch of Object.values(batches)) {
      if (batch.count <= 0) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, batch.instVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.instData.subarray(0, batch.count * 8));
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  function renderShadowPass(lightViewProj, ctx) {
    gl.useProgram(shadowProg);
    gl.uniformMatrix4fv(shadowLvpLoc, false, lightViewProj);
    for (const batch of Object.values(batches)) {
      if (batch.count <= 0) continue;
      gl.bindVertexArray(batch.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, batch.indexCount, gl.UNSIGNED_SHORT, 0, batch.count);
      ctx.calls++;
    }
    gl.bindVertexArray(null);
  }

  function renderMainPass(ctx) {
    gl.useProgram(mainProg);
    gl.uniformMatrix4fv(loc.uViewProj, false, ctx.viewProj);
    gl.uniformMatrix4fv(loc.uLightViewProj, false, ctx.lightViewProj);
    gl.uniform1f(loc.uTime, ctx.time);
    gl.uniform3fv(loc.uLightDir, ctx.lightDir);
    gl.uniform3fv(loc.uCamPos, ctx.camPos);
    gl.uniform1f(loc.uWorldSize, ctx.worldSize);
    gl.uniform1f(loc.uNoFog, ctx.noFog ? 1.0 : 0.0);
    gl.uniform1f(loc.uShadowTexelSize, 1.0 / ctx.shadowSize);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ctx.shadowTex);
    gl.uniform1i(loc.uShadowMap, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ctx.fogTex);
    gl.uniform1i(loc.uFogTex, 1);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    for (const batch of Object.values(batches)) {
      if (batch.count <= 0) continue;
      gl.bindVertexArray(batch.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, batch.indexCount, gl.UNSIGNED_SHORT, 0, batch.count);
      ctx.calls++;
    }
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  function dispose() {
    gl.deleteProgram(mainProg);
    gl.deleteProgram(shadowProg);
    for (const batch of Object.values(batches)) {
      gl.deleteVertexArray(batch.vao);
      gl.deleteBuffer(batch.vbo);
      gl.deleteBuffer(batch.ibo);
      gl.deleteBuffer(batch.instVbo);
    }
  }

  return { syncMap, renderShadowPass, renderMainPass, dispose };
}
