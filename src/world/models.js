// Single Draw Call Multi-Part Vertex-Articulated InstancedMesh Model Factory.
// Vertex layout (10 floats): pos(3), normal(3), uv(2), aPartId(1), aTone(1).
// Per-instance layout (20 floats): aInstanceMatrix(mat4=16) + aUnitState(vec4: turretDeltaYaw, recoil, hpRatio, teamAndFlags).

import { CANONICAL_ENTITY_IDS, ENTITY_DEFS, FACTIONS, PLAYER_COLORS } from '../core/config.js';
import { MAP_SIZE, worldToGrid } from './map.js';
import { PCSS_GLSL } from '../render/shadow.js';

const FLOATS_PER_VERT = 10;
const FLOATS_PER_INST = 20;

const MODEL_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in float aPartId;
layout(location = 4) in float aTone;

layout(location = 5) in vec4 iMatCol0;
layout(location = 6) in vec4 iMatCol1;
layout(location = 7) in vec4 iMatCol2;
layout(location = 8) in vec4 iMatCol3;
layout(location = 9) in vec4 iUnitState; // x: localTurretYaw, y: recoil, z: hpRatio, w: teamEncoded

uniform mat4 uViewProj;
uniform mat4 uLightViewProj;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
out float vTone;
out vec4 vUnitState;
out vec4 vShadowPos;

vec3 rotateY(vec3 v, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

void main() {
  mat4 modelMat = mat4(iMatCol0, iMatCol1, iMatCol2, iMatCol3);
  vec3 pos = aPos;
  vec3 nrm = aNormal;

  // Sub-part vertex articulation (Zero CPU hierarchy matrix sync):
  // aPartId == 1: turret/dish; aPartId == 2: barrel/tool (recoils along local -Z then inherits turret yaw)
  if (aPartId > 0.5) {
    if (aPartId > 1.5) {
      pos.z -= iUnitState.y;
    }
    pos = rotateY(pos, iUnitState.x);
    nrm = rotateY(nrm, iUnitState.x);
  }

  vec4 worldPos = modelMat * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;
  vNormal = normalize(mat3(modelMat) * nrm);
  vUv = aUv;
  vTone = aTone;
  vUnitState = iUnitState;
  vShadowPos = uLightViewProj * worldPos;
  gl_Position = uViewProj * worldPos;
}`;

const MODEL_FS = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
in float vTone;
in vec4 vUnitState;
in vec4 vShadowPos;

uniform vec3 uCamPos;
uniform vec3 uLightDir;
uniform float uCamHeight;
uniform float uWorldSize;
uniform float uNoFog;
uniform float uShadowTexelSize;
uniform sampler2D uDetailTex;
uniform sampler2D uMaterialTex;
uniform sampler2D uShadowMap;
uniform sampler2D uFogTex;
uniform vec3 uTeamColors[4];

out vec4 outColor;

${PCSS_GLSL}

void main() {
  vec2 fogUv = clamp(vWorldPos.xz / uWorldSize, 0.0, 1.0);
  float fogTexel = 1.0 / 256.0;
  float fogSample = (
    texture(uFogTex, fogUv).r * 2.0 +
    texture(uFogTex, fogUv + vec2(fogTexel, 0.0)).r +
    texture(uFogTex, fogUv - vec2(fogTexel, 0.0)).r +
    texture(uFogTex, fogUv + vec2(0.0, fogTexel)).r +
    texture(uFogTex, fogUv - vec2(0.0, fogTexel)).r
  ) * (1.0 / 6.0);
  float fogVis = mix(fogSample, 1.0, uNoFog);
  if (fogVis < 0.09) discard;

  int teamIdx = clamp(int(vUnitState.w + 0.5), 0, 3);
  vec3 teamCol = uTeamColors[teamIdx];
  float hpRatio = clamp(vUnitState.z, 0.0, 1.0);

  vec4 detail = texture(uDetailTex, vUv * 1.5);
  vec4 mat = texture(uMaterialTex, vUv * 1.5);

  vec3 baseCol;
  float metallic = mat.a;
  float roughness = mat.b;

  if (vTone < 0.5) {
    // Tone 0: Faction painted military armor with crisp machined panel seam grid
    vec2 seam = abs(fract(vUv * vec2(3.0, 3.0)) - 0.5);
    float panelEdge = smoothstep(0.44, 0.495, max(seam.x, seam.y));
    vec3 oliveSteel = mix(vec3(0.16, 0.19, 0.23), teamCol * 0.78, 0.60);
    baseCol = oliveSteel * (0.82 + detail.r * 0.38 - detail.g * 0.24) * (1.0 - panelEdge * 0.34);
  } else if (vTone < 1.5) {
    // Tone 1: Dark gunmetal, tracks & tires with tread rib pattern
    float treadRib = 0.82 + 0.18 * step(0.45, fract(vUv.y * 8.0));
    baseCol = vec3(0.08, 0.09, 0.11) * (0.80 + detail.r * 0.30) * treadRib;
    roughness = clamp(roughness + 0.16, 0.0, 1.0);
  } else if (vTone < 2.5) {
    // Tone 2: Glowing energy core / optical visor / plasma vent
    baseCol = mix(teamCol * 1.55, vec3(0.95, 0.86, 0.42), 0.26);
    metallic = 0.2;
    roughness = 0.14;
  } else if (vTone < 3.5) {
    // Tone 3: Reinforced concrete plinth / copper coil / metallic trim
    baseCol = vec3(0.36, 0.35, 0.34) * (0.84 + detail.r * 0.28);
    metallic = 0.18;
    roughness = 0.78;
  } else {
    // Tone 4: Industrial yellow/black chevron hazard stripes
    float stripe = step(0.5, fract((vWorldPos.x + vWorldPos.z) * 1.65));
    baseCol = mix(vec3(0.09, 0.09, 0.10), vec3(0.90, 0.64, 0.10), stripe);
    metallic = 0.32;
    roughness = 0.52;
  }

  // < 50% HP charred battle-damage mask
  float dmgMask = smoothstep(0.55, 0.12, hpRatio) * smoothstep(0.32, 0.72, detail.r + detail.b * 0.35);
  baseCol = mix(baseCol, vec3(0.04, 0.035, 0.035), dmgMask * 0.85);
  roughness = mix(roughness, 0.92, dmgMask);

  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(V + L);

  float NdotL = max(dot(N, L), 0.0);
  float specPow = mix(20.0, 108.0, 1.0 - roughness);
  float spec = pow(max(dot(N, H), 0.0), specPow) * mix(0.30, 1.15, metallic);

  vec3 proj = (vShadowPos.xyz / vShadowPos.w) * 0.5 + 0.5;
  float shadow = sampleShadowPCSS(uShadowMap, proj, 0.0022, uShadowTexelSize);

  vec3 ambient = baseCol * (0.24 + 0.14 * max(N.y, 0.0)) * detail.a;
  vec3 direct = (baseCol * 1.28 + vec3(spec)) * NdotL * mix(0.26, 1.0, shadow);

  // Height-adaptive faction Fresnel rim silhouette (subtle at 14m close-up, crisp at 60-80m macro view)
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.2);
  float rimScale = mix(0.20, 1.15, smoothstep(16.0, 68.0, uCamHeight));
  vec3 rim = teamCol * fresnel * rimScale;

  // Low-HP ember pulse + Tone 2 emissive boost
  vec3 emissive = (vTone > 1.5 && vTone < 2.5) ? baseCol * 0.72 : vec3(0.0);
  if (hpRatio < 0.35) {
    emissive += vec3(0.9, 0.25, 0.04) * (1.0 - hpRatio / 0.35) * 0.35 * dmgMask;
  }

  vec3 color = (ambient + direct + rim + emissive) * fogVis;
  outColor = vec4(color, 1.0);
}`;

const SHADOW_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 3) in float aPartId;

layout(location = 5) in vec4 iMatCol0;
layout(location = 6) in vec4 iMatCol1;
layout(location = 7) in vec4 iMatCol2;
layout(location = 8) in vec4 iMatCol3;
layout(location = 9) in vec4 iUnitState;

uniform mat4 uLightViewProj;

