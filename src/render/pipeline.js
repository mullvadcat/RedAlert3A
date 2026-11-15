// Self-contained WebGL2 Deferred/Forward+ RTS Rendering Pipeline (L2 UI/Render Layer).
// Enforces < 140 Draw Calls, 2K PBR Baking, Texel-Snapped PCSS Shadows, Gerstner Water,
// 5 Hz GPU Fog, Half-Res Bloom, AgX Tone Mapping, and RTS Screen-to-World Camera Controls.

import { CELL_SIZE, MAP_SIZE, ORE_TYPE, TERRAIN, WORLD_SIZE } from '../world/map.js';
import { ECONOMY_CONFIG, QUALITY_PRESETS } from '../core/config.js';
import { createGpuFog } from './fog.js';
import { bakeProceduralPBRTextures } from './pbr.js';
import {
  PCSS_GLSL,
  createShadowSystem,
  mat4Identity,
  mat4LookAt,
  mat4Multiply
} from './shadow.js';
import { createWaterRenderer } from './water.js';
import { createModelFactory } from '../world/models.js';
import { createBillboardRenderer } from './billboards.js';
import { createDecalPool } from './decals.js';
import { createDebrisSystem } from '../world/destruction.js';

export function compileProgram(gl, vsSrc, fsSrc) {
  const compileShader = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(sh) || 'Unknown shader compile error';
      gl.deleteShader(sh);
      throw new Error(`WebGL2 Shader Error (${type === gl.VERTEX_SHADER ? 'VS' : 'FS'}): ${info}`);
    }
    return sh;
  };

  const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog) || 'Unknown program link error';
    gl.deleteProgram(prog);
    throw new Error(`WebGL2 Program Link Error: ${info}`);
  }
  return prog;
}

function mat4Perspective(out, fovYRad, aspect, near, far) {
  const f = 1.0 / Math.tan(fovYRad * 0.5);
  const nf = 1.0 / (near - far);
  out.fill(0);
  out[0] = f / Math.max(0.1, aspect);
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

function mat4Invert(out, m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-8) return null;
  det = 1.0 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

function createColorRenderTarget(gl, width, height, preferFloat, withDepth) {
  const build = (useFloat) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (useFloat) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    let rbo = null;
    if (withDepth) {
      rbo = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rbo);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, width, height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, rbo);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    }

    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fbo);
      if (rbo) gl.deleteRenderbuffer(rbo);
      return null;
    }
    return { tex, fbo, rbo, width, height, isFloat: useFloat };
  };

  if (preferFloat) {
    const rt = build(true);
    if (rt) return rt;
  }
  return build(false);
}

function disposeRenderTarget(gl, rt) {
  if (!rt) return;
  gl.deleteTexture(rt.tex);
  gl.deleteFramebuffer(rt.fbo);
  if (rt.rbo) gl.deleteRenderbuffer(rt.rbo);
}

// === Terrain Shader ===
const TERRAIN_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;

uniform mat4 uViewProj;
uniform mat4 uLightViewProj;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
out vec4 vShadowPos;

void main() {
  vWorldPos = aPos;
  vNormal = normalize(aNormal);
  vUv = aUv;
  vShadowPos = uLightViewProj * vec4(aPos, 1.0);
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const TERRAIN_FS = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
in vec4 vShadowPos;

uniform sampler2D uSplatTex;   // R: terrainClass, G: oreType, B: oreAmount, A: bridgeFlag
uniform sampler2D uDetailTex;
uniform sampler2D uShadowMap;
uniform sampler2D uFogTex;
uniform vec3 uCamPos;
uniform vec3 uLightDir;
uniform float uWorldSize;
uniform float uTime;
uniform float uNoFog;
uniform float uShadowTexelSize;

out vec4 outColor;

${PCSS_GLSL}

void main() {
  vec4 splat = texture(uSplatTex, vUv);
  vec2 tileUv = vWorldPos.xz * 0.14;
  vec4 detail = texture(uDetailTex, tileUv);

  float slope = 1.0 - max(vNormal.y, 0.0);
  vec3 grassCol = vec3(0.13, 0.20, 0.10) * (0.74 + 0.52 * detail.r);
  vec3 earthCol = vec3(0.17, 0.13, 0.09) * (0.76 + 0.48 * detail.b);
  vec3 rockCol  = vec3(0.16, 0.17, 0.20) * (0.74 + 0.52 * detail.b);
  vec3 sandCol  = vec3(0.26, 0.22, 0.15) * (0.80 + 0.40 * detail.r);
  vec3 deckCol  = vec3(0.22, 0.25, 0.29) * (0.80 + 0.40 * detail.b);

  float elev = vWorldPos.y;
  float soilMix = smoothstep(0.26, 0.74, detail.r * 0.55 + detail.b * 0.45);
  vec3 albedo = mix(grassCol, earthCol, soilMix);
  albedo = mix(sandCol, albedo, smoothstep(-0.35, 0.85, elev));
  albedo = mix(albedo, rockCol, smoothstep(0.18, 0.48, slope));

  // Bridges painted clearly as reinforced steel/concrete decks
  if (splat.a > 0.5) {
    float stripe = step(0.88, fract(vWorldPos.z * 0.5)) * 0.18;
    albedo = deckCol + vec3(stripe * 0.55, stripe * 0.38, 0.0);
  }

  // Ore vein glow on surface (Red crystal vs Violet crystal)
  float oreAmt = splat.b;
  vec3 emissive = vec3(0.0);
  if (oreAmt > 0.05 && splat.g > 0.1) {
    bool isViolet = splat.g > 0.7;
    vec3 oreCol = isViolet ? vec3(0.76, 0.26, 1.0) : vec3(1.0, 0.25, 0.16);
    float facet = smoothstep(0.35, 0.85, sin(vWorldPos.x * 3.1) * cos(vWorldPos.z * 3.1) * 0.5 + 0.5);
    float veinMask = clamp(oreAmt * (0.55 + 0.45 * facet), 0.0, 1.0);
    albedo = mix(albedo, oreCol * 0.55, veinMask * 0.7);
    emissive += oreCol * veinMask * (0.35 + 0.15 * sin(uTime * 2.4 + vWorldPos.x * 0.3));
  }

  // Subtle tactical grid only faintly visible from high elevation / bridges
  vec2 cellGrid = abs(fract(vWorldPos.xz / 2.0 - 0.5) - 0.5) / max(fwidth(vWorldPos.xz / 2.0), vec2(0.001));
  float gridLine = 1.0 - min(min(cellGrid.x, cellGrid.y), 1.0);
  albedo = mix(albedo, albedo * 1.08 + vec3(0.008), gridLine * (0.018 + 0.08 * splat.a));

  // Organic micro-bump surface normal perturbation (avoids armor plate grid seams)
  float hDet = detail.r * 0.65 + detail.b * 0.35;
  vec3 N = normalize(vNormal + vec3(dFdx(hDet), 0.0, dFdy(hDet)) * -1.4);
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 H = normalize(V + L);

  float NdotL = max(dot(N, L), 0.0);
  vec3 proj = (vShadowPos.xyz / vShadowPos.w) * 0.5 + 0.5;
  float shadow = sampleShadowPCSS(uShadowMap, proj, 0.0022, uShadowTexelSize);

  float spec = pow(max(dot(N, H), 0.0), 28.0) * 0.08 * shadow;
  vec3 skyAmbient = vec3(0.14, 0.18, 0.24);
  vec3 sunColor = vec3(1.18, 1.08, 0.94);

  vec3 lit = albedo * (skyAmbient + sunColor * NdotL * mix(0.32, 1.0, shadow)) + vec3(spec) + emissive;

  // 5-tap softened GPU Fog of War to eliminate 256x256 block edges
  float fogTexel = 1.0 / 256.0;
  float fogSample = (
    texture(uFogTex, vUv).r * 2.0 +
    texture(uFogTex, vUv + vec2(fogTexel, 0.0)).r +
    texture(uFogTex, vUv - vec2(fogTexel, 0.0)).r +
    texture(uFogTex, vUv + vec2(0.0, fogTexel)).r +
    texture(uFogTex, vUv - vec2(0.0, fogTexel)).r
  ) * (1.0 / 6.0);
  float fogVis = mix(fogSample, 1.0, uNoFog);
  lit *= fogVis;

  outColor = vec4(lit, 1.0);
}`;

// === Instanced Voxel/Box/Crystal VFX Shader (Pillars, Projectiles, Beams, Flashes) ===
const INST_VFX_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;

// Instance attributes (12 floats = 3 vec4)
layout(location = 2) in vec4 iWorldScale;   // xyz: center, w: yawRad
layout(location = 3) in vec4 iScalePitch;   // xyz: scale(w,h,d), w: pitchRad
layout(location = 4) in vec4 iColorKind;    // rgb: HDR color, w: emissiveGain

uniform mat4 uViewProj;

out vec3 vNormal;
out vec3 vColor;
out float vGain;

void main() {
  float cy = cos(iWorldScale.w);
  float sy = sin(iWorldScale.w);
  float cp = cos(iScalePitch.w);
  float sp = sin(iScalePitch.w);

  vec3 p = aPos * iScalePitch.xyz;
  // Pitch around X, then Yaw around Y
  vec3 pitched = vec3(p.x, p.y * cp - p.z * sp, p.y * sp + p.z * cp);
  vec3 worldPos = iWorldScale.xyz + vec3(
    pitched.x * cy + pitched.z * sy,
    pitched.y,
    -pitched.x * sy + pitched.z * cy
  );

  vec3 nP = vec3(aNormal.x, aNormal.y * cp - aNormal.z * sp, aNormal.y * sp + aNormal.z * cp);
  vNormal = normalize(vec3(nP.x * cy + nP.z * sy, nP.y, -nP.x * sy + nP.z * cy));
  vColor = iColorKind.rgb;
  vGain = iColorKind.w;
  gl_Position = uViewProj * vec4(worldPos, 1.0);
}`;

const INST_VFX_FS = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vColor;
in float vGain;

uniform vec3 uLightDir;

out vec4 outColor;

void main() {
  float diff = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);
  vec3 col = vColor * (0.45 + 0.55 * diff + vGain);
  outColor = vec4(col, 1.0);
}`;

// === Building Placement Ghost & Conyard Radius Shader ===
const GHOST_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aQuad; // -0.5..0.5

uniform mat4 uViewProj;
uniform vec4 uRect; // xz: world center, yw: width/depth

out vec2 vUv;

void main() {
  vUv = aQuad + 0.5;
  vec3 wp = vec3(uRect.x + aQuad.x * uRect.z, 1.85, uRect.y + aQuad.y * uRect.w);
  gl_Position = uViewProj * vec4(wp, 1.0);
}`;

