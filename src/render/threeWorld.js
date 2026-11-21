import { THREE, HDRLoader, mergeGeometries } from './threeVendor.bundle.js';
import { MAP_SIZE, CELL_SIZE, WORLD_SIZE, TERRAIN, ORE_TYPE } from '../world/map.js';
import { ECONOMY_CONFIG } from '../core/config.js';
import { FOG_EXPLORED, FOG_VISIBLE } from '../gameplay/fogCpu.js';

export const WATER_LEVEL = 0.0;
const TERRAIN_LAYERS = ['grass', 'dirt', 'rock', 'concrete', 'sand'];

function hash2(ix, iz) {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function applyWorldFogShader(mat, fogState, cacheKey) {
  if (!mat || !fogState) return mat;
  const prevCompile = mat.onBeforeCompile;
  mat.customProgramCacheKey = () => `ra3a-fog-v2-${cacheKey}`;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prevCompile) prevCompile(shader, renderer);
    shader.uniforms.uFogTex = fogState.fogTexUniform;
    shader.uniforms.uNoFog = fogState.noFogUniform;

    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `varying vec3 vFogWorldPos;
void main() {`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vec4 _fogWp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
_fogWp = instanceMatrix * _fogWp;
#endif
vFogWorldPos = (modelMatrix * _fogWp).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vFogWorldPos;
uniform sampler2D uFogTex;
uniform float uNoFog;
float _sampleFogSmooth(vec2 uv) {
  float d = 1.85 / 256.0;
  return texture2D(uFogTex, uv).r * 0.36
    + texture2D(uFogTex, clamp(uv + vec2(d, d), vec2(0.002), vec2(0.998))).r * 0.16
    + texture2D(uFogTex, clamp(uv + vec2(-d, d), vec2(0.002), vec2(0.998))).r * 0.16
    + texture2D(uFogTex, clamp(uv + vec2(d, -d), vec2(0.002), vec2(0.998))).r * 0.16
    + texture2D(uFogTex, clamp(uv + vec2(-d, -d), vec2(0.002), vec2(0.998))).r * 0.16;
}
void main() {`
      )
      .replace(
        '#include <dithering_fragment>',
        `vec2 _fogUv = clamp(vFogWorldPos.xz / ${WORLD_SIZE.toFixed(1)}, vec2(0.002), vec2(0.998));
float _fogVis = mix(_sampleFogSmooth(_fogUv), 1.0, uNoFog);
float _fogLuma = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
vec3 _exploredCol = mix(vec3(_fogLuma), gl_FragColor.rgb, 0.36) * vec3(0.38, 0.43, 0.54);
vec3 _unexploredCol = vec3(0.014, 0.018, 0.026);
vec3 _shadedCol = mix(_unexploredCol, _exploredCol, smoothstep(0.06, 0.44, _fogVis));
gl_FragColor.rgb = mix(_shadedCol, gl_FragColor.rgb, smoothstep(0.46, 0.91, _fogVis));
#include <dithering_fragment>`
      );
  };
  mat.needsUpdate = true;
  return mat;
}

export function createGpuFog() {
  const bytes = new Uint8Array(MAP_SIZE * MAP_SIZE);
  bytes.fill(255);
  const tex = new THREE.DataTexture(bytes, MAP_SIZE, MAP_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
  tex.flipY = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  const fogTexUniform = { value: tex };
  const noFogUniform = { value: 0.0 };
  let lastUploadMs = -1000;
  let lastNoFog = false;

  function updateFromCpu(fogGrid, noFog = false, force = false) {
    const flag = noFog || !fogGrid;
    noFogUniform.value = flag ? 1.0 : 0.0;
    if (flag) {
      if (!lastNoFog || force) {
        bytes.fill(255);
        tex.needsUpdate = true;
      }
      lastNoFog = true;
      return;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && lastNoFog === false && now - lastUploadMs < 95) return;
    lastUploadMs = now;
    lastNoFog = false;

    const total = MAP_SIZE * MAP_SIZE;
    for (let i = 0; i < total; i++) {
      const m = fogGrid[i];
      bytes[i] = (m & FOG_VISIBLE) ? 255 : ((m & FOG_EXPLORED) ? 116 : 8);
    }
    tex.needsUpdate = true;
  }

  function reset() {
    bytes.fill(255);
    tex.needsUpdate = true;
    lastUploadMs = -1000;
  }

  function dispose() {
    tex.dispose();
  }

  return {
    texture: tex,
    fogTexUniform,
    noFogUniform,
    updateFromCpu,
    reset,
    dispose
  };
}

function buildFallbackEnvTexture(renderer) {
  const c = makeCanvas(256, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0.0, '#4a79b8');
  g.addColorStop(0.42, '#9ec3e6');
  g.addColorStop(0.50, '#d8e3eb');
  g.addColorStop(0.55, '#616e57');
  g.addColorStop(1.0, '#232a24');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 128);
  // Warm sun highlight in upper sky
  const sunG = ctx.createRadialGradient(180, 32, 1, 180, 32, 34);
  sunG.addColorStop(0, 'rgba(255,244,210,1)');
  sunG.addColorStop(0.3, 'rgba(255,220,165,0.55)');
  sunG.addColorStop(1, 'rgba(255,220,165,0)');
  ctx.fillStyle = sunG;
  ctx.fillRect(140, 0, 80, 72);

  const equirect = new THREE.CanvasTexture(c);
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  equirect.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromEquirectangular(equirect);
  equirect.dispose();
  pmrem.dispose();
  return rt;
}

function buildFallbackTerrainArrays(anisotropy = 4) {
  const size = 128;
  const layers = TERRAIN_LAYERS.length;
  const diffData = new Uint8Array(size * size * 4 * layers);
  const norData = new Uint8Array(size * size * 4 * layers);
  const roughData = new Uint8Array(size * size * 4 * layers);

  const layerColors = [
    [92, 114, 58, 224],   // grass
    [118, 96, 74, 232],   // dirt
    [116, 118, 116, 212], // rock
    [142, 144, 142, 204], // concrete
    [186, 170, 134, 218]  // sand
  ];

  for (let l = 0; l < layers; l++) {
    const [br, bg, bb, rgh] = layerColors[l];
    const base = l * size * size * 4;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = base + (y * size + x) * 4;
        const n = (hash2(x * 0.7 + l * 19, y * 0.7) - 0.5) * 26 + (hash2(x * 0.15, y * 0.15 + l) - 0.5) * 18;
        diffData[idx] = Math.max(12, Math.min(255, br + n));
        diffData[idx + 1] = Math.max(12, Math.min(255, bg + n));
        diffData[idx + 2] = Math.max(12, Math.min(255, bb + n));
        diffData[idx + 3] = 255;

        norData[idx] = 128 + Math.round((hash2(x + 3, y) - 0.5) * 24);
        norData[idx + 1] = 128 + Math.round((hash2(x, y + 7) - 0.5) * 24);
        norData[idx + 2] = 252;
        norData[idx + 3] = 255;

        const rv = Math.max(30, Math.min(255, rgh + Math.round(n * 0.8)));
        roughData[idx] = rv;
        roughData[idx + 1] = rv;
        roughData[idx + 2] = rv;
        roughData[idx + 3] = 255;
      }
    }
  }

  const mkArr = (buf, srgb = false) => {
    const t = new THREE.DataArrayTexture(buf, size, size, layers);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = Math.min(8, anisotropy);
    t.needsUpdate = true;
    return t;
  };

  return {
    diffArr: mkArr(diffData, true),
    norArr: mkArr(norData, false),
    roughArr: mkArr(roughData, false)
  };
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });
}

