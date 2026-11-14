// 4-Wave Gerstner Ocean Shader + CPU height sampler with smoothstep(0.0, 2.0, waterDepth) shore attenuation.

import { WORLD_SIZE } from '../world/map.js';
import { PCSS_GLSL } from './shadow.js';

const WAVES = [
  { dx: 0.85, dz: 0.52, steep: 0.18, len: 14.0, speed: 1.45 },
  { dx: -0.45, dz: 0.89, steep: 0.15, len: 9.2, speed: 1.85 },
  { dx: 0.92, dz: -0.39, steep: 0.12, len: 5.8, speed: 2.30 },
  { dx: -0.78, dz: -0.62, steep: 0.10, len: 3.4, speed: 2.85 }
];

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// CPU sampler for naval pitch/roll synchronization (zero wave amplitude near shallow beach).
export function getWaterHeight(x, z, time, waterDepth = 4.0) {
  const atten = smoothstep(0.0, 2.0, waterDepth);
  if (atten <= 0.001) return 0;
  let y = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    const k = (Math.PI * 2) / w.len;
    const amp = (w.steep / k) * 0.45 * atten;
    const phase = k * (w.dx * x + w.dz * z) + w.speed * time;
    y += Math.sin(phase) * amp;
  }
  return y;
}

const WATER_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aGridUv;

uniform mat4 uViewProj;
uniform mat4 uLightViewProj;
uniform sampler2D uHeightTex;
uniform float uTime;
uniform float uWorldSize;
uniform float uWaveScale;

out vec3 vWorldPos;
out vec3 vNormal;
out vec4 vShadowPos;
out float vDepth;

float sampleDepth(vec2 xz) {
  vec2 uv = clamp(xz / uWorldSize, 0.0, 1.0);
  float elev = texture(uHeightTex, uv).r;
  return max(0.0, -elev);
}

void gerstnerWave(vec2 dir, float steepness, float wavelength, float speed, vec3 p, float atten, inout vec3 offset, inout vec3 tangent, inout vec3 binormal) {
  float k = 6.2831853 / wavelength;
  float a = (steepness / k) * 0.45 * atten;
  float f = k * dot(dir, p.xz) + speed * uTime;
  float s = sin(f);
  float c = cos(f);

  offset.x += dir.x * (a * c);
  offset.y += a * s;
  offset.z += dir.y * (a * c);

  tangent += vec3(-dir.x * dir.x * steepness * s, dir.x * steepness * c, -dir.x * dir.y * steepness * s) * atten;
  binormal += vec3(-dir.x * dir.y * steepness * s, dir.y * steepness * c, -dir.y * dir.y * steepness * s) * atten;
}

void main() {
  vec3 basePos = vec3(aGridUv.x * uWorldSize, 0.0, aGridUv.y * uWorldSize);
  float depth = sampleDepth(basePos.xz);
  float atten = smoothstep(0.0, 2.0, depth) * uWaveScale;

  vec3 offset = vec3(0.0);
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);

  if (atten > 0.001) {
    gerstnerWave(normalize(vec2(0.85, 0.52)), 0.18, 14.0, 1.45, basePos, atten, offset, tangent, binormal);
    gerstnerWave(normalize(vec2(-0.45, 0.89)), 0.15, 9.2, 1.85, basePos, atten, offset, tangent, binormal);
    gerstnerWave(normalize(vec2(0.92, -0.39)), 0.12, 5.8, 2.30, basePos, atten, offset, tangent, binormal);
    gerstnerWave(normalize(vec2(-0.78, -0.62)), 0.10, 3.4, 2.85, basePos, atten, offset, tangent, binormal);
  } else {
    // Sink dry-land water quads below terrain so coastal buildings never intersect sea geometry
    offset.y = -0.35;
  }

  vec3 worldPos = basePos + offset;
  vWorldPos = worldPos;
  vNormal = normalize(cross(binormal, tangent));
  vShadowPos = uLightViewProj * vec4(worldPos, 1.0);
  vDepth = depth;
  gl_Position = uViewProj * vec4(worldPos, 1.0);
}`;

const WATER_FS = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec4 vShadowPos;
in float vDepth;

uniform vec3 uCamPos;
uniform vec3 uLightDir;
uniform sampler2D uHeightTex;
uniform sampler2D uShadowMap;
uniform sampler2D uFogTex;
uniform float uWorldSize;
uniform float uTime;
uniform float uNoFog;
uniform float uShadowTexelSize;

out vec4 outColor;

${PCSS_GLSL}

void main() {
  vec2 uv = clamp(vWorldPos.xz / uWorldSize, 0.0, 1.0);
  float elev = texture(uHeightTex, uv).r;
  float depth = max(0.0, -elev);
  if (depth <= 0.015) discard;

  vec3 N = normalize(vNormal + vec3(
    sin(vWorldPos.x * 1.4 + uTime * 2.1) * 0.04,
    0.0,
    cos(vWorldPos.z * 1.3 - uTime * 1.9) * 0.04
  ) * smoothstep(0.0, 1.2, depth));
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(V + L);

  float NdotL = max(dot(N, L), 0.0);
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  float spec = pow(max(dot(N, H), 0.0), 140.0) * 1.8;

  vec3 shallowCol = vec3(0.08, 0.34, 0.42);
  vec3 deepCol = vec3(0.03, 0.11, 0.22);
  vec3 skyReflect = vec3(0.36, 0.56, 0.78);
  vec3 baseCol = mix(shallowCol, deepCol, smoothstep(0.0, 2.8, depth));

  // Shoreline surf foam where 0 < depth < 0.95m
  float foamBand = smoothstep(1.0, 0.02, depth);
  float foamRipple = sin(depth * 14.0 - uTime * 3.2) * 0.5 + 0.5;
  float foam = foamBand * (0.45 + 0.55 * foamRipple);

  vec3 proj = (vShadowPos.xyz / vShadowPos.w) * 0.5 + 0.5;
  float shadow = sampleShadowPCSS(uShadowMap, proj, 0.0025, uShadowTexelSize);

  vec3 lit = mix(baseCol, skyReflect, fresnel * 0.72) * (0.42 + 0.75 * NdotL * mix(0.45, 1.0, shadow));
  lit += vec3(1.0, 0.95, 0.85) * spec * shadow;
  lit = mix(lit, vec3(0.86, 0.92, 0.96), foam * 0.55);

  float fogVis = mix(texture(uFogTex, uv).r, 1.0, uNoFog);
  lit *= fogVis;

  float alpha = mix(0.68, 0.94, smoothstep(0.02, 1.6, depth));
  outColor = vec4(lit, alpha);
}`;