vec3 rotateY(vec3 v, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

void main() {
  mat4 modelMat = mat4(iMatCol0, iMatCol1, iMatCol2, iMatCol3);
  vec3 pos = aPos;
  if (aPartId > 0.5) {
    if (aPartId > 1.5) pos.z -= iUnitState.y;
    pos = rotateY(pos, iUnitState.x);
  }
  gl_Position = uLightViewProj * modelMat * vec4(pos, 1.0);
}`;

const SHADOW_FS = `#version 300 es
precision highp float;
void main() {}`;

const XRAY_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 3) in float aPartId;

layout(location = 5) in vec4 iMatCol0;
layout(location = 6) in vec4 iMatCol1;
layout(location = 7) in vec4 iMatCol2;
layout(location = 8) in vec4 iMatCol3;
layout(location = 9) in vec4 iUnitState;

uniform mat4 uViewProj;

out vec3 vWorldPos;
out vec3 vNormal;
out vec4 vUnitState;

vec3 rotateY(vec3 v, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

void main() {
  mat4 modelMat = mat4(iMatCol0, iMatCol1, iMatCol2, iMatCol3);
  vec3 pos = aPos;
  vec3 nrm = aNormal;
  if (aPartId > 0.5) {
    if (aPartId > 1.5) pos.z -= iUnitState.y;
    pos = rotateY(pos, iUnitState.x);
    nrm = rotateY(nrm, iUnitState.x);
  }
  vec4 worldPos = modelMat * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;
  vNormal = normalize(mat3(modelMat) * nrm);
  vUnitState = iUnitState;
  gl_Position = uViewProj * worldPos;
}`;

const XRAY_FS = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in vec4 vUnitState;

uniform vec3 uCamPos;
uniform float uWorldSize;
uniform float uNoFog;
uniform sampler2D uFogTex;
uniform vec3 uTeamColors[4];

out vec4 outColor;

void main() {
  vec2 fogUv = clamp(vWorldPos.xz / uWorldSize, 0.0, 1.0);
  float fogVis = mix(texture(uFogTex, fogUv).r, 1.0, uNoFog);
  if (fogVis < 0.09) discard;

  int teamIdx = clamp(int(vUnitState.w + 0.5), 0, 3);
  vec3 teamCol = uTeamColors[teamIdx];
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 1.65);
  float alpha = (0.14 + 0.44 * rim) * fogVis;
  outColor = vec4(teamCol * (0.65 + 0.7 * rim), alpha);
}`;

function createMeshBuilder() {
  const verts = [];
  const indices = [];
  let vertCount = 0;

  function addTri(p0, p1, p2, nx, ny, nz, u0, v0, u1, v1, u2, v2, partId, tone) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const dot = cx * nx + cy * ny + cz * nz;
    const base = vertCount;

    const pushV = (p, u, v) => {
      verts.push(p[0], p[1], p[2], nx, ny, nz, u, v, partId, tone);
      vertCount++;
    };
    pushV(p0, u0, v0);
    if (dot >= 0) {
      pushV(p1, u1, v1);
      pushV(p2, u2, v2);
    } else {
      pushV(p2, u2, v2);
      pushV(p1, u1, v1);
    }
    indices.push(base, base + 1, base + 2);
  }

  function addQuad(p0, p1, p2, p3, nx, ny, nz, partId = 0, tone = 0) {
    addTri(p0, p1, p2, nx, ny, nz, 0, 0, 1, 0, 1, 1, partId, tone);
    addTri(p0, p2, p3, nx, ny, nz, 0, 0, 1, 1, 0, 1, partId, tone);
  }

  function addBox(cx, cy, cz, sx, sy, sz, partId = 0, tone = 0) {
    const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
    const x0 = cx - hx, x1 = cx + hx;
    const y0 = cy - hy, y1 = cy + hy;
    const z0 = cz - hz, z1 = cz + hz;
    addQuad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 0, 1, 0, partId, tone);
    addQuad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0, -1, 0, partId, tone);
    addQuad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, partId, tone);
    addQuad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0, 0, -1, partId, tone);
    addQuad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1, 0, 0, partId, tone);
    addQuad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, partId, tone);
  }

  function addQuadAuto(p0, p1, p2, p3, partId = 0, tone = 0) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p3[0] - p0[0], vy = p3[1] - p0[1], vz = p3[2] - p0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    addQuad(p0, p1, p2, p3, nx, ny, nz, partId, tone);
  }

  // Tapered / sloped trapezoid prism (glacis hulls, wedge turrets, flared roofs)
  function addTrapezoid(cx, cy, cz, bw, bd, tw, td, h, offsetZ = 0, partId = 0, tone = 0) {
    const hy = h * 0.5;
    const bx = bw * 0.5, bz = bd * 0.5;
    const tx = tw * 0.5, tz = td * 0.5;
    const y0 = cy - hy, y1 = cy + hy;
    const bfl = [cx - bx, y0, cz + bz], bfr = [cx + bx, y0, cz + bz];
    const brr = [cx + bx, y0, cz - bz], brl = [cx - bx, y0, cz - bz];
    const tfl = [cx - tx, y1, cz + offsetZ + tz], tfr = [cx + tx, y1, cz + offsetZ + tz];
    const trr = [cx + tx, y1, cz + offsetZ - tz], trl = [cx - tx, y1, cz + offsetZ - tz];

    addQuad(tfl, tfr, trr, trl, 0, 1, 0, partId, tone);   // Top
    addQuad(brl, brr, bfr, bfl, 0, -1, 0, partId, tone);  // Bottom
    addQuadAuto(bfl, bfr, tfr, tfl, partId, tone);        // Sloped Front
    addQuadAuto(brr, brl, trl, trr, partId, tone);        // Sloped Rear
    addQuadAuto(bfr, brr, trr, tfr, partId, tone);        // Sloped Right
    addQuadAuto(brl, bfl, tfl, trl, partId, tone);        // Sloped Left
  }

  // Track pod assembly with tapered front/rear approach angles, road wheels & armored skirt
  function addTrackAssembly(cx, cy, cz, w, h, len, wheels = 4, partId = 0) {
    addTrapezoid(cx, cy, cz, w, len * 0.78, w, len, h, 0, partId, 1);
    addTrapezoid(cx, cy + h * 0.34, cz, w * 1.12, len * 0.96, w * 1.06, len * 0.88, h * 0.32, 0, partId, 0);
    const wheelSpan = len * 0.68;
    const sideSign = cx >= 0 ? 1 : -1;
    const wx = cx + sideSign * (w * 0.42);
    for (let i = 0; i < wheels; i++) {
      const t = wheels === 1 ? 0 : (i / (wheels - 1) - 0.5);
      const wz = cz + t * wheelSpan;
      addCylinder(wx, cy - h * 0.14, wz, h * 0.33, h * 0.33, 0.18, 8, 'X', partId, 3);
    }
  }

  // Oriented barrel / cylinder aligned along X, Y, or Z axis
  function addCylinder(cx, cy, cz, rBottom, rTop, length, segs = 10, axis = 'Y', partId = 0, tone = 0) {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const am = (a0 + a1) * 0.5;
      const c0 = Math.cos(a0), s0 = Math.sin(a0);
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      const cm = Math.cos(am), sm = Math.sin(am);
      const half = length * 0.5;
      if (axis === 'X') {
        addQuad(
          [cx - half, cy + c0 * rBottom, cz + s0 * rBottom],
          [cx + half, cy + c0 * rTop, cz + s0 * rTop],
          [cx + half, cy + c1 * rTop, cz + s1 * rTop],
          [cx - half, cy + c1 * rBottom, cz + s1 * rBottom],
          0, cm, sm, partId, tone
        );
        if (rTop > 0.01) {
          addTri([cx + half, cy, cz], [cx + half, cy + c0 * rTop, cz + s0 * rTop], [cx + half, cy + c1 * rTop, cz + s1 * rTop], 1, 0, 0, 0.5, 0.5, 1, 0.5, 0.5, 1, partId, tone);
          addTri([cx - half, cy, cz], [cx - half, cy + c1 * rBottom, cz + s1 * rBottom], [cx - half, cy + c0 * rBottom, cz + s0 * rBottom], -1, 0, 0, 0.5, 0.5, 1, 0.5, 0.5, 1, partId, tone);
        }
      } else if (axis === 'Z') {
        addQuad(
          [cx + c0 * rBottom, cy + s0 * rBottom, cz - half],
          [cx + c1 * rBottom, cy + s1 * rBottom, cz - half],
          [cx + c1 * rTop, cy + s1 * rTop, cz + half],
          [cx + c0 * rTop, cy + s0 * rTop, cz + half],
          cm, sm, 0, partId, tone
        );
        if (rTop > 0.01) {
          addTri([cx, cy, cz + half], [cx + c0 * rTop, cy + s0 * rTop, cz + half], [cx + c1 * rTop, cy + s1 * rTop, cz + half], 0, 0, 1, 0.5, 0.5, 1, 0.5, 0.5, 1, partId, tone);
        }
      } else {
        addQuad(
          [cx + c0 * rBottom, cy - half, cz + s0 * rBottom],
          [cx + c1 * rBottom, cy - half, cz + s1 * rBottom],
          [cx + c1 * rTop, cy + half, cz + s1 * rTop],
          [cx + c0 * rTop, cy + half, cz + s0 * rTop],
          cm, 0, sm, partId, tone
        );
        if (rTop > 0.01) {
          addTri([cx, cy + half, cz], [cx + c1 * rTop, cy + half, cz + s1 * rTop], [cx + c0 * rTop, cy + half, cz + s0 * rTop], 0, 1, 0, 0.5, 0.5, 1, 0.5, 0.5, 1, partId, tone);
        }
      }
    }
  }

  return {
    addBox,
    addTrapezoid,
    addTrackAssembly,
    addCylinder,
    build() {
      return {
        vertices: new Float32Array(verts),
        indices: new Uint16Array(indices),
        indexCount: indices.length
      };
    }
  };
}

// High-detail procedural CAD blueprints for units & buildings + clean coverage for all 49 canonical IDs.
function buildProceduralGeometryData(typeId) {
  const b = createMeshBuilder();
  const def = ENTITY_DEFS[typeId];

  switch (typeId) {
    case 'grizzly': {
      // Abyssal Grizzly: Sloped NATO hull, armored skirted 4-wheel tracks, ERA cheek turret, bore evacuator
      b.addTrapezoid(0, 0.48, 0.05, 1.52, 2.85, 1.38, 2.25, 0.62, -0.15, 0, 0);
      b.addBox(0, 0.72, 1.25, 1.15, 0.14, 0.16, 0, 2); // Tactical headlight bar
      b.addBox(-0.95, 0.56, 0, 0.14, 0.34, 2.85, 0, 0); // Armored side skirts
      b.addBox(0.95, 0.56, 0, 0.14, 0.34, 2.85, 0, 0);
      b.addTrackAssembly(-0.92, 0.42, 0, 0.46, 0.66, 3.05, 4, 0);
      b.addTrackAssembly(0.92, 0.42, 0, 0.46, 0.66, 3.05, 4, 0);
      b.addBox(0, 0.82, -1.0, 1.32, 0.25, 0.62, 0, 1); // Rear louver deck
      // Chamfered turret (part 1) + optic cupola + bustle rack + coax
      b.addTrapezoid(0, 1.06, -0.1, 1.48, 1.65, 1.12, 1.18, 0.52, -0.1, 1, 0);
      b.addBox(0, 1.1, -1.02, 1.08, 0.34, 0.36, 1, 1); // Turret bustle stowage rack
      b.addBox(-0.62, 1.06, 0.22, 0.26, 0.28, 0.62, 1, 0); // Left composite cheek module
      b.addBox(0.62, 1.06, 0.22, 0.26, 0.28, 0.62, 1, 0); // Right composite cheek module
      b.addCylinder(0.32, 1.38, -0.25, 0.24, 0.22, 0.18, 8, 'Y', 1, 1);
      b.addBox(0.32, 1.42, -0.05, 0.22, 0.1, 0.14, 1, 2); // Optic glow
      // 105mm stabilized cannon (part 2)
      b.addCylinder(0, 1.08, 1.4, 0.1, 0.085, 1.95, 8, 'Z', 2, 1);
      b.addCylinder(0, 1.08, 1.12, 0.145, 0.145, 0.36, 8, 'Z', 2, 0);
      b.addBox(0.28, 1.12, 0.88, 0.08, 0.08, 0.48, 2, 1);
      break;
    }

    case 'rhino': {
      // Crimson Rhino: Heavy sloped wedge prow, 5-wheel crimson assault chassis, cast turret + ERA + slotted muzzle brake
      b.addTrapezoid(0, 0.52, 0.05, 1.78, 3.2, 1.6, 2.55, 0.72, -0.15, 0, 0);
      b.addBox(0, 0.78, 1.38, 1.3, 0.16, 0.18, 0, 4); // Hazard bumper trim
      b.addBox(-1.12, 0.62, 0, 0.16, 0.38, 3.1, 0, 0); // Heavy reactive side skirts
      b.addBox(1.12, 0.62, 0, 0.16, 0.38, 3.1, 0, 0);
      b.addTrackAssembly(-1.08, 0.46, 0, 0.52, 0.76, 3.35, 5, 0);
      b.addTrackAssembly(1.08, 0.46, 0, 0.52, 0.76, 3.35, 5, 0);
      b.addCylinder(-0.5, 0.82, -1.55, 0.2, 0.2, 0.6, 8, 'X', 0, 1); // External fuel drums
      b.addCylinder(0.5, 0.82, -1.55, 0.2, 0.2, 0.6, 8, 'X', 0, 1);
      // Heavy sloped turret (part 1) + rangefinder + smoke pods
      b.addTrapezoid(0, 1.18, -0.08, 1.66, 1.85, 1.28, 1.38, 0.62, -0.08, 1, 0);
      b.addBox(-0.68, 1.18, 0.3, 0.32, 0.32, 0.68, 1, 1); // ERA armor blocks
      b.addBox(0.68, 1.18, 0.3, 0.32, 0.32, 0.68, 1, 1);
      b.addCylinder(-0.38, 1.56, -0.25, 0.26, 0.24, 0.18, 8, 'Y', 1, 1);
      b.addBox(0.38, 1.48, 0.18, 0.24, 0.12, 0.22, 1, 2);
      // 120mm heavy gun + muzzle brake (part 2)
      b.addCylinder(0, 1.2, 1.55, 0.13, 0.11, 2.15, 8, 'Z', 2, 1);
      b.addCylinder(0, 1.2, 1.25, 0.165, 0.165, 0.38, 8, 'Z', 2, 0);
      b.addBox(0, 1.2, 2.52, 0.3, 0.24, 0.28, 2, 1);
      break;
    }

    case 'apocalypse': {
      // Mammoth Twin-Cannon Apocalypse Tank: 4 articulated quad track pods + twin 120mm guns + SAM pod
      b.addTrapezoid(0, 0.62, 0, 2.25, 3.8, 1.98, 3.1, 0.82, -0.1, 0, 0);
      b.addTrackAssembly(-1.32, 0.48, 1.0, 0.55, 0.72, 1.7, 3, 0);
      b.addTrackAssembly(1.32, 0.48, 1.0, 0.55, 0.72, 1.7, 3, 0);
      b.addTrackAssembly(-1.32, 0.48, -1.0, 0.55, 0.72, 1.7, 3, 0);
      b.addTrackAssembly(1.32, 0.48, -1.0, 0.55, 0.72, 1.7, 3, 0);
      b.addTrapezoid(0, 1.38, -0.15, 1.95, 2.1, 1.58, 1.58, 0.68, -0.1, 1, 0);
      b.addBox(0.68, 1.65, -0.45, 0.5, 0.42, 0.72, 1, 1); // AA SAM pod
      b.addBox(0, 1.72, 0.25, 0.42, 0.16, 0.26, 1, 2);
      // Twin 120mm barrels
      b.addCylinder(-0.34, 1.38, 1.7, 0.125, 0.11, 2.2, 8, 'Z', 2, 1);
      b.addCylinder(0.34, 1.38, 1.7, 0.125, 0.11, 2.2, 8, 'Z', 2, 1);
      b.addBox(-0.34, 1.38, 2.68, 0.26, 0.22, 0.24, 2, 1);
      b.addBox(0.34, 1.38, 2.68, 0.26, 0.22, 0.24, 2, 1);
      break;
    }

    case 'harvester': {
      // Heavy Armed Ore Harvester with sloped hazard ore scoop & rotating crusher drum
      b.addTrapezoid(0, 0.5, -0.2, 1.82, 2.9, 1.66, 2.6, 0.64, 0, 0, 0);
      b.addTrackAssembly(-1.08, 0.46, -0.2, 0.46, 0.78, 3.05, 4, 0);
      b.addTrackAssembly(1.08, 0.46, -0.2, 0.46, 0.78, 3.05, 4, 0);
      b.addTrapezoid(0, 1.18, -0.65, 1.65, 1.75, 1.75, 1.9, 0.74, 0, 0, 3);
      b.addTrapezoid(0, 1.16, 0.68, 1.5, 0.95, 1.32, 0.75, 0.76, -0.05, 0, 0);
      b.addBox(0, 1.25, 1.12, 1.18, 0.32, 0.14, 0, 2);
      // Articulated Hazard Front Scoop (part 2)
      b.addTrapezoid(0, 0.56, 1.58, 2.05, 0.85, 1.92, 0.55, 0.56, -0.1, 2, 4);
      b.addCylinder(0, 0.54, 1.98, 0.34, 0.34, 1.85, 8, 'X', 2, 1);
      break;
    }

    case 'mcv': {
      // Massive 6-Wheel Heavy Mobile Construction Vehicle
      b.addTrapezoid(0, 0.65, 0, 2.15, 4.2, 1.95, 3.9, 0.78, 0, 0, 0);
      for (const wz of [-1.3, 0.05, 1.4]) {
        b.addCylinder(-1.18, 0.46, wz, 0.46, 0.46, 0.36, 10, 'X', 0, 1);
        b.addCylinder(1.18, 0.46, wz, 0.46, 0.46, 0.36, 10, 'X', 0, 1);
      }
      b.addTrapezoid(0, 1.45, -0.45, 1.88, 2.45, 1.65, 2.15, 0.86, 0, 0, 4);
      b.addTrapezoid(0, 1.4, 1.45, 1.92, 1.15, 1.65, 0.85, 0.82, -0.08, 0, 0);
      b.addBox(0, 1.55, 1.96, 1.45, 0.28, 0.14, 0, 2);
      b.addBox(0, 2.04, -0.5, 0.62, 0.34, 2.25, 1, 1);
      break;
    }

    case 'conyard': {
      b.addTrapezoid(0, 0.26, 0, 7.8, 7.8, 7.4, 7.4, 0.52, 0, 0, 3);
      b.addBox(0, 0.54, 0, 7.2, 0.08, 7.2, 0, 4);
      b.addTrapezoid(-1.55, 1.55, -1.55, 3.8, 3.8, 3.1, 3.1, 2.2, 0, 0, 0);
      b.addTrapezoid(1.85, 1.15, 1.5, 3.1, 3.3, 2.7, 2.9, 1.5, 0, 0, 1);
      b.addBox(-1.55, 2.8, -1.55, 1.5, 0.45, 1.5, 0, 2);
      b.addCylinder(1.2, 2.25, -1.2, 0.58, 0.44, 3.3, 8, 'Y', 1, 4);
      b.addBox(1.2, 4.0, 0.25, 0.72, 0.52, 4.4, 1, 0);
      b.addBox(1.2, 3.35, 2.1, 0.38, 1.15, 0.38, 2, 2);
      break;
    }

    case 'power_plant': {
      b.addTrapezoid(0, 0.22, 0, 3.8, 3.8, 3.55, 3.55, 0.44, 0, 0, 3);
      b.addTrapezoid(0, 1.02, -0.8, 3.25, 1.75, 2.85, 1.45, 1.4, 0, 0, 0);
      for (const px of [-0.85, 0.85]) {
        b.addCylinder(px, 1.35, 0.75, 0.68, 0.46, 1.8, 10, 'Y', 0, 1);
        b.addCylinder(px, 2.35, 0.75, 0.46, 0.58, 0.65, 10, 'Y', 0, 1);
        b.addCylinder(px, 2.75, 0.75, 0.44, 0.44, 0.25, 10, 'Y', 0, 2);
      }
      break;
    }

    case 'nuclear_reactor': {
      const sx = 5.7, sz = 5.7;
      b.addTrapezoid(0, 0.24, 0, sx, sz, sx * 0.94, sz * 0.94, 0.48, 0, 0, 3);
      b.addBox(0, 0.52, 0, sx * 0.9, 0.08, sz * 0.9, 0, 4);
      b.addCylinder(-0.6, 1.7, -0.5, 1.55, 1.25, 2.4, 12, 'Y', 0, 0);
      b.addCylinder(-0.6, 3.05, -0.5, 1.25, 0.45, 0.55, 12, 'Y', 0, 1);
      b.addCylinder(1.5, 1.65, 1.2, 0.85, 0.62, 2.3, 10, 'Y', 0, 1);
      b.addCylinder(1.5, 2.88, 1.2, 0.56, 0.56, 0.3, 10, 'Y', 0, 2);
      break;
    }

    case 'refinery': {
      b.addTrapezoid(0, 0.22, 0, 5.7, 5.7, 5.4, 5.4, 0.44, 0, 0, 3);
      b.addTrapezoid(-1.1, 1.5, -1.0, 2.9, 3.1, 2.45, 2.65, 2.45, 0, 0, 0);
      b.addCylinder(1.4, 1.8, -1.1, 0.98, 0.82, 2.8, 10, 'Y', 0, 1);
      b.addCylinder(1.4, 3.3, -1.1, 0.68, 0.68, 0.38, 10, 'Y', 0, 2);
      b.addBox(0.2, 0.68, 1.65, 3.8, 0.55, 1.85, 0, 1);
      b.addBox(0.2, 1.0, 2.45, 3.6, 0.22, 0.35, 0, 4);
      break;
    }

    case 'war_factory': {
      b.addTrapezoid(0, 0.22, 0, 7.7, 5.7, 7.4, 5.4, 0.44, 0, 0, 3);
      b.addTrapezoid(0, 1.65, -1.1, 6.9, 3.1, 6.1, 2.55, 2.65, 0, 0, 0);
      b.addBox(-2.5, 1.4, 1.1, 1.6, 2.2, 2.6, 0, 1);
      b.addBox(2.5, 1.4, 1.1, 1.6, 2.2, 2.6, 0, 1);
      b.addBox(0, 2.38, 1.1, 3.8, 0.62, 2.4, 0, 0);
      b.addBox(0, 0.48, 2.2, 3.6, 0.12, 1.1, 0, 4);
      b.addBox(0, 3.05, -1.1, 2.3, 0.36, 1.5, 0, 2);
      break;
    }

    case 'naval_yard': {
      b.addBox(-2.7, 0.75, 0, 1.9, 1.2, 7.4, 0, 3);
      b.addBox(2.7, 0.75, 0, 1.9, 1.2, 7.4, 0, 3);
      b.addBox(0, 0.9, -2.9, 7.2, 1.4, 1.6, 0, 0);
      b.addBox(-2.7, 1.5, 0, 0.6, 0.3, 6.8, 0, 4);
      b.addBox(2.7, 1.5, 0, 0.6, 0.3, 6.8, 0, 4);
      // Gantry crane bridge
      b.addBox(0, 3.3, 0.8, 6.8, 0.55, 0.9, 0, 4);
      b.addBox(-2.8, 2.1, 0.8, 0.45, 2.4, 0.55, 0, 1);
      b.addBox(2.8, 2.1, 0.8, 0.45, 2.4, 0.55, 0, 1);
      break;
    }

    case 'prism_tower': {
      b.addTrapezoid(0, 0.2, 0, 1.9, 1.9, 1.7, 1.7, 0.4, 0, 0, 3);
      b.addTrapezoid(0, 1.45, 0, 1.35, 1.35, 0.65, 0.65, 2.2, 0, 0, 0);
      b.addCylinder(0, 2.95, 0, 0.36, 0.12, 0.85, 6, 'Y', 1, 2);
      b.addBox(-0.48, 2.4, 0, 0.14, 0.65, 0.38, 1, 3);
      b.addBox(0.48, 2.4, 0, 0.14, 0.65, 0.38, 1, 3);
      break;
    }

    case 'tesla_coil': {
      b.addTrapezoid(0, 0.2, 0, 1.9, 1.9, 1.7, 1.7, 0.4, 0, 0, 3);
      b.addCylinder(0, 1.35, 0, 0.52, 0.32, 2.1, 10, 'Y', 0, 0);
      for (const ry of [1.2, 1.75, 2.3]) {
        b.addCylinder(0, ry, 0, 0.72, 0.72, 0.14, 12, 'Y', 0, 4);
      }
      b.addCylinder(0, 2.72, 0, 0.38, 0.38, 0.45, 10, 'Y', 1, 2);
      break;
    }

    case 'gi': {
      b.addTrapezoid(0, 0.56, 0, 0.56, 0.48, 0.48, 0.42, 0.96, 0, 0, 0);
      b.addCylinder(0, 1.22, 0, 0.24, 0.2, 0.34, 8, 'Y', 1, 1); // Wide NATO helmet
      b.addBox(0, 0.65, 0.42, 0.62, 0.68, 0.09, 2, 3); // Deployable ballistic shield / bipod rig
      b.addCylinder(0.24, 0.78, 0.5, 0.06, 0.05, 0.85, 6, 'Z', 2, 1);
      break;
    }

    case 'conscript': {
      b.addTrapezoid(0, 0.54, 0, 0.48, 0.44, 0.42, 0.38, 0.96, 0, 0, 0);
      b.addCylinder(0, 1.2, 0, 0.22, 0.22, 0.36, 8, 'Y', 1, 1); // Fur ushanka
      b.addCylinder(0.2, 0.75, 0.44, 0.048, 0.04, 0.9, 6, 'Z', 2, 1);
      break;
    }

    case 'flak_trooper': {
      b.addTrapezoid(0, 0.58, 0, 0.62, 0.54, 0.52, 0.46, 1.0, 0, 0, 0);
      b.addCylinder(-0.18, 0.76, -0.34, 0.14, 0.14, 0.55, 8, 'Y', 0, 4);
      b.addCylinder(0.18, 0.76, -0.34, 0.14, 0.14, 0.55, 8, 'Y', 0, 4);
      b.addCylinder(0, 1.24, 0, 0.23, 0.2, 0.34, 8, 'Y', 1, 2);
      b.addCylinder(0.26, 0.86, 0.48, 0.11, 0.09, 1.0, 8, 'Z', 2, 1);
      break;
    }

    case 'engineer': {
      b.addTrapezoid(0, 0.52, 0, 0.48, 0.42, 0.42, 0.38, 0.92, 0, 0, 3);
      b.addBox(0, 0.68, -0.28, 0.4, 0.48, 0.22, 0, 4); // Hazard toolkit
      b.addCylinder(0, 1.16, 0, 0.23, 0.2, 0.28, 8, 'Y', 1, 4); // Hard-hat
      b.addBox(0.22, 0.7, 0.32, 0.08, 0.08, 0.46, 2, 2);
      break;
    }

    case 'rocketeer': {
      b.addTrapezoid(0, 0.58, 0, 0.52, 0.46, 0.46, 0.4, 0.96, 0, 0, 0);
      b.addBox(-0.22, 0.72, -0.32, 0.16, 0.52, 0.24, 0, 1);
      b.addBox(0.22, 0.72, -0.32, 0.16, 0.52, 0.24, 0, 1);
      b.addTrapezoid(0, 0.88, -0.32, 1.55, 0.42, 1.15, 0.26, 0.08, 0, 0, 2); // Jump wings
      b.addCylinder(0, 1.22, 0, 0.21, 0.19, 0.34, 8, 'Y', 1, 2);
      b.addCylinder(-0.28, 0.98, 0.26, 0.08, 0.08, 0.82, 6, 'Z', 2, 1);
      break;
    }

    case 'tesla_trooper': {
      b.addTrapezoid(0, 0.62, 0, 0.76, 0.66, 0.64, 0.56, 1.1, 0, 0, 0); // Heavy exo armor
      b.addCylinder(-0.24, 0.95, -0.36, 0.16, 0.14, 0.68, 8, 'Y', 0, 4);
      b.addCylinder(0.24, 0.95, -0.36, 0.16, 0.14, 0.68, 8, 'Y', 0, 4);
      b.addCylinder(0, 1.32, 0, 0.24, 0.2, 0.34, 8, 'Y', 1, 2);
      b.addCylinder(0.32, 0.82, 0.46, 0.11, 0.07, 0.92, 8, 'Z', 2, 2);
      break;
    }

    case 'chrono': {
      b.addTrapezoid(0, 0.58, 0, 0.62, 0.54, 0.52, 0.46, 1.0, 0, 0, 0);
      b.addCylinder(0, 0.82, -0.34, 0.28, 0.28, 0.22, 10, 'Z', 0, 2); // Chrono core ring
      b.addCylinder(0, 1.24, 0, 0.22, 0.2, 0.34, 8, 'Y', 1, 2);
      b.addCylinder(0.28, 0.78, 0.52, 0.09, 0.06, 0.96, 8, 'Z', 2, 2);
      break;
    }

    case 'shadow': {
      b.addTrapezoid(0, 0.54, 0, 0.5, 0.42, 0.42, 0.34, 0.94, 0, 0, 1);
      b.addCylinder(0, 1.18, 0, 0.19, 0.17, 0.32, 8, 'Y', 1, 1);
      b.addBox(0, 1.2, 0.16, 0.26, 0.07, 0.1, 1, 2); // Night vision visor
      b.addBox(-0.22, 0.72, 0.32, 0.07, 0.09, 0.44, 2, 1);
      b.addBox(0.22, 0.72, 0.32, 0.07, 0.09, 0.44, 2, 1);
      break;
    }

    case 'sledge': {
      b.addTrapezoid(0, 0.68, 0, 0.88, 0.78, 0.74, 0.64, 1.22, 0, 0, 0);
      b.addBox(-0.56, 0.92, 0.06, 0.34, 0.48, 0.42, 1, 4);
      b.addBox(0.56, 0.92, 0.06, 0.34, 0.48, 0.42, 1, 1);
      b.addCylinder(0, 1.42, 0, 0.26, 0.22, 0.34, 8, 'Y', 1, 2);
      b.addBox(0.58, 0.84, 0.58, 0.22, 0.26, 0.75, 2, 1);
      break;
    }

    case 'ifv': {
      b.addTrapezoid(0, 0.48, 0, 1.48, 2.75, 1.28, 2.2, 0.62, -0.1, 0, 0);
      for (const wz of [-0.9, 0, 0.9]) {
        b.addCylinder(-0.84, 0.36, wz, 0.36, 0.36, 0.26, 8, 'X', 0, 1);
        b.addCylinder(0.84, 0.36, wz, 0.36, 0.36, 0.26, 8, 'X', 0, 1);
      }
      b.addTrapezoid(0, 1.0, -0.15, 1.02, 1.15, 0.82, 0.88, 0.44, 0, 1, 1);
      b.addCylinder(-0.18, 1.04, 0.78, 0.09, 0.08, 0.95, 8, 'Z', 2, 2);
      b.addCylinder(0.18, 1.04, 0.78, 0.09, 0.08, 0.95, 8, 'Z', 2, 4);
      break;
    }

    case 'v3': {
      b.addTrapezoid(0, 0.46, 0, 1.72, 3.35, 1.56, 3.0, 0.58, 0, 0, 0);
      b.addTrackAssembly(-0.98, 0.42, 0, 0.44, 0.66, 3.4, 5, 0);
      b.addTrackAssembly(0.98, 0.42, 0, 0.44, 0.66, 3.4, 5, 0);
      b.addTrapezoid(0, 0.96, 1.15, 1.35, 0.85, 1.15, 0.65, 0.52, -0.08, 0, 1); // Cab
      // Elevated V3 ballistic missile in launch rail
      b.addBox(0, 1.32, -0.1, 0.58, 0.26, 2.45, 1, 4);
      b.addCylinder(0, 1.66, -0.05, 0.34, 0.28, 2.35, 10, 'Z', 2, 0);
      b.addCylinder(0, 1.66, 1.38, 0.28, 0.02, 0.65, 10, 'Z', 2, 2); // Warhead cone
      break;
    }

    case 'prism': {
      b.addTrapezoid(0, 0.45, 0, 1.56, 2.95, 1.4, 2.45, 0.54, -0.1, 0, 0);
      b.addTrackAssembly(-0.9, 0.4, 0, 0.4, 0.62, 3.05, 4, 0);
      b.addTrackAssembly(0.9, 0.4, 0, 0.4, 0.62, 3.05, 4, 0);
      b.addCylinder(0, 0.92, -0.15, 0.62, 0.42, 0.46, 8, 'Y', 1, 1);
      b.addCylinder(0, 1.45, 0.05, 0.28, 0.1, 0.92, 6, 'Y', 2, 2); // Focusing prism emitter
      b.addBox(-0.42, 1.24, 0.05, 0.12, 0.55, 0.42, 1, 3);
      b.addBox(0.42, 1.24, 0.05, 0.12, 0.55, 0.42, 1, 3);
      break;
    }

    case 'stormhawk': {
      b.addTrapezoid(0, 0, 0.1, 1.05, 3.6, 0.68, 2.9, 0.68, 0.15, 0, 0);
      b.addTrapezoid(0, 0.04, -0.25, 4.1, 1.45, 1.25, 0.65, 0.14, -0.35, 0, 1); // Delta wing
      b.addBox(-0.52, 0.42, -1.2, 0.1, 0.68, 0.72, 0, 0);
      b.addBox(0.52, 0.42, -1.2, 0.1, 0.68, 0.72, 0, 0);
      b.addBox(0, 0.36, 1.05, 0.52, 0.3, 0.88, 0, 2); // Canopy
      break;
    }

    case 'crimson_mig': {
      b.addCylinder(0, 0, 0.1, 0.42, 0.16, 3.9, 8, 'Z', 0, 0); // Needle nose fuselage
      b.addTrapezoid(0, 0.02, -0.3, 3.85, 1.3, 1.6, 0.65, 0.12, -0.45, 0, 4); // Swept wings
      b.addBox(0, 0.52, -1.35, 0.12, 0.78, 0.82, 0, 0); // Tall MiG fin
      b.addBox(0, 0.34, 0.85, 0.46, 0.28, 0.85, 0, 2);
      break;
    }

    case 'nighthawk': {
      b.addTrapezoid(0, 0.1, 0.05, 1.42, 3.7, 1.1, 3.2, 0.82, 0.1, 0, 1); // Faceted stealth fuselage
      b.addBox(-1.15, 0.05, -0.1, 0.9, 0.22, 0.95, 0, 1);
      b.addBox(1.15, 0.05, -0.1, 0.9, 0.22, 0.95, 0, 1);
      b.addBox(0, 0.28, 1.35, 0.82, 0.36, 0.85, 0, 2);
      // Quad rotor hub (part 1)
      b.addCylinder(0, 0.75, 0, 0.24, 0.24, 0.42, 8, 'Y', 1, 1);
      b.addBox(0, 0.92, 0, 4.4, 0.06, 0.24, 1, 1);
      b.addBox(0, 0.92, 0, 0.24, 0.06, 4.4, 1, 1);
      break;
    }

    case 'kirov': {
      b.addCylinder(0, 0.6, 0, 1.35, 1.35, 5.2, 12, 'Z', 0, 0);
      b.addCylinder(0, 0.6, 2.7, 1.15, 0.18, 0.95, 12, 'Z', 0, 4); // Shark jaw nose cone
      b.addCylinder(0, 0.6, -2.7, 0.18, 1.15, 0.95, 12, 'Z', 0, 0);
      b.addBox(0, -0.92, 0, 0.78, 0.58, 2.4, 0, 1); // Gondola
      b.addBox(0, 0.6, -2.2, 2.9, 0.14, 0.9, 0, 1); // X-tail horizontal
      b.addBox(0, 0.6, -2.2, 0.14, 2.9, 0.9, 0, 1); // X-tail vertical
      break;
    }

    case 'hover_transport': {
      b.addTrapezoid(0, 0.38, 0, 2.9, 5.2, 2.6, 4.7, 0.64, 0, 0, 1); // Air-cushion skirt
      b.addBox(0, 0.86, 0, 2.35, 0.32, 4.35, 0, 0);
      b.addBox(-1.05, 1.22, -0.3, 0.35, 0.48, 3.6, 0, 0);
      b.addBox(1.05, 1.22, -0.3, 0.35, 0.48, 3.6, 0, 0);
      b.addBox(0, 1.35, -1.75, 2.1, 0.82, 0.85, 0, 2); // Rear bridge
      b.addBox(0, 1.05, 2.18, 1.9, 0.65, 0.18, 0, 4); // Bow ramp
      break;
    }

    case 'dolphin': {
      b.addCylinder(0, 0.52, 0, 0.65, 0.35, 3.2, 10, 'Z', 0, 0);
      b.addCylinder(0, 0.52, 1.85, 0.42, 0.08, 0.75, 10, 'Z', 0, 0);
      b.addBox(0, 0.95, -0.3, 0.12, 0.58, 0.75, 0, 2); // Dorsal fin
      b.addCylinder(0, 1.05, 0.55, 0.34, 0.14, 0.32, 8, 'Y', 2, 2); // Sonic dish
      break;
    }

    case 'sea_scorpion': {
      b.addTrapezoid(0, 0.54, 0, 2.2, 4.8, 1.85, 4.2, 0.92, 0.1, 0, 0);
      b.addTrapezoid(0, 1.24, -0.75, 1.25, 1.45, 0.95, 1.15, 0.72, 0, 0, 1);
      b.addCylinder(0, 1.9, -0.9, 0.12, 0.08, 0.8, 6, 'Y', 1, 2);
      b.addCylinder(0, 1.18, 0.95, 0.58, 0.48, 0.42, 8, 'Y', 1, 0);
      b.addCylinder(-0.18, 1.26, 1.65, 0.09, 0.08, 1.15, 8, 'Z', 2, 1);
      b.addCylinder(0.18, 1.26, 1.65, 0.09, 0.08, 1.15, 8, 'Z', 2, 1);
      break;
    }

    case 'aegis': {
      b.addTrapezoid(0, 0.62, 0, 2.25, 5.8, 1.9, 5.1, 1.08, 0.25, 0, 0);
      b.addTrapezoid(0, 1.56, -0.25, 1.45, 2.05, 1.05, 1.55, 1.05, 0, 0, 1);
      b.addBox(0, 2.25, -0.4, 0.95, 0.55, 0.95, 0, 2); // SPY phased-array bridge
      b.addTrapezoid(0, 1.32, 1.55, 0.9, 0.9, 0.68, 0.68, 0.48, 0, 1, 0);
      b.addCylinder(-0.18, 1.52, 1.98, 0.1, 0.09, 1.1, 8, 'Z', 2, 4);
      b.addCylinder(0.18, 1.52, 1.98, 0.1, 0.09, 1.1, 8, 'Z', 2, 4);
      break;
    }

    case 'typhoon': {
      b.addCylinder(0, 0.45, 0, 0.88, 0.88, 5.2, 12, 'Z', 0, 1);
      b.addCylinder(0, 0.45, 2.85, 0.85, 0.18, 0.95, 12, 'Z', 0, 1);
      b.addCylinder(0, 0.45, -2.85, 0.18, 0.85, 0.95, 12, 'Z', 0, 1);
      b.addTrapezoid(0, 1.24, 0.35, 0.52, 1.45, 0.42, 1.1, 0.88, 0, 0, 0); // Conning sail
      b.addCylinder(0, 1.85, 0.45, 0.08, 0.07, 0.52, 6, 'Y', 1, 2);
      break;
    }

    case 'carrier': {
      b.addTrapezoid(0, 0.72, 0, 2.9, 6.9, 2.6, 6.4, 1.28, 0.2, 0, 0);
      b.addBox(0, 1.45, 0, 3.65, 0.22, 6.95, 0, 1); // Flight deck
      b.addBox(0, 1.58, 0, 0.38, 0.04, 6.4, 0, 4); // Runway centerline
      b.addTrapezoid(1.15, 2.15, -0.45, 0.95, 1.9, 0.75, 1.4, 1.25, 0, 0, 0); // Island bridge
      b.addBox(1.15, 2.95, -0.45, 0.48, 0.35, 0.48, 1, 2);
      break;
    }

    case 'dreadnought': {
      b.addTrapezoid(0, 0.68, 0, 2.55, 6.5, 2.25, 5.8, 1.18, 0.25, 0, 0);
      b.addTrapezoid(0, 1.62, -0.5, 1.75, 2.2, 1.35, 1.75, 0.95, 0, 0, 1);
      // Heavy aft cruise missile VLS silos
      b.addBox(-0.48, 1.75, -1.9, 0.68, 0.95, 1.45, 2, 4);
      b.addBox(0.48, 1.75, -1.9, 0.68, 0.95, 1.45, 2, 4);
      b.addTrapezoid(0, 1.45, 1.5, 1.15, 1.2, 0.88, 0.95, 0.55, 0, 1, 0);
      b.addCylinder(-0.24, 1.5, 2.3, 0.12, 0.1, 1.35, 8, 'Z', 2, 1);
      b.addCylinder(0.24, 1.5, 2.3, 0.12, 0.1, 1.35, 8, 'Z', 2, 1);
      break;
    }

    case 'barracks': {
      b.addTrapezoid(0, 0.22, 0, 5.7, 3.8, 5.4, 3.5, 0.44, 0, 0, 3);
      b.addTrapezoid(0, 1.25, -0.35, 4.9, 2.6, 4.2, 2.1, 1.75, 0, 0, 0);
      b.addBox(0, 1.05, 1.25, 2.2, 1.35, 0.85, 0, 1);
      b.addBox(0, 0.52, 1.65, 2.0, 0.16, 0.45, 0, 4);
      b.addBox(-1.75, 2.35, -0.35, 0.55, 0.85, 0.55, 0, 2);
      break;
    }

    case 'airforce_radar': {
      b.addTrapezoid(0, 0.2, 0, 5.8, 5.8, 5.5, 5.5, 0.4, 0, 0, 3);
      for (const px of [-1.6, 1.6]) {
        for (const pz of [-1.6, 1.6]) {
          b.addBox(px, 0.45, pz, 1.85, 0.1, 1.85, 0, 4); // 4 landing pads
        }
      }
      b.addTrapezoid(0, 1.25, 0, 1.6, 1.6, 1.2, 1.2, 1.75, 0, 0, 0);
      b.addCylinder(0, 2.55, 0, 0.85, 0.25, 0.45, 10, 'Z', 1, 2); // Rotating radar dish
      break;
    }

    case 'service_depot': {
      b.addTrapezoid(0, 0.16, 0, 5.7, 5.7, 5.5, 5.5, 0.32, 0, 0, 3);
      b.addBox(0, 0.35, 0, 4.8, 0.08, 4.8, 0, 4);
      b.addBox(-2.2, 1.15, -2.2, 0.55, 1.75, 0.55, 0, 1);
      b.addBox(2.2, 1.15, -2.2, 0.55, 1.75, 0.55, 0, 1);
      b.addBox(0, 2.1, -0.5, 0.55, 0.42, 3.6, 1, 0); // Rotating repair crane arm
      b.addBox(0, 1.65, 1.1, 0.28, 0.65, 0.28, 1, 2);
      break;
    }

    case 'battle_lab': {
      b.addTrapezoid(0, 0.24, 0, 5.7, 5.7, 5.4, 5.4, 0.48, 0, 0, 3);
      b.addTrapezoid(-0.85, 1.25, 0, 3.2, 3.8, 2.6, 3.2, 1.65, 0, 0, 0);
      b.addCylinder(1.25, 1.75, -0.65, 0.95, 0.38, 2.25, 12, 'Y', 0, 2); // Science dome spire
      b.addCylinder(1.25, 2.95, 1.15, 0.35, 0.22, 1.6, 8, 'Y', 1, 1);
      break;
    }

    case 'pillbox': {
      b.addTrapezoid(0, 0.22, 0, 1.9, 1.9, 1.7, 1.7, 0.44, 0, 0, 3);
      b.addCylinder(0, 0.72, 0, 0.85, 0.72, 0.65, 8, 'Y', 0, 3); // Concrete octagon casemate
      b.addTrapezoid(0, 1.18, 0, 1.05, 1.05, 0.78, 0.78, 0.38, 0, 1, 0); // Armored gun cupola
      b.addCylinder(-0.14, 1.16, 0.78, 0.06, 0.05, 1.1, 6, 'Z', 2, 1); // Twin HMGs
      b.addCylinder(0.14, 1.16, 0.78, 0.06, 0.05, 1.1, 6, 'Z', 2, 1);
      break;
    }

    case 'aa_turret': {
      b.addTrapezoid(0, 0.22, 0, 1.9, 1.9, 1.7, 1.7, 0.44, 0, 0, 3);
      b.addCylinder(0, 0.85, 0, 0.72, 0.56, 0.95, 8, 'Y', 0, 1);
      b.addTrapezoid(0, 1.48, 0, 1.02, 1.08, 0.76, 0.82, 0.52, 0, 1, 0);
      for (const ox of [-0.28, -0.09, 0.09, 0.28]) {
        b.addCylinder(ox, 1.58, 0.85, 0.06, 0.05, 1.25, 6, 'Z', 2, 1);
      }
      break;
    }

    case 'chrono_sphere': {
      b.addTrapezoid(0, 0.26, 0, 5.7, 5.7, 5.4, 5.4, 0.52, 0, 0, 3);
      b.addBox(-1.6, 1.65, 0, 0.65, 2.5, 1.2, 0, 0);
      b.addBox(1.6, 1.65, 0, 0.65, 2.5, 1.2, 0, 0);
      b.addCylinder(0, 1.95, 0, 1.15, 1.15, 1.1, 12, 'Y', 1, 2); // Glowing sphere core
      break;
    }

    case 'weather_control': {
      b.addTrapezoid(0, 0.26, 0, 5.7, 5.7, 5.4, 5.4, 0.52, 0, 0, 3);
      b.addCylinder(0, 1.85, 0, 0.95, 0.42, 2.8, 10, 'Y', 0, 0);
      for (const [rx, rz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
        b.addCylinder(rx, 1.55, rz, 0.22, 0.08, 2.3, 6, 'Y', 0, 2);
      }
      b.addCylinder(0, 3.4, 0, 0.65, 0.65, 0.22, 12, 'Y', 1, 2);
      break;
    }

    case 'iron_curtain': {
      b.addTrapezoid(0, 0.26, 0, 5.7, 5.7, 5.4, 5.4, 0.52, 0, 0, 3);
      b.addTrapezoid(-1.45, 1.65, 0, 1.2, 1.6, 0.85, 1.1, 2.4, 0, 0, 1);
      b.addTrapezoid(1.45, 1.65, 0, 1.2, 1.6, 0.85, 1.1, 2.4, 0, 0, 1);
      b.addCylinder(0, 2.15, 0, 0.92, 0.92, 0.92, 12, 'Y', 1, 2);
      break;
    }

    case 'nuclear_silo': {
      b.addTrapezoid(0, 0.26, 0, 5.7, 5.7, 5.4, 5.4, 0.52, 0, 0, 3);
      b.addBox(0, 0.72, 0, 4.4, 0.44, 4.4, 0, 4);
      b.addCylinder(0, 2.05, 0, 0.68, 0.16, 2.65, 12, 'Y', 0, 0); // ICBM warhead nose
      b.addCylinder(0, 3.42, 0, 0.18, 0.04, 0.48, 8, 'Y', 0, 2);
      break;
    }

    case 'oil_derrick': {
      b.addTrapezoid(0, 0.2, 0, 3.8, 3.8, 3.5, 3.5, 0.4, 0, 0, 3);
      b.addTrapezoid(0, 1.65, -0.45, 1.85, 1.85, 0.55, 0.55, 2.65, 0, 0, 4); // Lattice tower
      b.addBox(0, 2.85, 0.25, 0.42, 0.36, 2.4, 1, 1); // Walking beam
      b.addCylinder(1.05, 0.95, 0.95, 0.55, 0.55, 1.1, 10, 'Y', 0, 0);
      break;
    }

    case 'hospital': {
      b.addTrapezoid(0, 0.22, 0, 5.7, 5.7, 5.4, 5.4, 0.44, 0, 0, 3);
      b.addTrapezoid(0, 1.25, 0, 4.4, 3.8, 4.1, 3.5, 1.7, 0, 0, 0);
      b.addBox(0, 2.22, 0, 1.6, 0.22, 0.45, 0, 4); // Cross marker
      b.addBox(0, 2.22, 0, 0.45, 0.22, 1.6, 0, 4);
      b.addCylinder(1.4, 2.45, -1.1, 0.32, 0.26, 0.55, 8, 'Y', 1, 2);
      break;
    }

    case 'tech_airport': {
      b.addTrapezoid(0, 0.2, 0, 5.7, 5.7, 5.4, 5.4, 0.4, 0, 0, 3);
      b.addBox(-0.6, 0.46, 0, 3.2, 0.12, 4.6, 0, 4);
      b.addTrapezoid(1.75, 1.5, -1.35, 1.35, 1.35, 0.95, 0.95, 2.2, 0, 0, 0);
      b.addCylinder(1.75, 2.9, -1.35, 0.72, 0.18, 0.38, 8, 'Z', 1, 2);
      break;
    }

    default: {
      // Parametric multi-part models for all remaining canonical units/buildings (Infantry, Air, Naval, Superweapons, Defenses)
      if (def?.isBuilding) {
        const sx = (def.footprintW ?? 2) * 1.85;
        const sz = (def.footprintH ?? 2) * 1.85;
        b.addTrapezoid(0, 0.22, 0, sx, sz, sx * 0.94, sz * 0.94, 0.44, 0, 0, 3);
        if (def.category === 'defense') {
          b.addCylinder(0, 0.92, 0, sx * 0.44, sx * 0.34, 1.35, 10, 'Y', 0, 1);
          b.addTrapezoid(0, 1.8, 0, sx * 0.5, sx * 0.5, sx * 0.38, sx * 0.38, 0.55, 0, 1, 0);
          b.addCylinder(0, 1.85, sx * 0.36, 0.14, 0.12, 1.15, 8, 'Z', 2, 2);
        } else {
          b.addTrapezoid(0, 1.35, 0, sx * 0.8, sz * 0.8, sx * 0.68, sz * 0.68, 2.1, 0, 0, 0);
          b.addCylinder(0, 2.65, 0, Math.min(sx, sz) * 0.22, Math.min(sx, sz) * 0.16, 0.95, 8, 'Y', 1, 2);
        }
      } else if (def?.category === 'infantry') {
        b.addTrapezoid(0, 0.55, 0, 0.52, 0.46, 0.44, 0.4, 0.98, 0, 0, 0);
        b.addCylinder(0, 1.2, 0, 0.2, 0.18, 0.36, 8, 'Y', 1, 2);
        b.addCylinder(0.22, 0.72, 0.36, 0.06, 0.05, 0.72, 6, 'Z', 2, 1);
      } else if (def?.category === 'air') {
        if (def.id === 'kirov') {
          b.addCylinder(0, 0.5, 0, 1.2, 1.2, 4.6, 12, 'Z', 0, 0);
          b.addBox(0, -0.8, 0, 0.75, 0.6, 2.2, 0, 1);
          b.addBox(0, 0.6, -2.0, 2.6, 0.15, 0.8, 0, 2);
        } else {
          b.addTrapezoid(0, 0, 0, 1.35, 3.7, 0.85, 3.1, 0.85, 0.1, 0, 0);
          b.addTrapezoid(0, 0.08, -0.1, 3.9, 1.1, 3.5, 0.65, 0.16, -0.2, 0, 1);
          b.addBox(0, 0.38, 1.15, 0.75, 0.32, 0.85, 0, 2);
        }
      } else if (def?.category === 'naval') {
        b.addTrapezoid(0, 0.56, 0, 2.15, 5.4, 2.45, 5.8, 1.1, 0.2, 0, 0);
        b.addTrapezoid(0, 1.38, -0.5, 1.35, 1.7, 1.1, 1.35, 0.9, 0, 0, 1);
        b.addTrapezoid(0, 1.25, 1.15, 0.85, 0.85, 0.68, 0.68, 0.45, 0, 1, 0);
        b.addCylinder(0, 1.32, 1.85, 0.1, 0.08, 1.25, 8, 'Z', 2, 2);
      } else {
        b.addTrapezoid(0, 0.48, 0, 1.5, 2.2, 1.32, 1.85, 0.68, 0, 0, 0);
        b.addTrackAssembly(-0.85, 0.4, 0, 0.34, 0.55, 2.25, 3, 0);
        b.addTrackAssembly(0.85, 0.4, 0, 0.34, 0.55, 2.25, 3, 0);
        b.addTrapezoid(0, 0.98, -0.1, 1.1, 1.15, 0.85, 0.9, 0.46, 0, 1, 0);
        b.addCylinder(0, 1.0, 0.85, 0.11, 0.095, 1.25, 8, 'Z', 2, 1);
      }
      break;
    }
  }

  return b.build();
}

function writeModelMatrix(out, offset, x, y, z, yaw, scale = 1.0) {
  const c = Math.cos(yaw) * scale;
  const s = Math.sin(yaw) * scale;
  out[offset + 0] = c;  out[offset + 1] = 0;     out[offset + 2] = -s; out[offset + 3] = 0;
  out[offset + 4] = 0;  out[offset + 5] = scale; out[offset + 6] = 0;  out[offset + 7] = 0;
  out[offset + 8] = s;  out[offset + 9] = 0;     out[offset + 10] = c; out[offset + 11] = 0;
  out[offset + 12] = x; out[offset + 13] = y;    out[offset + 14] = z; out[offset + 15] = 1;
}

export function createModelFactory(gl, compileProgram, worldSize) {
  const mainProg = compileProgram(gl, MODEL_VS, MODEL_FS);
  const shadowProg = compileProgram(gl, SHADOW_VS, SHADOW_FS);
  const xrayProg = compileProgram(gl, XRAY_VS, XRAY_FS);

  const loc = {
    uViewProj: gl.getUniformLocation(mainProg, 'uViewProj'),
    uLightViewProj: gl.getUniformLocation(mainProg, 'uLightViewProj'),
    uCamPos: gl.getUniformLocation(mainProg, 'uCamPos'),
    uLightDir: gl.getUniformLocation(mainProg, 'uLightDir'),
    uCamHeight: gl.getUniformLocation(mainProg, 'uCamHeight'),
    uWorldSize: gl.getUniformLocation(mainProg, 'uWorldSize'),
    uNoFog: gl.getUniformLocation(mainProg, 'uNoFog'),
    uShadowTexelSize: gl.getUniformLocation(mainProg, 'uShadowTexelSize'),
    uDetailTex: gl.getUniformLocation(mainProg, 'uDetailTex'),
    uMaterialTex: gl.getUniformLocation(mainProg, 'uMaterialTex'),
    uShadowMap: gl.getUniformLocation(mainProg, 'uShadowMap'),
    uFogTex: gl.getUniformLocation(mainProg, 'uFogTex'),
    uTeamColors: gl.getUniformLocation(mainProg, 'uTeamColors')
  };
  const shadowLightLoc = gl.getUniformLocation(shadowProg, 'uLightViewProj');
  const xrayLoc = {
    uViewProj: gl.getUniformLocation(xrayProg, 'uViewProj'),
    uCamPos: gl.getUniformLocation(xrayProg, 'uCamPos'),
    uWorldSize: gl.getUniformLocation(xrayProg, 'uWorldSize'),
    uNoFog: gl.getUniformLocation(xrayProg, 'uNoFog'),
    uFogTex: gl.getUniformLocation(xrayProg, 'uFogTex'),
    uTeamColors: gl.getUniformLocation(xrayProg, 'uTeamColors')
  };

  const meshes = new Map();
  const teamColorsFlat = new Float32Array([
    ...PLAYER_COLORS[0].rgb,
    ...PLAYER_COLORS[1].rgb,
    ...PLAYER_COLORS[2].rgb,
    ...PLAYER_COLORS[3].rgb
  ]);

  function getOrCreateBatch(typeId) {
    let batch = meshes.get(typeId);
    if (batch) return batch;

    const geom = buildProceduralGeometryData(typeId);
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const ibo = gl.createBuffer();
    const instVbo = gl.createBuffer();
    const capacity = 64;
    const instBuffer = new Float32Array(capacity * FLOATS_PER_INST);

    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, geom.vertices, gl.STATIC_DRAW);
    const stride = FLOATS_PER_VERT * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 32);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 36);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, instVbo);
    gl.bufferData(gl.ARRAY_BUFFER, instBuffer.byteLength, gl.DYNAMIC_DRAW);
    const iStride = FLOATS_PER_INST * 4;
    for (let c = 0; c < 4; c++) {
      gl.enableVertexAttribArray(5 + c);
      gl.vertexAttribPointer(5 + c, 4, gl.FLOAT, false, iStride, c * 16);
      gl.vertexAttribDivisor(5 + c, 1);
    }
    gl.enableVertexAttribArray(9);
    gl.vertexAttribPointer(9, 4, gl.FLOAT, false, iStride, 64);
    gl.vertexAttribDivisor(9, 1);

    gl.bindVertexArray(null);

    batch = {
      typeId,
      vao,
      vbo,
      ibo,
      instVbo,
      indexCount: geom.indexCount,
      capacity,
      instBuffer,
      staticCount: 0,
      dynamicCount: 0
    };
    meshes.set(typeId, batch);
    return batch;
  }

  function ensureCapacity(batch, needed) {
    if (needed <= batch.capacity) return;
    batch.capacity = Math.max(needed * 2, 128);
    batch.instBuffer = new Float32Array(batch.capacity * FLOATS_PER_INST);
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.instVbo);
    gl.bufferData(gl.ARRAY_BUFFER, batch.instBuffer.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  const staticBatches = [];
  const dynamicBatches = [];

  function isRenderableEntity(state, ent, noFog) {
    if (!ent || !ent.alive) return false;
    if (noFog || ent.teamId === 0 || ent.teamId === 3) return true;
    const isHiddenSub = ent.domain === 'SUBMERGED' && !(ent.surfacedTicks > 0);
    const isHiddenStealth = ent.isStealthed && !(ent.revealTicks > 0);
    if (!isHiddenSub && !isHiddenStealth) return true;
    const gx = Math.max(0, Math.min(MAP_SIZE - 1, worldToGrid(ent.x)));
    const gz = Math.max(0, Math.min(MAP_SIZE - 1, worldToGrid(ent.z)));
    const mask = state.fogGrids?.[0]?.[gz * MAP_SIZE + gx] ?? 0;
    return (mask & 6) === 6;
  }

  function syncEntities(state, alpha, uiState = null) {
    const noFog = Boolean(uiState?.noFog);
    staticBatches.length = 0;
    dynamicBatches.length = 0;

    // Reset counts cleanly (zero object allocations)
    for (const batch of meshes.values()) {
      batch.staticCount = 0;
      batch.dynamicCount = 0;
    }

    const counts = new Map();
    for (let i = 0; i < state.entities.length; i++) {
      const ent = state.entities[i];
      if (!isRenderableEntity(state, ent, noFog)) continue;
      counts.set(ent.typeId, (counts.get(ent.typeId) ?? 0) + 1);
    }

    for (const [typeId, n] of counts.entries()) {
      ensureCapacity(getOrCreateBatch(typeId), n);
    }

    // Fill cleanly in 2 passes: buildings first, mobile units second per batch
    for (let i = 0; i < state.entities.length; i++) {
      const ent = state.entities[i];
      if (!isRenderableEntity(state, ent, noFog) || !ent.isBuilding) continue;
      const batch = meshes.get(ent.typeId);
      const slot = batch.staticCount++;
      const off = slot * FLOATS_PER_INST;
      writeModelMatrix(batch.instBuffer, off, ent.x, ent.y, ent.z, ent.yaw);
      batch.instBuffer[off + 16] = ent.turretYaw - ent.yaw;
      batch.instBuffer[off + 17] = ent.recoil;
      batch.instBuffer[off + 18] = ent.hp / Math.max(1, ent.maxHp);
      batch.instBuffer[off + 19] = ent.category === 'neutral' ? 2 : (ent.playerId % 4);
    }
    for (let i = 0; i < state.entities.length; i++) {
      const ent = state.entities[i];
      if (!isRenderableEntity(state, ent, noFog) || ent.isBuilding) continue;
      const batch = meshes.get(ent.typeId);
      const slot = batch.staticCount + batch.dynamicCount++;
      const off = slot * FLOATS_PER_INST;
      const ix = ent.prevX + (ent.x - ent.prevX) * alpha;
      const iy = ent.prevY + (ent.y - ent.prevY) * alpha;
      const iz = ent.prevZ + (ent.z - ent.prevZ) * alpha;
      writeModelMatrix(batch.instBuffer, off, ix, iy, iz, ent.yaw);
      batch.instBuffer[off + 16] = ent.turretYaw - ent.yaw;
      batch.instBuffer[off + 17] = ent.recoil;
      batch.instBuffer[off + 18] = ent.hp / Math.max(1, ent.maxHp);
      batch.instBuffer[off + 19] = ent.playerId % 4;
    }

    for (const batch of meshes.values()) {
      const total = batch.staticCount + batch.dynamicCount;
      if (total === 0) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, batch.instVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.instBuffer.subarray(0, total * FLOATS_PER_INST));
      if (batch.staticCount > 0) staticBatches.push(batch);
      if (batch.dynamicCount > 0) dynamicBatches.push(batch);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  function renderShadowPass(lightViewProj, onlyStatic, ctx) {
    gl.useProgram(shadowProg);
    gl.uniformMatrix4fv(shadowLightLoc, false, lightViewProj);
    const list = onlyStatic ? staticBatches : dynamicBatches;
    for (let i = 0; i < list.length; i++) {
      const batch = list[i];
      const count = onlyStatic ? batch.staticCount : batch.dynamicCount;
      if (count <= 0) continue;
      const baseInstanceOffset = onlyStatic ? 0 : batch.staticCount;
      gl.bindVertexArray(batch.vao);
      // Adjust attribute base pointer cleanly when drawing dynamic subset after static subset
      if (baseInstanceOffset > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, batch.instVbo);
        const iStride = FLOATS_PER_INST * 4;
        const byteOff = baseInstanceOffset * iStride;
        for (let c = 0; c < 4; c++) {
          gl.vertexAttribPointer(5 + c, 4, gl.FLOAT, false, iStride, byteOff + c * 16);
        }
        gl.vertexAttribPointer(9, 4, gl.FLOAT, false, iStride, byteOff + 64);
      }
      gl.drawElementsInstanced(gl.TRIANGLES, batch.indexCount, gl.UNSIGNED_SHORT, 0, count);
      ctx.calls++;
      if (baseInstanceOffset > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, batch.instVbo);
        const iStride = FLOATS_PER_INST * 4;
        for (let c = 0; c < 4; c++) {
          gl.vertexAttribPointer(5 + c, 4, gl.FLOAT, false, iStride, c * 16);
        }
        gl.vertexAttribPointer(9, 4, gl.FLOAT, false, iStride, 64);
      }
    }
    gl.bindVertexArray(null);
  }

  function renderMainPass(ctx) {
    gl.useProgram(mainProg);
    gl.uniformMatrix4fv(loc.uViewProj, false, ctx.viewProj);
    gl.uniformMatrix4fv(loc.uLightViewProj, false, ctx.lightViewProj);
    gl.uniform3fv(loc.uCamPos, ctx.camPos);
    gl.uniform3fv(loc.uLightDir, ctx.lightDir);
    gl.uniform1f(loc.uCamHeight, ctx.camHeight);
    gl.uniform1f(loc.uWorldSize, worldSize);
    gl.uniform1f(loc.uNoFog, ctx.noFog ? 1.0 : 0.0);
    gl.uniform1f(loc.uShadowTexelSize, 1.0 / ctx.shadowSize);
    gl.uniform3fv(loc.uTeamColors, teamColorsFlat);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ctx.pbr.detailTex);
    gl.uniform1i(loc.uDetailTex, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ctx.pbr.materialTex);
    gl.uniform1i(loc.uMaterialTex, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, ctx.shadowTex);
    gl.uniform1i(loc.uShadowMap, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, ctx.fogTex);
    gl.uniform1i(loc.uFogTex, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    for (const batch of meshes.values()) {
      const total = batch.staticCount + batch.dynamicCount;
      if (total === 0) continue;
      gl.bindVertexArray(batch.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, batch.indexCount, gl.UNSIGNED_SHORT, 0, total);
      ctx.calls++;
    }
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  function renderXRayPass(ctx) {
    if (dynamicBatches.length === 0) return;
    gl.useProgram(xrayProg);
    gl.uniformMatrix4fv(xrayLoc.uViewProj, false, ctx.viewProj);
    gl.uniform3fv(xrayLoc.uCamPos, ctx.camPos);
    gl.uniform1f(xrayLoc.uWorldSize, worldSize);
    gl.uniform1f(xrayLoc.uNoFog, ctx.noFog ? 1.0 : 0.0);
    gl.uniform3fv(xrayLoc.uTeamColors, teamColorsFlat);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ctx.fogTex);
    gl.uniform1i(xrayLoc.uFogTex, 0);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.GREATER);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.CULL_FACE);

    for (let i = 0; i < dynamicBatches.length; i++) {
      const batch = dynamicBatches[i];
      if (batch.dynamicCount <= 0) continue;
      gl.bindVertexArray(batch.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, batch.indexCount, gl.UNSIGNED_SHORT, 0, batch.dynamicCount);
      ctx.calls++;
    }

    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  // Pre-warm M1 core meshes cleanly at startup
  for (const id of ['conyard', 'power_plant', 'refinery', 'war_factory', 'mcv', 'harvester', 'grizzly', 'rhino']) {
    getOrCreateBatch(id);
  }

  return {
    canonicalCount: CANONICAL_ENTITY_IDS.length,
    syncEntities,
    renderShadowPass,
    renderMainPass,
    renderXRayPass,
    dispose() {
      gl.deleteProgram(mainProg);
      gl.deleteProgram(shadowProg);
      gl.deleteProgram(xrayProg);
      for (const b of meshes.values()) {
        gl.deleteVertexArray(b.vao);
        gl.deleteBuffer(b.vbo);
        gl.deleteBuffer(b.ibo);
        gl.deleteBuffer(b.instVbo);
      }
      meshes.clear();
    }
  };
}