const GHOST_FS = `#version 300 es
precision highp float;

in vec2 vUv;
uniform vec4 uColor;
uniform float uTime;
uniform float uIsRing;

out vec4 outColor;

void main() {
  if (uIsRing > 0.5) {
    vec2 d = vUv * 2.0 - 1.0;
    float r = length(d);
    if (r > 1.0 || r < 0.965) discard;
    float dash = step(0.35, fract(atan(d.y, d.x) * 8.0 / 6.28318));
    outColor = vec4(uColor.rgb, uColor.a * dash);
    return;
  }
  vec2 edge = min(vUv, 1.0 - vUv);
  float border = 1.0 - smoothstep(0.03, 0.08, min(edge.x, edge.y));
  float pulse = 0.72 + 0.28 * sin(uTime * 6.0);
  float fill = 0.28 * pulse;
  outColor = vec4(uColor.rgb * (0.8 + border * 0.6), clamp(fill + border * 0.55, 0.0, 0.88));
}`;

// === Post-Process Shaders (Half-Res Bloom + Blur + AgX Filmic Composite) ===
const QUAD_VS = `#version 300 es
precision highp float;

out vec2 vUv;

void main() {
  // Full-screen triangle with zero VBO required
  vec2 pos = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vUv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const BLOOM_EXTRACT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSceneTex;
out vec4 outColor;

void main() {
  vec3 col = texture(uSceneTex, vUv).rgb;
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float contrib = max(luma - 0.95, 0.0);
  outColor = vec4(col * (contrib / max(luma, 0.001)), 1.0);
}`;

const BLOOM_BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexelStep;
out vec4 outColor;