function buildWaterGridMesh(gl, segs = 128) {
  const verts = [];
  const indices = [];
  for (let z = 0; z <= segs; z++) {
    for (let x = 0; x <= segs; x++) {
      verts.push(x / segs, z / segs);
    }
  }
  const row = segs + 1;
  for (let z = 0; z < segs; z++) {
    for (let x = 0; x < segs; x++) {
      const a = z * row + x;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  const ibo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, vbo, ibo, indexCount: indices.length };
}

export function createWaterRenderer(gl, compileProgram) {
  const prog = compileProgram(gl, WATER_VS, WATER_FS);
  const mesh = buildWaterGridMesh(gl, 128);
  const loc = {
    uViewProj: gl.getUniformLocation(prog, 'uViewProj'),
    uLightViewProj: gl.getUniformLocation(prog, 'uLightViewProj'),
    uHeightTex: gl.getUniformLocation(prog, 'uHeightTex'),
    uShadowMap: gl.getUniformLocation(prog, 'uShadowMap'),
    uFogTex: gl.getUniformLocation(prog, 'uFogTex'),
    uCamPos: gl.getUniformLocation(prog, 'uCamPos'),
    uLightDir: gl.getUniformLocation(prog, 'uLightDir'),
    uTime: gl.getUniformLocation(prog, 'uTime'),
    uWorldSize: gl.getUniformLocation(prog, 'uWorldSize'),
    uWaveScale: gl.getUniformLocation(prog, 'uWaveScale'),
    uNoFog: gl.getUniformLocation(prog, 'uNoFog'),
    uShadowTexelSize: gl.getUniformLocation(prog, 'uShadowTexelSize')
  };

  function render(ctx) {
    gl.useProgram(prog);
    gl.bindVertexArray(mesh.vao);
    gl.uniformMatrix4fv(loc.uViewProj, false, ctx.viewProj);
    gl.uniformMatrix4fv(loc.uLightViewProj, false, ctx.lightViewProj);
    gl.uniform3fv(loc.uCamPos, ctx.camPos);
    gl.uniform3fv(loc.uLightDir, ctx.lightDir);
    gl.uniform1f(loc.uTime, ctx.time);
    gl.uniform1f(loc.uWorldSize, WORLD_SIZE);
    gl.uniform1f(loc.uWaveScale, ctx.waveScale ?? 1.0);
    gl.uniform1f(loc.uNoFog, ctx.noFog ? 1.0 : 0.0);
    gl.uniform1f(loc.uShadowTexelSize, 1.0 / ctx.shadowSize);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ctx.heightTex);
    gl.uniform1i(loc.uHeightTex, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ctx.shadowTex);
    gl.uniform1i(loc.uShadowMap, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, ctx.fogTex);
    gl.uniform1i(loc.uFogTex, 2);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
    ctx.calls++;
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  return {
    render,
    dispose() {
      gl.deleteProgram(prog);
      gl.deleteVertexArray(mesh.vao);
      gl.deleteBuffer(mesh.vbo);
      gl.deleteBuffer(mesh.ibo);
    }
  };
}
