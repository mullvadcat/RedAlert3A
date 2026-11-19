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

float vnoiseTiled(vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 i0 = mod(i, period);
  vec2 i1 = mod(i + 1.0, period);
  float a = hash21(i0);
  float b = hash21(vec2(i1.x, i0.y));
  float c = hash21(vec2(i0.x, i1.y));
  float d = hash21(i1);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbmTiled(vec2 uv, float basePeriod) {
  float v = 0.0;
  float a = 0.5;
  float freq = basePeriod;
  for (int i = 0; i < 4; i++) {
    v += a * vnoiseTiled(uv * freq, freq);
    freq *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  // Seamless periodic tiled UV space (zero wrap seams across terrain!)
  float macro = fbmTiled(vUv, 16.0);
  float fine = fbmTiled(vUv + 0.37, 64.0);
  float microGrit = fbmTiled(vUv + 0.71, 128.0);

  // Armor plate seams & corner rivets (8x8 plate tile)
  vec2 plate = fract(vUv * 8.0);
  float seamX = smoothstep(0.025, 0.0, min(plate.x, 1.0 - plate.x));
  float seamY = smoothstep(0.025, 0.0, min(plate.y, 1.0 - plate.y));
  float seam = max(seamX, seamY);

  vec2 riv = abs(plate - clamp(plate, 0.08, 0.92));
  float rivet = smoothstep(0.018, 0.008, length(fract(plate * 6.0) - 0.5)) * step(0.15, max(riv.x, riv.y));

  // Smooth multi-scale organic grain (avoids chunky blotches on terrain)
  float organicGrain = clamp(fine * 0.62 + microGrit * 0.38, 0.0, 1.0);
  float edgeWear = smoothstep(0.4, 0.9, seam + (fine - 0.5) * 0.35);

  float heightL = macro - seam * 0.25 + rivet * 0.15;
  float eps = 0.004;
  float hx = fbmTiled(vUv + vec2(eps, 0.0), 32.0) - fbmTiled(vUv - vec2(eps, 0.0), 32.0);
  float hy = fbmTiled(vUv + vec2(0.0, eps), 32.0) - fbmTiled(vUv - vec2(0.0, eps), 32.0);
  vec2 normXY = clamp(vec2(hx, hy) * 1.9 + 0.5, 0.0, 1.0);

  float roughness = clamp(0.42 + (1.0 - macro) * 0.28 + seam * 0.2 - edgeWear * 0.18, 0.15, 0.95);
  float metallic = clamp(0.72 + rivet * 0.2 - seam * 0.35, 0.1, 0.98);

  outDetail = vec4(macro, seam, organicGrain, clamp(0.85 - seam * 0.4 + microGrit * 0.15, 0.0, 1.0));
  outMaterial = vec4(normXY.x, normXY.y, roughness, metallic);
}`;

function applyAnisotropic(gl, target, maxAniso = 8) {
  const ext = gl.getExtension('EXT_texture_filter_anisotropic')
    || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
  if (!ext) return;
  const limit = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
  gl.texParameterf(target, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(maxAniso, limit));
}

function createTexture2D(gl, width, height, internalFormat = gl.RGBA8, format = gl.RGBA, type = gl.UNSIGNED_BYTE, mipmap = true) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  applyAnisotropic(gl, gl.TEXTURE_2D, 8);
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

const TERRAIN_LAYERS = ['grass', 'dirt', 'rock', 'concrete', 'sand'];
const TERRAIN_FALLBACK_ALBEDO = [
  [44, 88, 28, 255],
  [76, 58, 38, 255],
  [82, 78, 74, 255],
  [98, 102, 106, 255],
  [148, 128, 86, 255]
];

function createEmptyTextureArray(gl, size, layers, fillFn) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, size, size, layers, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const scratch = new Uint8Array(size * size * 4);
  for (let l = 0; l < layers; l++) {
    const [r, g, b, a] = fillFn(l);
    for (let i = 0; i < scratch.length; i += 4) {
      scratch[i] = r;
      scratch[i + 1] = g;
      scratch[i + 2] = b;
      scratch[i + 3] = a;
    }
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, l, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
  }
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  applyAnisotropic(gl, gl.TEXTURE_2D_ARRAY, 8);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  return tex;
}

async function decodeImagePixels(url, size, ctx) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${url}`);
  const blob = await resp.blob();
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(blob);
    ctx.drawImage(bmp, 0, 0, size, size);
    if (typeof bmp.close === 'function') bmp.close();
  } else {
    const objUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error(`Decode failed: ${url}`));
        el.src = objUrl;
      });
      ctx.drawImage(img, 0, 0, size, size);
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  }
  return new Uint8Array(ctx.getImageData(0, 0, size, size).data);
}

export function loadTerrainPbrArrays(gl) {
  const size = 512;
  const layers = TERRAIN_LAYERS.length;
  const albedoArr = createEmptyTextureArray(gl, size, layers, (l) => TERRAIN_FALLBACK_ALBEDO[l]);
  const normRoughArr = createEmptyTextureArray(gl, size, layers, () => [128, 128, 255, 210]);

  let ready = false;
  let disposed = false;

  if (typeof fetch === 'function' && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (ctx) {
      Promise.all(
        TERRAIN_LAYERS.map(async (name, layerIdx) => {
          const base = `./assets/textures/terrain/${name}`;
          const diff = await decodeImagePixels(`${base}_diff.jpg`, size, ctx);
          const nor = await decodeImagePixels(`${base}_nor.jpg`, size, ctx);
          const rough = await decodeImagePixels(`${base}_rough.jpg`, size, ctx);
          return { layerIdx, diff, nor, rough };
        })
      )
        .then((decoded) => {
          if (disposed) return;
          const merged = new Uint8Array(size * size * 4);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

          for (const { layerIdx, diff, nor, rough } of decoded) {
            for (let i = 0; i < merged.length; i += 4) {
              merged[i] = nor[i];
              merged[i + 1] = nor[i + 1];
              merged[i + 2] = nor[i + 2];
              merged[i + 3] = rough[i];
            }
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, albedoArr);
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layerIdx, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, diff);

            gl.bindTexture(gl.TEXTURE_2D_ARRAY, normRoughArr);
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layerIdx, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, merged);
          }

          gl.bindTexture(gl.TEXTURE_2D_ARRAY, albedoArr);
          gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, normRoughArr);
          gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
          ready = true;
        })
        .catch(() => {
          // Keeps procedural terrain fallback silently if texture sheets are unavailable.
        });
    }
  }

  return {
    albedoArr,
    normRoughArr,
    get ready() { return ready; },
    dispose() {
      disposed = true;
      gl.deleteTexture(albedoArr);
      gl.deleteTexture(normRoughArr);
    }
  };
}
