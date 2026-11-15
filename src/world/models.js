// Single Draw Call Multi-Part Vertex-Articulated InstancedMesh Model Factory.
// Vertex layout (10 floats): pos(3), normal(3), uv(2), aPartId(1), aTone(1).
// Per-instance layout (20 floats): aInstanceMatrix(mat4=16) + aUnitState(vec4: turretDeltaYaw, recoil, hpRatio, teamAndFlags).

import { CANONICAL_ENTITY_IDS, ENTITY_DEFS, FACTIONS, PLAYER_COLORS } from '../core/config.js';
import { MAP_SIZE, worldToGrid } from './map.js';
import { PCSS_GLSL } from '../render/shadow.js';
import { fetchAndParseGlb, parseGlbGeometry } from './glbLoader.js';

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
    // Tone 0: Gunsteel / architectural armor plate + industrial panel seams & subtle louver vents on vertical facades
    vec3 gunSteel = mix(vec3(0.20, 0.22, 0.26), teamCol * 0.65, 0.16);
    float wallMask = 1.0 - smoothstep(0.25, 0.65, abs(vNormal.y));
    float seamGrid = 1.0 - 0.14 * max(step(0.92, fract(vWorldPos.x * 1.2 + vWorldPos.z * 1.2)), step(0.90, fract(vWorldPos.y * 1.4)));
    float louver = 1.0 - 0.12 * wallMask * step(0.65, fract(vWorldPos.y * 5.0));
    float microGrain = 0.90 + detail.r * 0.18 - detail.g * 0.08;
    baseCol = gunSteel * microGrain * seamGrid * louver;
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
    // Tone 3: Brushed alloy trim / concrete plinth with slab block mortar lines
    float slabX = step(0.94, fract(vWorldPos.x * 0.75));
    float slabZ = step(0.94, fract(vWorldPos.z * 0.75));
    float mortar = 1.0 - 0.18 * max(slabX, slabZ);
    baseCol = vec3(0.42, 0.40, 0.37) * (0.88 + detail.r * 0.18) * mortar;
    metallic = 0.36;
    roughness = 0.58;
  } else if (vTone < 4.5) {
    // Tone 4: High-contrast industrial hazard chevron stripes
    float stripe = step(0.5, fract((vWorldPos.x + vWorldPos.z) * 1.65));
    baseCol = mix(vec3(0.08, 0.08, 0.09), vec3(0.92, 0.66, 0.10), stripe);
    metallic = 0.30;
    roughness = 0.48;
  } else if (vTone < 5.5) {
    // Tone 5: Crisp faction metallic armor coat (CMC pauldrons, cuirass, turret chevrons, trim)
    vec3 trimSteel = mix(teamCol * 0.96, teamCol * 0.56 + vec3(0.04, 0.05, 0.08), detail.g * 0.42);
    float armorSeam = 1.0 - 0.14 * step(0.92, fract(vWorldPos.y * 2.4 + (vWorldPos.x + vWorldPos.z) * 1.1));
    baseCol = trimSteel * (0.90 + detail.r * 0.20) * armorSeam;
    metallic = 0.72;
    roughness = 0.26;
  } else if (vTone < 6.5) {
    // Tone 6: Reflective tinted glass cockpit canopy & illuminated architectural window panes
    float mullionX = step(0.88, fract((vWorldPos.x + vWorldPos.z) * 2.2));
    float mullionY = step(0.86, fract(vWorldPos.y * 2.6));
    float frame = max(mullionX, mullionY);
    vec3 paneCol = mix(vec3(0.04, 0.16, 0.25), teamCol * 0.58 + vec3(0.05, 0.12, 0.18), 0.42);
    baseCol = mix(paneCol, vec3(0.09, 0.11, 0.14), frame * 0.85);
    metallic = mix(0.45, 0.60, frame);
    roughness = mix(0.06, 0.45, frame);
    glassFactor = 1.0 - frame * 0.85;
  } else if (vTone < 7.5) {
    // Tone 7: Woven tactical burlap sandbags & ballistic khaki cloth (subtle crosshatch weave)
    float weaveA = step(0.5, fract((vWorldPos.x + vWorldPos.z) * 14.0));
    float weaveB = step(0.5, fract((vWorldPos.y * 14.0 + vWorldPos.x * 6.0)));
    float weave = 0.92 + 0.08 * (weaveA * 0.6 + weaveB * 0.4);
    baseCol = vec3(0.36, 0.31, 0.21) * (0.86 + detail.r * 0.22) * weave;
    metallic = 0.02;
    roughness = 0.92;
  } else if (vTone < 8.5) {
    // Tone 8: Industrial Safety Hazard Yellow-Amber Armor (Engineer suit & hardware trim)
    float seam = 1.0 - 0.14 * step(0.92, fract(vWorldPos.y * 2.4 + (vWorldPos.x + vWorldPos.z) * 1.1));
    baseCol = vec3(0.84, 0.62, 0.09) * (0.90 + detail.r * 0.18) * seam;
    metallic = 0.52;
    roughness = 0.34;
  } else {
    // Tone 9: Warm Brushed Copper & Ordnance Brass (Tesla coils & cartridge belts)
    float wind = 0.86 + 0.14 * step(0.42, fract(vWorldPos.y * 18.0 + vUv.y * 6.0));
    baseCol = vec3(0.82, 0.45, 0.16) * (0.90 + detail.r * 0.16) * wind;
    metallic = 0.86;
    roughness = 0.22;
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
  float specPow = mix(18.0, 148.0, 1.0 - roughness);
  float spec = pow(max(dot(N, H), 0.0), specPow) * mix(0.14, 1.52, max(metallic, glassFactor));

  vec3 proj = (vShadowPos.xyz / vShadowPos.w) * 0.5 + 0.5;
  float shadow = sampleShadowPCSS(uShadowMap, proj, 0.0022, uShadowTexelSize);

  float upAO = mix(0.66, 1.12, clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
  vec3 ambient = baseCol * (0.18 + 0.18 * max(N.y, 0.0)) * detail.a * upAO;
  vec3 specTint = mix(vec3(1.0), clamp(baseCol * 1.35 + vec3(0.28), 0.0, 1.0), metallic * 0.65);
  vec3 direct = (baseCol * 1.24 + specTint * spec) * NdotL * mix(0.24, 1.0, shadow);

  // Height-adaptive faction Fresnel rim + glossy canopy sky reflection
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.4);
  float rimScale = mix(0.06, 0.92, smoothstep(22.0, 72.0, uCamHeight));
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
  let activeXform = null;

  function makeXform(tx, ty, tz, rx = 0, ry = 0, rz = 0) {
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    const rot = (v) => {
      const x1 = v[0] * cz - v[1] * sz;
      const y1 = v[0] * sz + v[1] * cz;
      const z1 = v[2];
      const y2 = y1 * cx - z1 * sx;
      const z2 = y1 * sx + z1 * cx;
      return [x1 * cy + z2 * sy, y2, -x1 * sy + z2 * cy];
    };
    return {
      pt: (v) => {
        const r = rot(v);
        return [r[0] + tx, r[1] + ty, r[2] + tz];
      },
      nrm: rot
    };
  }

  function withTransform(tx, ty, tz, rx, ry, rz, fn) {
    const prev = activeXform;
    activeXform = makeXform(tx, ty, tz, rx, ry, rz);
    try {
      fn();
    } finally {
      activeXform = prev;
    }
  }

  function addTri(p0, p1, p2, nx, ny, nz, u0, v0, u1, v1, u2, v2, partId, tone) {
    if (activeXform) {
      p0 = activeXform.pt(p0);
      p1 = activeXform.pt(p1);
      p2 = activeXform.pt(p2);
      const rn = activeXform.nrm([nx, ny, nz]);
      nx = rn[0]; ny = rn[1]; nz = rn[2];
    }
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
    if (activeXform) {
      p0 = activeXform.pt(p0);
      p1 = activeXform.pt(p1);
      p2 = activeXform.pt(p2);
      n0 = activeXform.nrm(n0);
      n1 = activeXform.nrm(n1);
      n2 = activeXform.nrm(n2);
    }
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

  // Smooth oriented limb/bone with hemispherical end-caps between arbitrary 3D joints p0 -> p1
  function addLimb(p0, p1, r0, r1 = r0, segs = 10, partId = 0, tone = 0) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    const ax = dx / len, ay = dy / len, az = dz / len;
    // Construct stable orthonormal frame (U, V) perpendicular to axis A
    const refX = Math.abs(ay) < 0.9 ? 0 : 1;
    const refY = Math.abs(ay) < 0.9 ? 1 : 0;
    const refZ = 0;
    let ux = refY * az - refZ * ay;
    let uy = refZ * ax - refX * az;
    let uz = refX * ay - refY * ax;
    const uLen = Math.hypot(ux, uy, uz) || 1;
    ux /= uLen; uy /= uLen; uz /= uLen;
    const vx = ay * uz - az * uy;
    const vy = az * ux - ax * uz;
    const vz = ax * uy - ay * ux;

    const ringPts = (cx, cy, cz, rad, axialShift = 0) => {
      const pts = [];
      const nrms = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        const rx = ux * c + vx * s;
        const ry = uy * c + vy * s;
        const rz = uz * c + vz * s;
        pts.push([cx + ax * axialShift + rx * rad, cy + ay * axialShift + ry * rad, cz + az * axialShift + rz * rad]);
        const nx = rx + ax * (axialShift !== 0 ? Math.sign(axialShift) * 0.55 : 0);
        const ny = ry + ay * (axialShift !== 0 ? Math.sign(axialShift) * 0.55 : 0);
        const nz = rz + az * (axialShift !== 0 ? Math.sign(axialShift) * 0.55 : 0);
        const nl = Math.hypot(nx, ny, nz) || 1;
        nrms.push([nx / nl, ny / nl, nz / nl]);
      }
      return { pts, nrms };
    };

    const rings = [
      ringPts(p0[0], p0[1], p0[2], r0 * 0.35, -r0 * 0.85),
      ringPts(p0[0], p0[1], p0[2], r0, 0),
      ringPts(p1[0], p1[1], p1[2], r1, 0),
      ringPts(p1[0], p1[1], p1[2], r1 * 0.35, r1 * 0.85)
    ];

    for (let rIdx = 0; rIdx < rings.length - 1; rIdx++) {
      const a = rings[rIdx], c = rings[rIdx + 1];
      for (let i = 0; i < segs; i++) {
        addSmoothTri(
          a.pts[i], a.nrms[i], 0, 0,
          c.pts[i], c.nrms[i], 0, 1,
          c.pts[i + 1], c.nrms[i + 1], 1, 1,
          partId, tone
        );
        addSmoothTri(
          a.pts[i], a.nrms[i], 0, 0,
          c.pts[i + 1], c.nrms[i + 1], 1, 1,
          a.pts[i + 1], a.nrms[i + 1], 1, 0,
          partId, tone
        );
      }
    }
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
    addLimb,
    withTransform,
    build() {
      return {
        vertices: new Float32Array(verts),
        indices: new Uint16Array(indices),
        indexCount: indices.length
      };
    }
  };
}

// Shared RA2-style beveled concrete foundation plinth + hazard trim + corner bollards
function addConcretePad(b, w, d, h = 0.44, apronScale = 0.92, hasHazard = true) {
  b.addTrapezoid(0, h * 0.5, 0, w, d, w * 0.94, d * 0.94, h, 0, 0, 3);
  if (hasHazard) {
    b.addBeveledBox(0, h + 0.04, 0, w * apronScale, 0.08, d * apronScale, 0.02, 0, 4);
  }
  const bx = w * 0.45;
  const bz = d * 0.45;
  for (const [cx, cz] of [[-bx, -bz], [bx, -bz], [-bx, bz], [bx, bz]]) {
    b.addCylinder(cx, h + 0.14, cz, 0.14, 0.12, 0.28, 6, 'Y', 0, 1);
  }
}

// Shared RA2 vaulted industrial hangar/barracks roof with arched ribs & glass skylights
function addVaultedHall(b, cx, baseY, cz, w, d, h, ribCount = 4, wallTone = 0, ribTone = 3) {
  const wallH = h * 0.52;
  b.addBeveledBox(cx, baseY + wallH * 0.5, cz, w, wallH, d, 0.08, 0, wallTone);
  // Arched upper shell (stepped bevel + crown prism)
  b.addTrapezoid(cx, baseY + wallH + h * 0.24, cz, w * 0.96, d * 0.98, w * 0.58, d * 0.94, h * 0.48, 0, 0, wallTone);
  b.addBeveledBox(cx, baseY + h * 0.96, cz, w * 0.48, h * 0.16, d * 0.88, 0.06, 0, 5);
  // Reflective glass clerestory side strips
  b.addBox(cx - w * 0.505, baseY + wallH * 0.68, cz, 0.06, wallH * 0.34, d * 0.72, 0, 6);
  b.addBox(cx + w * 0.505, baseY + wallH * 0.68, cz, 0.06, wallH * 0.34, d * 0.72, 0, 6);
  // Structural metal truss ribs spanning across Z or X
  for (let i = 0; i < ribCount; i++) {
    const t = ribCount === 1 ? 0 : (i / (ribCount - 1) - 0.5) * (d * 0.76);
    b.addBeveledBox(cx, baseY + wallH * 0.95, cz + t, w * 1.03, h * 0.12, 0.24, 0.03, 0, ribTone);
  }
}

