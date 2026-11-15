// Single Draw Call Multi-Part Vertex-Articulated InstancedMesh Model Factory.
// Vertex layout (10 floats): pos(3), normal(3), uv(2), aPartId(1), aTone(1).
// Per-instance layout (20 floats): aInstanceMatrix(mat4=16) + aUnitState(vec4: turretDeltaYaw, recoil, hpRatio, teamAndFlags).

import { CANONICAL_ENTITY_IDS, ENTITY_DEFS, FACTIONS, PLAYER_COLORS } from '../core/config.js';
import { MAP_SIZE, worldToGrid } from './map.js';
import { PCSS_GLSL } from '../render/shadow.js';
import { fetchAndParseGlb } from './glbLoader.js';

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

  vec4 detail = texture(uDetailTex, vUv * 0.75);
  vec4 mat = texture(uMaterialTex, vUv * 0.75);

  vec3 baseCol;
  float metallic = mat.a;
  float roughness = mat.b;
  float glassFactor = 0.0;

  if (vTone < 0.5) {
    // Tone 0: Primary dark gunsteel / titanium chassis armor (concept-art silhouette steel, subtle 16% faction tint)
    vec3 gunSteel = mix(vec3(0.20, 0.22, 0.26), teamCol * 0.65, 0.16);
    float microGrain = 0.90 + detail.r * 0.18 - detail.g * 0.08;
    baseCol = gunSteel * microGrain;
    metallic = clamp(metallic + 0.18, 0.0, 0.96);
    roughness = clamp(roughness * 0.85, 0.18, 0.75);
  } else if (vTone < 1.5) {
    // Tone 1: Matte rubber tracks, tires & oiled dark rifle gunmetal
    float treadRib = 0.80 + 0.20 * step(0.45, fract(vUv.y * 10.0));
    baseCol = vec3(0.065, 0.07, 0.082) * (0.86 + detail.r * 0.20) * treadRib;
    metallic = 0.35;
    roughness = 0.74;
  } else if (vTone < 2.5) {
    // Tone 2: Glowing energy core / optical visor / afterburner thruster
    baseCol = mix(teamCol * 1.65, vec3(0.98, 0.88, 0.44), 0.26);
    metallic = 0.15;
    roughness = 0.12;
  } else if (vTone < 3.5) {
    // Tone 3: Brushed titanium alloy trim / concrete plinth / copper coil
    baseCol = vec3(0.42, 0.40, 0.37) * (0.88 + detail.r * 0.18);
    metallic = 0.36;
    roughness = 0.58;
  } else if (vTone < 4.5) {
    // Tone 4: High-contrast industrial hazard chevron stripes
    float stripe = step(0.5, fract((vWorldPos.x + vWorldPos.z) * 1.65));
    baseCol = mix(vec3(0.08, 0.08, 0.09), vec3(0.92, 0.66, 0.10), stripe);
    metallic = 0.30;
    roughness = 0.48;
  } else if (vTone < 5.5) {
    // Tone 5: Crisp faction livery accent (turret stripes, pauldrons, wing tips, hull trim)
    vec3 trimSteel = mix(teamCol * 0.92, teamCol * 0.65 + vec3(0.08), detail.g * 0.35);
    baseCol = trimSteel * (0.90 + detail.r * 0.18);
    metallic = 0.55;
    roughness = 0.34;
  } else if (vTone < 6.5) {
    // Tone 6: Reflective tinted glass cockpit canopy & prism crystal refraction
    baseCol = mix(vec3(0.04, 0.14, 0.22), teamCol * 0.55, 0.38);
    metallic = 0.42;
    roughness = 0.07;
    glassFactor = 1.0;
  } else {
    // Tone 7: Woven tactical khaki / sandbags / cloth uniform
    baseCol = vec3(0.36, 0.32, 0.22) * (0.86 + detail.r * 0.22);
    metallic = 0.02;
    roughness = 0.90;
  }

  // < 50% HP charred battle-damage mask
  float dmgMask = smoothstep(0.55, 0.12, hpRatio) * smoothstep(0.32, 0.72, detail.r + detail.b * 0.35);
  baseCol = mix(baseCol, vec3(0.035, 0.032, 0.03), dmgMask * 0.86);
  roughness = mix(roughness, 0.92, dmgMask);

  // Derivative micro-normal relief from baked PBR normal XY + edge-highlight crispness
  vec3 N = normalize(vNormal);
  vec2 nPerturb = (mat.rg - 0.5) * mix(0.28, 0.05, glassFactor);
  vec3 dp1 = dFdx(vWorldPos);
  vec3 dp2 = dFdy(vWorldPos);
  vec2 duv1 = dFdx(vUv);
  vec2 duv2 = dFdy(vUv);
  vec3 dp2perp = cross(dp2, N);
  vec3 dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invMax = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-6);
  if (invMax < 1e4) {
    N = normalize(N + (T * nPerturb.x + B * nPerturb.y) * invMax);
  }

  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(V + L);

  float NdotL = max(dot(N, L), 0.0);
  float specPow = mix(18.0, 140.0, 1.0 - roughness);
  float spec = pow(max(dot(N, H), 0.0), specPow) * mix(0.28, 1.45, max(metallic, glassFactor));

  vec3 proj = (vShadowPos.xyz / vShadowPos.w) * 0.5 + 0.5;
  float shadow = sampleShadowPCSS(uShadowMap, proj, 0.0022, uShadowTexelSize);

  vec3 ambient = baseCol * (0.26 + 0.18 * max(N.y, 0.0)) * detail.a;
  vec3 direct = (baseCol * 1.25 + vec3(spec)) * NdotL * mix(0.26, 1.0, shadow);

  // Height-adaptive faction Fresnel rim + glossy canopy sky reflection
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  float rimScale = mix(0.18, 1.05, smoothstep(16.0, 68.0, uCamHeight));
  vec3 rim = teamCol * fresnel * rimScale + vec3(0.45, 0.65, 0.88) * fresnel * glassFactor * 0.85;

  // Emissive energy core + subtle crystal internal glow + Low-HP embers
  vec3 emissive = (vTone > 1.5 && vTone < 2.5) ? baseCol * 0.82 : vec3(0.0);
  emissive += teamCol * glassFactor * 0.14;
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

  function addSmoothTri(p0, n0, u0, v0, p1, n1, u1, v1, p2, n2, u2, v2, partId, tone) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const avgNx = n0[0] + n1[0] + n2[0];
    const avgNy = n0[1] + n1[1] + n2[1];
    const avgNz = n0[2] + n1[2] + n2[2];
    const dot = cx * avgNx + cy * avgNy + cz * avgNz;
    const base = vertCount;

    const pushV = (p, n, u, v) => {
      verts.push(p[0], p[1], p[2], n[0], n[1], n[2], u, v, partId, tone);
      vertCount++;
    };
    pushV(p0, n0, u0, v0);
    if (dot >= 0) {
      pushV(p1, n1, u1, v1);
      pushV(p2, n2, u2, v2);
    } else {
      pushV(p2, n2, u2, v2);
      pushV(p1, n1, u1, v1);
    }
    indices.push(base, base + 1, base + 2);
  }

  // Chamfered / beveled armor block (adds sloped 45-degree specular rim catches!)
  function addBeveledBox(cx, cy, cz, sx, sy, sz, bevel = 0.08, partId = 0, tone = 0) {
    const b = Math.min(bevel, sx * 0.25, sy * 0.32, sz * 0.25);
    const botH = sy * 0.22;
    const midH = sy - b * 2;
    if (b < 0.015 || midH <= 0.02) {
      addBox(cx, cy, cz, sx, sy, sz, partId, tone);
      return;
    }
    addTrapezoid(cx, cy + sy * 0.5 - b * 0.5, cz, sx, sz, sx - b * 2, sz - b * 2, b, 0, partId, tone);
    addBox(cx, cy, cz, sx, Math.max(0.02, sy - b * 2), sz, partId, tone);
    addTrapezoid(cx, cy - sy * 0.5 + b * 0.5, cz, sx - b * 1.4, sz - b * 1.4, sx, sz, b, 0, partId, tone);
    void botH;
  }

  // Smooth revolved lathe body along axis 'Y' or 'Z'. profile = [[coordAlongAxis, radius], ...]
  function addLathe(cx, cy, cz, profile, segs = 16, axis = 'Y', partId = 0, tone = 0) {
    if (!profile || profile.length < 2) return;
    // Compute per-ring tangent-based outward slope normals along profile
    const ringSlope = [];
    for (let j = 0; j < profile.length; j++) {
      const prev = profile[Math.max(0, j - 1)];
      const next = profile[Math.min(profile.length - 1, j + 1)];
      const da = next[0] - prev[0];
      const dr = next[1] - prev[1];
      const len = Math.hypot(da, dr) || 1;
      // Outward radial weight = da / len, axial weight = -dr / len
      ringSlope.push([da / len, -dr / len]);
    }

    const toWorld = (axCoord, rad, ang) => {
      const c = Math.cos(ang), s = Math.sin(ang);
      if (axis === 'Z') return [cx + c * rad, cy + s * rad, cz + axCoord];
      if (axis === 'X') return [cx + axCoord, cy + c * rad, cz + s * rad];
      return [cx + c * rad, cy + axCoord, cz + s * rad];
    };
    const toNorm = (rw, aw, ang) => {
      const c = Math.cos(ang), s = Math.sin(ang);
      let nx, ny, nz;
      if (axis === 'Z') { nx = c * rw; ny = s * rw; nz = aw; }
      else if (axis === 'X') { nx = aw; ny = c * rw; nz = s * rw; }
      else { nx = c * rw; ny = aw; nz = s * rw; }
      const len = Math.hypot(nx, ny, nz) || 1;
      return [nx / len, ny / len, nz / len];
    };

    for (let j = 0; j < profile.length - 1; j++) {
      const [a0, r0] = profile[j];
      const [a1, r1] = profile[j + 1];
      if (r0 <= 0.001 && r1 <= 0.001) continue;
      const [rw0, aw0] = ringSlope[j];
      const [rw1, aw1] = ringSlope[j + 1];
      const v0 = j / (profile.length - 1);
      const v1 = (j + 1) / (profile.length - 1);

      for (let i = 0; i < segs; i++) {
        const ang0 = (i / segs) * Math.PI * 2;
        const ang1 = ((i + 1) / segs) * Math.PI * 2;
        const u0 = i / segs, u1 = (i + 1) / segs;

        const p00 = toWorld(a0, r0, ang0), n00 = toNorm(rw0, aw0, ang0);
        const p10 = toWorld(a0, r0, ang1), n10 = toNorm(rw0, aw0, ang1);
        const p01 = toWorld(a1, r1, ang0), n01 = toNorm(rw1, aw1, ang0);
        const p11 = toWorld(a1, r1, ang1), n11 = toNorm(rw1, aw1, ang1);

        if (r0 > 0.001 && r1 > 0.001) {
          addSmoothTri(p00, n00, u0, v0, p10, n10, u1, v0, p11, n11, u1, v1, partId, tone);
          addSmoothTri(p00, n00, u0, v0, p11, n11, u1, v1, p01, n01, u0, v1, partId, tone);
        } else if (r0 <= 0.001) {
          addSmoothTri(p00, n00, u0, v0, p11, n11, u1, v1, p01, n01, u0, v1, partId, tone);
        } else {
          addSmoothTri(p00, n00, u0, v0, p10, n10, u1, v0, p11, n11, u1, v1, partId, tone);
        }
      }
    }
  }

  // Smooth Torus ring (ideal for Chrono Sphere gyros & Tesla Coil HV toroids)
  function addTorus(cx, cy, cz, majorR, minorR, majorSegs = 20, minorSegs = 10, tiltX = 0, tiltZ = 0, partId = 0, tone = 0) {
    const cxRot = Math.cos(tiltX), sxRot = Math.sin(tiltX);
    const czRot = Math.cos(tiltZ), szRot = Math.sin(tiltZ);
    const rotPt = (x, y, z) => {
      // Rotate X then Z
      const y1 = y * cxRot - z * sxRot;
      const z1 = y * sxRot + z * cxRot;
      const x2 = x * czRot - y1 * szRot;
      const y2 = x * szRot + y1 * czRot;
      return [x2, y2, z1];
    };
    const pt = (uAng, vAng) => {
      const cu = Math.cos(uAng), su = Math.sin(uAng);
      const cv = Math.cos(vAng), sv = Math.sin(vAng);
      const r = majorR + minorR * cv;
      const [px, py, pz] = rotPt(r * cu, minorR * sv, r * su);
      const [nx, ny, nz] = rotPt(cv * cu, sv, cv * su);
      return { p: [cx + px, cy + py, cz + pz], n: [nx, ny, nz] };
    };
    for (let i = 0; i < majorSegs; i++) {
      const u0 = (i / majorSegs) * Math.PI * 2;
      const u1 = ((i + 1) / majorSegs) * Math.PI * 2;
      for (let j = 0; j < minorSegs; j++) {
        const v0 = (j / minorSegs) * Math.PI * 2;
        const v1 = ((j + 1) / minorSegs) * Math.PI * 2;
        const a = pt(u0, v0), b = pt(u1, v0), c = pt(u1, v1), d = pt(u0, v1);
        addSmoothTri(a.p, a.n, i / majorSegs, j / minorSegs, b.p, b.n, (i + 1) / majorSegs, j / minorSegs, c.p, c.n, (i + 1) / majorSegs, (j + 1) / minorSegs, partId, tone);
        addSmoothTri(a.p, a.n, i / majorSegs, j / minorSegs, c.p, c.n, (i + 1) / majorSegs, (j + 1) / minorSegs, d.p, d.n, i / majorSegs, (j + 1) / minorSegs, partId, tone);
      }
    }
  }

  // Swept airfoil wing prism (side: -1 left, +1 right)
  function addSweptWing(side, rootX, y, rootZ, span, rootChord, tipChord, sweepBack, dihedral = 0, thick = 0.12, partId = 0, tone = 0) {
    const tipX = rootX + side * span;
    const tipY = y + dihedral;
    const tipZ = rootZ - sweepBack;
    const ht = thick * 0.5;
    const htt = thick * 0.25;
    const rLE = rootZ + rootChord * 0.5, rTE = rootZ - rootChord * 0.5;
    const tLE = tipZ + tipChord * 0.5, tTE = tipZ - tipChord * 0.5;

    const p = {
      rlTop: [rootX, y + ht, rLE], rtTop: [rootX, y + ht * 0.5, rTE],
      tlTop: [tipX, tipY + htt, tLE], ttTop: [tipX, tipY + htt * 0.5, tTE],
      rlBot: [rootX, y - ht, rLE], rtBot: [rootX, y - ht * 0.5, rTE],
      tlBot: [tipX, tipY - htt, tLE], ttBot: [tipX, tipY - htt * 0.5, tTE]
    };
    addQuadAuto(p.rlTop, p.tlTop, p.ttTop, p.rtTop, partId, tone);
    addQuadAuto(p.rlBot, p.rtBot, p.ttBot, p.tlBot, partId, tone);
    addQuadAuto(p.rlBot, p.tlBot, p.tlTop, p.rlTop, partId, tone);
    addQuadAuto(p.rtTop, p.ttTop, p.ttBot, p.rtBot, partId, tone);
    addQuadAuto(p.tlBot, p.ttBot, p.ttTop, p.tlTop, partId, tone);
  }

  // Smooth rounded capsule / organic silhouette part
  function addCapsule(cx, cy, cz, r, cylLen, axis = 'Y', segs = 12, partId = 0, tone = 0) {
    const hl = cylLen * 0.5;
    const prof = [];
    for (let k = 0; k <= 4; k++) {
      const t = (k / 4) * Math.PI * 0.5;
      prof.push([-hl - Math.cos(t) * r, Math.sin(t) * r]);
    }
    for (let k = 0; k <= 4; k++) {
      const t = (k / 4) * Math.PI * 0.5;
      prof.push([hl + Math.sin(t) * r, Math.cos(t) * r]);
    }
    addLathe(cx, cy, cz, prof, segs, axis, partId, tone);
  }

  return {
    addBox,
    addBeveledBox,
    addTrapezoid,
    addTrackAssembly,
    addCylinder,
    addLathe,
    addTorus,
    addSweptWing,
    addCapsule,
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
      // Abyssal Grizzly MBT: Dark titanium glacis + Tone 5 Abyssal shoulder stripes + beveled composite turret
      b.addTrapezoid(0, 0.48, 0.05, 1.56, 2.9, 1.4, 2.3, 0.64, -0.15, 0, 0);
      b.addBeveledBox(0, 0.78, 0.85, 1.25, 0.14, 0.75, 0.04, 0, 5); // Faction stripe on upper glacis
      b.addBox(0, 0.72, 1.32, 1.12, 0.12, 0.14, 0, 2); // Twin LED headlights
      b.addBeveledBox(-0.98, 0.56, 0, 0.18, 0.36, 2.92, 0.04, 0, 0); // Armored mudguard skirts
      b.addBeveledBox(0.98, 0.56, 0, 0.18, 0.36, 2.92, 0.04, 0, 0);
      b.addTrackAssembly(-0.92, 0.42, 0, 0.46, 0.66, 3.05, 4, 0);
      b.addTrackAssembly(0.92, 0.42, 0, 0.46, 0.66, 3.05, 4, 0);
      b.addBeveledBox(0, 0.84, -1.02, 1.34, 0.24, 0.64, 0.04, 0, 1); // Rear engine grill deck
      // Chamfered turret (part 1) + faction cheek accents + glass optic + bustle rack
      b.addTrapezoid(0, 1.08, -0.1, 1.52, 1.72, 1.14, 1.22, 0.54, -0.1, 1, 0);
      b.addBeveledBox(0, 1.12, -1.04, 1.12, 0.32, 0.38, 0.05, 1, 1);
      b.addBeveledBox(-0.68, 1.08, 0.15, 0.24, 0.32, 0.82, 0.05, 1, 5); // Crisp faction turret stripe
      b.addBeveledBox(0.68, 1.08, 0.15, 0.24, 0.32, 0.82, 0.05, 1, 5);
      b.addCylinder(0.34, 1.4, -0.25, 0.24, 0.22, 0.18, 12, 'Y', 1, 3);
      b.addBeveledBox(0.32, 1.42, 0.04, 0.24, 0.12, 0.16, 0.02, 1, 6); // Tinted optic glass
      b.addBox(-0.34, 1.4, -0.28, 0.22, 0.14, 0.22, 1, 1);
      // 105mm stabilized cannon (part 2) with fume extractor
      b.addCylinder(0, 1.08, 1.44, 0.095, 0.08, 2.02, 12, 'Z', 2, 1);
      b.addCylinder(0, 1.08, 1.15, 0.145, 0.145, 0.38, 12, 'Z', 2, 3);
      b.addCylinder(0, 1.08, 2.38, 0.125, 0.125, 0.18, 12, 'Z', 2, 1);
      b.addBox(0.28, 1.12, 0.88, 0.08, 0.08, 0.5, 2, 1);
      break;
    }

    case 'rhino': {
      // Crimson Rhino Heavy Tank: Dark iron prow + Tone 5 crimson plates + external fuel drums + heavy cannon
      b.addTrapezoid(0, 0.54, 0.05, 1.82, 3.25, 1.62, 2.6, 0.74, -0.15, 0, 0);
      b.addBeveledBox(0, 0.82, 0.96, 1.42, 0.14, 0.7, 0.04, 0, 5); // Crimson upper glacis plate
      b.addBox(0, 0.78, 1.42, 1.32, 0.16, 0.16, 0, 4); // Hazard bumper trim
      b.addBeveledBox(-1.14, 0.64, 0, 0.18, 0.4, 3.15, 0.04, 0, 0);
      b.addBeveledBox(1.14, 0.64, 0, 0.18, 0.4, 3.15, 0.04, 0, 0);
      b.addTrackAssembly(-1.08, 0.46, 0, 0.52, 0.76, 3.35, 5, 0);
      b.addTrackAssembly(1.08, 0.46, 0, 0.52, 0.76, 3.35, 5, 0);
      b.addCylinder(-0.52, 0.84, -1.58, 0.21, 0.21, 0.62, 12, 'X', 0, 5); // Crimson fuel drums
      b.addCylinder(0.52, 0.84, -1.58, 0.21, 0.21, 0.62, 12, 'X', 0, 5);
      // Heavy sloped turret (part 1) + crimson ERA armor cheeks + rangefinder
      b.addTrapezoid(0, 1.2, -0.08, 1.7, 1.9, 1.32, 1.42, 0.64, -0.08, 1, 0);
      b.addBeveledBox(-0.72, 1.2, 0.25, 0.3, 0.34, 0.78, 0.05, 1, 5);
      b.addBeveledBox(0.72, 1.2, 0.25, 0.3, 0.34, 0.78, 0.05, 1, 5);
      b.addCylinder(-0.38, 1.58, -0.25, 0.26, 0.24, 0.2, 12, 'Y', 1, 3);
      b.addBeveledBox(0.38, 1.48, 0.18, 0.24, 0.14, 0.22, 0.03, 1, 6);
      // 120mm heavy gun + slotted muzzle brake (part 2)
      b.addCylinder(0, 1.2, 1.58, 0.13, 0.11, 2.2, 12, 'Z', 2, 1);
      b.addCylinder(0, 1.2, 1.26, 0.175, 0.175, 0.42, 12, 'Z', 2, 3);
      b.addBeveledBox(0, 1.2, 2.58, 0.34, 0.26, 0.32, 0.04, 2, 1);
      break;
    }

    case 'apocalypse': {
      // Mammoth Twin-Cannon Apocalypse: Quad articulated tracks, beveled dark steel hull + Crimson livery & twin SAM pods
      b.addTrapezoid(0, 0.64, 0, 2.28, 3.85, 1.98, 3.15, 0.84, -0.1, 0, 0);
      b.addBeveledBox(0, 0.98, 1.15, 1.72, 0.18, 0.85, 0.05, 0, 5);
      b.addBeveledBox(0, 0.96, -1.25, 1.75, 0.28, 0.85, 0.05, 0, 1);
      b.addTrackAssembly(-1.34, 0.48, 1.04, 0.56, 0.74, 1.72, 3, 0);
      b.addTrackAssembly(1.34, 0.48, 1.04, 0.56, 0.74, 1.72, 3, 0);
      b.addTrackAssembly(-1.34, 0.48, -1.04, 0.56, 0.74, 1.72, 3, 0);
      b.addTrackAssembly(1.34, 0.48, -1.04, 0.56, 0.74, 1.72, 3, 0);
      // Massive beveled turret + twin side Mammoth SAM pods + faction cheek plates
      b.addTrapezoid(0, 1.4, -0.15, 2.0, 2.15, 1.6, 1.62, 0.72, -0.1, 1, 0);
      b.addBeveledBox(-0.88, 1.4, 0.12, 0.28, 0.42, 1.15, 0.05, 1, 5);
      b.addBeveledBox(0.88, 1.4, 0.12, 0.28, 0.42, 1.15, 0.05, 1, 5);
      b.addBeveledBox(-0.82, 1.76, -0.52, 0.48, 0.44, 0.78, 0.05, 1, 5); // Left AA SAM pod
      b.addBeveledBox(0.82, 1.76, -0.52, 0.48, 0.44, 0.78, 0.05, 1, 5); // Right AA SAM pod
      b.addBox(-0.82, 1.78, -0.1, 0.36, 0.3, 0.08, 1, 2);
      b.addBox(0.82, 1.78, -0.1, 0.36, 0.3, 0.08, 1, 2);
      b.addBeveledBox(0, 1.78, 0.26, 0.48, 0.16, 0.28, 0.03, 1, 6); // Optic visor
      // Twin 120mm cannons + heavy muzzle brakes (part 2)
      b.addCylinder(-0.36, 1.4, 1.74, 0.13, 0.11, 2.25, 12, 'Z', 2, 1);
      b.addCylinder(0.36, 1.4, 1.74, 0.13, 0.11, 2.25, 12, 'Z', 2, 1);
      b.addCylinder(-0.36, 1.4, 1.28, 0.17, 0.17, 0.42, 12, 'Z', 2, 3);
      b.addCylinder(0.36, 1.4, 1.28, 0.17, 0.17, 0.42, 12, 'Z', 2, 3);
      b.addBeveledBox(-0.36, 1.4, 2.74, 0.28, 0.24, 0.28, 0.04, 2, 1);
      b.addBeveledBox(0.36, 1.4, 2.74, 0.28, 0.24, 0.28, 0.04, 2, 1);
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
      // Beveled steel plinth, tapered strut legs, faceted prism crystal core (Tone 6) + emitter lenses (Tone 2)
      b.addTrapezoid(0, 0.2, 0, 2.0, 2.0, 1.75, 1.75, 0.4, 0, 0, 3);
      b.addTrapezoid(0, 1.4, 0, 1.35, 1.35, 0.62, 0.62, 2.05, 0, 0, 0);
      for (const [lx, lz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) {
        b.addBeveledBox(lx * 0.85, 1.05, lz * 0.85, 0.24, 1.55, 0.24, 0.04, 0, 5);
      }
      // Focusing crystal spire
      b.addLathe(0, 2.95, 0, [[-0.52, 0.02], [-0.25, 0.36], [0.15, 0.32], [0.55, 0.02]], 8, 'Y', 1, 6);
      b.addCylinder(0, 2.38, 0, 0.52, 0.46, 0.18, 12, 'Y', 1, 2);
      b.addBeveledBox(-0.52, 2.75, 0, 0.14, 0.72, 0.34, 0.03, 1, 3);
      b.addBeveledBox(0.52, 2.75, 0, 0.14, 0.72, 0.34, 0.03, 1, 3);
      break;
    }

    case 'tesla_coil': {
      // Heavy copper-wound shaft + 3 smooth chrome Torus rings + glossy silver HV discharge sphere
      b.addTrapezoid(0, 0.2, 0, 2.0, 2.0, 1.72, 1.72, 0.4, 0, 0, 3);
      b.addBeveledBox(0, 0.58, 0, 1.42, 0.36, 1.42, 0.06, 0, 0);
      b.addCylinder(0, 1.45, 0, 0.44, 0.26, 1.85, 14, 'Y', 0, 5);
      for (const [ry, mr] of [[1.15, 0.68], [1.68, 0.58], [2.18, 0.48]]) {
        b.addTorus(0, ry, 0, mr, 0.095, 20, 10, 0, 0, 0, 3);
      }
      b.addCapsule(0, 2.68, 0, 0.36, 0.02, 'Y', 16, 1, 6); // Mirror HV ball + cyan plasma halo
      b.addTorus(0, 2.68, 0, 0.42, 0.04, 16, 8, 0, 0, 1, 2);
      break;
    }

    case 'gi': {
      // Tactical GI behind curved layered sandbags with deployed LMG + NATO helmet + Tone 5 blue pauldrons
      // Curved sandbag breastwork (Tone 7 khaki cloth)
      for (let i = -2; i <= 2; i++) {
        const ax = i * 0.22;
        const az = 0.54 - Math.abs(i) * 0.07;
        b.addCapsule(ax, 0.14, az, 0.11, 0.16, 'X', 10, 0, 7);
        if (Math.abs(i) <= 1) b.addCapsule(ax, 0.32, az - 0.02, 0.105, 0.15, 'X', 10, 0, 7);
      }
      // Trooper legs, armored vest, blue shoulder pads, arms, NATO helmet & visor
      b.addCapsule(-0.12, 0.34, -0.05, 0.095, 0.36, 'Y', 10, 0, 1);
      b.addCapsule(0.12, 0.34, -0.05, 0.095, 0.36, 'Y', 10, 0, 1);
      b.addBeveledBox(0, 0.72, -0.04, 0.42, 0.46, 0.3, 0.06, 0, 0);
      b.addBeveledBox(-0.26, 0.84, -0.04, 0.14, 0.18, 0.26, 0.04, 0, 5); // Abyssal blue pauldron
      b.addBeveledBox(0.26, 0.84, -0.04, 0.14, 0.18, 0.26, 0.04, 0, 5);
      b.addCapsule(0, 1.12, 0, 0.19, 0.06, 'Y', 12, 1, 5); // NATO helmet dome
      b.addBox(0, 1.08, 0.14, 0.22, 0.08, 0.12, 1, 6); // Tinted visor
      // Heavy deployed LMG + bipod
      b.addCylinder(0.16, 0.72, 0.48, 0.048, 0.042, 0.88, 10, 'Z', 2, 1);
      b.addBox(0.16, 0.66, 0.36, 0.12, 0.16, 0.18, 2, 7); // Ammo box
      break;
    }

    case 'conscript': {
      // Soviet-style Crimson Greatcoat Conscript: khaki trenchcoat, crimson collar/pads, ushanka cap, AK rifle
      b.addCylinder(0, 0.34, 0, 0.24, 0.18, 0.56, 12, 'Y', 0, 7); // Trenchcoat flare
      b.addBeveledBox(0, 0.76, 0, 0.4, 0.44, 0.28, 0.05, 0, 5); // Crimson breastplate/coat
      b.addBeveledBox(-0.24, 0.84, 0, 0.12, 0.18, 0.22, 0.04, 0, 0);
      b.addBeveledBox(0.24, 0.84, 0, 0.12, 0.18, 0.22, 0.04, 0, 0);
      b.addCylinder(0, 1.14, 0, 0.19, 0.17, 0.26, 12, 'Y', 1, 1); // Fur ushanka
      b.addBox(0, 1.16, 0.14, 0.12, 0.08, 0.08, 1, 5);
      b.addCylinder(0.2, 0.76, 0.42, 0.04, 0.032, 0.92, 10, 'Z', 2, 1); // Assault rifle
      break;
    }

    case 'flak_trooper': {
      // Heavy Flak Trooper: khaki fatigues + dark armored vest + twin flak fuel tanks + shoulder flak cannon
      b.addCapsule(-0.12, 0.3, 0, 0.1, 0.36, 'Y', 10, 0, 7);
      b.addCapsule(0.12, 0.3, 0, 0.1, 0.36, 'Y', 10, 0, 7);
      b.addBeveledBox(0, 0.74, 0, 0.48, 0.5, 0.34, 0.06, 0, 0);
      b.addCapsule(-0.16, 0.76, -0.26, 0.11, 0.36, 'Y', 10, 0, 5); // Twin crimson flak cylinders
      b.addCapsule(0.16, 0.76, -0.26, 0.11, 0.36, 'Y', 10, 0, 5);
      b.addCapsule(0, 1.14, 0, 0.19, 0.06, 'Y', 12, 1, 0);
      b.addCylinder(0.26, 0.9, 0.44, 0.11, 0.095, 1.02, 12, 'Z', 2, 1); // Heavy flak cannon
      break;
    }

    case 'engineer': {
      // Hazard Yellow Engineer: articulated yellow suit, armored gray chest, hard hat, wrench/repair pack
      b.addCapsule(-0.11, 0.28, 0, 0.09, 0.34, 'Y', 10, 0, 4);
      b.addCapsule(0.11, 0.28, 0, 0.09, 0.34, 'Y', 10, 0, 4);
      b.addBeveledBox(0, 0.7, 0, 0.42, 0.44, 0.28, 0.05, 0, 0);
      b.addBeveledBox(0, 0.72, -0.22, 0.34, 0.4, 0.2, 0.04, 0, 4); // Hazard toolkit
      b.addCapsule(0, 1.1, 0, 0.19, 0.05, 'Y', 12, 1, 4); // Yellow hard-hat
      b.addBox(0, 1.08, 0.15, 0.2, 0.07, 0.08, 1, 6);
      b.addBeveledBox(0.24, 0.68, 0.26, 0.1, 0.12, 0.44, 0.02, 2, 3); // Steel tool
      break;
    }

    case 'rocketeer': {
      // Jet-pack Abyssal Rocketeer: sleek blue/titanium flight suit + twin jetpack nozzles + swept jump wings + visor
      b.addCapsule(-0.11, 0.3, 0, 0.09, 0.36, 'Y', 10, 0, 0);
      b.addCapsule(0.11, 0.3, 0, 0.09, 0.36, 'Y', 10, 0, 0);
      b.addBeveledBox(0, 0.72, 0, 0.42, 0.48, 0.3, 0.06, 0, 5);
      b.addCapsule(-0.16, 0.76, -0.24, 0.11, 0.36, 'Y', 10, 0, 1);
      b.addCapsule(0.16, 0.76, -0.24, 0.11, 0.36, 'Y', 10, 0, 1);
      b.addCylinder(-0.16, 0.48, -0.24, 0.08, 0.06, 0.14, 10, 'Y', 0, 2); // Twin glowing jet exhaust
      b.addCylinder(0.16, 0.48, -0.24, 0.08, 0.06, 0.14, 10, 'Y', 0, 2);
      b.addSweptWing(-1, -0.18, 0.84, -0.24, 0.65, 0.34, 0.16, 0.18, 0.08, 0.06, 0, 5);
      b.addSweptWing(1, 0.18, 0.84, -0.24, 0.65, 0.34, 0.16, 0.18, 0.08, 0.06, 0, 5);
      b.addCapsule(0, 1.12, 0, 0.19, 0.06, 'Y', 12, 1, 5);
      b.addBox(0, 1.12, 0.15, 0.22, 0.09, 0.09, 1, 6);
      b.addCylinder(-0.26, 0.94, 0.24, 0.075, 0.065, 0.78, 10, 'Z', 2, 1);
      break;
    }

    case 'tesla_trooper': {
      // Heavy Crimson Exo-Suit Tesla Trooper: thick articulated powered armor + dorsal twin copper Tesla coils + shock emitter
      b.addCapsule(-0.17, 0.34, 0, 0.135, 0.38, 'Y', 10, 0, 0);
      b.addCapsule(0.17, 0.34, 0, 0.135, 0.38, 'Y', 10, 0, 0);
      b.addBeveledBox(0, 0.82, 0, 0.66, 0.6, 0.46, 0.08, 0, 5); // Crimson exo chest
      b.addBeveledBox(-0.4, 0.94, 0, 0.22, 0.26, 0.36, 0.05, 0, 0);
      b.addBeveledBox(0.4, 0.94, 0, 0.22, 0.26, 0.36, 0.05, 0, 0);
      b.addCylinder(-0.22, 1.02, -0.32, 0.12, 0.1, 0.65, 12, 'Y', 0, 4); // Twin dorsal coils
      b.addCylinder(0.22, 1.02, -0.32, 0.12, 0.1, 0.65, 12, 'Y', 0, 4);
      b.addCapsule(-0.22, 1.38, -0.32, 0.12, 0.02, 'Y', 10, 0, 2); // Electric arc orbs
      b.addCapsule(0.22, 1.38, -0.32, 0.12, 0.02, 'Y', 10, 0, 2);
      b.addCapsule(0, 1.24, 0, 0.21, 0.05, 'Y', 12, 1, 5);
      b.addBox(0, 1.24, 0.17, 0.24, 0.07, 0.08, 1, 2); // Glowing eye slit
      b.addCylinder(0.38, 0.82, 0.44, 0.11, 0.07, 0.88, 12, 'Z', 2, 3); // Shock gauntlet
      b.addCapsule(0.38, 0.82, 0.92, 0.09, 0.02, 'Z', 10, 2, 2);
      break;
    }

    case 'chrono': {
      // Silver-White & Cyan Chrono Legionnaire: sleek armored suit + tilted chrono torus backpack + cyan visor + rifle
      b.addCapsule(-0.12, 0.3, 0, 0.1, 0.36, 'Y', 10, 0, 3);
      b.addCapsule(0.12, 0.3, 0, 0.1, 0.36, 'Y', 10, 0, 3);
      b.addBeveledBox(0, 0.74, 0, 0.46, 0.5, 0.32, 0.06, 0, 3);
      b.addBeveledBox(0, 0.78, 0.16, 0.24, 0.24, 0.04, 0.02, 0, 5);
      b.addTorus(0, 0.86, -0.26, 0.24, 0.055, 16, 8, Math.PI * 0.5, 0, 0, 2); // Glowing chrono ring pack
      b.addCapsule(0, 1.14, 0, 0.19, 0.06, 'Y', 12, 1, 3);
      b.addBox(0, 1.14, 0.16, 0.22, 0.09, 0.09, 1, 2);
      b.addCylinder(0.28, 0.78, 0.48, 0.085, 0.06, 0.94, 12, 'Z', 2, 0); // Chrono phase rifle
      b.addBox(0.28, 0.8, 0.94, 0.08, 0.08, 0.16, 2, 2);
      break;
    }

    case 'shadow': {
      // Tactical Stealth Commando "Shadow": matte carbon suit + blue trim + NVG visor + twin silenced pistols
      b.addCapsule(-0.11, 0.29, 0, 0.09, 0.36, 'Y', 10, 0, 1);
      b.addCapsule(0.11, 0.29, 0, 0.09, 0.36, 'Y', 10, 0, 1);
      b.addBeveledBox(0, 0.7, 0, 0.42, 0.46, 0.28, 0.05, 0, 1);
      b.addBeveledBox(-0.24, 0.82, 0, 0.12, 0.18, 0.2, 0.03, 0, 5);
      b.addBeveledBox(0.24, 0.82, 0, 0.12, 0.18, 0.2, 0.03, 0, 5);
      b.addCapsule(0, 1.1, 0, 0.175, 0.06, 'Y', 12, 1, 1);
      b.addBox(0, 1.12, 0.15, 0.24, 0.065, 0.1, 1, 2); // Cyan NVG visor
      b.addCylinder(-0.24, 0.74, 0.36, 0.04, 0.035, 0.5, 8, 'Z', 2, 1);
      b.addCylinder(0.24, 0.74, 0.36, 0.04, 0.035, 0.5, 8, 'Z', 2, 1);
      break;
    }

    case 'sledge': {
      // Juggernaut Demo Hero "Sledge": massive red/iron juggernaut exo + hazard shoulder + shoulder siege mortar
      b.addCapsule(-0.2, 0.36, 0, 0.16, 0.42, 'Y', 10, 0, 0);
      b.addCapsule(0.2, 0.36, 0, 0.16, 0.42, 'Y', 10, 0, 0);
      b.addBeveledBox(0, 0.9, 0, 0.78, 0.7, 0.54, 0.08, 0, 5);
      b.addBeveledBox(-0.48, 1.02, 0.04, 0.28, 0.38, 0.42, 0.05, 1, 4);
      b.addBeveledBox(0.48, 1.02, 0.04, 0.28, 0.38, 0.42, 0.05, 1, 0);
      b.addCapsule(0, 1.38, 0, 0.23, 0.06, 'Y', 12, 1, 5);
      b.addBox(0, 1.38, 0.19, 0.24, 0.07, 0.09, 1, 2);
      b.addCylinder(0.52, 0.98, 0.52, 0.15, 0.14, 0.95, 12, 'Z', 2, 1); // Hand siege cannon
      break;
    }

    case 'ifv': {
      // Multi-Purpose IFV: Sloped dark-titanium APC hull + 6 armored tires + Tone 5 blue side skirts + roof missile pod
      b.addTrapezoid(0, 0.5, 0, 1.54, 2.85, 1.32, 2.25, 0.64, -0.1, 0, 0);
      b.addBeveledBox(0, 0.72, 0.92, 1.18, 0.16, 0.42, 0.04, 0, 6); // Sloped armored windshield
      b.addBeveledBox(-0.78, 0.66, -0.2, 0.12, 0.24, 1.85, 0.03, 0, 5); // Blue stripe
      b.addBeveledBox(0.78, 0.66, -0.2, 0.12, 0.24, 1.85, 0.03, 0, 5);
      for (const wz of [-0.95, 0, 0.95]) {
        b.addCylinder(-0.84, 0.36, wz, 0.38, 0.38, 0.28, 12, 'X', 0, 1);
        b.addCylinder(0.84, 0.36, wz, 0.38, 0.38, 0.28, 12, 'X', 0, 1);
        b.addCylinder(-0.96, 0.36, wz, 0.2, 0.2, 0.06, 10, 'X', 0, 3);
        b.addCylinder(0.96, 0.36, wz, 0.2, 0.2, 0.06, 10, 'X', 0, 3);
      }
      b.addTrapezoid(0, 1.02, -0.18, 1.06, 1.2, 0.84, 0.92, 0.44, 0, 1, 5);
      b.addCylinder(-0.2, 1.08, 0.72, 0.09, 0.08, 0.95, 10, 'Z', 2, 2);
      b.addCylinder(0.2, 1.08, 0.72, 0.09, 0.08, 0.95, 10, 'Z', 2, 1);
      break;
    }

    case 'v3': {
      // V3 Rocket Launcher: Heavy crimson armored truck + elevated smooth Lathe tactical ballistic missile
      b.addTrapezoid(0, 0.46, 0, 1.76, 3.45, 1.6, 3.05, 0.58, 0, 0, 0);
      b.addTrackAssembly(-1.0, 0.42, 0, 0.46, 0.68, 3.45, 5, 0);
      b.addTrackAssembly(1.0, 0.42, 0, 0.46, 0.68, 3.45, 5, 0);
      b.addTrapezoid(0, 1.0, 1.18, 1.42, 0.92, 1.18, 0.68, 0.56, -0.08, 0, 5); // Crimson cab
      b.addBox(0, 1.04, 1.6, 1.05, 0.2, 0.08, 0, 6); // Cab windshield
      b.addBeveledBox(0, 1.32, -0.15, 0.64, 0.28, 2.55, 0.05, 1, 4); // Launch rail
      b.addLathe(0, 1.72, 0.2, [[-1.65, 0.32], [-1.4, 0.36], [0.85, 0.34], [1.45, 0.18], [1.82, 0.01]], 14, 'Z', 2, 0);
      b.addCylinder(0, 1.72, 1.4, 0.28, 0.14, 0.42, 12, 'Z', 2, 5); // Crimson warhead band
      break;
    }

    case 'prism': {
      // Abyssal Prism Tank: Sleek hover-sloped titanium hull, Tone 5 blue side trim, faceted glowing Crystal turret + focusing prongs
      b.addTrapezoid(0, 0.46, 0, 1.62, 3.05, 1.44, 2.48, 0.56, -0.1, 0, 0);
      b.addBeveledBox(-0.74, 0.68, 0.05, 0.18, 0.22, 1.85, 0.04, 0, 5);
      b.addBeveledBox(0.74, 0.68, 0.05, 0.18, 0.22, 1.85, 0.04, 0, 5);
      b.addTrackAssembly(-0.92, 0.4, 0, 0.42, 0.62, 3.1, 4, 0);
      b.addTrackAssembly(0.92, 0.4, 0, 0.42, 0.62, 3.1, 4, 0);
      b.addCylinder(0, 0.96, -0.12, 0.66, 0.48, 0.44, 14, 'Y', 1, 0);
      // Faceted cyan crystal turret + energy ring + silver focus mirrors
      b.addLathe(0, 1.54, 0.04, [[-0.45, 0.05], [-0.15, 0.42], [0.22, 0.38], [0.55, 0.03]], 8, 'Y', 2, 6);
      b.addTorus(0, 1.18, 0.04, 0.48, 0.07, 16, 8, 0, 0, 1, 2);
      b.addBeveledBox(-0.46, 1.48, 0.04, 0.14, 0.62, 0.36, 0.03, 1, 3);
      b.addBeveledBox(0.46, 1.48, 0.04, 0.14, 0.62, 0.36, 0.03, 1, 3);
      break;
    }

    case 'stormhawk': {
      // Sleek Delta-Stealth Strike Fighter: pointed lathe fuselage + swept wings + glossy canopy + glowing afterburners
      b.addLathe(0, 0.04, 0.2, [[-2.05, 0.32], [-1.2, 0.48], [0.35, 0.46], [1.45, 0.26], [2.15, 0.02]], 12, 'Z', 0, 0);
      b.addSweptWing(-1, -0.35, 0.04, 0.15, 1.95, 1.75, 0.48, 1.05, -0.06, 0.14, 0, 0);
      b.addSweptWing(1, 0.35, 0.04, 0.15, 1.95, 1.75, 0.48, 1.05, -0.06, 0.14, 0, 0);
      b.addSweptWing(-1, -1.95, -0.01, -0.78, 0.36, 0.56, 0.34, 0.2, 0, 0.12, 0, 5); // Blue wingtip stripes
      b.addSweptWing(1, 1.95, -0.01, -0.78, 0.36, 0.56, 0.34, 0.2, 0, 0.12, 0, 5);
      // Canted twin tails + wingtip rails
      b.addTrapezoid(-0.56, 0.42, -1.28, 0.12, 0.85, 0.08, 0.48, 0.72, -0.25, 0, 5);
      b.addTrapezoid(0.56, 0.42, -1.28, 0.12, 0.85, 0.08, 0.48, 0.72, -0.25, 0, 5);
      b.addCapsule(0, 0.36, 0.85, 0.25, 0.75, 'Z', 12, 0, 6); // Tinted fighter canopy
      b.addCylinder(-0.22, 0.02, -1.85, 0.16, 0.13, 0.26, 12, 'Z', 0, 2); // Twin afterburners
      b.addCylinder(0.22, 0.02, -1.85, 0.16, 0.13, 0.26, 12, 'Z', 0, 2);
      break;
    }

    case 'crimson_mig': {
      // Needle-nose Crimson MiG: forward chined intakes, swept wings, tall dorsal tail fin, crimson stripes, glowing jets
      b.addLathe(0, 0.04, 0.2, [[-2.1, 0.3], [-1.0, 0.44], [0.45, 0.42], [1.6, 0.2], [2.25, 0.015]], 12, 'Z', 0, 0);
      b.addSweptWing(-1, -0.32, 0.04, 0.1, 1.85, 1.45, 0.42, 1.15, -0.04, 0.12, 0, 5); // Crimson swept wings
      b.addSweptWing(1, 0.32, 0.04, 0.1, 1.85, 1.45, 0.42, 1.15, -0.04, 0.12, 0, 5);
      b.addTrapezoid(0, 0.56, -1.35, 0.12, 0.92, 0.08, 0.52, 0.88, -0.28, 0, 5); // Tall MiG fin
      b.addCapsule(0, 0.34, 0.88, 0.23, 0.72, 'Z', 12, 0, 6);
      b.addCylinder(0, 0.02, -1.9, 0.2, 0.17, 0.3, 12, 'Z', 0, 2); // Hot exhaust
      break;
    }

    case 'nighthawk': {
      b.addTrapezoid(0, 0.1, 0.05, 1.48, 3.75, 1.12, 3.25, 0.84, 0.1, 0, 1); // Matte stealth fuselage
      b.addSweptWing(-1, -0.68, 0.06, -0.1, 0.98, 1.05, 0.55, 0.35, 0, 0.16, 0, 0);
      b.addSweptWing(1, 0.68, 0.06, -0.1, 0.98, 1.05, 0.55, 0.35, 0, 0.16, 0, 0);
      b.addBeveledBox(0, 0.3, 1.4, 0.82, 0.36, 0.82, 0.08, 0, 6); // Angled stealth windshield
      // Rotor hub (part 1)
      b.addCylinder(0, 0.78, 0, 0.26, 0.26, 0.44, 12, 'Y', 1, 3);
      b.addBox(0, 0.96, 0, 4.5, 0.06, 0.22, 1, 1);
      b.addBox(0, 0.96, 0, 0.22, 0.06, 4.5, 1, 1);
      break;
    }

    case 'kirov': {
      // Signature Crimson Kirov Airship: Smooth 16-seg Lathe Zeppelin envelope + Shark Jaw cone + Under-slung Bomb Gondola + 4 Outrigger Nacelles + X-Tail
      b.addLathe(0, 0.68, 0, [
        [-3.25, 0.04], [-2.55, 0.76], [-1.35, 1.32], [0.25, 1.52], [1.65, 1.44], [2.65, 1.02], [3.2, 0.34], [3.42, 0.02]
      ], 16, 'Z', 0, 0);
      // Crimson dorsal livery stripe + Shark snout tip
      b.addLathe(0, 0.68, 0, [[2.58, 1.05], [3.18, 0.36], [3.44, 0.02]], 16, 'Z', 0, 5);
      b.addCylinder(0, 0.68, 2.38, 1.18, 1.14, 0.24, 16, 'Z', 0, 4); // Shark-tooth warning band
      // Underslung armored bomb bay gondola + glass bridge + glowing thrusters
      b.addBeveledBox(0, -0.96, 0.05, 0.88, 0.66, 2.55, 0.1, 0, 0);
      b.addBeveledBox(0, -0.88, 1.24, 0.64, 0.32, 0.26, 0.05, 0, 6);
      b.addBox(0, 1.88, -0.2, 0.14, 0.72, 2.6, 0, 5); // Dorsal spine
      // 4 Outrigger engine pods + spinning props (part 1)
      for (const [ex, ey, ez] of [[-1.58, 0.62, 0.4], [1.58, 0.62, 0.4], [-1.45, 0.56, -1.2], [1.45, 0.56, -1.2]]) {
        b.addBox(ex * 0.55, ey, ez, Math.abs(ex) * 0.9, 0.12, 0.22, 0, 3);
        b.addCapsule(ex, ey, ez, 0.24, 0.75, 'Z', 10, 0, 1);
        b.addBox(ex, ey, ez + 0.48, 0.88, 0.08, 0.06, 1, 3);
        b.addBox(ex, ey, ez + 0.48, 0.08, 0.88, 0.06, 1, 3);
        b.addCylinder(ex, ey, ez - 0.52, 0.14, 0.14, 0.12, 10, 'Z', 0, 2);
      }
      // Cruciform X-tail fins with crimson tips
      b.addTrapezoid(0, 0.68, -2.45, 3.25, 1.05, 1.65, 0.65, 0.14, -0.2, 0, 5);
      b.addBox(0, 0.68, -2.45, 0.14, 3.25, 0.95, 0, 5);
      break;
    }

    case 'hover_transport': {
      b.addTrapezoid(0, 0.38, 0, 2.95, 5.25, 2.65, 4.75, 0.64, 0, 0, 1); // Dark rubber air-cushion skirt
      b.addBeveledBox(0, 0.86, 0, 2.38, 0.34, 4.38, 0.05, 0, 0);
      b.addBeveledBox(-1.08, 1.24, -0.3, 0.36, 0.5, 3.65, 0.05, 0, 5);
      b.addBeveledBox(1.08, 1.24, -0.3, 0.36, 0.5, 3.65, 0.05, 0, 5);
      b.addBeveledBox(0, 1.38, -1.78, 2.12, 0.84, 0.88, 0.06, 0, 0);
      b.addBox(0, 1.48, -1.32, 1.72, 0.28, 0.08, 0, 6);
      b.addBox(0, 1.05, 2.2, 1.9, 0.65, 0.18, 0, 4); // Bow ramp
      break;
    }

    case 'dolphin': {
      // Smooth bio-mechanical Dolphin hydro-hull + dorsal sonic dish
      b.addLathe(0, 0.52, 0, [[-1.9, 0.05], [-1.0, 0.44], [0.2, 0.62], [1.25, 0.42], [2.1, 0.04]], 14, 'Z', 0, 0);
      b.addBox(0, 0.98, -0.25, 0.12, 0.62, 0.78, 0, 5); // Blue dorsal fin
      b.addCylinder(0, 1.06, 0.52, 0.36, 0.12, 0.3, 12, 'Y', 2, 2); // Sonic emitter
      break;
    }

    case 'sea_scorpion': {
      b.addTrapezoid(0, 0.54, 0, 2.25, 4.85, 1.88, 4.25, 0.92, 0.1, 0, 0);
      b.addTrapezoid(0, 1.26, -0.75, 1.28, 1.5, 0.96, 1.18, 0.74, 0, 0, 5);
      b.addBox(0, 1.42, -0.1, 0.9, 0.22, 0.1, 0, 6);
      b.addCylinder(0, 1.94, -0.9, 0.12, 0.08, 0.82, 8, 'Y', 1, 3);
      b.addCylinder(0, 1.18, 0.98, 0.6, 0.48, 0.42, 12, 'Y', 1, 0);
      b.addCylinder(-0.18, 1.28, 1.68, 0.095, 0.08, 1.18, 10, 'Z', 2, 1);
      b.addCylinder(0.18, 1.28, 1.68, 0.095, 0.08, 1.18, 10, 'Z', 2, 1);
      break;
    }

    case 'aegis': {
      // Sleek Naval Cruiser: dark steel flared bow + blue deck trim + SPY phased-array bridge + VLS launcher
      b.addTrapezoid(0, 0.64, 0, 2.32, 5.9, 1.94, 5.2, 1.1, 0.28, 0, 0);
      b.addBeveledBox(0, 1.18, 0.1, 1.75, 0.12, 4.4, 0.04, 0, 5);
      b.addTrapezoid(0, 1.62, -0.25, 1.48, 2.1, 1.08, 1.58, 1.08, 0, 0, 0);
      b.addBeveledBox(0, 2.3, -0.4, 0.96, 0.56, 0.96, 0.06, 0, 3); // SPY phased-array superstructure
      b.addBox(0, 2.34, 0.1, 0.7, 0.28, 0.06, 0, 6); // Bridge window
      b.addTrapezoid(0, 1.36, 1.62, 0.94, 0.94, 0.72, 0.72, 0.5, 0, 1, 5);
      b.addCylinder(-0.18, 1.56, 2.04, 0.1, 0.09, 1.14, 10, 'Z', 2, 3);
      b.addCylinder(0.18, 1.56, 2.04, 0.1, 0.09, 1.14, 10, 'Z', 2, 3);
      break;
    }

    case 'typhoon': {
      // Smooth hydrodynamic Typhoon Attack Submarine
      b.addLathe(0, 0.48, 0, [[-3.15, 0.05], [-2.2, 0.72], [0.2, 0.94], [2.1, 0.88], [3.05, 0.32], [3.3, 0.03]], 16, 'Z', 0, 1);
      b.addTrapezoid(0, 1.28, 0.35, 0.56, 1.52, 0.44, 1.14, 0.92, 0, 0, 0); // Conning sail
      b.addBox(0, 1.45, 0.35, 0.48, 0.18, 0.95, 0, 5); // Crimson sail insignia band
      b.addCylinder(0, 1.9, 0.45, 0.08, 0.07, 0.54, 8, 'Y', 1, 3);
      break;
    }

    case 'carrier': {
      b.addTrapezoid(0, 0.72, 0, 2.95, 7.0, 2.65, 6.5, 1.28, 0.2, 0, 0);
      b.addBeveledBox(0, 1.46, 0, 3.75, 0.24, 7.05, 0.06, 0, 1); // Flight deck
      b.addBox(0, 1.59, 0, 0.34, 0.04, 6.45, 0, 4); // Runway stripes
      b.addBeveledBox(-1.72, 1.46, 0, 0.18, 0.24, 6.6, 0.03, 0, 5);
      b.addTrapezoid(1.18, 2.18, -0.45, 0.96, 1.95, 0.76, 1.42, 1.28, 0, 0, 0); // Island bridge
      b.addBox(1.18, 2.45, 0.32, 0.65, 0.26, 0.08, 0, 6);
      b.addBox(1.18, 2.98, -0.45, 0.48, 0.34, 0.48, 1, 5);
      break;
    }

    case 'dreadnought': {
      b.addTrapezoid(0, 0.7, 0, 2.6, 6.6, 2.28, 5.9, 1.2, 0.28, 0, 0);
      b.addBeveledBox(0, 1.28, 0.2, 2.0, 0.14, 4.9, 0.04, 0, 5); // Crimson armored deck
      b.addTrapezoid(0, 1.66, -0.5, 1.78, 2.25, 1.38, 1.78, 0.96, 0, 0, 0);
      b.addBox(0, 1.95, 0.42, 1.15, 0.24, 0.08, 0, 6);
      // Heavy aft cruise missile VLS silos
      b.addBeveledBox(-0.5, 1.78, -1.92, 0.7, 0.98, 1.48, 0.05, 2, 5);
      b.addBeveledBox(0.5, 1.78, -1.92, 0.7, 0.98, 1.48, 0.05, 2, 5);
      b.addTrapezoid(0, 1.48, 1.54, 1.18, 1.22, 0.9, 0.98, 0.56, 0, 1, 5);
      b.addCylinder(-0.24, 1.54, 2.34, 0.125, 0.1, 1.38, 10, 'Z', 2, 1);
      b.addCylinder(0.24, 1.54, 2.34, 0.125, 0.1, 1.38, 10, 'Z', 2, 1);
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
      // Octagonal plinth + interlocking gyroscope chrome rings + suspended glowing Chrono core orb
      b.addTrapezoid(0, 0.26, 0, 5.7, 5.7, 5.4, 5.4, 0.52, 0, 0, 3);
      b.addBeveledBox(-1.85, 1.45, 0, 0.62, 2.1, 1.15, 0.08, 0, 0);
      b.addBeveledBox(1.85, 1.45, 0, 0.62, 2.1, 1.15, 0.08, 0, 0);
      b.addTorus(0, 2.05, 0, 1.55, 0.14, 24, 10, 0.52, 0.25, 1, 3);
      b.addTorus(0, 2.05, 0, 1.22, 0.12, 24, 10, -0.68, -0.35, 1, 5);
      b.addCapsule(0, 2.05, 0, 0.68, 0.02, 'Y', 16, 1, 2);
      break;
    }

    case 'weather_control': {
      b.addTrapezoid(0, 0.26, 0, 5.7, 5.7, 5.4, 5.4, 0.52, 0, 0, 3);
      b.addCylinder(0, 1.85, 0, 0.95, 0.36, 2.9, 14, 'Y', 0, 0);
      b.addTorus(0, 2.9, 0, 1.05, 0.11, 20, 10, 0, 0, 0, 5);
      for (const [rx, rz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
        b.addCylinder(rx, 1.55, rz, 0.22, 0.08, 2.35, 10, 'Y', 0, 3);
        b.addCapsule(rx, 2.8, rz, 0.16, 0.02, 'Y', 10, 0, 2);
      }
      b.addCapsule(0, 3.45, 0, 0.42, 0.02, 'Y', 14, 1, 2);
      break;
    }

    case 'iron_curtain': {
      b.addTrapezoid(0, 0.26, 0, 5.7, 5.7, 5.4, 5.4, 0.52, 0, 0, 3);
      b.addTrapezoid(-1.5, 1.65, 0, 1.25, 1.65, 0.85, 1.15, 2.4, 0, 0, 0);
      b.addTrapezoid(1.5, 1.65, 0, 1.25, 1.65, 0.85, 1.15, 2.4, 0, 0, 0);
      b.addTorus(0, 1.85, 0, 1.32, 0.14, 24, 10, 0, 0, 0, 5);
      b.addCapsule(0, 1.85, 0, 0.88, 0.02, 'Y', 16, 1, 2); // Crimson energy sphere dome
      break;
    }

    case 'nuclear_silo': {
      b.addTrapezoid(0, 0.26, 0, 5.7, 5.7, 5.4, 5.4, 0.52, 0, 0, 3);
      b.addBeveledBox(0, 0.72, 0, 4.45, 0.46, 4.45, 0.08, 0, 0);
      b.addBeveledBox(-1.35, 1.05, 0, 1.15, 0.35, 3.2, 0.06, 0, 4); // Slanted blast hatches
      b.addBeveledBox(1.35, 1.05, 0, 1.15, 0.35, 3.2, 0.06, 0, 4);
      b.addLathe(0, 0.85, 0, [[0, 0.72], [1.85, 0.62], [2.45, 0.32], [2.85, 0.02]], 16, 'Y', 0, 0);
      b.addCylinder(0, 2.95, 0, 0.46, 0.28, 0.42, 16, 'Y', 0, 5); // Crimson warhead collar
      b.addCapsule(0, 3.65, 0, 0.12, 0.02, 'Y', 10, 0, 2);
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

  const glbCache = new Map();

  function uploadGeometryToBatch(batch, geom) {
    gl.bindVertexArray(batch.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, geom.vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    batch.indexCount = geom.indexCount;
    batch.indexType = geom.useUint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  }

  async function loadGlbOverride(typeId, url, options = {}) {
    const geom = await fetchAndParseGlb(url, options);
    glbCache.set(typeId, { url, vertexCount: geom.vertexCount, indexCount: geom.indexCount });
    const existing = meshes.get(typeId);
    if (existing) {
      uploadGeometryToBatch(existing, geom);
    } else {
      getOrCreateBatch(typeId, geom);
    }
    return geom;
  }

  async function syncGlbManifest() {
    if (typeof fetch !== 'function' || typeof window === 'undefined') return;
    try {
      const resp = await fetch('./assets/models/manifest.json', { cache: 'no-store' });
      if (!resp.ok) return;
      const manifest = await resp.json();
      const entries = manifest && typeof manifest.models === 'object' ? Object.entries(manifest.models) : [];
      await Promise.all(
        entries.map(async ([typeId, spec]) => {
          const url = typeof spec === 'string' ? spec : spec && spec.url;
          if (!url) return;
          const opts = typeof spec === 'object' && spec ? spec : {};
          await loadGlbOverride(typeId, url, opts);
        })
      );
    } catch {
      // Optional .glb overrides fail softly and keep procedural high-detail geometry.
    }
  }

  function getOrCreateBatch(typeId, overrideGeom = null) {
    let batch = meshes.get(typeId);
    if (batch) return batch;

    const geom = overrideGeom || buildProceduralGeometryData(typeId);
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
      indexType: geom.useUint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
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
      gl.drawElementsInstanced(gl.TRIANGLES, batch.indexCount, batch.indexType, 0, count);
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
      gl.drawElementsInstanced(gl.TRIANGLES, batch.indexCount, batch.indexType, 0, total);
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
      gl.drawElementsInstanced(gl.TRIANGLES, batch.indexCount, batch.indexType, 0, batch.dynamicCount);
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
  syncGlbManifest();

  return {
    canonicalCount: CANONICAL_ENTITY_IDS.length,
    syncEntities,
    renderShadowPass,
    renderMainPass,
    renderXRayPass,
    loadGlbOverride,
    get glbLoadedTypes() {
      return Array.from(glbCache.keys());
    },
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
      glbCache.clear();
    }
  };
}
