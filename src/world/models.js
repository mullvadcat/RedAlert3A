// Single Draw Call Multi-Part Vertex-Articulated InstancedMesh Model Factory.
// Vertex layout (10 floats): pos(3), normal(3), uv(2), aPartId(1), aTone(1).
// Per-instance layout (20 floats): aInstanceMatrix(mat4=16) + aUnitState(vec4: turretDeltaYaw, recoil, hpRatio, teamAndFlags).

import { CANONICAL_ENTITY_IDS, ENTITY_DEFS, FACTIONS, PLAYER_COLORS } from '../core/config.js';
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
  float fogVis = mix(texture(uFogTex, fogUv).r, 1.0, uNoFog);
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
    // Tone 0: Faction painted military armor
    vec3 oliveSteel = mix(vec3(0.24, 0.27, 0.31), teamCol * 0.82, 0.58);
    baseCol = oliveSteel * (0.85 + detail.r * 0.35 - detail.g * 0.22);
  } else if (vTone < 1.5) {
    // Tone 1: Dark gunmetal, tracks & tires
    baseCol = vec3(0.11, 0.12, 0.14) * (0.8 + detail.r * 0.3);
    roughness = clamp(roughness + 0.2, 0.0, 1.0);
  } else if (vTone < 2.5) {
    // Tone 2: Glowing energy core / canopy / sensor (boosts HDR bloom subtly)
    baseCol = mix(teamCol * 1.45, vec3(0.95, 0.82, 0.35), 0.3);
    metallic = 0.2;
    roughness = 0.18;
  } else {
    // Tone 3: Concrete pad / gold ore trim
    baseCol = vec3(0.46, 0.45, 0.43) * (0.85 + detail.r * 0.25);
    metallic = 0.1;
    roughness = 0.85;
  }

  // < 50% HP charred battle-damage mask
  float dmgMask = smoothstep(0.55, 0.12, hpRatio) * smoothstep(0.32, 0.72, detail.r + detail.b * 0.35);
  baseCol = mix(baseCol, vec3(0.05, 0.04, 0.04), dmgMask * 0.85);
  roughness = mix(roughness, 0.92, dmgMask);

  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(V + L);

  float NdotL = max(dot(N, L), 0.0);
  float specPow = mix(18.0, 96.0, 1.0 - roughness);
  float spec = pow(max(dot(N, H), 0.0), specPow) * mix(0.25, 1.0, metallic);

  vec3 proj = (vShadowPos.xyz / vShadowPos.w) * 0.5 + 0.5;
  float shadow = sampleShadowPCSS(uShadowMap, proj, 0.0022, uShadowTexelSize);

  vec3 ambient = baseCol * (0.36 + 0.16 * max(N.y, 0.0)) * detail.a;
  vec3 direct = (baseCol * 1.15 + vec3(spec)) * NdotL * mix(0.32, 1.0, shadow);

  // Height-adaptive faction Fresnel rim silhouette (subtle at 14m close-up, crisp at 60-80m macro view)
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.2);
  float rimScale = mix(0.22, 1.25, smoothstep(16.0, 68.0, uCamHeight));
  vec3 rim = teamCol * fresnel * rimScale;

  // Low-HP ember pulse + Tone 2 emissive boost
  vec3 emissive = (vTone > 1.5 && vTone < 2.5) ? baseCol * 0.65 : vec3(0.0);
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

  // Oriented barrel / cylinder aligned along Z or Y axis
  function addCylinder(cx, cy, cz, rBottom, rTop, length, segs = 10, axis = 'Y', partId = 0, tone = 0) {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const am = (a0 + a1) * 0.5;
      const c0 = Math.cos(a0), s0 = Math.sin(a0);
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      const cm = Math.cos(am), sm = Math.sin(am);
      const half = length * 0.5;
      if (axis === 'Z') {
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

// Detailed multi-part procedural CAD blueprints for M1 units & buildings + clean coverage for all 49 IDs.
function buildProceduralGeometryData(typeId) {
  const b = createMeshBuilder();
  const def = ENTITY_DEFS[typeId];

  switch (typeId) {
    case 'grizzly': {
      // Lower chassis + left/right heavy armored treads (part 0)
      b.addBox(0, 0.45, 0, 1.5, 0.6, 2.7, 0, 0);
      b.addBox(-0.92, 0.38, 0, 0.42, 0.65, 2.95, 0, 1);
      b.addBox(0.92, 0.38, 0, 0.42, 0.65, 2.95, 0, 1);
      b.addBox(0, 0.78, -0.95, 1.4, 0.28, 0.65, 0, 1); // Engine vent
      // Sloped turret (part 1) + viewport sensor (tone 2)
      b.addBox(0, 1.05, -0.08, 1.35, 0.55, 1.55, 1, 0);
      b.addBox(0.32, 1.36, -0.22, 0.42, 0.16, 0.42, 1, 2);
      // 105mm main gun + bore evacuator (part 2 -> recoils along -Z)
      b.addCylinder(0, 1.08, 1.35, 0.11, 0.09, 1.85, 8, 'Z', 2, 1);
      b.addCylinder(0, 1.08, 1.1, 0.15, 0.15, 0.35, 8, 'Z', 2, 0);
      break;
    }

    case 'rhino': {
      // Wide Crimson heavy hull & thick treads
      b.addBox(0, 0.5, 0, 1.75, 0.7, 3.05, 0, 0);
      b.addBox(-1.05, 0.42, 0, 0.48, 0.75, 3.25, 0, 1);
      b.addBox(1.05, 0.42, 0, 0.48, 0.75, 3.25, 0, 1);
      b.addBox(0, 0.85, -1.0, 1.6, 0.35, 0.75, 0, 1);
      // Cast heavy box turret (part 1)
      b.addBox(0, 1.18, -0.1, 1.58, 0.65, 1.75, 1, 0);
      b.addBox(-0.4, 1.55, -0.25, 0.46, 0.18, 0.46, 1, 2);
      // Long 120mm cannon (part 2)
      b.addCylinder(0, 1.2, 1.5, 0.13, 0.11, 2.05, 8, 'Z', 2, 1);
      b.addBox(0, 1.2, 2.42, 0.28, 0.24, 0.26, 2, 1); // Muzzle brake
      break;
    }

    case 'harvester': {
      // Heavy mining truck chassis + cargo hopper
      b.addBox(0, 0.5, -0.2, 1.8, 0.65, 2.8, 0, 0);
      b.addBox(-1.05, 0.45, -0.2, 0.45, 0.8, 3.0, 0, 1);
      b.addBox(1.05, 0.45, -0.2, 0.45, 0.8, 3.0, 0, 1);
      // Ore hopper bin (gold/ore accent tone 3) + cab
      b.addBox(0, 1.15, -0.6, 1.65, 0.75, 1.7, 0, 3);
      b.addBox(0, 1.15, 0.65, 1.45, 0.75, 0.9, 0, 0);
      b.addBox(0, 1.25, 1.12, 1.2, 0.35, 0.15, 0, 2);
      // Articulated front mining scoop/drum (part 2)
      b.addBox(0, 0.55, 1.55, 1.9, 0.55, 0.75, 2, 1);
      b.addCylinder(0, 0.55, 1.95, 0.35, 0.35, 1.8, 8, 'Y', 2, 3);
      break;
    }

    case 'mcv': {
      // Massive 6-wheel mobile command trailer
      b.addBox(0, 0.65, 0, 2.1, 0.8, 4.1, 0, 0);
      b.addBox(-1.15, 0.48, -1.2, 0.38, 0.88, 1.1, 0, 1);
      b.addBox(1.15, 0.48, -1.2, 0.38, 0.88, 1.1, 0, 1);
      b.addBox(-1.15, 0.48, 0.1, 0.38, 0.88, 1.1, 0, 1);
      b.addBox(1.15, 0.48, 0.1, 0.38, 0.88, 1.1, 0, 1);
      b.addBox(-1.15, 0.48, 1.4, 0.38, 0.88, 1.0, 0, 1);
      b.addBox(1.15, 0.48, 1.4, 0.38, 0.88, 1.0, 0, 1);
      // Folded crane gantry & command cab
      b.addBox(0, 1.45, -0.4, 1.85, 0.85, 2.4, 0, 3);
      b.addBox(0, 1.4, 1.4, 1.9, 0.8, 1.1, 0, 0);
      b.addBox(0, 1.55, 1.96, 1.5, 0.32, 0.12, 0, 2);
      b.addBox(0, 2.05, -0.5, 0.6, 0.35, 2.2, 1, 1);
      break;
    }

    case 'conyard': {
      // 4x4 Construction Yard (8m x 8m footprint): concrete slab + command bunker + rotating industrial crane
      b.addBox(0, 0.25, 0, 7.6, 0.5, 7.6, 0, 3);
      b.addBox(-1.6, 1.45, -1.6, 3.6, 2.1, 3.6, 0, 0);
      b.addBox(1.8, 1.1, 1.5, 3.0, 1.4, 3.2, 0, 1);
      b.addBox(-1.6, 2.65, -1.6, 1.4, 0.45, 1.4, 0, 2);
      // Rotating crane tower (part 1) + extending boom (part 2)
      b.addCylinder(1.2, 2.2, -1.2, 0.55, 0.45, 3.2, 8, 'Y', 1, 3);
      b.addBox(1.2, 3.9, 0.2, 0.7, 0.5, 4.2, 1, 0);
      b.addBox(1.2, 3.3, 2.0, 0.35, 1.1, 0.35, 2, 2);
      break;
    }

    case 'power_plant': {
      // 2x2 Power Plant (4m x 4m): concrete base + dual glowing plasma turbines
      b.addBox(0, 0.2, 0, 3.7, 0.4, 3.7, 0, 3);
      b.addBox(0, 1.0, -0.8, 3.2, 1.4, 1.7, 0, 0);
      b.addCylinder(-0.85, 1.5, 0.75, 0.65, 0.48, 2.2, 10, 'Y', 0, 1);
      b.addCylinder(-0.85, 2.7, 0.75, 0.45, 0.45, 0.35, 10, 'Y', 0, 2);
      b.addCylinder(0.85, 1.5, 0.75, 0.65, 0.48, 2.2, 10, 'Y', 0, 1);
      b.addCylinder(0.85, 2.7, 0.75, 0.45, 0.45, 0.35, 10, 'Y', 0, 2);
      break;
    }

    case 'refinery': {
      // 3x3 Ore Refinery (6m x 6m): main smelter silo, ore ramp, conveyor tower
      b.addBox(0, 0.2, 0, 5.6, 0.4, 5.6, 0, 3);
      b.addBox(-1.1, 1.5, -1.0, 2.8, 2.4, 3.0, 0, 0);
      b.addCylinder(1.4, 1.8, -1.1, 0.95, 0.85, 2.8, 10, 'Y', 0, 1);
      b.addCylinder(1.4, 3.3, -1.1, 0.65, 0.65, 0.35, 10, 'Y', 0, 2);
      b.addBox(0.2, 0.7, 1.6, 3.6, 0.6, 1.8, 0, 1); // Unload ramp
      b.addBox(0.2, 1.15, 2.3, 3.2, 0.25, 0.35, 0, 3);
      break;
    }

    case 'war_factory': {
      // 4x3 War Factory (8m x 6m): armored assembly bay, open front hangar doors, twin overhead gantry cranes
      b.addBox(0, 0.2, 0, 7.6, 0.4, 5.6, 0, 3);
      b.addBox(0, 1.6, -1.1, 6.8, 2.6, 3.0, 0, 0);
      b.addBox(-2.5, 1.4, 1.1, 1.6, 2.2, 2.6, 0, 1);
      b.addBox(2.5, 1.4, 1.1, 1.6, 2.2, 2.6, 0, 1);
      b.addBox(0, 2.35, 1.1, 3.8, 0.6, 2.4, 0, 0);
      b.addBox(0, 2.95, -1.1, 2.2, 0.35, 1.4, 0, 2); // Roof bay hatch beacon
      break;
    }

    default: {
      // Clean parametric geometry for all remaining canonical units/buildings (Infantry, Air, Naval, Defenses)
      if (def?.isBuilding) {
        const sx = (def.footprintW ?? 2) * 1.8;
        const sz = (def.footprintH ?? 2) * 1.8;
        b.addBox(0, 0.2, 0, sx, 0.4, sz, 0, 3);
        if (def.category === 'defense') {
          b.addCylinder(0, 0.9, 0, sx * 0.42, sx * 0.35, 1.3, 10, 'Y', 0, 1);
          b.addBox(0, 1.8, 0, sx * 0.45, 0.55, sx * 0.45, 1, 0);
          b.addCylinder(0, 1.85, sx * 0.35, 0.14, 0.12, 1.1, 8, 'Z', 2, 2);
        } else {
          b.addBox(0, 1.35, 0, sx * 0.78, 2.1, sz * 0.78, 0, 0);
          b.addCylinder(0, 2.6, 0, Math.min(sx, sz) * 0.22, Math.min(sx, sz) * 0.18, 0.9, 8, 'Y', 1, 2);
        }
      } else if (def?.category === 'infantry') {
        b.addBox(0, 0.55, 0, 0.5, 1.0, 0.45, 0, 0);
        b.addBox(0, 1.2, 0, 0.36, 0.36, 0.36, 1, 2);
        b.addCylinder(0.22, 0.72, 0.35, 0.06, 0.05, 0.7, 6, 'Z', 2, 1);
      } else if (def?.category === 'air') {
        b.addBox(0, 0, 0, 1.3, 0.9, 3.6, 0, 0);
        b.addBox(0, 0.1, 0, 3.8, 0.18, 1.0, 0, 1);
        b.addBox(0, 0.35, 1.2, 0.8, 0.35, 0.8, 0, 2);
      } else if (def?.category === 'naval') {
        b.addBox(0, 0.55, 0, 2.0, 1.1, 5.2, 0, 0);
        b.addBox(0, 1.35, -0.5, 1.3, 0.9, 1.6, 0, 1);
        b.addBox(0, 1.25, 1.1, 0.8, 0.45, 0.8, 1, 0);
        b.addCylinder(0, 1.3, 1.8, 0.1, 0.08, 1.2, 8, 'Z', 2, 2);
      } else {
        b.addBox(0, 0.5, 0, 1.4, 0.8, 2.0, 0, 0);
        b.addCylinder(0, 0.95, 0.6, 0.1, 0.1, 1.0, 8, 'Z', 2, 1);
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

  function syncEntities(state, alpha) {
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
      if (!ent.alive) continue;
      counts.set(ent.typeId, (counts.get(ent.typeId) ?? 0) + 1);
    }

    for (const [typeId, n] of counts.entries()) {
      ensureCapacity(getOrCreateBatch(typeId), n);
    }

    for (let i = 0; i < state.entities.length; i++) {
      const ent = state.entities[i];
      if (!ent.alive) continue;
      const batch = meshes.get(ent.typeId);
      const isStatic = ent.isBuilding;
      const idx = isStatic ? batch.staticCount++ : (batch.staticCount + batch.dynamicCount++);
      // Ensure dynamic entities never overwrite static slots: count static first or use separate offset?
      // Wait: if we process in two fast passes or allocate after static counts, zero overwrite happens!
      void idx;
    }

    // Reset and fill cleanly in 2 simple passes: buildings first, mobile units second per batch
    for (const batch of meshes.values()) {
      batch.staticCount = 0;
      batch.dynamicCount = 0;
    }
    for (let i = 0; i < state.entities.length; i++) {
      const ent = state.entities[i];
      if (!ent.alive || !ent.isBuilding) continue;
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
      if (!ent.alive || ent.isBuilding) continue;
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

  // Pre-warm M1 core meshes cleanly at startup
  for (const id of ['conyard', 'power_plant', 'refinery', 'war_factory', 'mcv', 'harvester', 'grizzly', 'rhino']) {
    getOrCreateBatch(id);
  }

  return {
    canonicalCount: CANONICAL_ENTITY_IDS.length,
    syncEntities,
    renderShadowPass,
    renderMainPass,
    dispose() {
      gl.deleteProgram(mainProg);
      gl.deleteProgram(shadowProg);
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