// Smooth hyperboloid industrial cooling tower
function addCoolingTower(b, cx, baseY, cz, baseR, waistR, topR, h, coreGlow = false) {
  b.addLathe(cx, baseY, cz, [
    [0, baseR], [h * 0.28, baseR * 0.82], [h * 0.66, waistR], [h * 0.92, topR], [h, topR * 0.92]
  ], 14, 'Y', 0, 3);
  b.addCylinder(cx, baseY + h + 0.06, cz, topR * 0.96, topR * 0.96, 0.16, 14, 'Y', 0, 1);
  if (coreGlow) {
    b.addCylinder(cx, baseY + h + 0.08, cz, waistR * 0.72, waistR * 0.72, 0.18, 12, 'Y', 0, 2);
  }
}

// SC2-inspired CMC Powered Combat Armor Trooper ('gi' standing & 'gi_deployed' braced sandbag bunker)
function addMarineArmor(b, { deployed = false } = {}) {
  const torsoBaseY = deployed ? 0.64 : 0.88;

  // === 1. Lower Power-Armor Legs & Grounded Heavy Sabaton Boots (partId = 0) ===
  if (deployed) {
    // Staggered 3-course stitched military sandbag parapet + vertical steel rebar stakes + ammo box
    const courses = [
      { y: 0.085, r: 0.84, angles: [-0.94, -0.63, -0.32, 0.0, 0.32, 0.63, 0.94], tilt: 0.04 },
      { y: 0.23, r: 0.82, angles: [-0.79, -0.47, -0.16, 0.16, 0.47, 0.79], tilt: -0.03 },
      { y: 0.36, r: 0.80, angles: [-0.66, -0.30, 0.30, 0.66], tilt: 0.02 }
    ];
    for (const c of courses) {
      for (let i = 0; i < c.angles.length; i++) {
        const ang = c.angles[i];
        const bx = Math.sin(ang) * c.r;
        const bz = Math.cos(ang) * c.r - 0.04;
        const alt = (i % 2 === 0 ? 1 : -1) * 0.025;
        b.withTransform(bx, c.y, bz, c.tilt + alt, ang, alt, () => {
          b.addBeveledBox(0, 0, 0, 0.34, 0.165, 0.21, 0.052, 0, 7);
        });
      }
    }
    for (const sAng of [-0.98, -0.45, 0.45, 0.98]) {
      b.addCylinder(Math.sin(sAng) * 0.94, 0.23, Math.cos(sAng) * 0.94 - 0.04, 0.025, 0.022, 0.46, 6, 'Y', 0, 1);
    }
    b.addBeveledBox(-0.48, 0.125, 0.28, 0.22, 0.25, 0.32, 0.025, 0, 0); // Field ammo crate
    b.addBox(-0.48, 0.23, 0.28, 0.16, 0.04, 0.26, 0, 8);

    // Left leg braced forward with heavy boot flush at y = 0
    b.addBox(-0.22, 0.03, 0.26, 0.21, 0.06, 0.35, 0, 1);
    b.addTrapezoid(-0.22, 0.115, 0.27, 0.20, 0.31, 0.17, 0.20, 0.11, -0.02, 0, 5);
    b.addBeveledBox(-0.22, 0.09, 0.39, 0.18, 0.09, 0.10, 0.02, 0, 0);
    b.addTrapezoid(-0.22, 0.30, 0.22, 0.22, 0.23, 0.19, 0.20, 0.28, 0.02, 0, 5);
    b.addBeveledBox(-0.22, 0.44, 0.33, 0.17, 0.16, 0.11, 0.035, 0, 0);
    b.addLimb([-0.22, 0.43, 0.23], [-0.17, torsoBaseY - 0.02, -0.04], 0.115, 0.125, 10, 0, 5);

    // Right leg kneeling solidly onto ground at y = 0
    b.addLimb([0.19, torsoBaseY - 0.02, -0.04], [0.24, 0.14, 0.05], 0.125, 0.115, 10, 0, 5);
    b.addBeveledBox(0.24, 0.09, 0.08, 0.17, 0.16, 0.16, 0.035, 0, 0);
    b.addLimb([0.24, 0.12, 0.02], [0.23, 0.08, -0.36], 0.105, 0.095, 10, 0, 5);
    b.addBeveledBox(0.23, 0.10, -0.44, 0.19, 0.20, 0.12, 0.025, 0, 1);
  } else {
    // Wide heroic standing combat stance (both armored sabaton boots flush on y = 0.00)
    const legs = [
      { x: -0.22, z: 0.05, side: -1 },
      { x: 0.22, z: -0.05, side: 1 }
    ];
    for (const leg of legs) {
      const { x, z, side } = leg;
      b.addBox(x, 0.03, z + 0.04, 0.215, 0.06, 0.36, 0, 1); // Sole tread grounded y=0
      b.addTrapezoid(x, 0.115, z + 0.05, 0.205, 0.32, 0.17, 0.20, 0.11, -0.03, 0, 5);
      b.addBeveledBox(x, 0.085, z + 0.175, 0.185, 0.095, 0.105, 0.02, 0, 0);
      b.addBeveledBox(x, 0.11, z - 0.135, 0.12, 0.14, 0.09, 0.02, 0, 3); // Heel piston
      // Flared greaves + front shin crest + rear calf hydraulics
      b.addTrapezoid(x, 0.33, z, 0.23, 0.25, 0.19, 0.21, 0.34, 0, 0, 5);
      b.addBeveledBox(x, 0.33, z + 0.11, 0.095, 0.27, 0.055, 0.015, 0, 0);
      b.addCylinder(x - 0.045, 0.31, z - 0.115, 0.024, 0.024, 0.28, 8, 'Y', 0, 3);
      b.addCylinder(x + 0.045, 0.31, z - 0.115, 0.024, 0.024, 0.28, 8, 'Y', 0, 3);
      // Pronounced beveled knee shield
      b.addBeveledBox(x, 0.50, z + 0.11, 0.175, 0.16, 0.105, 0.035, 0, 0);
      b.addBeveledBox(x, 0.50, z + 0.145, 0.105, 0.095, 0.04, 0.015, 0, 5);
      // Armored thigh + undersuit + outer utility pod
      b.addLimb([x, 0.49, z], [x * 0.86, 0.83, 0], 0.11, 0.12, 10, 0, 1);
      b.addTrapezoid(x * 0.92, 0.67, z * 0.45 + 0.01, 0.20, 0.22, 0.22, 0.24, 0.28, 0, 0, 5);
      b.addBeveledBox(x + side * 0.12, 0.67, z * 0.45, 0.075, 0.15, 0.12, 0.018, 0, 0);
    }
  }

  // Pelvis flex waist, armored codpiece & tactical hip tassets
  b.addBeveledBox(0, torsoBaseY - 0.07, 0, 0.42, 0.13, 0.28, 0.03, 0, 1);
  b.addTrapezoid(0, torsoBaseY - 0.08, 0.08, 0.16, 0.15, 0.24, 0.19, 0.19, 0, 0, 5);
  b.addBeveledBox(0, torsoBaseY - 0.02, 0.165, 0.14, 0.07, 0.05, 0.015, 0, 3);
  b.addBeveledBox(-0.25, torsoBaseY - 0.06, 0.02, 0.10, 0.16, 0.20, 0.025, 0, 0);
  b.addBeveledBox(0.25, torsoBaseY - 0.06, 0.02, 0.10, 0.16, 0.20, 0.025, 0, 0);

  // === 2. Articulated Upper CMC Armor: Cuirass, Gorget, Pauldrons, Jetpack & Helmet (partId = 1) ===
  // Broad heavy V-tapered chest armor
  b.addTrapezoid(0, torsoBaseY + 0.20, 0.01, 0.42, 0.30, 0.60, 0.40, 0.42, 0.02, 1, 5);
  b.addTrapezoid(0, torsoBaseY + 0.22, 0.18, 0.30, 0.12, 0.38, 0.16, 0.32, 0.02, 1, 0);
  b.addBeveledBox(-0.15, torsoBaseY + 0.29, 0.21, 0.16, 0.13, 0.07, 0.025, 1, 5);
  b.addBeveledBox(0.15, torsoBaseY + 0.29, 0.21, 0.16, 0.13, 0.07, 0.025, 1, 5);
  b.addBox(0, torsoBaseY + 0.27, 0.25, 0.10, 0.05, 0.03, 1, 2); // Central chest core light

  // High U-shaped armored gorget neck collar wrapping the helmet base
  b.addBeveledBox(0, torsoBaseY + 0.47, -0.17, 0.36, 0.18, 0.10, 0.03, 1, 5);
  for (const side of [-1, 1]) {
    b.withTransform(side * 0.20, torsoBaseY + 0.46, -0.02, 0.10, side * -0.45, side * -0.14, () => {
      b.addBeveledBox(0, 0, 0, 0.09, 0.16, 0.26, 0.025, 1, 5);
      b.addBeveledBox(side * -0.03, 0.04, 0, 0.04, 0.08, 0.22, 0.01, 1, 0);
    });
  }

  // Signature Giant Layered SC2 Shoulder Pauldrons
  for (const side of [-1, 1]) {
    b.addCapsule(side * 0.29, torsoBaseY + 0.30, -0.01, 0.115, 0.05, 'X', 10, 1, 1); // Inner joint
    b.withTransform(side * 0.42, torsoBaseY + 0.31, -0.01, 0.04, 0, side * -0.56, () => {
      b.addLathe(0, -0.04, 0, [
        [0.0, 0.245], [0.065, 0.242], [0.13, 0.212], [0.19, 0.145], [0.23, 0.02]
      ], 14, 'Y', 1, 5);
      b.addCylinder(0, -0.042, 0, 0.26, 0.252, 0.06, 14, 'Y', 1, 0); // Rim collar
      b.addBeveledBox(0, 0.11, 0, 0.085, 0.13, 0.33, 0.02, 1, 3); // Crest spine
      if (side < 0) {
        b.addBeveledBox(-0.18, 0.02, 0, 0.055, 0.055, 0.24, 0.01, 1, 4); // Squad hazard stripe
      }
    });
  }

  // Iconic Dorsal CMC Fusion Power-Pack + Twin Angled Jet-Turbine Pods
  b.addBeveledBox(0, torsoBaseY + 0.24, -0.28, 0.34, 0.38, 0.24, 0.04, 1, 0);
  b.addBeveledBox(0, torsoBaseY + 0.40, -0.28, 0.28, 0.11, 0.20, 0.03, 1, 5);
  b.addBox(0, torsoBaseY + 0.24, -0.405, 0.12, 0.16, 0.03, 1, 2); // Spine fusion glow
  for (const side of [-1, 1]) {
    b.withTransform(side * 0.20, torsoBaseY + 0.25, -0.34, -0.20, 0, side * -0.24, () => {
      b.addCylinder(0, 0, 0, 0.095, 0.115, 0.34, 12, 'Y', 1, 3);
      b.addCylinder(0, 0.185, 0, 0.105, 0.072, 0.07, 12, 'Y', 1, 1); // Top intake shroud
      b.addCylinder(0, -0.19, 0, 0.115, 0.085, 0.09, 12, 'Y', 1, 0); // Exhaust bell
      b.addCylinder(0, -0.23, 0, 0.078, 0.06, 0.04, 10, 'Y', 1, 2); // Jet core glow
    });
  }
  b.addCylinder(-0.13, torsoBaseY + 0.56, -0.34, 0.014, 0.010, 0.26, 6, 'Y', 1, 3); // Pack comms whip
  b.addBox(-0.13, torsoBaseY + 0.69, -0.34, 0.032, 0.032, 0.032, 1, 2);

  // Enclosed Powered Combat Helmet + Wrap-around Glowing Tactical Visor + Respirator Mask
  const headY = torsoBaseY + 0.55;
  b.addLathe(0, headY, 0.02, [
    [-0.08, 0.162], [-0.02, 0.180], [0.06, 0.168], [0.13, 0.120], [0.165, 0.02]
  ], 14, 'Y', 1, 5);
  b.addBeveledBox(0, headY + 0.085, 0.115, 0.22, 0.045, 0.095, 0.018, 1, 0); // Heavy brow hood
  b.addCylinder(0, headY + 0.018, 0.092, 0.152, 0.152, 0.086, 14, 'Y', 1, 2); // Prominent curved glowing SC2 visor
  b.addTrapezoid(0, headY - 0.082, 0.095, 0.18, 0.15, 0.21, 0.17, 0.095, 0.01, 1, 0); // Respirator jaw
  b.addCylinder(-0.10, headY - 0.08, 0.13, 0.04, 0.04, 0.07, 8, 'Z', 1, 3); // Cheek breather pods
  b.addCylinder(0.10, headY - 0.08, 0.13, 0.04, 0.04, 0.07, 8, 'Z', 1, 3);
  b.addBeveledBox(-0.17, headY + 0.01, 0.01, 0.06, 0.11, 0.11, 0.015, 1, 0); // Ear comms
  b.addBeveledBox(0.17, headY + 0.01, 0.01, 0.06, 0.11, 0.11, 0.015, 1, 0);
  b.addCylinder(0.18, headY + 0.11, 0.01, 0.014, 0.010, 0.15, 6, 'Y', 1, 3); // Helmet rangefinder

  // Chunky Armored Arms & Flared Gauntlets cradling the rifle
  const gunY = torsoBaseY + 0.05;
  b.addLimb([0.38, torsoBaseY + 0.22, 0.01], [0.35, gunY - 0.01, 0.07], 0.105, 0.095, 10, 1, 1);
  b.addLimb([0.35, gunY - 0.01, 0.07], [0.22, gunY, 0.28], 0.102, 0.082, 10, 1, 5);
  b.addBeveledBox(0.20, gunY + 0.01, 0.29, 0.11, 0.10, 0.11, 0.02, 1, 1); // Right armored gauntlet fist

  b.addLimb([-0.38, torsoBaseY + 0.22, 0.01], [-0.25, gunY - 0.04, 0.26], 0.105, 0.095, 10, 1, 1);
  b.addLimb([-0.25, gunY - 0.04, 0.26], [0.06, gunY - 0.01, 0.54], 0.102, 0.082, 10, 1, 5);
  b.addBeveledBox(0.08, gunY, 0.55, 0.11, 0.10, 0.11, 0.02, 1, 1); // Left armored gauntlet fist

  // === 3. Heavy C-14 Impaler-style Gauss Rifle (partId = 2 -> recoils cleanly along -Z) ===
  const gx = 0.17;
  b.addBeveledBox(gx, gunY + 0.02, 0.45, 0.125, 0.16, 0.52, 0.025, 2, 0); // Heavy angular receiver
  b.addBox(gx + 0.065, gunY + 0.02, 0.44, 0.02, 0.10, 0.36, 2, 5); // Faction casing trim
  b.addBeveledBox(gx + 0.02, gunY, 0.17, 0.085, 0.14, 0.21, 0.02, 2, 1); // Stock
  b.addCylinder(gx, gunY + 0.03, 0.85, 0.056, 0.046, 0.46, 10, 'Z', 2, 1); // Barrel shroud
  b.addBeveledBox(gx, gunY + 0.03, 1.07, 0.088, 0.098, 0.11, 0.015, 2, 3); // Muzzle compensator
  b.addTrapezoid(gx, gunY - 0.045, 0.90, 0.028, 0.20, 0.018, 0.13, 0.055, 0.03, 2, 3); // Bayonet lug
  b.addCylinder(gx, gunY - 0.095, 0.47, 0.105, 0.105, 0.15, 12, 'X', 2, 3); // Underslung rotary ammo drum
  b.addBox(gx - 0.05, gunY - 0.03, 0.47, 0.04, 0.06, 0.09, 2, 9); // Brass cartridge feed belt
  b.addBeveledBox(gx, gunY + 0.125, 0.46, 0.062, 0.058, 0.16, 0.012, 2, 0); // Reflex optic mount
  b.addBox(gx, gunY + 0.125, 0.535, 0.042, 0.038, 0.02, 2, 2); // Optic sight glow
  if (deployed) {
    b.addLimb([gx, gunY - 0.02, 0.78], [gx - 0.14, 0.41, 0.78], 0.024, 0.020, 6, 2, 1);
    b.addLimb([gx, gunY - 0.02, 0.78], [gx + 0.14, 0.41, 0.78], 0.024, 0.020, 6, 2, 1);
  }
}