async function loadScannedTerrainArrays(anisotropy = 8) {
  const size = 512;
  const layers = TERRAIN_LAYERS.length;
  const cvs = makeCanvas(size, size);
  const ctx = cvs.getContext('2d', { willReadFrequently: true });

  const extractPixels = async (url) => {
    const img = await loadImageElement(url);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    return ctx.getImageData(0, 0, size, size).data;
  };

  const diffBuf = new Uint8Array(size * size * 4 * layers);
  const norBuf = new Uint8Array(size * size * 4 * layers);
  const roughBuf = new Uint8Array(size * size * 4 * layers);

  await Promise.all(
    TERRAIN_LAYERS.map(async (name, li) => {
      const [dPix, nPix, rPix] = await Promise.all([
        extractPixels(`assets/textures/terrain/${name}_diff.jpg`),
        extractPixels(`assets/textures/terrain/${name}_nor.jpg`),
        extractPixels(`assets/textures/terrain/${name}_rough.jpg`)
      ]);
      const off = li * size * size * 4;
      diffBuf.set(dPix, off);
      norBuf.set(nPix, off);
      roughBuf.set(rPix, off);
    })
  );

  const mkArr = (buf, srgb = false) => {
    const t = new THREE.DataArrayTexture(buf, size, size, layers);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = Math.min(8, anisotropy);
    t.needsUpdate = true;
    return t;
  };

  return {
    diffArr: mkArr(diffBuf, true),
    norArr: mkArr(norBuf, false),
    roughArr: mkArr(roughBuf, false)
  };
}

