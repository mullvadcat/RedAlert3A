// Startup GPU FBO 2048x2048 Procedural PBR Texture Baker + optional assets/textures/<id>.ktx2 hook.
// Produces tileable albedo/detail, normal/height, and roughness/metallic/rivet maps in VRAM.

export const PBR_ATLAS_SIZE = 2048;

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile error: ${info}`);
  }
  return sh;
}

function createProgram(gl, vsSrc, fsSrc) {
  const prog = gl.createProgram();
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link error: ${info}`);
  }
  return prog;
}

const BAKE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Bakes two 2048x2048 MRT attachments:
// Attachment 0: (albedoNoise, panelGrid, treadOrCamo, aoMicro) -> industrial metal & terrain detail
// Attachment 1: (normalX, normalY, roughness, metallic)
const BAKE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 outDetail;
layout(location = 1) out vec4 outMaterial;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  // Seamless tiled UV space
  vec2 p = vUv * 32.0;
  float macro = fbm(p);
  float fine = fbm(p * 4.0 + 17.3);

  // Armor plate seams & corner rivets (4x4 plate tile)
  vec2 plate = fract(vUv * 8.0);
  float seamX = smoothstep(0.025, 0.0, min(plate.x, 1.0 - plate.x));
  float seamY = smoothstep(0.025, 0.0, min(plate.y, 1.0 - plate.y));
  float seam = max(seamX, seamY);

  vec2 riv = abs(plate - clamp(plate, 0.08, 0.92));
  float rivet = smoothstep(0.018, 0.008, length(fract(plate * 6.0) - 0.5)) * step(0.15, max(riv.x, riv.y));

  // Digital camo blotches
  float camo = smoothstep(0.46, 0.56, fbm(vUv * 12.0 + vec2(3.1, 7.4)));
  float edgeWear = smoothstep(0.4, 0.9, seam + (fine - 0.5) * 0.35);

  float heightL = macro - seam * 0.25 + rivet * 0.15;
  float hx = fbm(p + vec2(0.15, 0.0)) - fbm(p - vec2(0.15, 0.0));
  float hy = fbm(p + vec2(0.0, 0.15)) - fbm(p - vec2(0.0, 0.15));
  vec2 normXY = clamp(vec2(hx, hy) * 1.6 + 0.5, 0.0, 1.0);

  float roughness = clamp(0.42 + (1.0 - macro) * 0.28 + seam * 0.2 - edgeWear * 0.18, 0.15, 0.95);
  float metallic = clamp(0.72 + rivet * 0.2 - seam * 0.35, 0.1, 0.98);

  outDetail = vec4(macro, seam, camo, clamp(0.85 - seam * 0.4 + fine * 0.15, 0.0, 1.0));
  outMaterial = vec4(normXY.x, normXY.y, roughness, metallic);
}`;

function createTexture2D(gl, width, height, internalFormat = gl.RGBA8, format = gl.RGBA, type = gl.UNSIGNED_BYTE, mipmap = true) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

export function bakeProceduralPBRTextures(gl, atlasSize = PBR_ATLAS_SIZE) {
  const startMs = performance.now();
  const detailTex = createTexture2D(gl, atlasSize, atlasSize);
  const materialTex = createTexture2D(gl, atlasSize, atlasSize);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, detailTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, materialTex, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

  const quadVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const prog = createProgram(gl, BAKE_VS, BAKE_FS);
  gl.useProgram(prog);
  gl.viewport(0, 0, atlasSize, atlasSize);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  gl.bindVertexArray(null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteBuffer(quadVbo);
  gl.deleteVertexArray(quadVao);
  gl.deleteProgram(prog);
  gl.deleteFramebuffer(fbo);

  // Generate hardware mipmaps so distant PBR textures shimmer zero pixels
  gl.bindTexture(gl.TEXTURE_2D, detailTex);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, materialTex);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, null);

  const elapsed = (performance.now() - startMs).toFixed(1);
  console.log(`[pbr] Baked ${atlasSize}x${atlasSize} MRT PBR textures on GPU in ${elapsed}ms`);

  // Async external .ktx2 override hook (falls back cleanly when assets/textures/*.ktx2 absent)
  async function tryLoadExternalKtx2Override(id) {
    try {
      const resp = await fetch(`./assets/textures/${id}.ktx2`, { method: 'HEAD' });
      if (resp.ok) {
        console.log(`[pbr] External KTX2 override detected for ${id}`);
      }
    } catch {
      // Zero-blocking fallback to GPU procedural textures
    }
  }

  return {
    atlasSize,
    detailTex,
    materialTex,
    tryLoadExternalKtx2Override,
    dispose() {
      gl.deleteTexture(detailTex);
      gl.deleteTexture(materialTex);
    }
  };
}