// Shared heroic powered-exo & tactical infantry rig (boots strictly grounded y=0, articulated torso partId=1)
function addTrooperRig(b, cfg) {
  const {
    armorTone = 5,
    trimTone = 0,
    clothTone = 1,
    helmetTone = 5,
    visorTone = 2,
    bootTone = 1,
    scale = 1.0,
    heavy = false,
    shoulderStyle = heavy ? 'cmc' : 'medium', // 'cmc' | 'sleek' | 'medium' | 'coat'
    helmetStyle = heavy ? 'cmc' : 'goggles',  // 'cmc' | 'dome' | 'goggles' | 'stealth'
    chestCoreTone = null,
    weaponHands = 'rifle' // 'rifle' | 'heavy' | 'dual' | 'shoulder' | 'tools'
  } = cfg;
  const S = scale;
  const wScale = heavy ? 1.24 : 1.0;

  b.withTransform(0, 0, 0, 0, 0, 0, () => {
    // 1. Grounded combat boots & segmented armored greaves (partId = 0)
    const legs = [
      { x: -0.20 * wScale * S, z: 0.05 * S, side: -1 },
      { x: 0.20 * wScale * S, z: -0.05 * S, side: 1 }
    ];
    for (const { x, z, side } of legs) {
      b.addBox(x, 0.028 * S, z + 0.04 * S, 0.19 * wScale * S, 0.056 * S, 0.33 * S, 0, bootTone);
      b.addTrapezoid(x, 0.105 * S, z + 0.04 * S, 0.18 * wScale * S, 0.29 * S, 0.15 * wScale * S, 0.18 * S, 0.10 * S, -0.02 * S, 0, heavy ? armorTone : bootTone);
      b.addBeveledBox(x, 0.08 * S, z + 0.15 * S, 0.16 * wScale * S, 0.085 * S, 0.095 * S, 0.018 * S, 0, trimTone);
      // Shins & knee guards
      b.addTrapezoid(x, 0.30 * S, z, 0.20 * wScale * S, 0.21 * S, 0.165 * wScale * S, 0.18 * S, 0.30 * S, 0, 0, heavy ? armorTone : clothTone);
      b.addBeveledBox(x, 0.30 * S, z + 0.095 * S, 0.10 * wScale * S, 0.24 * S, 0.05 * S, 0.015 * S, 0, heavy ? trimTone : armorTone);
      b.addBeveledBox(x, 0.46 * S, z + 0.095 * S, 0.15 * wScale * S, 0.14 * S, 0.09 * S, 0.03 * S, 0, trimTone);
      // Thighs + armored cuisses
      b.addLimb([x, 0.45 * S, z], [x * 0.86, 0.77 * S, 0], 0.095 * wScale * S, 0.105 * wScale * S, 10, 0, clothTone);
      b.addTrapezoid(x * 0.92, 0.62 * S, z * 0.4, 0.175 * wScale * S, 0.19 * S, 0.195 * wScale * S, 0.21 * S, 0.25 * S, 0, 0, armorTone);
      b.addBeveledBox(x + side * 0.10 * wScale * S, 0.62 * S, z * 0.4, 0.065 * S, 0.13 * S, 0.10 * S, 0.015 * S, 0, trimTone);
    }

    // 2. Pelvis, belt & hip armor
    const pelvisY = 0.79 * S;
    b.addBeveledBox(0, pelvisY, 0, 0.38 * wScale * S, 0.12 * S, 0.26 * S, 0.025 * S, 0, bootTone);
    b.addTrapezoid(0, pelvisY - 0.01 * S, 0.07 * S, 0.14 * wScale * S, 0.14 * S, 0.21 * wScale * S, 0.17 * S, 0.17 * S, 0, 0, armorTone);
    b.addBeveledBox(0, pelvisY + 0.03 * S, 0.145 * S, 0.12 * S, 0.06 * S, 0.04 * S, 0.012 * S, 0, 3);

    // 3. Articulated Upper Torso & Armor (partId = 1)
    const torsoBaseY = 0.84 * S;
    b.addTrapezoid(0, torsoBaseY + 0.19 * S, 0.01 * S, 0.38 * wScale * S, 0.27 * wScale * S, 0.54 * wScale * S, 0.36 * wScale * S, 0.38 * S, 0.02 * S, 1, armorTone);
    b.addTrapezoid(0, torsoBaseY + 0.21 * S, 0.16 * wScale * S, 0.27 * wScale * S, 0.11 * S, 0.35 * wScale * S, 0.14 * S, 0.29 * S, 0.02 * S, 1, trimTone);
    b.addBeveledBox(-0.13 * wScale * S, torsoBaseY + 0.27 * S, 0.19 * wScale * S, 0.14 * wScale * S, 0.11 * S, 0.06 * S, 0.02 * S, 1, armorTone);
    b.addBeveledBox(0.13 * wScale * S, torsoBaseY + 0.27 * S, 0.19 * wScale * S, 0.14 * wScale * S, 0.11 * S, 0.06 * S, 0.02 * S, 1, armorTone);
    if (chestCoreTone !== null) {
      b.addCylinder(0, torsoBaseY + 0.26 * S, 0.22 * wScale * S, 0.055 * S, 0.055 * S, 0.04 * S, 12, 'Z', 1, chestCoreTone);
    }

    // 4. Shoulder Style & Gorget Collar
    const shY = torsoBaseY + 0.30 * S;
    const shX = (heavy ? 0.36 : (shoulderStyle === 'sleek' ? 0.29 : 0.31)) * S;
    if (shoulderStyle === 'cmc') {
      b.addBeveledBox(0, torsoBaseY + 0.44 * S, -0.16 * S, 0.34 * wScale * S, 0.16 * S, 0.09 * S, 0.028 * S, 1, armorTone);
      for (const side of [-1, 1]) {
        b.addCapsule(side * 0.27 * wScale * S, shY, -0.01 * S, 0.11 * S, 0.04 * S, 'X', 10, 1, 1);
        b.withTransform(side * 0.39 * wScale * S, shY, -0.01 * S, 0.04, 0, side * -0.54, () => {
          b.addLathe(0, -0.03 * S, 0, [
            [0.0, 0.22 * S], [0.06 * S, 0.215 * S], [0.12 * S, 0.185 * S], [0.18 * S, 0.125 * S], [0.21 * S, 0.02 * S]
          ], 14, 'Y', 1, armorTone);
          b.addCylinder(0, -0.035 * S, 0, 0.232 * S, 0.225 * S, 0.055 * S, 14, 'Y', 1, trimTone);
          b.addBeveledBox(0, 0.10 * S, 0, 0.075 * S, 0.11 * S, 0.29 * S, 0.018 * S, 1, 3);
        });
      }
    } else if (shoulderStyle === 'sleek') {
      for (const side of [-1, 1]) {
        b.withTransform(side * shX, shY, 0, 0.03, 0, side * -0.42, () => {
          b.addLathe(0, -0.02 * S, 0, [
            [0.0, 0.145 * S], [0.05 * S, 0.14 * S], [0.10 * S, 0.11 * S], [0.14 * S, 0.02 * S]
          ], 12, 'Y', 1, armorTone);
          b.addCylinder(0, -0.025 * S, 0, 0.155 * S, 0.15 * S, 0.035 * S, 12, 'Y', 1, trimTone);
        });
      }
    } else if (shoulderStyle === 'medium') {
      for (const side of [-1, 1]) {
        b.withTransform(side * shX, shY, 0, 0.04, 0, side * -0.35, () => {
          b.addBeveledBox(0, 0, 0, 0.18 * S, 0.16 * S, 0.22 * S, 0.04 * S, 1, trimTone);
          b.addBeveledBox(0, 0.03 * S, 0, 0.13 * S, 0.11 * S, 0.18 * S, 0.025 * S, 1, armorTone);
        });
      }
    } else {
      // 'coat': tailored armored coat shoulders
      b.addBeveledBox(-0.27 * S, shY - 0.02 * S, 0, 0.14 * S, 0.14 * S, 0.20 * S, 0.035 * S, 1, armorTone);
      b.addBeveledBox(0.27 * S, shY - 0.02 * S, 0, 0.14 * S, 0.14 * S, 0.20 * S, 0.035 * S, 1, armorTone);
    }

    // 5. Helmet / Faceplate Styles (zero toy-skin gaps!)
    const headY = torsoBaseY + 0.51 * S;
    if (helmetStyle === 'cmc') {
      b.addLathe(0, headY, 0.02 * S, [
        [-0.075 * S, 0.15 * S], [-0.02 * S, 0.165 * S], [0.055 * S, 0.155 * S], [0.12 * S, 0.11 * S], [0.155 * S, 0.02 * S]
      ], 14, 'Y', 1, helmetTone);
      b.addBeveledBox(0, headY + 0.075 * S, 0.11 * S, 0.21 * S, 0.045 * S, 0.09 * S, 0.016 * S, 1, trimTone);
      b.addCylinder(0, headY + 0.015 * S, 0.088 * S, 0.142 * S, 0.142 * S, 0.08 * S, 14, 'Y', 1, visorTone);
      b.addTrapezoid(0, headY - 0.078 * S, 0.088 * S, 0.17 * S, 0.14 * S, 0.20 * S, 0.16 * S, 0.09 * S, 0.01 * S, 1, trimTone);
    } else if (helmetStyle === 'dome') {
      // Sleek full-face Chrono/Rocketeer spherical-oval combat helmet
      b.addLathe(0, headY + 0.01 * S, 0.01 * S, [
        [-0.08 * S, 0.135 * S], [-0.01 * S, 0.162 * S], [0.07 * S, 0.152 * S], [0.13 * S, 0.105 * S], [0.165 * S, 0.02 * S]
      ], 14, 'Y', 1, helmetTone);
      b.addCapsule(0, headY + 0.01 * S, 0.08 * S, 0.095 * S, 0.05 * S, 'Y', 12, 1, visorTone);
      b.addBeveledBox(-0.155 * S, headY, 0, 0.05 * S, 0.09 * S, 0.10 * S, 0.015 * S, 1, trimTone);
      b.addBeveledBox(0.155 * S, headY, 0, 0.05 * S, 0.09 * S, 0.10 * S, 0.015 * S, 1, trimTone);
    } else if (helmetStyle === 'stealth') {
      // Balaclava + glowing dual NVG tactical goggles
      b.addCapsule(0, headY + 0.01 * S, 0.01 * S, 0.135 * S, 0.07 * S, 'Y', 12, 1, bootTone);
      b.addBeveledBox(0, headY + 0.03 * S, 0.11 * S, 0.18 * S, 0.065 * S, 0.07 * S, 0.015 * S, 1, trimTone);
      b.addCylinder(-0.048 * S, headY + 0.03 * S, 0.14 * S, 0.035 * S, 0.035 * S, 0.04 * S, 10, 'Z', 1, visorTone);
      b.addCylinder(0.048 * S, headY + 0.03 * S, 0.14 * S, 0.035 * S, 0.035 * S, 0.04 * S, 10, 'Z', 1, visorTone);
    } else {
      // 'goggles': Steel/Hazard M1 dome + tinted combat goggles + respirator mask
      b.addCapsule(0, headY, 0.01 * S, 0.125 * S, 0.06 * S, 'Y', 12, 1, bootTone); // Sealed balaclava head
      b.addLathe(0, headY + 0.04 * S, 0, [
        [-0.03 * S, 0.17 * S], [0.02 * S, 0.165 * S], [0.075 * S, 0.145 * S], [0.125 * S, 0.095 * S], [0.145 * S, 0.02 * S]
      ], 14, 'Y', 1, helmetTone);
      b.addBeveledBox(0, headY + 0.02 * S, 0.115 * S, 0.18 * S, 0.058 * S, 0.065 * S, 0.015 * S, 1, visorTone);
      b.addCylinder(0, headY - 0.055 * S, 0.11 * S, 0.065 * S, 0.055 * S, 0.07 * S, 10, 'Z', 1, trimTone);
    }

    // 6. Articulated Arms & Gauntlets (partId = 1)
    const gunY = torsoBaseY + 0.05 * S;
    const armR = (heavy ? 0.098 : 0.072) * S;
    const armForeR = (heavy ? 0.092 : 0.068) * S;
    if (weaponHands === 'dual') {
      b.addLimb([-shX + 0.02 * S, shY - 0.08 * S, 0], [-0.28 * S, gunY - 0.02 * S, 0.12 * S], armR, armForeR, 8, 1, clothTone);
      b.addLimb([-0.28 * S, gunY - 0.02 * S, 0.12 * S], [-0.22 * S, gunY, 0.34 * S], armForeR, armForeR * 0.85, 8, 1, armorTone);
      b.addLimb([shX - 0.02 * S, shY - 0.08 * S, 0], [0.28 * S, gunY - 0.02 * S, 0.12 * S], armR, armForeR, 8, 1, clothTone);
      b.addLimb([0.28 * S, gunY - 0.02 * S, 0.12 * S], [0.22 * S, gunY, 0.34 * S], armForeR, armForeR * 0.85, 8, 1, armorTone);
    } else if (weaponHands === 'tools') {
      // Left arm carries heavy toolbox low at side; right arm holds wrench forward
      b.addLimb([-shX, shY - 0.07 * S, 0], [-0.34 * S, torsoBaseY - 0.06 * S, 0.04 * S], armR, armForeR, 8, 1, armorTone);
      b.addLimb([-0.34 * S, torsoBaseY - 0.06 * S, 0.04 * S], [-0.33 * S, torsoBaseY - 0.28 * S, 0.08 * S], armForeR, armForeR * 0.85, 8, 1, trimTone);
      b.addLimb([shX, shY - 0.07 * S, 0], [0.30 * S, gunY - 0.03 * S, 0.14 * S], armR, armForeR, 8, 1, armorTone);
      b.addLimb([0.30 * S, gunY - 0.03 * S, 0.14 * S], [0.24 * S, gunY + 0.06 * S, 0.34 * S], armForeR, armForeR * 0.85, 8, 1, trimTone);
    } else if (weaponHands === 'shoulder') {
      // High right shoulder launcher grip + left forward support grip
      b.addLimb([shX, shY - 0.06 * S, 0], [0.34 * S, shY - 0.04 * S, 0.18 * S], armR, armForeR, 8, 1, clothTone);
      b.addLimb([0.34 * S, shY - 0.04 * S, 0.18 * S], [0.24 * S, shY + 0.06 * S, 0.32 * S], armForeR, armForeR * 0.85, 8, 1, bootTone);
      b.addLimb([-shX, shY - 0.07 * S, 0], [-0.14 * S, shY - 0.06 * S, 0.28 * S], armR, armForeR, 8, 1, clothTone);
      b.addLimb([-0.14 * S, shY - 0.06 * S, 0.28 * S], [0.16 * S, shY + 0.06 * S, 0.46 * S], armForeR, armForeR * 0.85, 8, 1, bootTone);
    } else {
      // 'heavy' or 'rifle' two-handed combat hold
      const gx = (heavy ? 0.20 : 0.15) * S;
      b.addLimb([shX - 0.02 * S, shY - 0.08 * S, 0.01 * S], [shX - 0.03 * S, gunY - 0.01 * S, 0.08 * S], armR, armForeR, 8, 1, clothTone);
      b.addLimb([shX - 0.03 * S, gunY - 0.01 * S, 0.08 * S], [gx + 0.03 * S, gunY, 0.25 * S], armForeR, armForeR * 0.85, 8, 1, armorTone);
      b.addLimb([-shX + 0.02 * S, shY - 0.08 * S, 0.01 * S], [-0.21 * S, gunY - 0.04 * S, 0.23 * S], armR, armForeR, 8, 1, clothTone);
      b.addLimb([-0.21 * S, gunY - 0.04 * S, 0.23 * S], [gx - 0.08 * S, gunY - 0.01 * S, 0.49 * S], armForeR, armForeR * 0.85, 8, 1, armorTone);
    }
  });
}