void main() {
  const float weights[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec3 sum = texture(uTex, vUv).rgb * weights[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = uTexelStep * float(i) * 1.6;
    sum += texture(uTex, vUv + off).rgb * weights[i];
    sum += texture(uTex, vUv - off).rgb * weights[i];
  }
  outColor = vec4(sum, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSceneTex;
uniform sampler2D uBloomTex;
uniform float uBloomStrength;
uniform float uExposure;
out vec4 outColor;

// Fitted AgX Filmic Tone Mapping Curve
vec3 agxToneMap(vec3 col) {
  const mat3 agxMat = mat3(
    0.842479062253094, 0.0423282422610123, 0.0423756549057051,
    0.0784335999999992, 0.878468636469772, 0.0784336,
    0.0792237451477643, 0.0791661274605434, 0.879142973793104
  );
  const mat3 agxInvMat = mat3(
    1.19687900512017, -0.0528968517574562, -0.0529716355144438,
    -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
    -0.0990297440797205, -0.0989611768448433, 1.15107367264116
  );
  vec3 val = agxMat * max(col, vec3(0.0));
  val = clamp(log2(max(val, vec3(1e-5))) * (1.0 / 16.5) + 0.7559, 0.0, 1.0);
  vec3 x2 = val * val;
  vec3 x4 = x2 * x2;
  val = 15.5 * x4 * x2 - 40.14 * x4 * val + 31.96 * x4 - 6.868 * x2 * val + 0.4298 * x2 + 0.1191 * val - 0.00232;
  val = agxInvMat * val;
  return clamp(val, 0.0, 1.0);
}

void main() {
  vec3 scene = texture(uSceneTex, vUv).rgb;
  vec3 bloom = texture(uBloomTex, vUv).rgb;
  vec3 hdr = (scene + bloom * uBloomStrength) * uExposure;
  // agxToneMap already curves into display-referred space; avoid double-gamma lift
  vec3 mapped = agxToneMap(hdr);

  // Subtle tactical edge vignette for HUD contrast
  vec2 centered = vUv - 0.5;
  float vig = 1.0 - dot(centered, centered) * 0.22;
  outColor = vec4(clamp(mapped * vig, 0.0, 1.0), 1.0);
}`;

function buildTerrainMesh(gl, map) {
  const segs = MAP_SIZE - 1;
  const count = MAP_SIZE * MAP_SIZE;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);

  for (let gz = 0; gz < MAP_SIZE; gz++) {
    for (let gx = 0; gx < MAP_SIZE; gx++) {
      const i = gz * MAP_SIZE + gx;
      const wx = (gx + 0.5) * CELL_SIZE;
      const wz = (gz + 0.5) * CELL_SIZE;
      const wy = map.elevation[i];
      positions[i * 3 + 0] = wx;
      positions[i * 3 + 1] = wy;
      positions[i * 3 + 2] = wz;
      uvs[i * 2 + 0] = (gx + 0.5) / MAP_SIZE;
      uvs[i * 2 + 1] = (gz + 0.5) / MAP_SIZE;
    }
  }

  for (let gz = 0; gz < MAP_SIZE; gz++) {
    for (let gx = 0; gx < MAP_SIZE; gx++) {
      const l = map.elevation[gz * MAP_SIZE + Math.max(0, gx - 1)];
      const r = map.elevation[gz * MAP_SIZE + Math.min(MAP_SIZE - 1, gx + 1)];
      const u = map.elevation[Math.max(0, gz - 1) * MAP_SIZE + gx];
      const d = map.elevation[Math.min(MAP_SIZE - 1, gz + 1) * MAP_SIZE + gx];
      const nx = l - r;
      const ny = 2.0 * CELL_SIZE;
      const nz = u - d;
      const len = Math.hypot(nx, ny, nz) || 1;
      const i = (gz * MAP_SIZE + gx) * 3;
      normals[i + 0] = nx / len;
      normals[i + 1] = ny / len;
      normals[i + 2] = nz / len;
    }
  }

  const indices = new Uint32Array(segs * segs * 6);
  let ptr = 0;
  for (let gz = 0; gz < segs; gz++) {
    for (let gx = 0; gx < segs; gx++) {
      const a = gz * MAP_SIZE + gx;
      const b = a + 1;
      const c = a + MAP_SIZE;
      const d = c + 1;
      indices[ptr++] = a; indices[ptr++] = c; indices[ptr++] = b;
      indices[ptr++] = b; indices[ptr++] = c; indices[ptr++] = d;
    }
  }

  const vao = gl.createVertexArray();
  const posVbo = gl.createBuffer();
  const normVbo = gl.createBuffer();
  const uvVbo = gl.createBuffer();
  const ibo = gl.createBuffer();

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, posVbo);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, normVbo);
  gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, uvVbo);
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  return {
    vao,
    posVbo,
    normVbo,
    uvVbo,
    ibo,
    indexCount: indices.length
  };
}

function buildUnitCubeMesh() {
  const s = 0.5;
  const faces = [
    [0, 0, 1, [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s]],
    [0, 0, -1, [s, -s, -s], [-s, -s, -s], [-s, s, -s], [s, s, -s]],
    [0, 1, 0, [-s, s, s], [s, s, s], [s, s, -s], [-s, s, -s]],
    [0, -1, 0, [-s, -s, -s], [s, -s, -s], [s, -s, s], [-s, -s, s]],
    [1, 0, 0, [s, -s, s], [s, -s, -s], [s, s, -s], [s, s, s]],
    [-1, 0, 0, [-s, -s, -s], [-s, -s, s], [-s, s, s], [-s, s, -s]]
  ];
  const verts = [];
  const idx = [];
  for (let f = 0; f < faces.length; f++) {
    const [nx, ny, nz, p0, p1, p2, p3] = faces[f];
    const base = verts.length / 6;
    verts.push(p0[0], p0[1], p0[2], nx, ny, nz);
    verts.push(p1[0], p1[1], p1[2], nx, ny, nz);
    verts.push(p2[0], p2[1], p2[2], nx, ny, nz);
    verts.push(p3[0], p3[1], p3[2], nx, ny, nz);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { vertices: new Float32Array(verts), indices: new Uint16Array(idx) };
}

export function createRenderPipeline(canvas, initialQuality = 'high') {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    depth: true,
    powerPreference: 'high-performance'
  });
  if (!gl) {
    throw new Error('WebGL2 is required to run RedAlert3A.');
  }

  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('EXT_color_buffer_half_float');

  let quality = QUALITY_PRESETS[initialQuality] ?? QUALITY_PRESETS.high;
  const cube = buildUnitCubeMesh();
  const MAX_VFX_INSTANCES = 1024;
  const VFX_FLOATS = 12;
  const vfxData = new Float32Array(MAX_VFX_INSTANCES * VFX_FLOATS);
  const splatBytes = new Uint8Array(MAP_SIZE * MAP_SIZE * 4);
  const debrisSys = createDebrisSystem(256);

  // GPU-owned subsystems & programs (initialized/rebuilt by initGpuResources on startup & context restore)
  let pbr = null;
  let gpuFog = null;
  let shadowSys = null;
  let waterRenderer = null;
  let modelFactory = null;
  let billboardRenderer = null;
  let decalPool = null;
  let terrainProg = null;
  let tLoc = null;
  let heightTex = null;
  let splatTex = null;
  let terrainMesh = null;
  let boundMapId = null;
  let lastOverlaySyncTick = -999;
  let vfxProg = null;
  let vfxLoc = null;
  let vfxVao = null;
  let vfxMeshVbo = null;
  let vfxIbo = null;
  let vfxInstVbo = null;
  let ghostProg = null;
  let ghostLoc = null;
  let ghostVao = null;
  let ghostVbo = null;
  let postVao = null;
  let extractProg = null;
  let extractSceneLoc = null;
  let blurProg = null;
  let blurTexLoc = null;
  let blurStepLoc = null;
  let compositeProg = null;
  let compLoc = null;
  let sceneRT = null;
  let bloomRT0 = null;
  let bloomRT1 = null;

  function initGpuResources() {
    pbr = bakeProceduralPBRTextures(gl, 2048);
    gpuFog = createGpuFog(gl);
    shadowSys = createShadowSystem(gl, quality.shadowSize);
    waterRenderer = createWaterRenderer(gl, compileProgram);
    modelFactory = createModelFactory(gl, compileProgram, WORLD_SIZE);
    billboardRenderer = createBillboardRenderer(gl, compileProgram);
    decalPool = createDecalPool(gl, compileProgram);

    // Terrain programs & textures
    terrainProg = compileProgram(gl, TERRAIN_VS, TERRAIN_FS);
    tLoc = {
      uViewProj: gl.getUniformLocation(terrainProg, 'uViewProj'),
      uLightViewProj: gl.getUniformLocation(terrainProg, 'uLightViewProj'),
      uSplatTex: gl.getUniformLocation(terrainProg, 'uSplatTex'),
      uDetailTex: gl.getUniformLocation(terrainProg, 'uDetailTex'),
      uShadowMap: gl.getUniformLocation(terrainProg, 'uShadowMap'),
      uFogTex: gl.getUniformLocation(terrainProg, 'uFogTex'),
      uCamPos: gl.getUniformLocation(terrainProg, 'uCamPos'),
      uLightDir: gl.getUniformLocation(terrainProg, 'uLightDir'),
      uWorldSize: gl.getUniformLocation(terrainProg, 'uWorldSize'),
      uTime: gl.getUniformLocation(terrainProg, 'uTime'),
      uNoFog: gl.getUniformLocation(terrainProg, 'uNoFog'),
      uShadowTexelSize: gl.getUniformLocation(terrainProg, 'uShadowTexelSize')
    };

    // GPU Height texture (R16F is natively linear-filterable in WebGL2 core!)
    heightTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, heightTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, MAP_SIZE, MAP_SIZE, 0, gl.RED, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    splatTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, splatTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, MAP_SIZE, MAP_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, splatBytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    // Instanced VFX / Crystal / Projectile Cube Batch (1 draw call!)
    vfxProg = compileProgram(gl, INST_VFX_VS, INST_VFX_FS);
    vfxLoc = {
      uViewProj: gl.getUniformLocation(vfxProg, 'uViewProj'),
      uLightDir: gl.getUniformLocation(vfxProg, 'uLightDir')
    };
    vfxVao = gl.createVertexArray();
    vfxMeshVbo = gl.createBuffer();
    vfxIbo = gl.createBuffer();
    vfxInstVbo = gl.createBuffer();

    gl.bindVertexArray(vfxVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vfxMeshVbo);
    gl.bufferData(gl.ARRAY_BUFFER, cube.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vfxIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cube.indices, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, vfxInstVbo);
    gl.bufferData(gl.ARRAY_BUFFER, vfxData.byteLength, gl.DYNAMIC_DRAW);
    for (let c = 0; c < 3; c++) {
      gl.enableVertexAttribArray(2 + c);
      gl.vertexAttribPointer(2 + c, 4, gl.FLOAT, false, VFX_FLOATS * 4, c * 16);
      gl.vertexAttribDivisor(2 + c, 1);
    }
    gl.bindVertexArray(null);

    // Placement Ghost & Radius quad
    ghostProg = compileProgram(gl, GHOST_VS, GHOST_FS);
    ghostLoc = {
      uViewProj: gl.getUniformLocation(ghostProg, 'uViewProj'),
      uRect: gl.getUniformLocation(ghostProg, 'uRect'),
      uColor: gl.getUniformLocation(ghostProg, 'uColor'),
      uTime: gl.getUniformLocation(ghostProg, 'uTime'),
      uIsRing: gl.getUniformLocation(ghostProg, 'uIsRing')
    };
    ghostVao = gl.createVertexArray();
    ghostVbo = gl.createBuffer();
    gl.bindVertexArray(ghostVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, ghostVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
      -0.5, -0.5, 0.5, 0.5, -0.5, 0.5
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Post-processing programs & full-screen VAO
    postVao = gl.createVertexArray();
    extractProg = compileProgram(gl, QUAD_VS, BLOOM_EXTRACT_FS);
    extractSceneLoc = gl.getUniformLocation(extractProg, 'uSceneTex');
    blurProg = compileProgram(gl, QUAD_VS, BLOOM_BLUR_FS);
    blurTexLoc = gl.getUniformLocation(blurProg, 'uTex');
    blurStepLoc = gl.getUniformLocation(blurProg, 'uTexelStep');
    compositeProg = compileProgram(gl, QUAD_VS, COMPOSITE_FS);
    compLoc = {
      uSceneTex: gl.getUniformLocation(compositeProg, 'uSceneTex'),
      uBloomTex: gl.getUniformLocation(compositeProg, 'uBloomTex'),
      uBloomStrength: gl.getUniformLocation(compositeProg, 'uBloomStrength'),
      uExposure: gl.getUniformLocation(compositeProg, 'uExposure')
    };

    terrainMesh = null;
    boundMapId = null;
    lastOverlaySyncTick = -999;
    sceneRT = null;
    bloomRT0 = null;
    bloomRT1 = null;
  }

  initGpuResources();

  function syncTerrainMap(map, tickCount, force = false) {
    if (!map) return;
    if (boundMapId !== map.id || !terrainMesh) {
      if (terrainMesh) {
        gl.deleteVertexArray(terrainMesh.vao);
        gl.deleteBuffer(terrainMesh.posVbo);
        gl.deleteBuffer(terrainMesh.normVbo);
        gl.deleteBuffer(terrainMesh.uvVbo);
        gl.deleteBuffer(terrainMesh.ibo);
      }
      terrainMesh = buildTerrainMesh(gl, map);
      gl.bindTexture(gl.TEXTURE_2D, heightTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAP_SIZE, MAP_SIZE, gl.RED, gl.FLOAT, map.elevation);
      gl.bindTexture(gl.TEXTURE_2D, null);
      boundMapId = map.id;
      force = true;
    }

    if (!force && tickCount - lastOverlaySyncTick < 6) return;
    lastOverlaySyncTick = tickCount;

    for (let i = 0, n = MAP_SIZE * MAP_SIZE; i < n; i++) {
      const dst = i * 4;
      const t = map.terrain[i];
      splatBytes[dst + 0] = Math.min(255, t * 50);
      splatBytes[dst + 1] = map.oreType[i] === ORE_TYPE.VIOLET ? 255 : (map.oreType[i] === ORE_TYPE.RED ? 128 : 0);
      splatBytes[dst + 2] = Math.min(255, Math.round((map.oreAmount[i] / ECONOMY_CONFIG.maxCellOreUnits) * 255));
      splatBytes[dst + 3] = t === TERRAIN.BRIDGE ? 255 : 0;
    }

    gl.bindTexture(gl.TEXTURE_2D, splatTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAP_SIZE, MAP_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, splatBytes);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // Transient beams / flashes / explosion rings spawned by game events & orders
  const transientFx = [];
  function pushTransientFx(fx) {
    if (transientFx.length < 320) transientFx.push(fx);
  }

  let viewportW = 1280;
  let viewportH = 720;
  let cssW = 1280;
  let cssH = 720;

  function ensureFramebuffers() {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(320, Math.round(rect.width || canvas.clientWidth || 1280));
    cssH = Math.max(240, Math.round(rect.height || canvas.clientHeight || 720));
    const dpr = Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap);
    const targetW = Math.max(320, Math.round(cssW * dpr));
    const targetH = Math.max(240, Math.round(cssH * dpr));

    if (canvas.width !== targetW || canvas.height !== targetH || !sceneRT) {
      canvas.width = targetW;
      canvas.height = targetH;
      viewportW = targetW;
      viewportH = targetH;

      disposeRenderTarget(gl, sceneRT);
      disposeRenderTarget(gl, bloomRT0);
      disposeRenderTarget(gl, bloomRT1);

      sceneRT = createColorRenderTarget(gl, viewportW, viewportH, true, true);
      const bw = Math.max(160, Math.floor(viewportW * 0.5));
      const bh = Math.max(120, Math.floor(viewportH * 0.5));
      bloomRT0 = createColorRenderTarget(gl, bw, bh, sceneRT.isFloat, false);
      bloomRT1 = createColorRenderTarget(gl, bw, bh, sceneRT.isFloat, false);
    }
  }

  // RTS Camera (52° default pitch clamped 38°~68°, FOV=42°, height 14m~80m)
  const camState = {
    targetX: 88,
    targetZ: 256,
    yaw: 0,
    pitchRad: (52 * Math.PI) / 180,
    height: 46,
    fovRad: (42 * Math.PI) / 180
  };
  const camPos = new Float32Array(3);
  const camRight = new Float32Array([1, 0, 0]);
  const camUp = new Float32Array([0, 1, 0]);
  const viewMat = mat4Identity();
  const projMat = mat4Identity();
  const viewProjMat = mat4Identity();
  const invViewProjMat = mat4Identity();

  function updateCameraMatrices() {
    const aspect = Math.max(0.1, viewportW / Math.max(1, viewportH));
    const horiz = camState.height / Math.tan(camState.pitchRad);
    camPos[0] = camState.targetX + Math.sin(camState.yaw) * horiz;
    camPos[1] = camState.height;
    camPos[2] = camState.targetZ + Math.cos(camState.yaw) * horiz;

    mat4LookAt(
      viewMat,
      camPos[0], camPos[1], camPos[2],
      camState.targetX, 1.5, camState.targetZ,
      0, 1, 0
    );
    mat4Perspective(projMat, camState.fovRad, aspect, 1.0, 520.0);
    mat4Multiply(viewProjMat, projMat, viewMat);
    mat4Invert(invViewProjMat, viewProjMat);

    // Extract camera right & up vectors from view matrix rows
    camRight[0] = viewMat[0]; camRight[1] = viewMat[4]; camRight[2] = viewMat[8];
    camUp[0] = viewMat[1]; camUp[1] = viewMat[5]; camUp[2] = viewMat[9];
  }

  function rayPlaneRaw(clientX, clientY, planeY = 1.6) {
    const rect = canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const ny = -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);

    const unproject = (zNdc) => {
      const x = invViewProjMat[0] * nx + invViewProjMat[4] * ny + invViewProjMat[8] * zNdc + invViewProjMat[12];
      const y = invViewProjMat[1] * nx + invViewProjMat[5] * ny + invViewProjMat[9] * zNdc + invViewProjMat[13];
      const z = invViewProjMat[2] * nx + invViewProjMat[6] * ny + invViewProjMat[10] * zNdc + invViewProjMat[14];
      const w = invViewProjMat[3] * nx + invViewProjMat[7] * ny + invViewProjMat[11] * zNdc + invViewProjMat[15];
      return [x / w, y / w, z / w];
    };

    const nearPt = unproject(-1);
    const farPt = unproject(1);
    const dy = farPt[1] - nearPt[1];
    if (Math.abs(dy) < 1e-4) {
      return { x: camState.targetX, z: camState.targetZ, hit: false };
    }
    const t = (planeY - nearPt[1]) / dy;
    return {
      x: nearPt[0] + (farPt[0] - nearPt[0]) * t,
      z: nearPt[2] + (farPt[2] - nearPt[2]) * t,
      hit: t > 0
    };
  }

  function screenToWorld(clientX, clientY, planeY = 1.6) {
    const p = rayPlaneRaw(clientX, clientY, planeY);
    if (!p.hit) return p;
    return {
      x: Math.max(2, Math.min(WORLD_SIZE - 2, p.x)),
      z: Math.max(2, Math.min(WORLD_SIZE - 2, p.z)),
      hit: true
    };
  }

  function worldToScreen(wx, wy, wz) {
    const cx = viewProjMat[0] * wx + viewProjMat[4] * wy + viewProjMat[8] * wz + viewProjMat[12];
    const cy = viewProjMat[1] * wx + viewProjMat[5] * wy + viewProjMat[9] * wz + viewProjMat[13];
    const cz = viewProjMat[2] * wx + viewProjMat[6] * wy + viewProjMat[10] * wz + viewProjMat[14];
    const cw = viewProjMat[3] * wx + viewProjMat[7] * wy + viewProjMat[11] * wz + viewProjMat[15];
    if (cw <= 0.01) return { x: -9999, y: -9999, visible: false };
    const ndcX = cx / cw;
    const ndcY = cy / cw;
    const ndcZ = cz / cw;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (ndcX * 0.5 + 0.5) * rect.width,
      y: rect.top + (0.5 - ndcY * 0.5) * rect.height,
      visible: ndcZ >= -1 && ndcZ <= 1 && Math.abs(ndcX) <= 1.05 && Math.abs(ndcY) <= 1.05
    };
  }

  const camera = {
    get targetX() { return camState.targetX; },
    get targetZ() { return camState.targetZ; },
    get height() { return camState.height; },
    get yaw() { return camState.yaw; },
    get pitchDeg() { return (camState.pitchRad * 180) / Math.PI; },
    pan(screenDx, screenDz) {
      const cy = Math.cos(camState.yaw);
      const sy = Math.sin(camState.yaw);
      const wx = screenDx * cy + screenDz * sy;
      const wz = -screenDx * sy + screenDz * cy;
      camState.targetX = Math.max(10, Math.min(WORLD_SIZE - 10, camState.targetX + wx));
      camState.targetZ = Math.max(10, Math.min(WORLD_SIZE - 10, camState.targetZ + wz));
      updateCameraMatrices();
    },
    panByScreenDrag(prevX, prevY, nextX, nextY) {
      const p0 = rayPlaneRaw(prevX, prevY, 1.6);
      const p1 = rayPlaneRaw(nextX, nextY, 1.6);
      if (p0.hit && p1.hit) {
        const dx = p0.x - p1.x;
        const dz = p0.z - p1.z;
        if (Math.hypot(dx, dz) < 120) {
          camState.targetX = Math.max(10, Math.min(WORLD_SIZE - 10, camState.targetX + dx));
          camState.targetZ = Math.max(10, Math.min(WORLD_SIZE - 10, camState.targetZ + dz));
          updateCameraMatrices();
          return;
        }
      }
      const scale = camState.height * 0.0028;
      this.pan((prevX - nextX) * scale, (prevY - nextY) * scale);
    },
    zoom(deltaHeight) {
      camState.height = Math.max(14, Math.min(80, camState.height + deltaHeight));
    },
    orbit(dYaw, dPitchRad) {
      camState.yaw += dYaw;
      camState.pitchRad = Math.max((38 * Math.PI) / 180, Math.min((68 * Math.PI) / 180, camState.pitchRad + dPitchRad));
    },
    resetOrientation() {
      camState.yaw = 0;
      camState.pitchRad = (52 * Math.PI) / 180;
    },
    jumpTo(x, z) {
      camState.targetX = Math.max(10, Math.min(WORLD_SIZE - 10, x));
      camState.targetZ = Math.max(10, Math.min(WORLD_SIZE - 10, z));
    },
    screenToWorld,
    worldToScreen,
    getViewRectBounds() {
      const rect = canvas.getBoundingClientRect();
      const pts = [
        screenToWorld(rect.left, rect.top, 1.6),
        screenToWorld(rect.right, rect.top, 1.6),
        screenToWorld(rect.right, rect.bottom, 1.6),
        screenToWorld(rect.left, rect.bottom, 1.6)
      ];
      return pts;
    }
  };

  const rendererInfo = {
    render: { calls: 0 }
  };

  function populateVfxInstances(state, alpha, elapsedSec) {
    let count = 0;
    const writeInst = (x, y, z, yaw, sx, sy, sz, pitch, r, g, b, gain) => {
      if (count >= MAX_VFX_INSTANCES) return;
      const off = count++ * VFX_FLOATS;
      vfxData[off + 0] = x;
      vfxData[off + 1] = y;
      vfxData[off + 2] = z;
      vfxData[off + 3] = yaw;
      vfxData[off + 4] = sx;
      vfxData[off + 5] = sy;
      vfxData[off + 6] = sz;
      vfxData[off + 7] = pitch;
      vfxData[off + 8] = r;
      vfxData[off + 9] = g;
      vfxData[off + 10] = b;
      vfxData[off + 11] = gain;
    };

    // 1. Regenerating Ore Pillar Spires (hero red/violet crystal columns)
    const pillars = state.orePillars ?? [];
    for (let i = 0; i < pillars.length; i++) {
      const p = pillars[i];
      const elev = state.map.elevation[p.gz * MAP_SIZE + p.gx] ?? 1.6;
      const isViolet = p.oreType === ORE_TYPE.VIOLET;
      const pulse = 1.6 + 0.35 * Math.sin(elapsedSec * 3.0 + i);
      const r = isViolet ? 0.85 : 1.0;
      const g = isViolet ? 0.32 : 0.25;
      const b = isViolet ? 1.0 : 0.14;
      writeInst(p.x, elev + 1.4, p.z, 0.35, 1.05, 3.0, 1.05, 0.12, r, g, b, pulse);
      writeInst(p.x + 0.55, elev + 0.9, p.z - 0.35, 1.1, 0.65, 2.0, 0.65, -0.25, r, g, b, pulse * 0.85);
      writeInst(p.x - 0.45, elev + 0.85, p.z + 0.45, -0.7, 0.6, 1.8, 0.6, 0.22, r, g, b, pulse * 0.85);
    }

    // 2. Active Ballistic/Missile Projectiles
    const projs = state.projectiles ?? [];
    for (let i = 0; i < projs.length; i++) {
      const p = projs[i];
      const ix = p.prevX + (p.x - p.prevX) * alpha;
      const iy = p.prevY + (p.y - p.prevY) * alpha;
      const iz = p.prevZ + (p.z - p.prevZ) * alpha;
      const dx = p.targetX - ix;
      const dz = p.targetZ - iz;
      const yaw = Math.atan2(dx, dz);
      const isMissile = p.damageType === 'Missile' || p.damageType === 'HighExplosive';
      const len = isMissile ? 1.35 : 0.95;
      const thick = isMissile ? 0.32 : 0.18;
      writeInst(ix, iy, iz, yaw, thick, thick, len, 0, 1.0, isMissile ? 0.45 : 0.82, isMissile ? 0.15 : 0.28, 3.2);
    }

    // 2b. Carrier Strike Drones & Orphan Airborne Drones
    for (let i = 0; i < (state.entities?.length ?? 0); i++) {
      const ent = state.entities[i];
      if (!ent.alive || ent.typeId !== 'carrier' || !ent.drones) continue;
      for (let j = 0; j < ent.drones.length; j++) {
        const d = ent.drones[j];
        if (d.fsmState === 'D_DOCKED' || d.fsmState === 'D_REARMING') continue;
        writeInst(d.x, d.y, d.z, d.yaw ?? 0, 1.35, 0.24, 1.15, 0, 0.25, 0.65, 0.98, 1.4);
      }
    }
    const orphans = state.orphanDrones ?? [];
    for (let i = 0; i < orphans.length; i++) {
      const d = orphans[i];
      writeInst(d.x, d.y, d.z, d.yaw ?? 0, 1.35, 0.24, 1.15, 0, 0.95, 0.45, 0.25, 1.6);
    }

    // 2.5 Active Superweapon Warnings, Area Effects, Iron Curtain & EMP Sparks
    const areaFx = state.areaEffects ?? [];
    for (let i = 0; i < areaFx.length; i++) {
      const fx = areaFx[i];
      const rad = fx.radius ?? 10;
      if (fx.kind === 'sw_warning') {
        const isNuke = fx.swTypeId === 'nuclear_silo';
        const r = isNuke ? 1.0 : 0.35;
        const g = isNuke ? 0.18 : 0.78;
        const b = isNuke ? 0.12 : 1.0;
        const pulse = 2.0 + 1.4 * Math.abs(Math.sin(elapsedSec * 7.0));
        writeInst(fx.x, 8.0, fx.z, elapsedSec * 2.5, 0.45, 16.0, 0.45, 0, r, g, b, pulse);
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2 + elapsedSec * 1.4;
          const px = fx.x + Math.cos(ang) * rad;
          const pz = fx.z + Math.sin(ang) * rad;
          writeInst(px, 2.2, pz, -ang, 0.45, 0.45, rad * 0.65, 0, r, g, b, pulse);
        }
      } else if (fx.kind === 'radiation' || fx.type === 'radiation') {
        for (let k = 0; k < 6; k++) {
          const ang = (k / 6) * Math.PI * 2 + elapsedSec * 0.8 + i;
          const dist = rad * (0.35 + ((k * 37) % 10) * 0.06);
          const px = fx.x + Math.cos(ang) * dist;
          const pz = fx.z + Math.sin(ang) * dist;
          const flicker = 1.4 + 0.8 * Math.sin(elapsedSec * 5.0 + k);
          writeInst(px, 2.1, pz, ang, 1.1, 0.25, 1.1, 0, 0.42, 0.95, 0.18, flicker);
        }
      } else if (fx.kind === 'satellite') {
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2 - elapsedSec * 1.2;
          const px = fx.x + Math.cos(ang) * rad;
          const pz = fx.z + Math.sin(ang) * rad;
          writeInst(px, 3.0, pz, -ang, 0.3, 0.3, 3.0, 0, 0.2, 0.88, 1.0, 2.2);
        }
      } else if (fx.kind === 'lightning_storm') {
        const pulse = 1.8 + Math.sin(elapsedSec * 9.0);
        writeInst(fx.x, 12.5, fx.z, elapsedSec, 8.5, 0.9, 8.5, 0, 0.35, 0.55, 0.98, pulse);
      }
    }

    const allEnts = state.entities ?? [];
    for (let i = 0; i < allEnts.length; i++) {
      const e = allEnts[i];
      if (!e.alive) continue;
      if (e.ironCurtainTicks > 0) {
        const s = (e.radius ?? 1.6) * 2.1;
        const glow = 2.0 + 0.9 * Math.sin(elapsedSec * 8.0 + e.id);
        writeInst(e.x, (e.y ?? 1.6) + 0.9, e.z, elapsedSec * 1.6, s, 1.8, s, 0, 0.85, 0.12, 0.16, glow);
      }
      if (e.empTicks > 0) {
        const jx = Math.sin(elapsedSec * 24 + e.id) * 0.45;
        const jz = Math.cos(elapsedSec * 21 + e.id) * 0.45;
        writeInst(e.x + jx, (e.y ?? 1.6) + 1.3, e.z + jz, elapsedSec * 6.0, 0.35, 1.1, 0.35, 0.4, 0.3, 0.85, 1.0, 2.8);
      }
    }

    // 3. Transient Fire Flashes / Explosions / Beams / Move Rings
    for (let i = transientFx.length - 1; i >= 0; i--) {
      const fx = transientFx[i];
      const age = elapsedSec - fx.startSec;
      if (age >= fx.duration) {
        transientFx.splice(i, 1);
        continue;
      }
      const prog = age / fx.duration;
      if (fx.kind === 'explosion') {
        const s = fx.scale * (0.6 + prog * 2.4);
        const heat = (1.0 - prog) * 3.8;
        writeInst(fx.x, fx.y + 0.6, fx.z, prog * 3.0, s, s * (1.1 - prog * 0.4), s, 0.3, 1.0, 0.52 * (1 - prog * 0.5), 0.12, heat);
      } else if (fx.kind === 'beam') {
        const dx = fx.tx - fx.x;
        const dz = fx.tz - fx.z;
        const dist = Math.hypot(dx, dz) || 1;
        const yaw = Math.atan2(dx, dz);
        const mx = (fx.x + fx.tx) * 0.5;
        const mz = (fx.z + fx.tz) * 0.5;
        const fade = (1.0 - prog) * 3.5;
        writeInst(mx, fx.y, mz, yaw, 0.2, 0.2, dist, 0, fx.r, fx.g, fx.b, fade);
      } else if (fx.kind === 'order') {
        const s = 1.6 * (1.0 - prog * 0.65);
        writeInst(fx.x, fx.y + 0.3, fx.z, elapsedSec * 4.0, s, 0.18, s, 0, fx.r, fx.g, fx.b, (1.0 - prog) * 2.0);
      }
    }

    const chunks = debrisSys.chunks;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      writeInst(c.x, c.y, c.z, c.yaw, c.sx, c.sy, c.sz, c.pitch, c.r, c.g, c.b, 0.25);
    }

    return count;
  }

  function renderFrame(state, alpha, uiState, elapsedSec) {
    ensureFramebuffers();
    updateCameraMatrices();
    rendererInfo.render.calls = 0;

    // Upload GPU fog (5 Hz cadence, or instant on tick 0 / force)
    const humanFog = state.fogGrids?.[0];
    gpuFog.sync(humanFog, state.tickCount, state.tickCount <= 2);
    syncTerrainMap(state.map, state.tickCount);
    modelFactory.syncEntities(state, alpha, uiState);
    billboardRenderer.sync(state, uiState.selectedIds, alpha);

    // 1. Tight-Ortho Texel-Snapped Shadow Pass (static buildings cached + dynamic units)
    const mapRev = state.map.revision ?? 1;
    const shadowCtx = { calls: 0 };
    shadowSys.renderShadows(
      camState.targetX,
      camState.targetZ,
      camState.height,
      mapRev,
      (lvp) => modelFactory.renderShadowPass(lvp, true, shadowCtx),
      (lvp) => modelFactory.renderShadowPass(lvp, false, shadowCtx)
    );
    rendererInfo.render.calls += shadowCtx.calls;

    // 2. Main Scene Pass into HDR FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneRT.fbo);
    gl.viewport(0, 0, viewportW, viewportH);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0.06, 0.10, 0.16, 1.0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    const frameCtx = {
      viewProj: viewProjMat,
      lightViewProj: shadowSys.lightViewProj,
      camPos,
      camRight,
      camUp,
      camHeight: camState.height,
      lightDir: shadowSys.lightDir,
      time: elapsedSec,
      waveScale: quality.gerstnerWaves >= 4 ? 1.0 : 0.55,
      noFog: Boolean(uiState.noFog),
      shadowSize: shadowSys.size,
      shadowTex: shadowSys.texture,
      heightTex,
      fogTex: gpuFog.texture,
      pbr,
      calls: 0
    };

    // 2a. Terrain Mesh (1 Draw Call)
    if (terrainMesh) {
      gl.useProgram(terrainProg);
      gl.bindVertexArray(terrainMesh.vao);
      gl.uniformMatrix4fv(tLoc.uViewProj, false, viewProjMat);
      gl.uniformMatrix4fv(tLoc.uLightViewProj, false, shadowSys.lightViewProj);
      gl.uniform3fv(tLoc.uCamPos, camPos);
      gl.uniform3fv(tLoc.uLightDir, shadowSys.lightDir);
      gl.uniform1f(tLoc.uWorldSize, WORLD_SIZE);
      gl.uniform1f(tLoc.uTime, elapsedSec);
      gl.uniform1f(tLoc.uNoFog, uiState.noFog ? 1.0 : 0.0);
      gl.uniform1f(tLoc.uShadowTexelSize, 1.0 / shadowSys.size);

      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, splatTex); gl.uniform1i(tLoc.uSplatTex, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, pbr.detailTex); gl.uniform1i(tLoc.uDetailTex, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, shadowSys.texture); gl.uniform1i(tLoc.uShadowMap, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, gpuFog.texture); gl.uniform1i(tLoc.uFogTex, 3);

      gl.enable(gl.CULL_FACE);
      gl.drawElements(gl.TRIANGLES, terrainMesh.indexCount, gl.UNSIGNED_INT, 0);
      frameCtx.calls++;
      gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(null);
    }

    // 2b. Ground Decals (scorch craters, tire tracks — 0 or 1 Draw Call)
    decalPool.render(frameCtx);

    // 2c. 3D Articulated Units & Buildings (1 Draw Call per active typeId!)
    modelFactory.renderMainPass(frameCtx);
    modelFactory.renderXRayPass(frameCtx);

    // 2d. Dynamic 4-Wave Gerstner Ocean (1 Draw Call)
    waterRenderer.render(frameCtx);

    // 2e. Instanced Ore Pillars, Projectiles & VFX (1 Draw Call)
    const vfxCount = populateVfxInstances(state, alpha, elapsedSec);
    if (vfxCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, vfxInstVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vfxData.subarray(0, vfxCount * VFX_FLOATS));
      gl.useProgram(vfxProg);
      gl.bindVertexArray(vfxVao);
      gl.uniformMatrix4fv(vfxLoc.uViewProj, false, viewProjMat);
      gl.uniform3fv(vfxLoc.uLightDir, shadowSys.lightDir);
      gl.drawElementsInstanced(gl.TRIANGLES, cube.indices.length, gl.UNSIGNED_SHORT, 0, vfxCount);
      frameCtx.calls++;
      gl.bindVertexArray(null);
    }

    // 2f. Building Placement Footprint & Conyard 18-cell Radius Ghost
    if (uiState.placementTypeId && uiState.hoverFootprint) {
      const fp = uiState.hoverFootprint;
      gl.useProgram(ghostProg);
      gl.bindVertexArray(ghostVao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.uniformMatrix4fv(ghostLoc.uViewProj, false, viewProjMat);
      gl.uniform1f(ghostLoc.uTime, elapsedSec);

      // Footprint quad
      const cx = (fp.gx + fp.w * 0.5) * CELL_SIZE;
      const cz = (fp.gz + fp.h * 0.5) * CELL_SIZE;
      gl.uniform4f(ghostLoc.uRect, cx, cz, fp.w * CELL_SIZE, fp.h * CELL_SIZE);
      gl.uniform4f(
        ghostLoc.uColor,
        uiState.placementValid ? 0.22 : 0.96,
        uiState.placementValid ? 0.92 : 0.22,
        uiState.placementValid ? 0.45 : 0.22,
        0.9
      );
      gl.uniform1f(ghostLoc.uIsRing, 0.0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      frameCtx.calls++;

      // Draw build radius ring around primary conyard
      const conyard = state.entities.find((e) => e.alive && e.playerId === 0 && e.typeId === 'conyard');
      if (conyard) {
        const radDiameter = ECONOMY_CONFIG.buildRadiusConyardCells * CELL_SIZE * 2;
        gl.uniform4f(ghostLoc.uRect, conyard.x, conyard.z, radDiameter, radDiameter);
        gl.uniform4f(ghostLoc.uColor, 0.35, 0.72, 1.0, 0.45);
        gl.uniform1f(ghostLoc.uIsRing, 1.0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        frameCtx.calls++;
      }

      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }

    // 2g. Single-Draw-Call GPU Tactical Billboards & Selection Rings
    billboardRenderer.render(frameCtx);
    rendererInfo.render.calls += frameCtx.calls;

    // 3. Half-Res Bloom + AgX Filmic Composite to Screen
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(postVao);

    let activeBloomTex = bloomRT0.tex;
    if (quality.bloomEnabled) {
      gl.viewport(0, 0, bloomRT0.width, bloomRT0.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomRT0.fbo);
      gl.useProgram(extractProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneRT.tex);
      gl.uniform1i(extractSceneLoc, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      rendererInfo.render.calls++;

      // Horizontal blur -> bloomRT1
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomRT1.fbo);
      gl.useProgram(blurProg);
      gl.bindTexture(gl.TEXTURE_2D, bloomRT0.tex);
      gl.uniform1i(blurTexLoc, 0);
      gl.uniform2f(blurStepLoc, 1.0 / bloomRT0.width, 0.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      rendererInfo.render.calls++;

      // Vertical blur -> bloomRT0
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomRT0.fbo);
      gl.bindTexture(gl.TEXTURE_2D, bloomRT1.tex);
      gl.uniform2f(blurStepLoc, 0.0, 1.0 / bloomRT0.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      rendererInfo.render.calls++;
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomRT0.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, viewportW, viewportH);
    gl.useProgram(compositeProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneRT.tex); gl.uniform1i(compLoc.uSceneTex, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, activeBloomTex); gl.uniform1i(compLoc.uBloomTex, 1);
    gl.uniform1f(compLoc.uBloomStrength, quality.bloomEnabled ? 0.55 : 0.0);
    gl.uniform1f(compLoc.uExposure, 1.18);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    rendererInfo.render.calls++;
    gl.bindVertexArray(null);
  }

  function setQuality(presetId) {
    const next = QUALITY_PRESETS[presetId];
    if (!next) return quality;
    quality = next;
    shadowSys.resize(quality.shadowSize);
    sceneRT = null; // triggers clean rebuild on next frame
    return quality;
  }

  function clearTransientVisuals() {
    decalPool?.clear?.();
    debrisSys.chunks.length = 0;
    transientFx.length = 0;
    gpuFog?.reset?.();
  }

  return {
    gl,
    info: rendererInfo,
    camera,
    get decalPool() { return decalPool; },
    get debrisSys() { return debrisSys; },
    get billboardRenderer() { return billboardRenderer; },
    get shadowSys() { return shadowSys; },
    get gpuFog() { return gpuFog; },
    pushTransientFx,
    clearTransientVisuals,
    syncTerrainMap,
    setQuality,
    setQualityPreset: setQuality,
    get quality() { return quality; },
    restoreContext(state, playerId = 0, noFog = false) {
      gl.getExtension('EXT_color_buffer_float');
      gl.getExtension('EXT_color_buffer_half_float');
      initGpuResources();
      if (state?.map) {
        syncTerrainMap(state.map, state.tickCount ?? 0, true);
        shadowSys.invalidateCache();
      }
      if (state?.fogGrids) {
        gpuFog.updateFromCpu(state.fogGrids[playerId] ?? state.fogGrids[0], noFog);
      }
    },
    renderFrame,
    dispose() {
      pbr.dispose();
      gpuFog.dispose();
      shadowSys.dispose();
      waterRenderer.dispose();
      modelFactory.dispose();
      billboardRenderer.dispose();
      decalPool.dispose();
      disposeRenderTarget(gl, sceneRT);
      disposeRenderTarget(gl, bloomRT0);
      disposeRenderTarget(gl, bloomRT1);
      gl.deleteTexture(heightTex);
      gl.deleteTexture(splatTex);
      gl.deleteProgram(terrainProg);
      gl.deleteProgram(vfxProg);
      gl.deleteProgram(ghostProg);
      gl.deleteProgram(extractProg);
      gl.deleteProgram(blurProg);
      gl.deleteProgram(compositeProg);
    }
  };
}