function createWaterNormalTexture() {
  const size = 256;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      const h1 = Math.sin(u * 3 + v * 2) * 0.25 + Math.cos(u * 5 - v * 4) * 0.18 + Math.sin(u * 9 + v * 7) * 0.08;
      const h2 = Math.cos(u * 4 + v * 5) * 0.22 + Math.sin(u * 7 - v * 6) * 0.14;
      const nx = Math.max(-1, Math.min(1, h1 * 0.55));
      const ny = Math.max(-1, Math.min(1, h2 * 0.55));
      const nz = Math.sqrt(Math.max(0.1, 1 - nx * nx - ny * ny));
      const p = (y * size + x) * 4;
      d[p] = Math.round((nx * 0.5 + 0.5) * 255);
      d[p + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      d[p + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(28, 28);
  return tex;
}

function buildLushPineAtlas() {
  const size = 512;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const cx = size * 0.5;
  const cy = size * 0.5;

  const branchAngles = [];
  for (let i = 0; i < 9; i++) branchAngles.push((i / 9) * Math.PI * 2 + (hash2(i, 3) - 0.5) * 0.24);

  for (const ang of branchAngles) {
    const len = size * (0.41 + hash2(ang * 10, 7) * 0.07);
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const px = -sin;
    const py = cos;

    ctx.strokeStyle = 'rgba(66, 46, 28, 0.94)';
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + cos * len * 0.86, cy + sin * len * 0.86);
    ctx.stroke();

    for (let s = 0.18; s <= 0.95; s += 0.032) {
      const bx = cx + cos * len * s;
      const by = cy + sin * len * s;
      const spread = (1.0 - s * 0.62) * 38;
      for (let side = -1; side <= 1; side += 2) {
        const subLen = spread * (0.65 + hash2(s * 97 + side, ang * 23) * 0.48);
        const subAng = ang + side * (0.68 - s * 0.24) + (hash2(s * 31, side * 5) - 0.5) * 0.16;
        const sx = bx + Math.cos(subAng) * subLen;
        const sy = by + Math.sin(subAng) * subLen;

        ctx.strokeStyle = s > 0.65 ? '#355c27' : '#25441a';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(bx + px * side * 1.2, by + py * side * 1.2);
        ctx.lineTo(sx, sy);
        ctx.stroke();

        for (let k = 0; k < 7; k++) {
          const t = (k + 1) / 7;
          const nx = bx + (sx - bx) * t;
          const ny = by + (sy - by) * t;
          const needleA = subAng + (k % 2 === 0 ? 0.52 : -0.52);
          ctx.strokeStyle = k > 4 ? '#4d7e34' : (s < 0.45 ? '#1c3614' : '#2f5721');
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(nx, ny);
          ctx.lineTo(nx + Math.cos(needleA) * 11, ny + Math.sin(needleA) * 11);
          ctx.stroke();
        }
      }
    }
  }

  const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, size * 0.16);
  grad.addColorStop(0, 'rgba(34, 62, 24, 0.95)');
  grad.addColorStop(1, 'rgba(34, 62, 24, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.16, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function buildPineCanopyGeometry() {
  const tiers = [
    { y: 1.55, r: 1.95, droop: -0.34, tilt: 0.04 },
    { y: 2.35, r: 1.72, droop: -0.30, tilt: -0.05 },
    { y: 3.15, r: 1.46, droop: -0.26, tilt: 0.04 },
    { y: 3.92, r: 1.18, droop: -0.22, tilt: -0.03 },
    { y: 4.65, r: 0.88, droop: -0.18, tilt: 0.03 },
    { y: 5.32, r: 0.56, droop: -0.12, tilt: -0.02 },
    { y: 5.88, r: 0.28, droop: -0.06, tilt: 0.0 }
  ];
  const parts = [];
  for (let ti = 0; ti < tiers.length; ti++) {
    const t = tiers[ti];
    const disc = new THREE.PlaneGeometry(t.r * 2.1, t.r * 2.1, 2, 2);
    disc.rotateX(-Math.PI / 2);
    const pos = disc.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      const d = Math.hypot(vx, vz) / Math.max(0.01, t.r);
      pos.setY(i, t.y + d * t.droop + (vx * 0.05 + vz * 0.04) * t.tilt);
    }
    disc.rotateY(ti * 0.72);
    disc.computeVertexNormals();
    parts.push(disc);
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

function buildPineTrunkGeometry() {
  const g = new THREE.CylinderGeometry(0.11, 0.27, 5.4, 7, 1);
  g.translate(0, 2.65, 0);
  return g;
}

export function createThreeWorld(renderer, scene, sharedAssets = null) {
  const disposables = [];
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 4);

  // 1. Atmosphere, HDR Sky IBL & Follow-Camera Sun Rig
  const sunLight = new THREE.DirectionalLight(0xfff2dc, 3.05);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 6;
  sunLight.shadow.camera.far = 210;
  const SUN_OFFSET = new THREE.Vector3(64, 92, 46);
  const SUN_SPAN = 64;
  sunLight.shadow.camera.left = -SUN_SPAN;
  sunLight.shadow.camera.right = SUN_SPAN;
  sunLight.shadow.camera.top = SUN_SPAN;
  sunLight.shadow.camera.bottom = -SUN_SPAN;
  sunLight.shadow.bias = -0.00055;
  sunLight.shadow.normalBias = 0.032;
  sunLight.position.copy(SUN_OFFSET);
  scene.add(sunLight);
  scene.add(sunLight.target);

  const hemiLight = new THREE.HemisphereLight(0xb2cff0, 0x4b553b, 0.56);
  scene.add(hemiLight);

  const rimLight = new THREE.DirectionalLight(0x88b4ea, 0.62);
  rimLight.position.set(-55, 42, -48);
  scene.add(rimLight);

  scene.background = new THREE.Color(0x87a2bc);
  scene.fog = new THREE.FogExp2(0x93a8be, 0.0020);

  let envRT = buildFallbackEnvTexture(renderer);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.96;

  // 2. GPU Fog of War
  const gpuFog = createGpuFog();

  // 3. Terrain PBR Texture Arrays & Splat Texture
  let terrainArrs = buildFallbackTerrainArrays(maxAniso);
  const splatBytes = new Uint8Array(MAP_SIZE * MAP_SIZE * 4);
  const splatTex = new THREE.DataTexture(splatBytes, MAP_SIZE, MAP_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  splatTex.flipY = false;
  splatTex.minFilter = THREE.LinearFilter;
  splatTex.magFilter = THREE.LinearFilter;
  splatTex.wrapS = THREE.ClampToEdgeWrapping;
  splatTex.wrapT = THREE.ClampToEdgeWrapping;
  splatTex.needsUpdate = true;
  disposables.push(splatTex);

  const terrainUniforms = {
    uTerrainDiff: { value: terrainArrs.diffArr },
    uTerrainNor: { value: terrainArrs.norArr },
    uTerrainRough: { value: terrainArrs.roughArr },
    uSplatMap: { value: splatTex },
    uFogTex: gpuFog.fogTexUniform,
    uNoFog: gpuFog.noFogUniform,
    uTerrainSize: { value: WORLD_SIZE },
    uWaterLevel: { value: WATER_LEVEL },
    uBiomeGrassLo: { value: new THREE.Color(0x6b8e47) },
    uBiomeGrassHi: { value: new THREE.Color(0xb2c775) },
    uBiomeDirt: { value: new THREE.Color(0x9e8c7a) },
    uBiomeRock: { value: new THREE.Color(0xbec2c9) },
    uBiomeSand: { value: new THREE.Color(0xdcc9a5) },
    uSnowMix: { value: 0.0 }
  };

  const terrainMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.02,
    envMapIntensity: 0.72
  });
  terrainMat.customProgramCacheKey = () => 'ra3a-plan-a-terrain-v2';
  terrainMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, terrainUniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `varying vec3 vTerrainWorldPos;
varying vec3 vTerrainWorldNorm;
varying float vTerrainHeight;
void main() {`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vec4 tWp = modelMatrix * vec4(transformed, 1.0);
vTerrainWorldPos = tWp.xyz;
vTerrainWorldNorm = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
vTerrainHeight = tWp.y;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vTerrainWorldPos;
varying vec3 vTerrainWorldNorm;
varying float vTerrainHeight;
uniform highp sampler2DArray uTerrainDiff;
uniform highp sampler2DArray uTerrainNor;
uniform highp sampler2DArray uTerrainRough;
uniform sampler2D uSplatMap;
uniform sampler2D uFogTex;
uniform float uNoFog;
uniform float uTerrainSize;
uniform float uWaterLevel;
uniform vec3 uBiomeGrassLo;
uniform vec3 uBiomeGrassHi;
uniform vec3 uBiomeDirt;
uniform vec3 uBiomeRock;
uniform vec3 uBiomeSand;
uniform float uSnowMix;

float terrainHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float terrainNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(terrainHash(i), terrainHash(i + vec2(1.0, 0.0)), u.x),
             mix(terrainHash(i + vec2(0.0, 1.0)), terrainHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec2 terrainRot(vec2 p) { return vec2(p.x * 0.7986 - p.y * 0.6018, p.x * 0.6018 + p.y * 0.7986); }
float _terrainFogSmooth(vec2 uv) {
  float d = 1.85 / 256.0;
  return texture2D(uFogTex, uv).r * 0.36
    + texture2D(uFogTex, clamp(uv + vec2(d, d), vec2(0.002), vec2(0.998))).r * 0.16
    + texture2D(uFogTex, clamp(uv + vec2(-d, d), vec2(0.002), vec2(0.998))).r * 0.16
    + texture2D(uFogTex, clamp(uv + vec2(d, -d), vec2(0.002), vec2(0.998))).r * 0.16
    + texture2D(uFogTex, clamp(uv + vec2(-d, -d), vec2(0.002), vec2(0.998))).r * 0.16;
}
void sampleTerrainLayer(vec2 wp, float layer, out vec3 outAlb, out vec3 outNor, out float outRgh) {
  vec2 uvNear = wp * 0.28;
  vec2 uvFar = terrainRot(wp * 0.095) + vec2(3.7, 1.9);
  vec3 a1 = pow(texture(uTerrainDiff, vec3(uvNear, layer)).rgb, vec3(2.2));
  vec3 a2 = pow(texture(uTerrainDiff, vec3(uvFar, layer)).rgb, vec3(2.2));
  vec3 n1 = texture(uTerrainNor, vec3(uvNear, layer)).xyz * 2.0 - 1.0;
  vec3 n2 = texture(uTerrainNor, vec3(uvFar, layer)).xyz * 2.0 - 1.0;
  float r1 = texture(uTerrainRough, vec3(uvNear, layer)).g;
  float r2 = texture(uTerrainRough, vec3(uvFar, layer)).g;
  float m = clamp(terrainNoise(wp * 0.065), 0.15, 0.85);
  outAlb = mix(a1, a2, 0.38 * m + 0.14);
  outNor = normalize(mix(n1, n2, 0.30));
  outRgh = mix(r1, r2, 0.42);
}
void main() {
  vec2 splatUv = clamp(vTerrainWorldPos.xz / uTerrainSize, vec2(0.002), vec2(0.998));
  vec4 splat = texture2D(uSplatMap, splatUv);
  float macroN = terrainNoise(vTerrainWorldPos.xz * 0.036);
  float detailN = terrainNoise(vTerrainWorldPos.xz * 0.16);
  vec3 albG, norG, albD, norD, albR, norR, albC, norC, albS, norS;
  float rghG, rghD, rghR, rghC, rghS;
  sampleTerrainLayer(vTerrainWorldPos.xz, 0.0, albG, norG, rghG);
  sampleTerrainLayer(vTerrainWorldPos.xz, 1.0, albD, norD, rghD);
  sampleTerrainLayer(vTerrainWorldPos.xz, 2.0, albR, norR, rghR);
  sampleTerrainLayer(vTerrainWorldPos.xz, 3.0, albC, norC, rghC);
  sampleTerrainLayer(vTerrainWorldPos.xz, 4.0, albS, norS, rghS);

  albG *= mix(uBiomeGrassLo, uBiomeGrassHi, macroN);
  albD *= uBiomeDirt * mix(0.74, 1.06, detailN);
  albR *= uBiomeRock;
  albS *= uBiomeSand;

  float slope = 1.0 - clamp(vTerrainWorldNorm.y, 0.0, 1.0);
  float wConc = splat.r;
  float wDirt = splat.g;
  float wRock = clamp(splat.b + smoothstep(0.18, 0.48, slope), 0.0, 1.0);
  float wSand = splat.a;
  float wSum = wConc + wDirt + wRock + wSand;
  float wScale = wSum > 1.0 ? 1.0 / wSum : 1.0;
  wConc *= wScale; wDirt *= wScale; wRock *= wScale; wSand *= wScale;
  float wGrass = max(0.0, 1.0 - (wConc + wDirt + wRock + wSand));

  float hG = albG.g * 0.6 + wGrass;
  float hD = albD.r * 0.45 + wDirt;
  float hR = albR.r * 0.55 + wRock;
  float hC = albC.r * 0.40 + wConc;
  float hS = albS.r * 0.45 + wSand;
  float maxH = max(max(hG, hD), max(max(hR, hC), hS)) - 0.18;
  float bG = max(wGrass, 0.0) * smoothstep(maxH, maxH + 0.18, hG) + 0.001;
  float bD = max(wDirt, 0.0) * smoothstep(maxH, maxH + 0.18, hD);
  float bR = max(wRock, 0.0) * smoothstep(maxH, maxH + 0.18, hR);
  float bC = max(wConc, 0.0) * smoothstep(maxH, maxH + 0.18, hC);
  float bS = max(wSand, 0.0) * smoothstep(maxH, maxH + 0.18, hS);
  float bTot = max(bG + bD + bR + bC + bS, 0.0001);
  bG /= bTot; bD /= bTot; bR /= bTot; bC /= bTot; bS /= bTot;

  vec3 tAlbedo = albG * bG + albD * bD + albR * bR + albC * bC + albS * bS;
  vec3 tNor = norG * bG + norD * bD + norR * bR + norC * bC + norS * bS;
  float tRough = rghG * bG + rghD * bD + rghR * bR + rghC * bC + rghS * bS;

  if (uSnowMix > 0.01) {
    float fineSnow = terrainNoise(vTerrainWorldPos.xz * 0.45);
    float snowMask = smoothstep(0.36, 0.74, macroN * 0.48 + detailN * 0.30 + fineSnow * 0.22)
      * (1.0 - smoothstep(0.22, 0.52, slope))
      * (1.0 - bC * 0.85)
      * smoothstep(uWaterLevel + 0.15, uWaterLevel + 0.65, vTerrainHeight);
    vec3 texturedSnow = clamp(albR * 0.46 + vec3(0.28), vec3(0.25), vec3(0.58)) * vec3(0.88, 0.94, 1.04);
    tAlbedo = mix(tAlbedo, texturedSnow, snowMask * uSnowMix);
    tRough = mix(tRough, 0.64, snowMask * uSnowMix);
  }

  float grime = smoothstep(0.05, 0.85, detailN);
  tAlbedo = mix(tAlbedo, tAlbedo * 0.74, bC * grime * 0.42);
  float shoreWet = 1.0 - smoothstep(uWaterLevel - 0.05, uWaterLevel + 0.36, vTerrainHeight);
  tAlbedo = mix(tAlbedo, tAlbedo * 0.46, shoreWet);
  tRough = mix(tRough, 0.14, shoreWet * 0.88);
`
      )
      .replace('#include <map_fragment>', `#include <map_fragment>\ndiffuseColor.rgb *= tAlbedo;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = clamp(tRough, 0.12, 0.98);`)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\nnormal = normalize(normal + vec3(tNor.x, 0.0, tNor.y) * 0.45);`
      )
      .replace(
        '#include <dithering_fragment>',
        `float _tFogVis = mix(_terrainFogSmooth(splatUv), 1.0, uNoFog);
float _tFogLuma = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
vec3 _tExp = mix(vec3(_tFogLuma), gl_FragColor.rgb, 0.36) * vec3(0.38, 0.43, 0.54);
vec3 _tUnexp = vec3(0.014, 0.018, 0.026);
vec3 _tShroud = mix(_tUnexp, _tExp, smoothstep(0.06, 0.44, _tFogVis));
gl_FragColor.rgb = mix(_tShroud, gl_FragColor.rgb, smoothstep(0.46, 0.91, _tFogVis));
#include <dithering_fragment>`
      );
  };
  disposables.push(terrainMat);

  // Terrain Mesh
  const terrainGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, MAP_SIZE, MAP_SIZE);
  terrainGeo.rotateX(-Math.PI / 2);
  disposables.push(terrainGeo);
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.position.set(WORLD_SIZE * 0.5, 0, WORLD_SIZE * 0.5);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = false;
  scene.add(terrainMesh);

  // 4. Coastal Surf-Foam Water Mesh
  const waterNormalTex = createWaterNormalTexture();
  disposables.push(waterNormalTex);
  const waterTimeUniform = { value: 0 };
  const waterShallowUniform = { value: new THREE.Color(0x143633) };
  const waterMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x091e2a),
    roughness: 0.14,
    metalness: 0.24,
    normalMap: waterNormalTex,
    normalScale: new THREE.Vector2(0.55, 0.55),
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
    envMapIntensity: 1.5
  });
  waterMat.customProgramCacheKey = () => 'ra3a-plan-a-water-v2';
  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = waterTimeUniform;
    shader.uniforms.uWaterShallow = waterShallowUniform;
    shader.uniforms.uFogTex = gpuFog.fogTexUniform;
    shader.uniforms.uNoFog = gpuFog.noFogUniform;

    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `attribute float aWaterDepth;
varying float vWaterDepth;
varying vec3 vWaterWorldPos;
void main() {`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vWaterDepth = aWaterDepth;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vWaterWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying float vWaterDepth;
varying vec3 vWaterWorldPos;
uniform float uWaterTime;
uniform vec3 uWaterShallow;
uniform sampler2D uFogTex;
uniform float uNoFog;
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x),
             mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float _waterFogSmooth(vec2 uv) {
  float d = 1.85 / 256.0;
  return texture2D(uFogTex, uv).r * 0.36
    + texture2D(uFogTex, clamp(uv + vec2(d, d), vec2(0.002), vec2(0.998))).r * 0.16
    + texture2D(uFogTex, clamp(uv + vec2(-d, d), vec2(0.002), vec2(0.998))).r * 0.16
    + texture2D(uFogTex, clamp(uv + vec2(d, -d), vec2(0.002), vec2(0.998))).r * 0.16
    + texture2D(uFogTex, clamp(uv + vec2(-d, -d), vec2(0.002), vec2(0.998))).r * 0.16;
}
void main() {
  float shoreAlpha = smoothstep(-0.02, 0.22, vWaterDepth);
  float depthMix = smoothstep(0.05, 1.85, vWaterDepth);
  float fn = wNoise(vWaterWorldPos.xz * 0.42 + vec2(uWaterTime * 0.16, -uWaterTime * 0.12));
  float fn2 = wNoise(vWaterWorldPos.xz * 1.15 - vec2(uWaterTime * 0.24, uWaterTime * 0.18));
  float surfWave = sin(vWaterDepth * 18.0 - uWaterTime * 2.3 + fn * 4.2);
  float shoreZone = (1.0 - smoothstep(0.06, 0.55, vWaterDepth)) * smoothstep(-0.01, 0.07, vWaterDepth);
  float lapEdge = (1.0 - smoothstep(0.01, 0.16, vWaterDepth)) * smoothstep(-0.02, 0.03, vWaterDepth) * (0.55 + 0.45 * fn2);
  float surfFoam = clamp(lapEdge * 0.95 + shoreZone * smoothstep(0.26, 0.84, surfWave) * (0.55 + 0.45 * fn2), 0.0, 1.0);
`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
diffuseColor.rgb = mix(uWaterShallow, diffuseColor.rgb, depthMix);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.87, 0.90), surfFoam * 0.72);
diffuseColor.a *= clamp(shoreAlpha + surfFoam * 0.35, 0.0, 1.0);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.72, surfFoam * 0.85);`
      )
      .replace(
        '#include <dithering_fragment>',
        `vec2 _wFogUv = clamp(vWaterWorldPos.xz / ${WORLD_SIZE.toFixed(1)}, vec2(0.002), vec2(0.998));
float _wVis = mix(_waterFogSmooth(_wFogUv), 1.0, uNoFog);
vec3 _wExpl = gl_FragColor.rgb * 0.34;
vec3 _wShroud = mix(vec3(0.012, 0.016, 0.024), _wExpl, smoothstep(0.06, 0.44, _wVis));
gl_FragColor.rgb = mix(_wShroud, gl_FragColor.rgb, smoothstep(0.46, 0.91, _wVis));
#include <dithering_fragment>`
      );
  };
  disposables.push(waterMat);

  const waterGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, MAP_SIZE, MAP_SIZE);
  waterGeo.rotateX(-Math.PI / 2);
  const waterDepthArr = new Float32Array(waterGeo.attributes.position.count);
  waterGeo.setAttribute('aWaterDepth', new THREE.BufferAttribute(waterDepthArr, 1));
  disposables.push(waterGeo);
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.position.set(WORLD_SIZE * 0.5, WATER_LEVEL, WORLD_SIZE * 0.5);
  waterMesh.receiveShadow = true;
  waterMesh.userData.skipGtao = true;
  waterMesh.renderOrder = 2;
  scene.add(waterMesh);

  // 5. Bridges Group
  const bridgeGroup = new THREE.Group();
  scene.add(bridgeGroup);
  const bridgeDeckMat = applyWorldFogShader(
    new THREE.MeshStandardMaterial({ color: 0x6f757b, roughness: 0.78, metalness: 0.14 }),
    gpuFog,
    'bridge-deck'
  );
  const bridgeSteelMat = applyWorldFogShader(
    new THREE.MeshStandardMaterial({ color: 0x454f58, roughness: 0.42, metalness: 0.78 }),
    gpuFog,
    'bridge-steel'
  );
  const bridgeHazardMat = applyWorldFogShader(
    new THREE.MeshStandardMaterial({ color: 0xd8a331, roughness: 0.45, metalness: 0.25 }),
    gpuFog,
    'bridge-hazard'
  );
  disposables.push(bridgeDeckMat, bridgeSteelMat, bridgeHazardMat);

  // 6. Dynamic Ore Crystals & Hero Regenerating Pillars
  const MAX_ORE_INST = 1800;
  const oreCrystalGeo = new THREE.ConeGeometry(0.32, 1.05, 5);
  oreCrystalGeo.translate(0, 0.48, 0);
  disposables.push(oreCrystalGeo);

  const makeOreMat = (col, emCol, key) => applyWorldFogShader(
    new THREE.MeshStandardMaterial({
      color: col,
      emissive: emCol,
      emissiveIntensity: 0.72,
      roughness: 0.24,
      metalness: 0.58,
      envMapIntensity: 1.4
    }),
    gpuFog,
    key
  );
  const redOreMat = makeOreMat(0xc93a1a, 0xff4616, 'ore-red');
  const violetOreMat = makeOreMat(0x7632d6, 0x9b46ff, 'ore-violet');
  const pillarBaseMat = applyWorldFogShader(
    new THREE.MeshStandardMaterial({ color: 0x3b3d42, roughness: 0.85, metalness: 0.12 }),
    gpuFog,
    'pillar-base'
  );
  disposables.push(redOreMat, violetOreMat, pillarBaseMat);

  const redOreInst = new THREE.InstancedMesh(oreCrystalGeo, redOreMat, MAX_ORE_INST);
  const violetOreInst = new THREE.InstancedMesh(oreCrystalGeo, violetOreMat, MAX_ORE_INST);
  redOreInst.castShadow = true;
  violetOreInst.castShadow = true;
  redOreInst.userData.skipGtao = true;
  violetOreInst.userData.skipGtao = true;
  redOreInst.count = 0;
  violetOreInst.count = 0;
  redOreInst.frustumCulled = false;
  violetOreInst.frustumCulled = false;
  scene.add(redOreInst);
  scene.add(violetOreInst);

  const pillarGroup = new THREE.Group();
  scene.add(pillarGroup);
  const pillarSpireMeshes = [];

  // 7. Boreal Woodland Pines, Boulders & Shrubs
  const pineAtlasTex = buildLushPineAtlas();
  disposables.push(pineAtlasTex);
  const pineCanopyGeo = buildPineCanopyGeometry();
  const pineTrunkGeo = buildPineTrunkGeometry();
  disposables.push(pineCanopyGeo, pineTrunkGeo);

  const pineTimeUniform = { value: 0 };
  const pineCanopyMat = applyWorldFogShader(
    new THREE.MeshStandardMaterial({
      map: pineAtlasTex,
      color: 0xffffff,
      alphaTest: 0.20,
      alphaToCoverage: true,
      transparent: false,
      side: THREE.DoubleSide,
      roughness: 0.78,
      metalness: 0.02,
      envMapIntensity: 0.8
    }),
    gpuFog,
    'pine-canopy'
  );
  const prevPineCompile = pineCanopyMat.onBeforeCompile;
  pineCanopyMat.onBeforeCompile = (shader, renderer) => {
    if (prevPineCompile) prevPineCompile(shader, renderer);
    shader.uniforms.uPineTime = pineTimeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `uniform float uPineTime;\nvoid main() {`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float _swayH = max(0.0, (position.y - 1.2) * 0.22);
vec3 _iOff = vec3(0.0);
#ifdef USE_INSTANCING
_iOff = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
#endif
transformed.x += sin(uPineTime * 1.45 + _iOff.x * 0.21 + _iOff.z * 0.13) * 0.11 * _swayH;
transformed.z += cos(uPineTime * 1.15 + _iOff.z * 0.18) * 0.08 * _swayH;`
      );
  };
  const pineTrunkMat = applyWorldFogShader(
    new THREE.MeshStandardMaterial({ color: 0x4b3826, roughness: 0.88, metalness: 0.02 }),
    gpuFog,
    'pine-trunk'
  );
  disposables.push(pineCanopyMat, pineTrunkMat);

  const MAX_TREES = 480;
  const pineCanopyInst = new THREE.InstancedMesh(pineCanopyGeo, pineCanopyMat, MAX_TREES);
  const pineTrunkInst = new THREE.InstancedMesh(pineTrunkGeo, pineTrunkMat, MAX_TREES);
  pineCanopyInst.castShadow = true;
  pineCanopyInst.receiveShadow = true;
  pineCanopyInst.userData.skipGtao = true;
  pineTrunkInst.castShadow = true;
  pineTrunkInst.receiveShadow = true;
  pineCanopyInst.count = 0;
  pineTrunkInst.count = 0;
  pineCanopyInst.frustumCulled = false;
  pineTrunkInst.frustumCulled = false;
  scene.add(pineCanopyInst);
  scene.add(pineTrunkInst);

  const rockGeo = new THREE.DodecahedronGeometry(1.0, 1);
  const rockPos = rockGeo.attributes.position;
  for (let i = 0; i < rockPos.count; i++) {
    const x = rockPos.getX(i);
    const y = rockPos.getY(i);
    const z = rockPos.getZ(i);
    const j = 0.82 + hash2(x * 13 + y * 7, z * 11) * 0.34;
    rockPos.setXYZ(i, x * j * 1.15, y * j * 0.68, z * j * 1.15);
  }
  rockGeo.computeVertexNormals();
  const rockMat = applyWorldFogShader(
    new THREE.MeshStandardMaterial({ color: 0x62676b, roughness: 0.86, metalness: 0.05 }),
    gpuFog,
    'boulder-rock'
  );
  disposables.push(rockGeo, rockMat);
  const MAX_ROCKS = 220;
  const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, MAX_ROCKS);
  rockInst.castShadow = true;
  rockInst.receiveShadow = true;
  rockInst.count = 0;
  rockInst.frustumCulled = false;
  scene.add(rockInst);

  // 8. Atmospheric Battle Dust Motes
  const DUST_COUNT = 150;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST_COUNT * 3);
  const dustOffsets = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i++) {
    dustOffsets[i * 3 + 0] = (hash2(i, 11) - 0.5) * 90;
    dustOffsets[i * 3 + 1] = 0.8 + hash2(i, 23) * 14.0;
    dustOffsets[i * 3 + 2] = (hash2(i, 37) - 0.5) * 90;
    dustPos[i * 3 + 0] = 256 + dustOffsets[i * 3 + 0];
    dustPos[i * 3 + 1] = dustOffsets[i * 3 + 1];
    dustPos[i * 3 + 2] = 256 + dustOffsets[i * 3 + 2];
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0xf4dec0,
    size: 0.17,
    transparent: true,
    opacity: 0.13,
    depthWrite: false
  });
  const dustPoints = new THREE.Points(dustGeo, dustMat);
  dustPoints.userData.skipGtao = true;
  dustPoints.frustumCulled = false;
  scene.add(dustPoints);
  disposables.push(dustGeo, dustMat);

  // State tracking
  const roadMask = new Uint8Array(MAP_SIZE * MAP_SIZE);
  let boundMapId = null;
  let boundMapRev = -1;
  let lastOverlaySyncTick = -999;
  let lastOreSyncTick = -999;
  let disposed = false;

  const dummy = new THREE.Object3D();

  function isGalleryMap(map) {
    if (!map) return false;
    if (map.id === 'gallery_showcase') return true;
    const br = map.bridges?.[0];
    if (br?.cells?.length) {
      return map.terrain[br.cells[0]] === TERRAIN.LAND;
    }
    return false;
  }

  function buildRoadMask(map) {
    roadMask.fill(0);
    if (!map || isGalleryMap(map)) return;
    const paintMaskDisk = (cx, cz, r, val) => {
      const r2 = r * r;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > r2) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (x < 0 || x >= MAP_SIZE || z < 0 || z >= MAP_SIZE) continue;
          const idx = z * MAP_SIZE + x;
          if (map.terrain[idx] === TERRAIN.LAND && map.oreType[idx] === 0 && roadMask[idx] < val) {
            roadMask[idx] = val;
          }
        }
      }
    };
    const paintRoad = (x0, z0, x1, z1) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 1.5));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        paintMaskDisk(Math.round(x0 + (x1 - x0) * t), Math.round(z0 + (z1 - z0) * t), 2, 1);
      }
    };
    const paintCompoundApron = (cx, cz) => {
      for (let dz = -6; dz <= 6; dz++) {
        for (let dx = -6; dx <= 6; dx++) {
          if (Math.abs(dx) + Math.abs(dz) > 9) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (x < 0 || x >= MAP_SIZE || z < 0 || z >= MAP_SIZE) continue;
          const idx = z * MAP_SIZE + x;
          if (map.terrain[idx] === TERRAIN.LAND && map.oreType[idx] === 0) {
            roadMask[idx] = 2;
          }
        }
      }
    };
    const spawns = map.spawns ?? [];
    const bridges = map.bridges ?? [];
    for (const sp of spawns) {
      paintMaskDisk(sp.gx, sp.gz, 9, 1);
      paintCompoundApron(sp.gx, sp.gz);
      if (bridges.length > 0) {
        let bestBr = bridges[0];
        let bestD = Infinity;
        for (const br of bridges) {
          const bx = (br.x0 + br.x1) * 0.5;
          const bz = (br.z0 + br.z1) * 0.5;
          const d = Math.hypot(bx - sp.gx, bz - sp.gz);
          if (d < bestD) { bestD = d; bestBr = br; }
        }
        paintRoad(sp.gx, sp.gz, Math.round((bestBr.x0 + bestBr.x1) * 0.5), Math.round((bestBr.z0 + bestBr.z1) * 0.5));
      }
    }
  }

  function rebuildHeightAndWater(map) {
    const pos = terrainGeo.attributes.position;
    const stride = MAP_SIZE + 1;
    const sampleSeabedOrElev = (gx, gz) => {
      const cx = Math.max(0, Math.min(MAP_SIZE - 1, gx));
      const cz = Math.max(0, Math.min(MAP_SIZE - 1, gz));
      const idx = cz * MAP_SIZE + cx;
      const t = map.terrain[idx];
      if (t === TERRAIN.BRIDGE || t === TERRAIN.BROKEN_BRIDGE) return -2.9;
      return map.elevation[idx];
    };

    for (let iz = 0; iz <= MAP_SIZE; iz++) {
      for (let ix = 0; ix <= MAP_SIZE; ix++) {
        const vi = iz * stride + ix;
        const h00 = sampleSeabedOrElev(ix - 1, iz - 1);
        const h10 = sampleSeabedOrElev(ix, iz - 1);
        const h01 = sampleSeabedOrElev(ix - 1, iz);
        const h11 = sampleSeabedOrElev(ix, iz);
        const avgH = (h00 + h10 + h01 + h11) * 0.25;
        pos.setY(vi, avgH);
        waterDepthArr[vi] = Math.max(0, WATER_LEVEL - avgH);
      }
    }
    pos.needsUpdate = true;
    terrainGeo.computeVertexNormals();
    terrainGeo.computeBoundingBox();
    terrainGeo.computeBoundingSphere();

    waterGeo.attributes.aWaterDepth.needsUpdate = true;
  }

  function rebuildBridges(map) {
    while (bridgeGroup.children.length > 0) {
      const c = bridgeGroup.children.pop();
      c.traverse((n) => {
        if (n.isMesh && n.geometry) n.geometry.dispose();
      });
    }
    const baseElev = map.blueprint?.baseElevation ?? 1.6;
    for (const br of map.bridges ?? []) {
      if (br.cells?.length && map.terrain[br.cells[0]] === TERRAIN.LAND) continue;
      const xMin = br.x0 * CELL_SIZE;
      const xMax = (br.x1 + 1) * CELL_SIZE;
      const zMin = br.z0 * CELL_SIZE;
      const zMax = (br.z1 + 1) * CELL_SIZE;
      const wX = xMax - xMin;
      const wZ = zMax - zMin;
      const cx = (xMin + xMax) * 0.5;
      const cz = (zMin + zMax) * 0.5;
      const spanAlongX = wX >= wZ;
      const length = spanAlongX ? wX : wZ;
      const width = spanAlongX ? wZ : wX;

      const g = new THREE.Group();
      g.position.set(cx, baseElev, cz);
      if (!spanAlongX) g.rotation.y = Math.PI * 0.5;

      if (br.intact !== false) {
        const deck = new THREE.Mesh(new THREE.BoxGeometry(length + 1.2, 0.42, width + 0.4), bridgeDeckMat);
        deck.position.y = -0.18;
        deck.castShadow = true;
        deck.receiveShadow = true;
        g.add(deck);

        // Side Warren steel trusses
        for (const side of [-1, 1]) {
          const zRail = side * (width * 0.5 + 0.15);
          const botChord = new THREE.Mesh(new THREE.BoxGeometry(length + 1.2, 0.32, 0.42), bridgeSteelMat);
          botChord.position.set(0, 0.18, zRail);
          botChord.castShadow = true;
          g.add(botChord);

          const topChord = new THREE.Mesh(new THREE.BoxGeometry(length * 0.92, 0.28, 0.38), bridgeSteelMat);
          topChord.position.set(0, 2.35, zRail);
          topChord.castShadow = true;
          g.add(topChord);

          const postCount = Math.max(4, Math.round(length / 5.5));
          for (let p = 0; p <= postCount; p++) {
            const px = -length * 0.46 + (p / postCount) * (length * 0.92);
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.2, 0.34), bridgeSteelMat);
            post.position.set(px, 1.25, zRail);
            post.castShadow = true;
            g.add(post);
          }
        }
        // Submerged piers
        const pierCount = Math.max(2, Math.round(length / 10));
        for (let p = 1; p < pierCount; p++) {
          const px = -length * 0.5 + (p / pierCount) * length;
          const pier = new THREE.Mesh(new THREE.BoxGeometry(1.4, 5.2, width * 0.82), bridgeDeckMat);
          pier.position.set(px, -2.75, 0);
          pier.castShadow = true;
          pier.receiveShadow = true;
          g.add(pier);
        }
        // Hazard bollards at shore entries
        for (const sx of [-length * 0.5, length * 0.5]) {
          for (const sz of [-width * 0.48, width * 0.48]) {
            const b = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.9, 8), bridgeHazardMat);
            b.position.set(sx, 0.45, sz);
            b.castShadow = true;
            g.add(b);
          }
        }
      } else {
        // Broken bridge ends dipped into water
        for (const dir of [-1, 1]) {
          const stub = new THREE.Mesh(new THREE.BoxGeometry(length * 0.26, 0.42, width + 0.2), bridgeDeckMat);
          stub.position.set(dir * length * 0.39, -0.85, 0);
          stub.rotation.z = dir * 0.32;
          stub.castShadow = true;
          stub.receiveShadow = true;
          g.add(stub);
        }
      }

      bridgeGroup.add(g);
    }
  }

  function rebuildPillars(map) {
    while (pillarGroup.children.length > 0) {
      const c = pillarGroup.children.pop();
      c.traverse((n) => {
        if (n.isMesh && n.geometry) n.geometry.dispose();
      });
    }
    pillarSpireMeshes.length = 0;

    for (const p of map.orePillars ?? []) {
      const idx = p.gz * MAP_SIZE + p.gx;
      const elev = map.elevation[idx] ?? 1.6;
      const isViolet = p.oreType === ORE_TYPE.VIOLET;
      const crystalMat = isViolet ? violetOreMat : redOreMat;

      const pg = new THREE.Group();
      pg.position.set(p.x, elev, p.z);

      const rockMound = new THREE.Mesh(new THREE.DodecahedronGeometry(1.55, 1), pillarBaseMat);
      rockMound.scale.set(1.2, 0.42, 1.2);
      rockMound.position.y = 0.25;
      rockMound.castShadow = true;
      rockMound.receiveShadow = true;
      pg.add(rockMound);

      const mainSpire = new THREE.Mesh(new THREE.ConeGeometry(0.68, 3.6, 6), crystalMat);
      mainSpire.position.y = 1.95;
      mainSpire.rotation.y = 0.35;
      mainSpire.castShadow = true;
      pg.add(mainSpire);
      pillarSpireMeshes.push(mainSpire);

      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * Math.PI * 2 + 0.4;
        const sub = new THREE.Mesh(new THREE.ConeGeometry(0.36, 2.05, 5), crystalMat);
        sub.position.set(Math.cos(ang) * 0.72, 1.05, Math.sin(ang) * 0.72);
        sub.rotation.z = -Math.cos(ang) * 0.32;
        sub.rotation.x = Math.sin(ang) * 0.32;
        sub.castShadow = true;
        pg.add(sub);
      }

      pillarGroup.add(pg);
    }
  }

  function rebuildProps(map) {
    const gallery = isGalleryMap(map);
    const spawns = map.spawns ?? [];
    const nearBlocked = (gx, gz) => {
      if (gallery && gx >= 92 && gx <= 164 && gz >= 92 && gz <= 164) return true;
      for (let s = 0; s < spawns.length; s++) {
        if (Math.hypot(gx - spawns[s].gx, gz - spawns[s].gz) < 20) return true;
      }
      for (const br of map.bridges ?? []) {
        if (gx >= br.x0 - 8 && gx <= br.x1 + 8 && gz >= br.z0 - 8 && gz <= br.z1 + 8) return true;
      }
      return false;
    };

    let tIdx = 0;
    let rIdx = 0;
    for (let gz = 6; gz < MAP_SIZE - 6; gz += 3) {
      for (let gx = 6; gx < MAP_SIZE - 6; gx += 3) {
        const idx = gz * MAP_SIZE + gx;
        const t = map.terrain[idx];
        const rnd = hash2(gx * 1.3, gz * 2.1);

        // Coastal & cliff boulders
        if (t === TERRAIN.CLIFF || (t === TERRAIN.LAND && rnd > 0.96 && map.oreType[idx] === 0 && roadMask[idx] === 0)) {
          if (rIdx < MAX_ROCKS && (t !== TERRAIN.CLIFF || rnd > 0.58) && !nearBlocked(gx, gz)) {
            const wx = (gx + 0.5 + (rnd - 0.5) * 0.6) * CELL_SIZE;
            const wz = (gz + 0.5 + (hash2(gz, gx) - 0.5) * 0.6) * CELL_SIZE;
            const elev = map.elevation[idx];
            dummy.position.set(wx, elev - 0.1, wz);
            dummy.rotation.set(rnd * 0.3, rnd * Math.PI * 2, hash2(gx + 5, gz) * 0.3);
            const s = (t === TERRAIN.CLIFF ? 1.45 : 0.72) * (0.75 + rnd * 0.65);
            dummy.scale.set(s, s * 0.75, s);
            dummy.updateMatrix();
            rockInst.setMatrixAt(rIdx++, dummy.matrix);
          }
          continue;
        }

        if (t !== TERRAIN.LAND || map.oreType[idx] !== 0 || roadMask[idx] !== 0) continue;
        if (tIdx >= MAX_TREES || nearBlocked(gx, gz)) continue;

        // Avoid shoreline shallow transition cells (need solid 2-cell land margin)
        const nIdx = Math.max(0, gz - 2) * MAP_SIZE + gx;
        const sIdx = Math.min(MAP_SIZE - 1, gz + 2) * MAP_SIZE + gx;
        if (map.terrain[nIdx] !== TERRAIN.LAND || map.terrain[sIdx] !== TERRAIN.LAND) continue;

        // Woodland clustering noise
        const cluster = Math.sin(gx * 0.085 + 1.1) * Math.cos(gz * 0.085 - 0.7) + rnd * 0.65;
        const borderBias = (gx < 26 || gx > MAP_SIZE - 26 || gz < 26 || gz > MAP_SIZE - 26) ? 0.35 : 0;
        if (cluster + borderBias < 0.72) continue;

        const wx = (gx + 0.5 + (hash2(gx + 9, gz) - 0.5) * 1.1) * CELL_SIZE;
        const wz = (gz + 0.5 + (hash2(gx, gz + 13) - 0.5) * 1.1) * CELL_SIZE;
        const elev = map.elevation[idx];
        const scale = 0.85 + hash2(gx + 17, gz + 3) * 0.65;
        const yaw = rnd * Math.PI * 2;

        dummy.position.set(wx, elev - 0.08, wz);
        dummy.rotation.set((rnd - 0.5) * 0.05, yaw, (hash2(gz, gx) - 0.5) * 0.05);
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        pineCanopyInst.setMatrixAt(tIdx, dummy.matrix);
        pineTrunkInst.setMatrixAt(tIdx, dummy.matrix);
        tIdx++;
      }
    }

    pineCanopyInst.count = tIdx;
    pineTrunkInst.count = tIdx;
    rockInst.count = rIdx;
    pineCanopyInst.instanceMatrix.needsUpdate = true;
    pineTrunkInst.instanceMatrix.needsUpdate = true;
    rockInst.instanceMatrix.needsUpdate = true;
  }

  function syncOreCrystals(map) {
    let rCount = 0;
    let vCount = 0;
    const total = MAP_SIZE * MAP_SIZE;
    for (let i = 0; i < total; i++) {
      const ot = map.oreType[i];
      const amt = map.oreAmount[i];
      if (!ot || amt <= 0) continue;
      const gx = i % MAP_SIZE;
      const gz = Math.floor(i / MAP_SIZE);
      const elev = map.elevation[i] ?? 1.6;
      const baseWx = (gx + 0.5) * CELL_SIZE;
      const baseWz = (gz + 0.5) * CELL_SIZE;
      const shards = Math.min(3, amt);
      const inst = ot === ORE_TYPE.VIOLET ? violetOreInst : redOreInst;
      const isV = ot === ORE_TYPE.VIOLET;

      for (let s = 0; s < shards; s++) {
        if ((isV ? vCount : rCount) >= MAX_ORE_INST) break;
        const r1 = hash2(gx * 7 + s * 3, gz * 5);
        const r2 = hash2(gx * 3, gz * 11 + s * 7);
        dummy.position.set(baseWx + (r1 - 0.5) * 1.15, elev - 0.06, baseWz + (r2 - 0.5) * 1.15);
        dummy.rotation.set((r1 - 0.5) * 0.45, r2 * Math.PI * 2, (r2 - 0.5) * 0.45);
        const sc = 0.65 + (amt / ECONOMY_CONFIG.maxCellOreUnits) * 0.55 + r1 * 0.22;
        dummy.scale.set(sc * 0.9, sc * (0.85 + s * 0.24), sc * 0.9);
        dummy.updateMatrix();
        if (isV) inst.setMatrixAt(vCount++, dummy.matrix);
        else inst.setMatrixAt(rCount++, dummy.matrix);
      }
    }
    redOreInst.count = rCount;
    violetOreInst.count = vCount;
    redOreInst.instanceMatrix.needsUpdate = true;
    violetOreInst.instanceMatrix.needsUpdate = true;
  }

  function updateSplatTexture(map) {
    const gallery = isGalleryMap(map);
    const bldg = map.buildingId;
    const total = MAP_SIZE * MAP_SIZE;
    for (let gz = 0; gz < MAP_SIZE; gz++) {
      const row = gz * MAP_SIZE;
      for (let gx = 0; gx < MAP_SIZE; gx++) {
        const i = row + gx;
        const dst = i * 4;
        const t = map.terrain[i];
        const hasCompound = roadMask[i] === 2;
        const hasRoad = roadMask[i] === 1;
        const bldgHere = bldg[i] !== 0;

        let bldgNb = false;
        if (!bldgHere && t === TERRAIN.LAND) {
          bldgNb =
            (gx > 0 && bldg[i - 1] !== 0) ||
            (gx + 1 < MAP_SIZE && bldg[i + 1] !== 0) ||
            (gz > 0 && bldg[i - MAP_SIZE] !== 0) ||
            (gz + 1 < MAP_SIZE && bldg[i + MAP_SIZE] !== 0);
        }

        const inPlaza = gallery && gx >= 99 && gx <= 157 && gz >= 99 && gz <= 157;
        const plazaRim = gallery && !inPlaza && gx >= 95 && gx <= 161 && gz >= 95 && gz <= 161;
        const wConc = inPlaza ? 215 : (bldgHere ? 255 : (bldgNb ? 185 : (hasCompound ? 148 : (hasRoad ? 70 : 0))));
        const wDirt = plazaRim ? 150 : (hasCompound ? 115 : ((hasRoad && !bldgHere) ? 195 : (map.oreType[i] > 0 ? 150 : 0)));
        const wRock = t === TERRAIN.CLIFF ? 255 : 0;

        let wSand = (t === TERRAIN.SHALLOW || t === TERRAIN.SEA) ? 250 : 0;
        if (t === TERRAIN.LAND && !bldgHere) {
          const nearSea =
            (gx > 1 && map.terrain[i - 2] === TERRAIN.SHALLOW) ||
            (gx + 2 < MAP_SIZE && map.terrain[i + 2] === TERRAIN.SHALLOW) ||
            (gz > 1 && map.terrain[i - MAP_SIZE * 2] === TERRAIN.SHALLOW) ||
            (gz + 2 < MAP_SIZE && map.terrain[i + MAP_SIZE * 2] === TERRAIN.SHALLOW);
          if (nearSea) wSand = 135;
        }

        splatBytes[dst + 0] = wConc;
        splatBytes[dst + 1] = wDirt;
        splatBytes[dst + 2] = wRock;
        splatBytes[dst + 3] = Math.min(255, wSand + (hash2(gx, gz) > 0.72 && !bldgHere ? 18 : 0));
      }
    }
    if (splatBytes.length === total * 4) {
      splatTex.needsUpdate = true;
    }
  }

  function applyMapBiomeTheme(map) {
    const id = String(map?.blueprint?.id || map?.id || '').toLowerCase();
    if (/frost|alpine|twin_bridges/.test(id)) {
      terrainUniforms.uBiomeGrassLo.value.setHex(0x6c7c66);
      terrainUniforms.uBiomeGrassHi.value.setHex(0xa8b4a4);
      terrainUniforms.uBiomeDirt.value.setHex(0x888f96);
      terrainUniforms.uBiomeRock.value.setHex(0xaab6c2);
      terrainUniforms.uBiomeSand.value.setHex(0xc2cbd4);
      terrainUniforms.uSnowMix.value = 0.78;
      waterMat.color.setHex(0x092438);
      waterShallowUniform.value.setHex(0x1f4b5e);
      rockMat.color.setHex(0x74818e);
      scene.fog.color.setHex(0xb3c7db);
    } else if (/crater|volcan|eruption/.test(id)) {
      terrainUniforms.uBiomeGrassLo.value.setHex(0x524c44);
      terrainUniforms.uBiomeGrassHi.value.setHex(0x786752);
      terrainUniforms.uBiomeDirt.value.setHex(0x7c5e4b);
      terrainUniforms.uBiomeRock.value.setHex(0x7a7478);
      terrainUniforms.uBiomeSand.value.setHex(0x6e5e52);
      terrainUniforms.uSnowMix.value = 0.0;
      waterMat.color.setHex(0x1a151c);
      waterShallowUniform.value.setHex(0x3a2422);
      rockMat.color.setHex(0x3e393d);
      scene.fog.color.setHex(0x7e726b);
    } else if (/mesa|basin|refinery/.test(id)) {
      terrainUniforms.uBiomeGrassLo.value.setHex(0x8a7d52);
      terrainUniforms.uBiomeGrassHi.value.setHex(0xb89c68);
      terrainUniforms.uBiomeDirt.value.setHex(0xb58863);
      terrainUniforms.uBiomeRock.value.setHex(0xc8a484);
      terrainUniforms.uBiomeSand.value.setHex(0xdcb98a);
      terrainUniforms.uSnowMix.value = 0.0;
      waterMat.color.setHex(0x0c242e);
      waterShallowUniform.value.setHex(0x285452);
      rockMat.color.setHex(0x886c56);
      scene.fog.color.setHex(0xb0a391);
    } else if (/archipelago|island/.test(id)) {
      terrainUniforms.uBiomeGrassLo.value.setHex(0x4c843c);
      terrainUniforms.uBiomeGrassHi.value.setHex(0x82b458);
      terrainUniforms.uBiomeDirt.value.setHex(0xa89278);
      terrainUniforms.uBiomeRock.value.setHex(0xb8bcbf);
      terrainUniforms.uBiomeSand.value.setHex(0xead6ac);
      terrainUniforms.uSnowMix.value = 0.0;
      waterMat.color.setHex(0x06293d);
      waterShallowUniform.value.setHex(0x1b6668);
      rockMat.color.setHex(0x72787d);
      scene.fog.color.setHex(0x9bc2d4);
    } else {
      terrainUniforms.uBiomeGrassLo.value.setHex(0x4a6934);
      terrainUniforms.uBiomeGrassHi.value.setHex(0x809950);
      terrainUniforms.uBiomeDirt.value.setHex(0x8e7d6c);
      terrainUniforms.uBiomeRock.value.setHex(0xaab0b6);
      terrainUniforms.uBiomeSand.value.setHex(0xd6c29d);
      terrainUniforms.uSnowMix.value = 0.0;
      waterMat.color.setHex(0x091e2a);
      waterShallowUniform.value.setHex(0x143633);
      rockMat.color.setHex(0x62676b);
      scene.fog.color.setHex(0x93a8be);
    }
  }

  function syncMap(map, tickCount = 0, force = false) {
    if (!map || disposed) return;
    const mapChanged = map.id !== boundMapId || (map.revision ?? 1) !== boundMapRev;
    if (mapChanged) {
      applyMapBiomeTheme(map);
      buildRoadMask(map);
      rebuildHeightAndWater(map);
      rebuildBridges(map);
      rebuildPillars(map);
      rebuildProps(map);
      boundMapId = map.id;
      boundMapRev = map.revision ?? 1;
      force = true;
    }

    if (force || tickCount - lastOverlaySyncTick >= 6) {
      lastOverlaySyncTick = tickCount;
      updateSplatTexture(map);
    }
    if (force || tickCount - lastOreSyncTick >= 10) {
      lastOreSyncTick = tickCount;
      syncOreCrystals(map);
    }
  }

  function updateSunFocus(targetX, targetZ, camHeight = 40) {
    const span = Math.max(46, Math.min(105, camHeight * 1.45));
    const texelSize = (span * 2) / 2048;
    const sx = Math.round(targetX / texelSize) * texelSize;
    const sz = Math.round(targetZ / texelSize) * texelSize;
    sunLight.target.position.set(sx, 1.6, sz);
    sunLight.position.set(sx + SUN_OFFSET.x, SUN_OFFSET.y, sz + SUN_OFFSET.z);
    if (Math.abs(sunLight.shadow.camera.right - span) > 1.5) {
      sunLight.shadow.camera.left = -span;
      sunLight.shadow.camera.right = span;
      sunLight.shadow.camera.top = span;
      sunLight.shadow.camera.bottom = -span;
      sunLight.shadow.camera.updateProjectionMatrix();
    }
    sunLight.target.updateMatrixWorld();
  }

  function updateAtmosphere(elapsedSec, camTargetX, camTargetZ) {
    waterTimeUniform.value = elapsedSec;
    pineTimeUniform.value = elapsedSec;
    const emPulse = 0.65 + 0.25 * Math.sin(elapsedSec * 2.8);
    redOreMat.emissiveIntensity = emPulse;
    violetOreMat.emissiveIntensity = emPulse * 1.15;

    const pAttr = dustGeo.attributes.position;
    for (let i = 0; i < DUST_COUNT; i++) {
      const ox = dustOffsets[i * 3 + 0];
      const oy = dustOffsets[i * 3 + 1];
      const oz = dustOffsets[i * 3 + 2];
      pAttr.setXYZ(
        i,
        camTargetX + ox + Math.sin(elapsedSec * 0.28 + i) * 2.6,
        oy + Math.sin(elapsedSec * 0.42 + i * 1.7) * 0.7,
        camTargetZ + oz + Math.cos(elapsedSec * 0.24 + i) * 2.4
      );
    }
    pAttr.needsUpdate = true;
  }

  function upgradeFromAsyncAssets() {
    if (disposed) return;
    loadScannedTerrainArrays(maxAniso)
      .then((realArrs) => {
        if (disposed) {
          realArrs.diffArr.dispose();
          realArrs.norArr.dispose();
          realArrs.roughArr.dispose();
          return;
        }
        const prev = terrainArrs;
        terrainArrs = realArrs;
        terrainUniforms.uTerrainDiff.value = realArrs.diffArr;
        terrainUniforms.uTerrainNor.value = realArrs.norArr;
        terrainUniforms.uTerrainRough.value = realArrs.roughArr;
        prev.diffArr.dispose();
        prev.norArr.dispose();
        prev.roughArr.dispose();
      })
      .catch(() => {});

    const hdrLoader = new HDRLoader();
    hdrLoader.load(
      'assets/plan-a/sky.hdr',
      (hdrTex) => {
        if (disposed) {
          hdrTex.dispose();
          return;
        }
        hdrTex.mapping = THREE.EquirectangularReflectionMapping;
        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
        const nextEnv = pmrem.fromEquirectangular(hdrTex);
        pmrem.dispose();
        const prevEnv = envRT;
        envRT = nextEnv;
        scene.environment = nextEnv.texture;
        scene.background = hdrTex;
        scene.backgroundBlurriness = 0.08;
        scene.backgroundIntensity = 0.72;
        prevEnv?.dispose();
        disposables.push(hdrTex);
      },
      undefined,
      () => {}
    );
  }
  upgradeFromAsyncAssets();

  function dispose() {
    disposed = true;
    gpuFog.dispose();
    envRT?.dispose();
    terrainArrs?.diffArr?.dispose();
    terrainArrs?.norArr?.dispose();
    terrainArrs?.roughArr?.dispose();
    for (const d of disposables) d?.dispose?.();
    redOreInst.dispose();
    violetOreInst.dispose();
    pineCanopyInst.dispose();
    pineTrunkInst.dispose();
    rockInst.dispose();
  }

  return {
    gpuFog,
    sunLight,
    waterMesh,
    terrainMesh,
    syncMap,
    updateSunFocus,
    updateAtmosphere,
    applyFogToMaterial: (mat, key) => applyWorldFogShader(mat, gpuFog, key),
    dispose
  };
}