// High-detail procedural CAD blueprints for units & buildings + clean coverage for all 49 canonical IDs.
export function buildProceduralGeometryData(typeId) {
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
      // Heavy Armed Ore Harvester: Beveled reinforced hull, panoramic cab glass, armored ore dump hopper & helical hazard crusher
      b.addTrapezoid(0, 0.52, -0.2, 1.88, 3.0, 1.72, 2.7, 0.66, 0, 0, 0);
      b.addTrackAssembly(-1.12, 0.46, -0.2, 0.48, 0.78, 3.15, 5, 0);
      b.addTrackAssembly(1.12, 0.46, -0.2, 0.48, 0.78, 3.15, 5, 0);
      // Armored rear ore dump bin + faction side rails + exhaust stacks
      b.addTrapezoid(0, 1.24, -0.72, 1.76, 1.88, 1.92, 2.04, 0.78, 0, 0, 3);
      b.addBeveledBox(-0.92, 1.28, -0.72, 0.16, 0.56, 1.75, 0.03, 0, 5);
      b.addBeveledBox(0.92, 1.28, -0.72, 0.16, 0.56, 1.75, 0.03, 0, 5);
      b.addCylinder(-0.62, 1.52, -1.64, 0.08, 0.08, 0.85, 8, 'Y', 0, 1);
      b.addCylinder(0.62, 1.52, -1.64, 0.08, 0.08, 0.85, 8, 'Y', 0, 1);
      // Forward armored cab + panoramic tinted glass
      b.addTrapezoid(0, 1.18, 0.68, 1.58, 0.98, 1.38, 0.78, 0.78, -0.06, 0, 0);
      b.addBeveledBox(0, 1.28, 1.12, 1.22, 0.34, 0.18, 0.03, 0, 6);
      b.addCylinder(0, 1.66, 0.68, 0.12, 0.10, 0.18, 8, 'Y', 0, 2); // Warning beacon
      // Articulated Hazard Front Scoop & Helical Crusher Drum (part 2)
      b.addTrapezoid(0, 0.56, 1.58, 2.12, 0.86, 1.96, 0.56, 0.56, -0.1, 2, 4);
      b.addCylinder(0, 0.54, 1.98, 0.36, 0.36, 1.94, 12, 'X', 2, 1);
      b.addBox(0, 0.54, 1.98, 1.72, 0.52, 0.12, 2, 3);
      break;
    }

    case 'mcv': {
      // Massive 6-Wheel Mobile Construction Vehicle with beveled sleeper cab, folded crane boom & hazard command module
      b.addTrapezoid(0, 0.66, 0, 2.22, 4.35, 2.02, 4.05, 0.82, 0, 0, 0);
      for (const wz of [-1.35, 0.05, 1.45]) {
        b.addCylinder(-1.24, 0.48, wz, 0.48, 0.48, 0.40, 12, 'X', 0, 1);
        b.addCylinder(-1.24, 0.48, wz, 0.24, 0.24, 0.44, 10, 'X', 0, 3);
        b.addCylinder(1.24, 0.48, wz, 0.48, 0.48, 0.40, 12, 'X', 0, 1);
        b.addCylinder(1.24, 0.48, wz, 0.24, 0.24, 0.44, 10, 'X', 0, 3);
      }
      // Rear folded prefab assembly core + faction armor panels + twin crane rails
      b.addBeveledBox(0, 1.52, -0.52, 1.96, 0.94, 2.45, 0.08, 0, 4);
      b.addBeveledBox(-1.0, 1.52, -0.52, 0.14, 0.72, 2.2, 0.03, 0, 5);
      b.addBeveledBox(1.0, 1.52, -0.52, 0.14, 0.72, 2.2, 0.03, 0, 5);
      b.addBeveledBox(0, 2.08, -0.52, 0.72, 0.34, 2.35, 0.05, 1, 1);
      // Forward armored command truck nose + panoramic blue cockpit glass + radar mast
      b.addTrapezoid(0, 1.44, 1.48, 2.0, 1.18, 1.72, 0.88, 0.84, -0.08, 0, 0);
      b.addBeveledBox(0, 1.56, 1.98, 1.52, 0.32, 0.16, 0.03, 0, 6);
      b.addBox(0, 1.18, 2.12, 1.86, 0.22, 0.16, 0, 4);
      b.addCylinder(-0.82, 1.88, 1.12, 0.07, 0.06, 0.78, 8, 'Y', 0, 1);
      b.addCylinder(0.82, 1.88, 1.12, 0.07, 0.06, 0.78, 8, 'Y', 0, 1);
      break;
    }

    case 'conyard': {
      // Iconic RA2 Construction Yard: Beveled concrete deck, central vaulted assembly bay, glass command tower & articulated truss crane
      addConcretePad(b, 7.8, 7.8, 0.52, 0.92, true);
      addVaultedHall(b, -1.45, 0.52, -1.15, 3.85, 4.4, 2.35, 4, 0, 3);
      // Central glass-walled command bunker + glowing assembly beacon
      b.addBeveledBox(1.65, 1.32, 1.35, 3.1, 1.6, 3.2, 0.1, 0, 1);
      b.addBeveledBox(1.65, 1.68, 2.94, 2.2, 0.42, 0.12, 0.03, 0, 6);
      b.addBeveledBox(-1.45, 3.05, -1.15, 1.65, 0.38, 1.65, 0.05, 0, 2);
      // Rotating heavy fabrication crane boom (part 1 & 2) with truss jib
      b.addCylinder(1.35, 1.95, -1.45, 0.78, 0.56, 2.9, 12, 'Y', 1, 4);
      b.addCylinder(1.35, 3.45, -1.45, 0.62, 0.48, 0.38, 12, 'Y', 1, 5);
      b.addLimb([1.35, 3.55, -1.45], [1.35, 4.65, 1.65], 0.34, 0.24, 8, 1, 5);
      b.addLimb([1.35, 3.45, -2.55], [1.35, 4.65, 1.65], 0.14, 0.10, 6, 1, 3);
      b.addBeveledBox(1.35, 3.5, -2.6, 1.15, 0.75, 1.15, 0.06, 1, 1); // Counterweight block
      b.addLimb([1.35, 4.65, 1.65], [1.35, 3.35, 1.65], 0.10, 0.08, 6, 2, 3); // Hoist cable
      b.addBeveledBox(1.35, 3.15, 1.65, 0.56, 0.42, 0.56, 0.05, 2, 2); // Crane electromagnet
      break;
    }

    case 'power_plant': {
      addConcretePad(b, 3.9, 3.9, 0.44, 0.88, false);
      addVaultedHall(b, 0, 0.44, -0.82, 3.3, 1.85, 1.45, 3, 0, 5);
      for (const px of [-0.88, 0.88]) {
        addCoolingTower(b, px, 0.44, 0.78, 0.74, 0.50, 0.64, 2.25, true);
        b.addLimb([px, 1.2, 0.1], [px, 1.2, -0.4], 0.14, 0.14, 8, 0, 3);
      }
      break;
    }

    case 'nuclear_reactor': {
      addConcretePad(b, 5.8, 5.8, 0.48, 0.90, true);
      addCoolingTower(b, -0.75, 0.48, -0.65, 1.65, 1.12, 1.42, 2.95, true);
      // Secondary steam dome containment vessel + glowing cooling pipes
      b.addLathe(1.45, 0.48, 1.15, [[0, 1.18], [1.35, 1.15], [1.95, 0.78], [2.25, 0.15]], 14, 'Y', 0, 0);
      b.addTorus(1.45, 1.75, 1.15, 1.05, 0.12, 16, 8, 0, 0, 0, 5);
      b.addLimb([-0.75, 1.6, -0.65], [1.45, 1.45, 1.15], 0.24, 0.22, 8, 0, 3);
      b.addCylinder(1.45, 2.75, 1.15, 0.28, 0.28, 0.4, 10, 'Y', 0, 2);
      break;
    }

    case 'refinery': {
      addConcretePad(b, 5.8, 5.8, 0.44, 0.90, false);
      addVaultedHall(b, -1.15, 0.44, -1.05, 2.95, 3.15, 2.35, 3, 0, 3);
      // Molten ore smelter vessel + glowing top crucible + twin smoke stacks
      b.addCylinder(1.45, 1.75, -1.05, 1.05, 0.84, 2.65, 12, 'Y', 0, 1);
      b.addTorus(1.45, 2.95, -1.05, 0.78, 0.14, 14, 8, 0, 0, 0, 2);
      b.addCylinder(1.15, 2.9, -2.05, 0.24, 0.18, 1.85, 8, 'Y', 0, 1);
      b.addCylinder(1.85, 2.9, -1.85, 0.24, 0.18, 1.85, 8, 'Y', 0, 1);
      // Unloading dock apron & conveyor ramp
      b.addBeveledBox(0.2, 0.72, 1.65, 4.1, 0.56, 1.95, 0.06, 0, 1);
      b.addBox(0.2, 1.04, 2.48, 3.85, 0.22, 0.38, 0, 4);
      b.addLimb([-0.5, 1.05, 1.1], [1.25, 2.1, -0.7], 0.26, 0.22, 8, 0, 3);
      break;
    }

    case 'war_factory': {
      // RA2 Iconic Vaulted Tank Assembly Hangar + Wide Hazard Apron + Double Blast Doors + Twin Stacks
      addConcretePad(b, 7.8, 5.8, 0.46, 0.94, false);
      addVaultedHall(b, 0, 0.46, -0.95, 7.0, 3.35, 2.85, 5, 0, 3);
      // Double armored flanking piers & illuminated bay portal
      b.addBeveledBox(-2.55, 1.48, 1.15, 1.75, 2.15, 2.55, 0.08, 0, 1);
      b.addBeveledBox(2.55, 1.48, 1.15, 1.75, 2.15, 2.55, 0.08, 0, 1);
      b.addBeveledBox(0, 2.48, 1.15, 3.9, 0.62, 2.35, 0.06, 0, 5);
      b.addBeveledBox(0, 1.38, 0.42, 3.35, 1.72, 0.16, 0.03, 0, 6); // Blast bay skylight
      b.addBox(0, 0.52, 2.15, 3.7, 0.12, 1.25, 0, 4); // Exit hazard stripes
      b.addBox(-2.55, 2.7, 1.15, 0.65, 0.45, 0.65, 0, 2);
      b.addBox(2.55, 2.7, 1.15, 0.65, 0.45, 0.65, 0, 2);
      break;
    }

    case 'naval_yard': {
      b.addBeveledBox(-2.75, 0.78, 0, 1.95, 1.25, 7.45, 0.08, 0, 3);
      b.addBeveledBox(2.75, 0.78, 0, 1.95, 1.25, 7.45, 0.08, 0, 3);
      b.addBeveledBox(0, 0.94, -2.95, 7.3, 1.5, 1.65, 0.08, 0, 0);
      b.addBeveledBox(-2.75, 1.52, 0, 0.62, 0.28, 6.85, 0.03, 0, 4);
      b.addBeveledBox(2.75, 1.52, 0, 0.62, 0.28, 6.85, 0.03, 0, 4);
      // Heavy overhead gantry crane truss + floodlight beacons
      b.addBeveledBox(0, 3.45, 0.85, 6.95, 0.58, 0.95, 0.06, 0, 4);
      b.addLimb([-2.85, 1.4, 0.85], [-2.85, 3.45, 0.85], 0.24, 0.20, 8, 0, 1);
      b.addLimb([2.85, 1.4, 0.85], [2.85, 3.45, 0.85], 0.24, 0.20, 8, 0, 1);
      b.addLimb([-2.85, 1.4, 0.2], [-2.85, 3.35, 0.85], 0.12, 0.12, 6, 0, 3);
      b.addLimb([2.85, 1.4, 0.2], [2.85, 3.35, 0.85], 0.12, 0.12, 6, 0, 3);
      b.addBox(-2.85, 3.82, 0.85, 0.42, 0.25, 0.42, 0, 2);
      b.addBox(2.85, 3.82, 0.85, 0.42, 0.25, 0.42, 0, 2);
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
      addMarineArmor(b, { deployed: false });
      break;
    }

    case 'gi_deployed': {
      addMarineArmor(b, { deployed: true });
      break;
    }

    case 'conscript': {
      // Crimson Foundry Trenchcoat Rifleman: greatcoat panels, webbed belt, helmet + goggles/mask, assault rifle
      const S = 1.0;
      const gunY = 0.89 * S;
      addTrooperRig(b, {
        armorTone: 5, trimTone: 0, clothTone: 7, helmetTone: 0, visorTone: 6, bootTone: 1,
        scale: S, shoulderStyle: 'coat', helmetStyle: 'goggles', weaponHands: 'rifle'
      });
      // Flared split greatcoat skirt (partId = 0, boots/knees cleanly articulated)
      b.addTrapezoid(0, 0.56, -0.05, 0.50, 0.34, 0.42, 0.26, 0.46, -0.04, 0, 5);
      b.addBeveledBox(-0.14, 0.56, 0.08, 0.21, 0.42, 0.14, 0.025, 0, 5);
      b.addBeveledBox(0.14, 0.56, 0.08, 0.21, 0.42, 0.14, 0.025, 0, 5);
      // Trenchcoat crimson collar & ammo webbing pouches (partId = 1)
      b.addBeveledBox(0, 1.19, -0.03, 0.30, 0.11, 0.24, 0.025, 1, 5);
      b.addBeveledBox(0, 0.90, -0.20, 0.28, 0.30, 0.14, 0.03, 1, 7);
      b.addBeveledBox(-0.14, 0.84, 0.17, 0.10, 0.10, 0.07, 0.015, 0, 0);
      b.addBeveledBox(0.14, 0.84, 0.17, 0.10, 0.10, 0.07, 0.015, 0, 0);
      // Tactical bullpup/AK assault rifle (partId = 2)
      b.addBeveledBox(0.15, gunY + 0.01, 0.20, 0.055, 0.095, 0.22, 0.012, 2, 1);
      b.addBeveledBox(0.15, gunY + 0.02, 0.44, 0.062, 0.105, 0.36, 0.015, 2, 0);
      b.addBeveledBox(0.15, gunY + 0.09, 0.40, 0.042, 0.045, 0.26, 0.01, 2, 1);
      b.addCylinder(0.15, gunY + 0.03, 0.75, 0.024, 0.019, 0.36, 8, 'Z', 2, 1);
      b.addLimb([0.15, gunY - 0.03, 0.46], [0.15, gunY - 0.16, 0.52], 0.025, 0.021, 6, 2, 1);
      break;
    }

    case 'flak_trooper': {
      // Heavy Flak Trooper: khaki sleeves/trousers, gunmetal flak vest, twin crimson tanks, shoulder flak cannon
      const S = 1.06;
      const shY = (0.84 + 0.30) * S;
      addTrooperRig(b, {
        armorTone: 0, trimTone: 5, clothTone: 7, helmetTone: 0, visorTone: 6, bootTone: 1,
        scale: S, shoulderStyle: 'medium', helmetStyle: 'goggles', weaponHands: 'shoulder'
      });
      // Twin dorsal propellant cylinders (partId = 1 so they rotate with torso)
      b.addCapsule(-0.14 * S, 1.02 * S, -0.22 * S, 0.085 * S, 0.28 * S, 'Y', 10, 1, 5);
      b.addCapsule(0.14 * S, 1.02 * S, -0.22 * S, 0.085 * S, 0.28 * S, 'Y', 10, 1, 5);
      b.addCylinder(-0.14 * S, 1.21 * S, -0.22 * S, 0.055 * S, 0.055 * S, 0.06 * S, 10, 'Y', 1, 3);
      b.addCylinder(0.14 * S, 1.21 * S, -0.22 * S, 0.055 * S, 0.055 * S, 0.06 * S, 10, 'Y', 1, 3);
      // Heavy over-shoulder flak rocket tube (partId = 2)
      b.withTransform(0.24 * S, shY + 0.09 * S, 0.16 * S, -0.06, 0, 0, () => {
        b.addCylinder(0, 0, 0.06 * S, 0.095 * S, 0.088 * S, 0.96 * S, 12, 'Z', 2, 0);
        b.addCylinder(0, 0, 0.54 * S, 0.118 * S, 0.098 * S, 0.16 * S, 12, 'Z', 2, 1);
        b.addCylinder(0, 0, -0.42 * S, 0.085 * S, 0.112 * S, 0.14 * S, 12, 'Z', 2, 1);
        b.addBeveledBox(0, 0.02 * S, 0.20 * S, 0.19 * S, 0.12 * S, 0.24 * S, 0.02 * S, 2, 5);
      });
      break;
    }

    case 'engineer': {
      // Hazard Yellow Engineer: Tone 8 industrial suit, gunmetal chest trim, left toolbox, right steel pipe wrench
      const S = 1.0;
      const gunY = 0.89 * S;
      addTrooperRig(b, {
        armorTone: 8, trimTone: 0, clothTone: 1, helmetTone: 8, visorTone: 6, bootTone: 1,
        scale: S, shoulderStyle: 'medium', helmetStyle: 'goggles', weaponHands: 'tools'
      });
      // Armored tool backpack (partId = 1)
      b.addBeveledBox(0, 1.02, -0.21, 0.34, 0.36, 0.17, 0.04, 1, 0);
      b.addBeveledBox(0, 1.12, -0.27, 0.24, 0.12, 0.08, 0.02, 1, 8);
      // Left-hand heavy rugged gunmetal toolbox with chrome handle (partId = 1)
      b.addBeveledBox(-0.34, 0.42, 0.08, 0.14, 0.24, 0.34, 0.025, 1, 0);
      b.addBeveledBox(-0.34, 0.42, 0.08, 0.15, 0.05, 0.32, 0.01, 1, 8);
      b.addBeveledBox(-0.34, 0.56, 0.08, 0.04, 0.05, 0.14, 0.01, 1, 3);
      // Right-hand heavy steel pipe wrench (partId = 2)
      b.addLimb([0.24, gunY - 0.02, 0.28], [0.24, gunY + 0.24, 0.54], 0.030, 0.028, 8, 2, 3);
      b.addBeveledBox(0.24, gunY + 0.26, 0.56, 0.075, 0.095, 0.12, 0.015, 2, 0);
      b.addBeveledBox(0.24, gunY + 0.29, 0.58, 0.082, 0.045, 0.08, 0.01, 2, 3);
      break;
    }

    case 'rocketeer': {
      // Abyssal Jump-Jet Rocketeer: sleek cobalt exo, curved dome visor, twin jet thrusters + fins, pulse rifle
      const S = 1.04;
      const gunY = 0.89 * S;
      addTrooperRig(b, {
        armorTone: 5, trimTone: 0, clothTone: 1, helmetTone: 5, visorTone: 3, bootTone: 1,
        scale: S, shoulderStyle: 'sleek', helmetStyle: 'dome', chestCoreTone: 2, weaponHands: 'heavy'
      });
      // Twin angled turbine thruster pods + compact jump fins (partId = 1)
      b.addBeveledBox(0, 1.04 * S, -0.19 * S, 0.26 * S, 0.28 * S, 0.14 * S, 0.03 * S, 1, 0);
      for (const side of [-1, 1]) {
        b.withTransform(side * 0.16 * S, 1.04 * S, -0.25 * S, 0.08, 0, side * -0.16, () => {
          b.addCapsule(0, 0.04 * S, 0, 0.082 * S, 0.30 * S, 'Y', 10, 1, 3);
          b.addCylinder(0, 0.20 * S, 0, 0.088 * S, 0.065 * S, 0.10 * S, 10, 'Y', 1, 5);
          b.addCylinder(0, -0.18 * S, 0, 0.072 * S, 0.048 * S, 0.12 * S, 10, 'Y', 1, 0);
          b.addCylinder(0, -0.26 * S, 0, 0.042 * S, 0.016 * S, 0.12 * S, 10, 'Y', 1, 2); // Cyan plasma thrust glow
        });
        b.addSweptWing(side, side * 0.18 * S, 1.06 * S, -0.23 * S, 0.56 * S, 0.26 * S, 0.11 * S, 0.14 * S, 0.07 * S, 0.04 * S, 1, 5);
      }
      // Dual-pod pulse rocket carbine (partId = 2)
      b.addBeveledBox(0.18 * S, gunY + 0.02 * S, 0.34 * S, 0.11 * S, 0.13 * S, 0.48 * S, 0.022 * S, 2, 0);
      b.addCylinder(0.18 * S, gunY + 0.05 * S, 0.68 * S, 0.042 * S, 0.038 * S, 0.36 * S, 10, 'Z', 2, 3);
      b.addCylinder(0.18 * S, gunY - 0.02 * S, 0.64 * S, 0.035 * S, 0.032 * S, 0.30 * S, 10, 'Z', 2, 5);
      break;
    }

    case 'tesla_trooper': {
      // Heavy Crimson CMC Exo Tesla Trooper: bulky exo plates, twin angled copper Tesla coils (Tone 9), arc cannon
      const S = 1.15;
      const gunY = 0.89 * S;
      addTrooperRig(b, {
        armorTone: 5, trimTone: 0, clothTone: 1, helmetTone: 5, visorTone: 2, bootTone: 1,
        heavy: true, scale: S, shoulderStyle: 'cmc', helmetStyle: 'cmc', chestCoreTone: 2, weaponHands: 'heavy'
      });
      // Dorsal heavy reactor pack & twin V-angled copper Tesla coils (partId = 1)
      b.addBeveledBox(0, 1.04 * S, -0.24 * S, 0.42 * S, 0.38 * S, 0.20 * S, 0.04 * S, 1, 0);
      for (const side of [-1, 1]) {
        b.withTransform(side * 0.21 * S, 1.24 * S, -0.27 * S, -0.14, 0, side * -0.26, () => {
          b.addCylinder(0, 0.18 * S, 0, 0.075 * S, 0.062 * S, 0.44 * S, 12, 'Y', 1, 9); // Copper core
          b.addTorus(0, 0.06 * S, 0, 0.105 * S, 0.024 * S, 12, 6, 0, 0, 0, 3);
          b.addTorus(0, 0.18 * S, 0, 0.115 * S, 0.026 * S, 12, 6, 0, 0, 0, 9);
          b.addTorus(0, 0.30 * S, 0, 0.125 * S, 0.028 * S, 12, 6, 0, 0, 0, 3);
          b.addCapsule(0, 0.42 * S, 0, 0.072 * S, 0.02 * S, 'Y', 10, 1, 2); // Cyan HV discharge sphere
        });
      }
      // Heavy forearm-mounted Tesla arc projector (partId = 2)
      b.addBeveledBox(0.22 * S, gunY + 0.01 * S, 0.36 * S, 0.14 * S, 0.15 * S, 0.44 * S, 0.03 * S, 2, 0);
      b.addCylinder(0.22 * S, gunY + 0.01 * S, 0.64 * S, 0.085 * S, 0.065 * S, 0.34 * S, 12, 'Z', 2, 9);
      b.addTorus(0.22 * S, gunY + 0.01 * S, 0.72 * S, 0.095 * S, 0.022 * S, 12, 6, Math.PI * 0.5, 0, 0, 3);
      b.addCapsule(0.22 * S, gunY + 0.01 * S, 0.86 * S, 0.068 * S, 0.02 * S, 'Z', 10, 2, 2);
      break;
    }

    case 'chrono': {
      // Titanium Silver-White Chrono Legionnaire: sleek white-silver armor, blue trim, glowing Chrono gyro pack, phase carbine
      const S = 1.02;
      const gunY = 0.89 * S;
      addTrooperRig(b, {
        armorTone: 3, trimTone: 5, clothTone: 1, helmetTone: 3, visorTone: 2, bootTone: 3,
        scale: S, shoulderStyle: 'sleek', helmetStyle: 'dome', chestCoreTone: 2, weaponHands: 'rifle'
      });
      // Dorsal Chrono gyro backpack with glowing cyan energy ring (partId = 1)
      b.addBeveledBox(0, 1.02 * S, -0.18 * S, 0.28 * S, 0.30 * S, 0.13 * S, 0.035 * S, 1, 0);
      b.addTorus(0, 1.08 * S, -0.30 * S, 0.21 * S, 0.046 * S, 16, 8, Math.PI * 0.46, 0, 0, 2);
      b.addCylinder(0, 1.08 * S, -0.30 * S, 0.105 * S, 0.105 * S, 0.085 * S, 12, 'Z', 1, 3);
      // Futuristic Chrono Phase Carbine with glowing cyan emitter rail (partId = 2)
      b.addBeveledBox(0.15 * S, gunY + 0.01 * S, 0.34 * S, 0.08 * S, 0.12 * S, 0.52 * S, 0.02 * S, 2, 0);
      b.addBeveledBox(0.15 * S, gunY + 0.04 * S, 0.42 * S, 0.088 * S, 0.045 * S, 0.42 * S, 0.012 * S, 2, 3);
      b.addCylinder(0.15 * S, gunY + 0.01 * S, 0.68 * S, 0.045 * S, 0.035 * S, 0.36 * S, 12, 'Z', 2, 2);
      b.addBeveledBox(0.15 * S, gunY + 0.01 * S, 0.84 * S, 0.068 * S, 0.072 * S, 0.14 * S, 0.015 * S, 2, 3);
      break;
    }

    case 'shadow': {
      // Tactical Stealth Commando "Shadow": matte carbon suit, blue armor trim, NVG goggles, twin suppressed pistols
      const S = 1.0;
      const gunY = 0.89 * S;
      addTrooperRig(b, {
        armorTone: 5, trimTone: 0, clothTone: 1, helmetTone: 1, visorTone: 2, bootTone: 1,
        scale: S, shoulderStyle: 'sleek', helmetStyle: 'stealth', weaponHands: 'dual'
      });
      // Slim matte stealth pack & chest utility rig (partId = 1)
      b.addBeveledBox(0, 1.02, -0.18, 0.24, 0.28, 0.11, 0.025, 1, 1);
      // Twin suppressed tactical pistols (partId = 2)
      for (const side of [-1, 1]) {
        b.addBeveledBox(side * 0.22, gunY + 0.02, 0.40, 0.045, 0.075, 0.20, 0.01, 2, 0);
        b.addCylinder(side * 0.22, gunY + 0.03, 0.62, 0.028, 0.026, 0.26, 10, 'Z', 2, 1);
      }
      break;
    }

    case 'sledge': {
      // Juggernaut Demo Hero "Sledge": massive powered crimson CMC exo, caution-amber shield, siege mortar
      const S = 1.24;
      const gunY = 0.89 * S;
      addTrooperRig(b, {
        armorTone: 5, trimTone: 0, clothTone: 1, helmetTone: 5, visorTone: 2, bootTone: 1,
        heavy: true, scale: S, shoulderStyle: 'cmc', helmetStyle: 'cmc', chestCoreTone: 2, weaponHands: 'heavy'
      });
      // Dorsal heavy siege pack & left industrial amber blast shield (partId = 1)
      b.addBeveledBox(0, 1.04 * S, -0.25 * S, 0.46 * S, 0.40 * S, 0.22 * S, 0.04 * S, 1, 0);
      b.addBeveledBox(-0.46 * S, 1.18 * S, 0.04 * S, 0.14 * S, 0.34 * S, 0.38 * S, 0.035 * S, 1, 8);
      b.addBeveledBox(-0.49 * S, 1.18 * S, 0.04 * S, 0.06 * S, 0.20 * S, 0.28 * S, 0.02 * S, 1, 0);
      // Heavy siege demolition cannon (partId = 2)
      b.addBeveledBox(0.24 * S, gunY + 0.02 * S, 0.38 * S, 0.16 * S, 0.18 * S, 0.48 * S, 0.035 * S, 2, 0);
      b.addCylinder(0.24 * S, gunY + 0.02 * S, 0.72 * S, 0.115 * S, 0.105 * S, 0.56 * S, 12, 'Z', 2, 1);
      b.addCylinder(0.24 * S, gunY + 0.02 * S, 0.98 * S, 0.132 * S, 0.122 * S, 0.14 * S, 12, 'Z', 2, 8);
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
      // Faceted stealth transport helicopter: twin-turbine nacelles, FLIR chin pod, tail boom + 4-blade swept rotor
      b.addTrapezoid(0, 0.14, 0.12, 1.52, 3.65, 1.14, 3.15, 0.88, 0.12, 0, 1);
      b.addBeveledBox(0, 0.34, 1.48, 0.86, 0.38, 0.88, 0.08, 0, 6);
      b.addCapsule(0, -0.34, 1.62, 0.16, 0.14, 'Y', 10, 1, 2); // Chin FLIR turret
      // Tail boom & canted stealth tail fin + tail rotor
      b.addTrapezoid(0, 0.24, -2.18, 0.42, 1.65, 0.24, 1.45, 0.38, 0, 0, 1);
      b.addBox(0, 0.66, -2.85, 0.10, 0.88, 0.56, 0, 5);
      b.addBox(-0.22, 0.72, -2.92, 0.06, 0.78, 0.14, 0, 3);
      // Twin side turbine pods & stub weapon wings
      b.addSweptWing(-1, -0.68, 0.12, -0.1, 1.05, 1.05, 0.55, 0.35, 0, 0.16, 0, 0);
      b.addSweptWing(1, 0.68, 0.12, -0.1, 1.05, 1.05, 0.55, 0.35, 0, 0.16, 0, 0);
      for (const sx of [-0.95, 0.95]) {
        b.addCapsule(sx, 0.48, -0.25, 0.22, 0.95, 'Z', 10, 0, 0);
        b.addCylinder(sx, 0.48, -0.88, 0.14, 0.12, 0.18, 8, 'Z', 0, 2);
      }
      // Articulated 4-blade swept main rotor hub (part 1)
      b.addCylinder(0, 0.78, 0.05, 0.28, 0.26, 0.46, 12, 'Y', 1, 3);
      b.addBox(0, 0.98, 0.05, 4.75, 0.06, 0.24, 1, 1);
      b.addBox(0, 0.98, 0.05, 0.24, 0.06, 4.75, 1, 1);
      break;
    }

    case 'kirov': {
      // Signature Crimson Kirov Airship: Smooth 16-seg Lathe Zeppelin envelope + Shark Jaw cone + Under-slung Bomb Gondola + 4 Outrigger Nacelles + X-Tail
      b.addLathe(0, 0.68, 0, [
        [-3.25, 0.04], [-2.55, 0.76], [-1.35, 1.32], [0.25, 1.52], [1.65, 1.44], [2.65, 1.02], [3.2, 0.34], [3.42, 0.02]
      ], 16, 'Z', 0, 0);
      // Crimson dorsal livery stripe + Shark snout tip + metallic rib hoops
      b.addLathe(0, 0.68, 0, [[2.58, 1.05], [3.18, 0.36], [3.44, 0.02]], 16, 'Z', 0, 5);
      for (const rz of [-1.4, -0.3, 0.8, 1.85]) {
        const rr = rz === -0.3 || rz === 0.8 ? 1.51 : 1.32;
        b.addCylinder(0, 0.68, rz, rr, rr, 0.10, 16, 'Z', 0, 3);
      }
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
      b.addTrapezoid(0, 0.38, 0, 3.05, 5.35, 2.75, 4.85, 0.66, 0, 0, 1); // Heavy rubber air-cushion skirt
      b.addBeveledBox(0, 0.88, 0, 2.45, 0.36, 4.45, 0.06, 0, 0);
      b.addBeveledBox(-1.12, 1.26, -0.3, 0.38, 0.52, 3.7, 0.05, 0, 5);
      b.addBeveledBox(1.12, 1.26, -0.3, 0.38, 0.52, 3.7, 0.05, 0, 5);
      b.addBeveledBox(0, 1.44, -1.8, 2.18, 0.9, 0.92, 0.06, 0, 0);
      b.addBeveledBox(0, 1.54, -1.32, 1.76, 0.32, 0.12, 0.02, 0, 6);
      // Twin shrouded rear propulsion fans + bow articulated loading ramp
      for (const sx of [-0.95, 0.95]) {
        b.addTorus(sx, 1.48, -2.35, 0.36, 0.08, 14, 8, Math.PI * 0.5, 0, 0, 3);
        b.addCylinder(sx, 1.48, -2.35, 0.12, 0.12, 0.25, 8, 'Z', 1, 2);
      }
      b.addBox(0, 1.05, 2.25, 1.98, 0.72, 0.22, 0, 4);
      break;
    }

    case 'dolphin': {
      // Smooth bio-mechanical Dolphin hydro-hull + pectoral hydrofoils + dorsal sonic dish
      b.addLathe(0, 0.54, 0, [
        [-2.05, 0.04], [-1.35, 0.32], [-0.4, 0.58], [0.45, 0.64], [1.35, 0.44], [2.15, 0.04]
      ], 16, 'Z', 0, 0);
      b.addSweptWing(-1, -0.45, 0.44, 0.25, 0.78, 0.52, 0.22, 0.36, -0.1, 0.10, 0, 5);
      b.addSweptWing(1, 0.45, 0.44, 0.25, 0.78, 0.52, 0.22, 0.36, -0.1, 0.10, 0, 5);
      b.addTrapezoid(0, 0.56, -2.02, 1.25, 0.48, 0.52, 0.26, 0.10, 0, 0, 5); // Tail fluke
      b.addBeveledBox(0, 1.04, -0.25, 0.14, 0.68, 0.82, 0.04, 0, 5);
      b.addTorus(0, 1.06, 0.52, 0.34, 0.07, 16, 8, 0.35, 0, 1, 3);
      b.addCapsule(0, 1.08, 0.58, 0.18, 0.06, 'Y', 12, 2, 2); // Glowing sonic dish emitter
      break;
    }

    case 'sea_scorpion': {
      b.addTrapezoid(0, 0.56, 0, 2.38, 5.05, 1.98, 4.45, 0.96, 0.12, 0, 0);
      b.addBeveledBox(-1.12, 0.58, -0.25, 0.32, 0.62, 3.9, 0.04, 0, 5);
      b.addBeveledBox(1.12, 0.58, -0.25, 0.32, 0.62, 3.9, 0.04, 0, 5);
      b.addTrapezoid(0, 1.32, -0.82, 1.38, 1.62, 1.04, 1.24, 0.82, 0, 0, 5);
      b.addBeveledBox(0, 1.48, -0.05, 0.98, 0.26, 0.14, 0.02, 0, 6);
      b.addCylinder(0, 2.02, -0.95, 0.14, 0.09, 0.92, 10, 'Y', 1, 3);
      b.addBeveledBox(0, 2.52, -0.95, 0.82, 0.26, 0.16, 0.03, 1, 3);
      // Forward armored flak cupola (part 1) + twin auto-cannons (part 2)
      b.addCylinder(0, 1.24, 1.05, 0.68, 0.52, 0.48, 12, 'Y', 1, 0);
      for (const bx of [-0.20, 0.20]) {
        b.addCylinder(bx, 1.32, 1.78, 0.10, 0.085, 1.28, 10, 'Z', 2, 1);
        b.addCylinder(bx, 1.32, 2.42, 0.125, 0.115, 0.14, 10, 'Z', 2, 3);
      }
      break;
    }

    case 'aegis': {
      // Sleek Aegis Guided-Missile Cruiser: stealth superstructure, 4-face SPY radar panels, forward & aft VLS grids
      b.addTrapezoid(0, 0.66, 0, 2.42, 6.15, 2.02, 5.45, 1.15, 0.30, 0, 0);
      b.addBeveledBox(0, 1.22, 0.1, 1.85, 0.14, 4.65, 0.04, 0, 5);
      // Forward & Aft VLS missile launch cells
      b.addBeveledBox(0, 1.34, 1.68, 1.05, 0.28, 1.05, 0.03, 0, 4);
      b.addBeveledBox(0, 1.34, -2.05, 1.15, 0.28, 1.25, 0.03, 0, 4);
      // Multi-tier SPY phased-array bridge tower + twin lattice masts
      b.addTrapezoid(0, 1.68, -0.25, 1.56, 2.25, 1.18, 1.72, 1.18, 0, 0, 0);
      b.addBeveledBox(0, 2.42, -0.35, 1.08, 0.64, 1.08, 0.08, 0, 3);
      b.addBeveledBox(0, 2.42, 0.20, 0.82, 0.34, 0.10, 0.02, 0, 6);
      b.addCylinder(0, 3.22, -0.55, 0.16, 0.08, 1.15, 8, 'Y', 1, 3);
      b.addBeveledBox(0, 3.75, -0.55, 0.98, 0.24, 0.22, 0.03, 1, 2);
      // Twin SAM launcher turret (part 1 & 2)
      b.addTrapezoid(0, 1.58, 1.62, 0.88, 0.88, 0.68, 0.68, 0.48, 0, 1, 5);
      b.addCylinder(-0.20, 1.78, 2.08, 0.11, 0.095, 1.22, 10, 'Z', 2, 3);
      b.addCylinder(0.20, 1.78, 2.08, 0.11, 0.095, 1.22, 10, 'Z', 2, 3);
      break;
    }

    case 'typhoon': {
      // Smooth hydrodynamic Typhoon Attack Submarine with sail dive planes, periscopes & shrouded propulsor
      b.addLathe(0, 0.50, 0, [
        [-3.25, 0.04], [-2.45, 0.68], [-0.4, 0.96], [1.85, 0.92], [2.95, 0.42], [3.4, 0.03]
      ], 16, 'Z', 0, 1);
      b.addTrapezoid(0, 1.32, 0.35, 0.58, 1.62, 0.46, 1.22, 0.98, 0, 0, 0); // Conning tower sail
      b.addBeveledBox(0, 1.48, 0.35, 0.50, 0.20, 1.02, 0.03, 0, 5);
      b.addSweptWing(-1, -0.26, 1.38, 0.35, 0.62, 0.38, 0.20, 0.15, 0, 0.08, 0, 1); // Sail fairwater planes
      b.addSweptWing(1, 0.26, 1.38, 0.35, 0.62, 0.38, 0.20, 0.15, 0, 0.08, 0, 1);
      b.addCylinder(-0.08, 1.98, 0.55, 0.07, 0.06, 0.68, 8, 'Y', 1, 3); // Periscope mast
      b.addCylinder(0.10, 1.92, 0.25, 0.06, 0.05, 0.58, 8, 'Y', 1, 2); // Radar snorkel
      // Aft cruciform hydroplanes + shrouded pump-jet ring
      b.addBox(0, 0.50, -2.85, 1.55, 0.10, 0.48, 0, 5);
      b.addBox(0, 0.50, -2.85, 0.10, 1.45, 0.48, 0, 5);
      b.addTorus(0, 0.50, -3.22, 0.32, 0.07, 14, 8, Math.PI * 0.5, 0, 0, 3);
      break;
    }

    case 'carrier': {
      // Abyssal Pact Supercarrier: Raked hull, overhanging angled flight deck, catapult markings, 2 deck jets & radar island
      b.addTrapezoid(0, 0.72, 0, 3.05, 7.1, 2.75, 6.6, 1.3, 0.22, 0, 0);
      b.addBeveledBox(0, 1.48, 0, 3.95, 0.28, 7.2, 0.07, 0, 1); // Cantilevered armored flight deck
      b.addBox(0, 1.64, 0, 0.36, 0.04, 6.65, 0, 4); // Catapult centerline hazard stripe
      b.addBeveledBox(-1.82, 1.48, 0, 0.22, 0.28, 6.8, 0.03, 0, 5);
      b.addBeveledBox(1.82, 1.48, 0, 0.22, 0.28, 6.8, 0.03, 0, 5);
      // 2 Parked Stormhawk deck fighters on port bow/aft staging spots
      for (const pz of [-1.85, 1.95]) {
        b.addBeveledBox(-0.88, 1.74, pz, 0.24, 0.14, 0.92, 0.03, 0, 5);
        b.addSweptWing(-1, -0.96, 1.72, pz - 0.1, 0.48, 0.42, 0.16, 0.28, 0, 0.05, 0, 0);
        b.addSweptWing(1, -0.80, 1.72, pz - 0.1, 0.48, 0.42, 0.16, 0.28, 0, 0.05, 0, 0);
      }
      // Starboard island bridge with panoramic glass cab & phased-array radar lattice mast
      b.addTrapezoid(1.24, 2.24, -0.45, 1.02, 2.05, 0.80, 1.48, 1.38, 0, 0, 0);
      b.addBeveledBox(1.24, 2.52, 0.36, 0.72, 0.32, 0.12, 0.02, 0, 6);
      b.addCylinder(1.24, 3.28, -0.45, 0.18, 0.10, 0.95, 8, 'Y', 1, 3);
      b.addBeveledBox(1.24, 3.82, -0.45, 0.95, 0.26, 0.22, 0.03, 1, 2);
      break;
    }

    case 'dreadnought': {
      // Crimson Dreadnought Missile Battleship: heavy raked hull, armored superstructure, twin V3 vertical silos & main cannon turret
      b.addTrapezoid(0, 0.72, 0, 2.72, 6.8, 2.38, 6.1, 1.24, 0.30, 0, 0);
      b.addBeveledBox(0, 1.32, 0.2, 2.08, 0.16, 5.1, 0.04, 0, 5);
      // Multi-tier command citadel + glass bridge + comms mast
      b.addTrapezoid(0, 1.76, -0.45, 1.85, 2.35, 1.42, 1.85, 1.08, 0, 0, 0);
      b.addBeveledBox(0, 2.48, -0.45, 1.15, 0.48, 1.15, 0.06, 0, 1);
      b.addBeveledBox(0, 2.05, 0.48, 1.22, 0.28, 0.12, 0.02, 0, 6);
      b.addCylinder(0, 3.15, -0.65, 0.14, 0.08, 1.05, 8, 'Y', 0, 3);
      // Heavy twin aft ballistic missile silos with blast deflectors (part 2)
      for (const mx of [-0.54, 0.54]) {
        b.addBeveledBox(mx, 1.84, -1.96, 0.76, 1.06, 1.56, 0.06, 2, 5);
        b.addCylinder(mx, 2.44, -1.85, 0.22, 0.18, 0.38, 10, 'Y', 2, 4);
      }
      // Forward armored dual 155mm naval turret (part 1 & 2)
      b.addTrapezoid(0, 1.54, 1.62, 1.26, 1.32, 0.96, 1.05, 0.62, 0, 1, 5);
      b.addCylinder(-0.26, 1.60, 2.46, 0.135, 0.11, 1.48, 10, 'Z', 2, 1);
      b.addCylinder(0.26, 1.60, 2.46, 0.135, 0.11, 1.48, 10, 'Z', 2, 1);
      break;
    }

    case 'barracks': {
      addConcretePad(b, 5.8, 3.9, 0.44, 0.90, false);
      addVaultedHall(b, 0, 0.44, -0.35, 4.95, 2.65, 1.85, 4, 0, 3);
      b.addBeveledBox(0, 1.12, 1.25, 2.35, 1.4, 0.92, 0.06, 0, 1);
      b.addBeveledBox(0, 1.24, 1.72, 1.55, 0.42, 0.08, 0.02, 0, 6);
      b.addBox(0, 0.52, 1.68, 2.15, 0.16, 0.48, 0, 4);
      b.addCylinder(-1.8, 2.45, -0.35, 0.12, 0.08, 1.15, 8, 'Y', 0, 3);
      b.addBox(-1.8, 3.05, -0.35, 0.35, 0.28, 0.35, 0, 2);
      break;
    }

    case 'airforce_radar': {
      addConcretePad(b, 5.9, 5.9, 0.40, 0.94, false);
      for (const px of [-1.65, 1.65]) {
        for (const pz of [-1.65, 1.65]) {
          b.addBeveledBox(px, 0.44, pz, 1.9, 0.09, 1.9, 0.02, 0, 4); // 4 landing pads
          b.addBox(px, 0.49, pz, 0.32, 0.04, 0.32, 0, 2);
        }
      }
      b.addTrapezoid(0, 1.32, 0, 1.75, 1.75, 1.25, 1.25, 1.85, 0, 0, 0);
      b.addCylinder(0, 2.25, 0, 0.88, 0.98, 0.48, 12, 'Y', 0, 6); // Glass air traffic cab
      b.addCylinder(0, 2.62, 0, 0.92, 0.22, 0.28, 12, 'Y', 0, 5);
      // Rotating sweeping radar dish (part 1)
      b.addBeveledBox(0, 2.98, 0.18, 1.45, 0.56, 0.22, 0.05, 1, 3);
      b.addBox(0, 3.02, 0.32, 0.42, 0.18, 0.12, 1, 2);
      break;
    }

    case 'service_depot': {
      addConcretePad(b, 5.8, 5.8, 0.32, 0.92, true);
      b.addBeveledBox(-2.25, 1.22, -2.25, 0.64, 1.85, 0.64, 0.06, 0, 1);
      b.addBeveledBox(2.25, 1.22, -2.25, 0.64, 1.85, 0.64, 0.06, 0, 1);
      b.addLimb([-2.25, 2.0, -2.25], [2.25, 2.0, -2.25], 0.18, 0.18, 8, 0, 5);
      // Rotating hydraulic repair gantry & laser torch (part 1 & 2)
      b.addCylinder(0, 1.15, -2.05, 0.52, 0.42, 1.75, 10, 'Y', 1, 4);
      b.addLimb([0, 2.05, -2.05], [0, 2.45, 1.15], 0.24, 0.18, 8, 1, 0);
      b.addBeveledBox(0, 1.85, 1.15, 0.38, 0.72, 0.38, 0.04, 1, 2);
      break;
    }

    case 'battle_lab': {
      addConcretePad(b, 5.8, 5.8, 0.48, 0.92, false);
      b.addBeveledBox(-0.85, 1.28, 0, 3.25, 1.68, 3.9, 0.1, 0, 0);
      b.addBeveledBox(-0.85, 1.45, 0, 3.35, 0.52, 2.6, 0.04, 0, 6); // Glass atrium wrap
      b.addLathe(1.32, 0.48, -0.65, [[0, 1.15], [1.2, 1.08], [1.95, 0.62], [2.25, 0.12]], 14, 'Y', 0, 3);
      b.addTorus(1.32, 1.82, -0.65, 1.08, 0.10, 16, 8, 0, 0, 0, 2);
      b.addCylinder(1.32, 2.95, 1.25, 0.36, 0.24, 1.75, 10, 'Y', 1, 5);
      b.addBeveledBox(1.32, 3.85, 1.35, 1.05, 0.55, 0.24, 0.04, 1, 3);
      break;
    }

    case 'pillbox': {
      addConcretePad(b, 2.0, 2.0, 0.44, 0.86, false);
      b.addCylinder(0, 0.76, 0, 0.92, 0.76, 0.68, 8, 'Y', 0, 3);
      b.addTrapezoid(0, 1.24, 0, 1.12, 1.12, 0.82, 0.82, 0.42, 0, 1, 0);
      b.addBeveledBox(0, 1.24, 0.52, 0.62, 0.18, 0.18, 0.03, 1, 5);
      b.addCylinder(-0.15, 1.2, 0.82, 0.065, 0.055, 1.15, 8, 'Z', 2, 1);
      b.addCylinder(0.15, 1.2, 0.82, 0.065, 0.055, 1.15, 8, 'Z', 2, 1);
      break;
    }

    case 'aa_turret': {
      addConcretePad(b, 2.0, 2.0, 0.44, 0.86, true);
      b.addCylinder(0, 0.88, 0, 0.76, 0.58, 0.96, 10, 'Y', 0, 1);
      b.addTrapezoid(0, 1.52, 0, 1.08, 1.12, 0.80, 0.86, 0.56, 0, 1, 0);
      b.addBeveledBox(0, 1.78, -0.25, 0.74, 0.24, 0.52, 0.04, 1, 5);
      for (const ox of [-0.28, -0.095, 0.095, 0.28]) {
        b.addCylinder(ox, 1.58, 0.88, 0.065, 0.055, 1.32, 8, 'Z', 2, 1);
        b.addCylinder(ox, 1.58, 1.52, 0.085, 0.075, 0.14, 8, 'Z', 2, 3);
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
      addConcretePad(b, 3.9, 3.9, 0.42, 0.90, true);
      // 4-legged open lattice steel derrick frame + top crown block
      for (const [lx, lz] of [[-0.85, -1.15], [0.85, -1.15], [-0.85, 0.35], [0.85, 0.35]]) {
        b.addLimb([lx, 0.42, lz], [lx * 0.28, 3.15, lz * 0.28 - 0.35], 0.10, 0.07, 6, 0, 4);
      }
      b.addBeveledBox(0, 3.18, -0.45, 0.65, 0.28, 0.65, 0.04, 0, 1);
      // Reciprocating pumpjack walking beam & horsehead + wellhead valve
      b.addBeveledBox(0, 3.45, 0.2, 0.46, 0.36, 2.45, 0.05, 1, 1);
      b.addBeveledBox(0, 3.35, 1.38, 0.52, 0.72, 0.36, 0.06, 1, 4);
      b.addCylinder(0, 1.65, 1.38, 0.08, 0.08, 2.4, 8, 'Y', 0, 3);
      // Pressurized crude storage tank + transfer pipes + flare stack beacon
      b.addCapsule(1.12, 0.98, 0.85, 0.56, 0.85, 'Z', 12, 0, 0);
      b.addLimb([0, 0.95, 1.38], [1.12, 0.95, 1.2], 0.12, 0.12, 6, 0, 3);
      b.addCylinder(-1.35, 1.95, -1.25, 0.10, 0.07, 3.1, 8, 'Y', 0, 1);
      b.addCapsule(-1.35, 3.55, -1.25, 0.18, 0.05, 'Y', 8, 0, 2);
      break;
    }

    case 'hospital': {
      addConcretePad(b, 5.8, 5.8, 0.44, 0.90, false);
      addVaultedHall(b, -0.45, 0.44, -0.25, 3.85, 3.65, 2.05, 4, 0, 3);
      b.addBeveledBox(-0.45, 1.12, 1.72, 2.25, 1.35, 0.85, 0.06, 0, 6);
      // Illuminated medical cross roof emblem + medevac helipad + rotating ambulance beacon
      b.addBeveledBox(-0.45, 2.55, -0.25, 1.65, 0.22, 0.48, 0.03, 0, 4);
      b.addBeveledBox(-0.45, 2.55, -0.25, 0.48, 0.22, 1.65, 0.03, 0, 4);
      b.addBeveledBox(1.85, 0.48, 1.15, 1.65, 0.08, 1.65, 0.02, 0, 4);
      b.addCylinder(1.85, 2.25, -1.35, 0.28, 0.22, 0.55, 8, 'Y', 1, 2);
      break;
    }

    case 'tech_airport': {
      addConcretePad(b, 5.8, 5.8, 0.42, 0.94, false);
      // Asphalt airstrip runway + yellow centerline markings + approach beacons
      b.addBeveledBox(-0.95, 0.46, 0, 2.65, 0.10, 5.15, 0.02, 0, 1);
      b.addBox(-0.95, 0.52, 0, 0.34, 0.03, 4.75, 0, 4);
      for (const bz of [-2.2, 0, 2.2]) {
        b.addBox(-2.22, 0.56, bz, 0.22, 0.16, 0.22, 0, 2);
      }
      // Vaulted service hangar + glass control tower + rotating radar dish (part 1)
      addVaultedHall(b, 1.55, 0.42, 0.95, 2.05, 2.55, 1.55, 3, 0, 3);
      b.addTrapezoid(1.65, 1.48, -1.45, 1.45, 1.45, 1.05, 1.05, 2.15, 0, 0, 0);
      b.addBeveledBox(1.65, 2.55, -1.45, 1.25, 0.48, 1.25, 0.04, 0, 6);
      b.addBeveledBox(1.65, 3.12, -1.45, 1.15, 0.36, 0.24, 0.04, 1, 2);
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

  function applyGeometryOverride(typeId, sourceLabel, geom) {
    glbCache.set(typeId, { url: sourceLabel, vertexCount: geom.vertexCount, indexCount: geom.indexCount });
    const existing = meshes.get(typeId);
    if (existing) {
      uploadGeometryToBatch(existing, geom);
    } else {
      getOrCreateBatch(typeId, geom);
    }
    return geom;
  }

  async function loadGlbOverride(typeId, url, options = {}) {
    const geom = await fetchAndParseGlb(url, options);
    return applyGeometryOverride(typeId, url, geom);
  }

  function loadGlbBufferOverride(typeId, arrayBuffer, options = {}) {
    const geom = parseGlbGeometry(arrayBuffer, options);
    return applyGeometryOverride(typeId, options.fileName || `idb:${typeId}.glb`, geom);
  }

  function restoreProceduralModel(typeId) {
    glbCache.delete(typeId);
    const geom = buildProceduralGeometryData(typeId);
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

    const getBatchKey = (ent) => (ent.typeId === 'gi' && ent.deployState === 'DEPLOYED') ? 'gi_deployed' : ent.typeId;

    const counts = new Map();
    for (let i = 0; i < state.entities.length; i++) {
      const ent = state.entities[i];
      if (!isRenderableEntity(state, ent, noFog)) continue;
      const key = getBatchKey(ent);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    for (const [typeId, n] of counts.entries()) {
      ensureCapacity(getOrCreateBatch(typeId), n);
    }

    // Fill cleanly in 2 passes: buildings first, mobile units second per batch
    for (let i = 0; i < state.entities.length; i++) {
      const ent = state.entities[i];
      if (!isRenderableEntity(state, ent, noFog) || !ent.isBuilding) continue;
      const batch = meshes.get(getBatchKey(ent));
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
      const batch = meshes.get(getBatchKey(ent));
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

  function drawBatchSlice(batch, count, baseInstanceOffset, ctx) {
    if (count <= 0) return;
    gl.bindVertexArray(batch.vao);
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

  function renderShadowPass(lightViewProj, onlyStatic, ctx) {
    gl.useProgram(shadowProg);
    gl.uniformMatrix4fv(shadowLightLoc, false, lightViewProj);
    const list = onlyStatic ? staticBatches : dynamicBatches;
    for (let i = 0; i < list.length; i++) {
      const batch = list[i];
      const count = onlyStatic ? batch.staticCount : batch.dynamicCount;
      const baseInstanceOffset = onlyStatic ? 0 : batch.staticCount;
      drawBatchSlice(batch, count, baseInstanceOffset, ctx);
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
    gl.enable(gl.STENCIL_TEST);

    // Draw dynamic units first leaving stencil = 0 so unobstructed units never trigger self-X-ray
    gl.stencilMask(0x00);
    gl.stencilFunc(gl.ALWAYS, 0, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    for (let i = 0; i < dynamicBatches.length; i++) {
      const batch = dynamicBatches[i];
      drawBatchSlice(batch, batch.dynamicCount, batch.staticCount, ctx);
    }

    // Draw static buildings marking stencil = 1 on foreground building pixels that win depth test
    gl.stencilMask(0xFF);
    gl.stencilFunc(gl.ALWAYS, 1, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    for (let i = 0; i < staticBatches.length; i++) {
      const batch = staticBatches[i];
      drawBatchSlice(batch, batch.staticCount, 0, ctx);
    }

    gl.stencilMask(0xFF);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  function renderXRayPass(ctx) {
    if (dynamicBatches.length === 0 || staticBatches.length === 0) return;
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
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0x00);
    gl.stencilFunc(gl.EQUAL, 1, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.CULL_FACE);

    for (let i = 0; i < dynamicBatches.length; i++) {
      const batch = dynamicBatches[i];
      drawBatchSlice(batch, batch.dynamicCount, batch.staticCount, ctx);
    }

    gl.stencilMask(0xFF);
    gl.disable(gl.STENCIL_TEST);
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
    loadGlbBufferOverride,
    restoreProceduralModel,
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
