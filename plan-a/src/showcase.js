import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const TERRAIN_SIZE = 160;
const TERRAIN_SEGMENTS = 192;
const WATER_LEVEL = 0.05;
const SHOWCASE_PAD = new THREE.Vector3(12.2, 0, 14.5);

const DEFAULT_STATS = {
  compressedPolyHavenRawKb: 518766.5,
  compressedPolyHavenOptKb: 7781.6,
  showcaseTotalDiskKb: 13043.5,
};

const LIGHTING_PRESETS = [
  {
    id: 'dusk',
    label: '光照: 黄昏战区',
    sunColor: 0xffd09a,
    sunIntensity: 2.85,
    sunPos: new THREE.Vector3(38, 22, 30),
    hemiSky: 0x89a9d4,
    hemiGround: 0x2f291f,
    hemiIntensity: 0.46,
    rimColor: 0x6ea6e8,
    rimIntensity: 0.42,
    envIntensity: 1.05,
    bgIntensity: 0.78,
    exposure: 1.02,
    fogColor: 0x6f7c8a,
    fogDensity: 0.0052,
    waterColor: 0x152b2c,
  },
  {
    id: 'noon',
    label: '光照: 正午强光',
    sunColor: 0xfff5e4,
    sunIntensity: 3.35,
    sunPos: new THREE.Vector3(26, 48, 24),
    hemiSky: 0xaed2ff,
    hemiGround: 0x453e31,
    hemiIntensity: 0.55,
    rimColor: 0x9ec5ff,
    rimIntensity: 0.34,
    envIntensity: 0.92,
    bgIntensity: 0.92,
    exposure: 0.94,
    fogColor: 0x90a9bf,
    fogDensity: 0.0042,
    waterColor: 0x1a3940,
  },
  {
    id: 'overcast',
    label: '光照: 暴雨前夕',
    sunColor: 0xb9cce2,
    sunIntensity: 1.65,
    sunPos: new THREE.Vector3(-34, 29, 26),
    hemiSky: 0x7b90a8,
    hemiGround: 0x22241f,
    hemiIntensity: 0.62,
    rimColor: 0x5684b8,
    rimIntensity: 0.52,
    envIntensity: 1.18,
    bgIntensity: 0.52,
    exposure: 1.08,
    fogColor: 0x4f5b69,
    fogDensity: 0.0076,
    waterColor: 0x101f22,
  },
];

const CAMERA_PRESETS = {
  cinematic: { pos: new THREE.Vector3(18.5, 7.6, 21.8), target: new THREE.Vector3(-2.8, 2.0, 2.4) },
  rts: { pos: new THREE.Vector3(15.5, 25.5, 25.5), target: new THREE.Vector3(-3.0, 1.4, 2.0) },
  tanks: { pos: new THREE.Vector3(10.8, 3.65, 13.4), target: new THREE.Vector3(0.6, 1.85, 5.4) },
  base: { pos: new THREE.Vector3(1.5, 7.6, 10.2), target: new THREE.Vector3(-12.5, 2.8, -7.8) },
};

const dom = {
  canvas: document.getElementById('viewport'),
  perfPill: document.getElementById('perf-pill'),
  assetsPill: document.getElementById('assets-pill'),
  dropStatus: document.getElementById('drop-status'),
  loadingOverlay: document.getElementById('loading-overlay'),
  loadingText: document.getElementById('loading-text'),
  loadingFill: document.getElementById('loading-fill'),
  btnTime: document.getElementById('btn-time'),
  btnHdri: document.getElementById('btn-hdri'),
  btnPost: document.getElementById('btn-post'),
  btnAction: document.getElementById('btn-action'),
  presetButtons: Array.from(document.querySelectorAll('#camera-presets [data-cam]')),
};

function setLoadingProgress(fraction, message) {
  if (dom.loadingFill) dom.loadingFill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  if (dom.loadingText && message) dom.loadingText.textContent = message;
}

function hideLoadingOverlay() {
  if (dom.loadingOverlay) dom.loadingOverlay.classList.add('hidden');
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function hash2D(ix, iz) {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise2D(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2D(ix, iz);
  const b = hash2D(ix + 1, iz);
  const c = hash2D(ix, iz + 1);
  const d = hash2D(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm2D(x, z) {
  let sum = 0;
  let amp = 0.55;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    sum += amp * valueNoise2D(x * freq, z * freq);
    freq *= 2.04;
    amp *= 0.48;
  }
  return sum;
}

function roadCenterX(z) {
  return 0.58 * z - 3.0 + Math.sin(z * 0.085) * 4.2;
}

function roadDistance(x, z) {
  return Math.abs(x - roadCenterX(z));
}

function terrainHeight(x, z) {
  let h = 1.25 + (fbm2D(x * 0.032 + 4.1, z * 0.032 - 2.7) - 0.5) * 1.9;
  h += (fbm2D(x * 0.11, z * 0.11) - 0.5) * 0.32;

  // Sculpted hills & defensive ridges around north/west/east perimeter (smooth organic transitions)
  const nRidge = smoothstep(-16, -54, z) * (4.8 + fbm2D(x * 0.055, z * 0.055) * 6.2);
  const wRidge = smoothstep(-28, -64, x) * smoothstep(8, -22, z) * (4.2 + fbm2D(x * 0.05 + 9, z * 0.05) * 4.5);
  const eRidge = smoothstep(24, 62, x) * (3.6 + fbm2D(x * 0.05 - 3, z * 0.05) * 4.6);
  h += nRidge + wRidge + eRidge;

  // Forward War Factory concrete compound plateau
  const baseDx = (x + 12.5) / 14.5;
  const baseDz = (z + 8.5) / 12.5;
  const baseDist = Math.hypot(baseDx, baseDz);
  const baseFlatten = 1.0 - smoothstep(0.58, 1.08, baseDist);
  h = h * (1.0 - baseFlatten) + 1.58 * baseFlatten;

  // Foreground right .glb inspection concrete pad
  const padDist = Math.hypot(x - SHOWCASE_PAD.x, z - SHOWCASE_PAD.z);
  const padFlatten = 1.0 - smoothstep(3.2, 6.4, padDist);
  h = h * (1.0 - padFlatten) + 1.18 * padFlatten;

  // Armored staging berm & road (stops cleanly behind War Factory so north ridge stays intact)
  const dRoad = roadDistance(x, z);
  const roadZMask = smoothstep(-14, -4, z) * (1.0 - smoothstep(22, 34, z));
  const roadFlatten = (1.0 - smoothstep(2.4, 6.8, dRoad)) * roadZMask;
  const roadTarget = 1.16 - smoothstep(18, 29, z) * 0.65;
  h = h * (1.0 - roadFlatten * 0.78) + roadTarget * (roadFlatten * 0.78);
  const ruts = Math.exp(-Math.pow((Math.abs(dRoad - 1.25)) / 0.52, 2)) * roadZMask * (1.0 - smoothstep(3.6, 5.8, dRoad));
  h -= ruts * 0.075;

  // Coastal harbor inlet on lower-left and western/southern shore edge (visible from RTS & cinematic angles)
  const coastMetric = z * 0.78 - x * 0.52 + Math.sin(x * 0.08 + z * 0.04) * 3.4;
  const coastSlope = smoothstep(14.5, 25.5, coastMetric);
  h = h * (1.0 - coastSlope) + (-1.35) * coastSlope;

  return h;
}

function terrainNormal(x, z, out = new THREE.Vector3()) {
  const eps = 0.45;
  const hL = terrainHeight(x - eps, z);
  const hR = terrainHeight(x + eps, z);
  const hD = terrainHeight(x, z - eps);
  const hU = terrainHeight(x, z + eps);
  return out.set(hL - hR, 2.0 * eps, hD - hU).normalize();
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

async function buildTerrainDataArray(urls, { size = 512 } = {}) {
  const imgs = await Promise.all(urls.map(loadImage));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const layerBytes = size * size * 4;
  const packed = new Uint8Array(layerBytes * imgs.length);

  for (let i = 0; i < imgs.length; i++) {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(imgs[i], 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    packed.set(data, i * layerBytes);
  }

  const arr = new THREE.DataArrayTexture(packed, size, size, imgs.length);
  arr.format = THREE.RGBAFormat;
  arr.type = THREE.UnsignedByteType;
  arr.wrapS = THREE.RepeatWrapping;
  arr.wrapT = THREE.RepeatWrapping;
  arr.minFilter = THREE.LinearMipmapLinearFilter;
  arr.magFilter = THREE.LinearFilter;
  arr.generateMipmaps = true;
  arr.needsUpdate = true;
  return arr;
}

function buildSplatMapTexture(size = 512) {
  const data = new Uint8Array(size * size * 4);
  const nVec = new THREE.Vector3();

  for (let py = 0; py < size; py++) {
    const wz = ((py + 0.5) / size - 0.5) * TERRAIN_SIZE;
    for (let px = 0; px < size; px++) {
      const wx = ((px + 0.5) / size - 0.5) * TERRAIN_SIZE;
      const h = terrainHeight(wx, wz);
      terrainNormal(wx, wz, nVec);
      const slope = 1.0 - Math.max(0, Math.min(1, nVec.y));

      // Concrete: base compound apron + foreground showcase pad
      const baseD = Math.hypot((wx + 12.5) / 11.8, (wz + 8.5) / 9.8);
      const baseConcrete = 1.0 - smoothstep(0.76, 1.02, baseD);
      const padD = Math.hypot(wx - SHOWCASE_PAD.x, wz - SHOWCASE_PAD.z);
      const padConcrete = 1.0 - smoothstep(2.9, 4.1, padD);
      const concrete = Math.max(baseConcrete, padConcrete);

      // Dirt: convoy road (only south of -12m gate) + tank tracks + firing berm disturbance
      const dRoad = roadDistance(wx, wz);
      const roadZMask = smoothstep(-12, -3.5, wz) * (1.0 - smoothstep(18.5, 25.0, wz));
      const roadW = (1.0 - smoothstep(2.1, 4.9, dRoad)) * roadZMask;
      const skirtD = Math.hypot((wx + 12.5) / 14.2, (wz + 8.5) / 12.2);
      const skirtDirt = (1.0 - smoothstep(0.84, 1.12, skirtD)) * (1.0 - baseConcrete * 0.92);
      const battleBerm = Math.exp(-Math.pow(Math.hypot(wx - 2.8, wz - 6.2) / 5.2, 2)) * 0.65;
      const dirt = Math.min(1, Math.max(roadW, skirtDirt, battleBerm) * (1.0 - concrete * 0.92));

      // Rock: steep cliffs + alpine ridges
      const ridgeRock = smoothstep(3.6, 7.6, h) * smoothstep(0.06, 0.25, slope + fbm2D(wx * 0.08, wz * 0.08) * 0.14);
      const slopeRock = smoothstep(0.11, 0.28, slope);
      const rock = Math.min(1, Math.max(slopeRock, ridgeRock) * (1.0 - concrete * 0.95));

      // Sand: shoreline & submerged coastal floor
      const sand = (1.0 - smoothstep(0.05, 0.85, h)) * (1.0 - concrete);

      const idx = (py * size + px) * 4;
      data[idx] = Math.round(concrete * 255);
      data[idx + 1] = Math.round(dirt * 255);
      data[idx + 2] = Math.round(rock * 255);
      data[idx + 3] = Math.round(sand * 255);
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

async function createTerrainMesh(maxAniso) {
  const names = ['grass', 'dirt', 'rock', 'concrete', 'sand'];
  const [diffArr, norArr, roughArr] = await Promise.all([
    buildTerrainDataArray(names.map((n) => `./assets/textures/terrain/${n}_diff.jpg`)),
    buildTerrainDataArray(names.map((n) => `./assets/textures/terrain/${n}_nor.jpg`)),
    buildTerrainDataArray(names.map((n) => `./assets/textures/terrain/${n}_rough.jpg`)),
  ]);

  const aniso = Math.min(8, maxAniso || 1);
  diffArr.anisotropy = aniso;
  norArr.anisotropy = aniso;
  roughArr.anisotropy = aniso;

  const splatTex = buildSplatMapTexture(512);

  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const posAttr = geo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    posAttr.setY(i, terrainHeight(x, z));
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.02,
    envMapIntensity: 0.72,
  });

  mat.customProgramCacheKey = () => 'plan-a-terrain-pbr-array-v1';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTerrainDiff = { value: diffArr };
    shader.uniforms.uTerrainNor = { value: norArr };
    shader.uniforms.uTerrainRough = { value: roughArr };
    shader.uniforms.uSplatMap = { value: splatTex };
    shader.uniforms.uTerrainSize = { value: TERRAIN_SIZE };
    shader.uniforms.uWaterLevel = { value: WATER_LEVEL };

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
vec4 tWorldPos = modelMatrix * vec4(transformed, 1.0);
vTerrainWorldPos = tWorldPos.xyz;
vTerrainWorldNorm = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
vTerrainHeight = tWorldPos.y;`
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
uniform float uTerrainSize;
uniform float uWaterLevel;

float terrainHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float terrainNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(terrainHash(i), terrainHash(i + vec2(1.0, 0.0)), u.x),
    mix(terrainHash(i + vec2(0.0, 1.0)), terrainHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
vec2 terrainRot(vec2 p) {
  return vec2(p.x * 0.7986 - p.y * 0.6018, p.x * 0.6018 + p.y * 0.7986);
}
void sampleTerrainLayer(vec2 wp, float layer, out vec3 outAlb, out vec3 outNor, out float outRgh) {
  vec2 uvNear = wp * 0.34;
  vec2 uvFar = terrainRot(wp * 0.115) + vec2(3.7, 1.9);
  vec3 a1 = pow(texture(uTerrainDiff, vec3(uvNear, layer)).rgb, vec3(2.2));
  vec3 a2 = pow(texture(uTerrainDiff, vec3(uvFar, layer)).rgb, vec3(2.2));
  vec3 n1 = texture(uTerrainNor, vec3(uvNear, layer)).xyz * 2.0 - 1.0;
  vec3 n2 = texture(uTerrainNor, vec3(uvFar, layer)).xyz * 2.0 - 1.0;
  float r1 = texture(uTerrainRough, vec3(uvNear, layer)).g;
  float r2 = texture(uTerrainRough, vec3(uvFar, layer)).g;
  float m = clamp(terrainNoise(wp * 0.085), 0.15, 0.85);
  outAlb = mix(a1, a2, 0.38 * m + 0.14);
  outNor = normalize(mix(n1, n2, 0.30));
  outRgh = mix(r1, r2, 0.42);
}

void main() {
  vec2 splatUv = clamp(vTerrainWorldPos.xz / uTerrainSize + 0.5, vec2(0.002), vec2(0.998));
  vec4 splat = texture2D(uSplatMap, splatUv);
  float macroN = terrainNoise(vTerrainWorldPos.xz * 0.048);
  float detailN = terrainNoise(vTerrainWorldPos.xz * 0.19);

  vec3 albG, norG, albD, norD, albR, norR, albC, norC, albS, norS;
  float rghG, rghD, rghR, rghC, rghS;
  sampleTerrainLayer(vTerrainWorldPos.xz, 0.0, albG, norG, rghG);
  sampleTerrainLayer(vTerrainWorldPos.xz, 1.0, albD, norD, rghD);
  sampleTerrainLayer(vTerrainWorldPos.xz, 2.0, albR, norR, rghR);
  sampleTerrainLayer(vTerrainWorldPos.xz, 3.0, albC, norC, rghC);
  sampleTerrainLayer(vTerrainWorldPos.xz, 4.0, albS, norS, rghS);

  // Rich temperate forest olive-emerald turf + earthy damp gravel road contrast
  albG *= mix(vec3(0.40, 0.56, 0.28), vec3(0.68, 0.78, 0.44), macroN) * vec3(0.86, 0.94, 0.80);
  albD *= mix(vec3(0.60, 0.54, 0.48), vec3(0.95, 0.88, 0.80), detailN);
  albR *= vec3(0.76, 0.78, 0.80);

  float wConc = splat.r;
  float wDirt = splat.g;
  float wRock = splat.b;
  float wSand = splat.a;
  float wSum = wConc + wDirt + wRock + wSand;
  float scale = wSum > 1.0 ? 1.0 / wSum : 1.0;
  wConc *= scale; wDirt *= scale; wRock *= scale; wSand *= scale;
  float wGrass = max(0.0, 1.0 - (wConc + wDirt + wRock + wSand));

  // Height-modulated transition crispness
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

  // Concrete pad grime around edges + subtle tire scuff contrast
  float grime = smoothstep(0.05, 0.85, detailN);
  tAlbedo = mix(tAlbedo, tAlbedo * 0.72, bC * grime * 0.45);

  // Coastal shoreline wetness band
  float shoreWet = 1.0 - smoothstep(uWaterLevel - 0.05, uWaterLevel + 0.34, vTerrainHeight);
  tAlbedo = mix(tAlbedo, tAlbedo * 0.48, shoreWet);
  tRough = mix(tRough, 0.15, shoreWet * 0.88);
`
      )
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= tAlbedo;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughness * mix(0.28, 0.96, tRough), 0.12, 0.98);')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
vec3 worldBump = vec3(tNor.x * 1.12, 0.0, -tNor.y * 1.12);
vec3 wPerturbed = normalize(vTerrainWorldNorm + worldBump);
normal = normalize((viewMatrix * vec4(wPerturbed, 0.0)).xyz);`
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

function createWaterMesh() {
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 96, 96);
  geo.rotateX(-Math.PI / 2);

  // Subtle normal texture procedural canvas for reflective ocean ripples
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const u = (x / 256) * Math.PI * 2;
      const v = (y / 256) * Math.PI * 2;
      const dx = Math.cos(u * 3 + v * 2) * 0.45 + Math.cos(u * 7 - v * 4) * 0.25;
      const dy = Math.sin(v * 4 + u * 2) * 0.45 + Math.sin(v * 6 + u * 5) * 0.25;
      const idx = (y * 256 + x) * 4;
      img.data[idx] = Math.round((dx * 0.4 + 0.5) * 255);
      img.data[idx + 1] = Math.round((dy * 0.4 + 0.5) * 255);
      img.data[idx + 2] = 245;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const normalTex = new THREE.CanvasTexture(c);
  normalTex.wrapS = THREE.RepeatWrapping;
  normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.repeat.set(16, 16);

  const mat = new THREE.MeshStandardMaterial({
    color: 0x152b2c,
    roughness: 0.09,
    metalness: 0.22,
    normalMap: normalTex,
    normalScale: new THREE.Vector2(0.45, 0.45),
    transparent: true,
    opacity: 0.91,
    envMapIntensity: 1.55,
  });

  const water = new THREE.Mesh(geo, mat);
  water.position.y = WATER_LEVEL;
  water.receiveShadow = true;
  return { water, waterMat: mat, waterNormal: normalTex };
}

function fixFoliageMaterial(mat) {
  const n = (mat.name || '').toLowerCase();
  if (n.includes('twig') || n.includes('leaf') || n.includes('shrub') || n.includes('foliage') || mat.transparent) {
    mat.transparent = false;
    mat.alphaTest = 0.22;
    mat.alphaToCoverage = true;
    mat.depthWrite = true;
    mat.side = THREE.DoubleSide;
    mat.roughness = Math.max(mat.roughness ?? 0.65, 0.72);
    mat.needsUpdate = true;
  }
}

function enhanceFoliageTextures(rootScene, { alphaPow = 0.36, tint = [0.68, 0.96, 0.56], anisotropy = 8 } = {}) {
  const seen = new Set();
  rootScene.traverse((obj) => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat || seen.has(mat)) continue;
      const n = (mat.name || '').toLowerCase();
      if (!/(twig|leaf|shrub|foliage)/i.test(n) || !mat.map?.image) continue;
      seen.add(mat);

      const tex = mat.map;
      const img = tex.image;
      if (!img || !img.width || !img.height) continue;

      const w = Math.min(512, img.width);
      const h = Math.min(512, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);

      const src = ctx.getImageData(0, 0, w, h);
      const data = src.data;
      const alphaCopy = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) alphaCopy[i] = data[i * 4 + 3];

      // 3x3 1-px alpha dilation + power lift so delicate pine needles keep silhouette across mip levels
      for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - 1);
        const y1 = Math.min(h - 1, y + 1);
        for (let x = 0; x < w; x++) {
          const x0 = Math.max(0, x - 1);
          const x1 = Math.min(w - 1, x + 1);
          const idx = y * w + x;
          let maxA = alphaCopy[idx];
          for (let ny = y0; ny <= y1; ny++) {
            for (let nx = x0; nx <= x1; nx++) {
              const na = alphaCopy[ny * w + nx];
              if (na > maxA) maxA = na;
            }
          }
          const baseA = alphaCopy[idx];
          const lifted = baseA > 6
            ? Math.round(Math.pow(baseA / 255, alphaPow) * 255)
            : Math.round(Math.pow(maxA / 255, alphaPow) * 255 * 0.86);
          const p = idx * 4;
          data[p] = Math.min(255, Math.round(data[p] * tint[0]));
          data[p + 1] = Math.min(255, Math.round(data[p + 1] * tint[1]));
          data[p + 2] = Math.min(255, Math.round(data[p + 2] * tint[2]));
          data[p + 3] = Math.min(255, lifted);
        }
      }

      ctx.putImageData(src, 0, 0);
      const nextTex = new THREE.CanvasTexture(canvas);
      nextTex.colorSpace = THREE.SRGBColorSpace;
      nextTex.flipY = tex.flipY;
      nextTex.wrapS = tex.wrapS;
      nextTex.wrapT = tex.wrapT;
      nextTex.repeat.copy(tex.repeat);
      nextTex.offset.copy(tex.offset);
      nextTex.anisotropy = Math.min(8, anisotropy || 4);
      nextTex.needsUpdate = true;

      mat.map = nextTex;
      mat.transparent = false;
      mat.alphaTest = 0.22;
      mat.alphaToCoverage = true;
      mat.depthWrite = true;
      mat.side = THREE.DoubleSide;
      mat.roughness = Math.max(mat.roughness ?? 0.72, 0.78);
      mat.needsUpdate = true;
    }
  });
}

function normalizeModelMaterials(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m) continue;
      fixFoliageMaterial(m);
      if (typeof m.envMapIntensity === 'number') {
        m.envMapIntensity = Math.max(m.envMapIntensity, 0.95);
      }
    }
  });
}

function extractCenteredSubnode(rootScene, nodeName, { groundMinY = true, targetHeight = null } = {}) {
  const src = rootScene.getObjectByName(nodeName);
  if (!src) throw new Error(`Missing subnode "${nodeName}"`);
  const clone = SkeletonUtils.clone(src);
  const wrapper = new THREE.Group();
  wrapper.add(clone);
  wrapper.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(clone);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  clone.position.x -= center.x;
  clone.position.z -= center.z;
  if (groundMinY) {
    clone.position.y -= box.min.y;
  } else {
    clone.position.y -= center.y;
  }

  if (targetHeight && size.y > 1e-4) {
    const s = targetHeight / size.y;
    wrapper.scale.setScalar(s);
  }

  normalizeModelMaterials(wrapper);
  return { object: wrapper, rawBox: box, size };
}

function normalizeWholeGltf(rootScene, { targetHeight = null, groundMinY = true, facePlusZFromMinusZ = false } = {}) {
  const clone = SkeletonUtils.clone(rootScene);
  if (facePlusZFromMinusZ) {
    clone.rotation.y = Math.PI;
  }
  const wrapper = new THREE.Group();
  wrapper.add(clone);
  wrapper.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(clone);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  clone.position.x -= center.x;
  clone.position.z -= center.z;
  if (groundMinY) clone.position.y -= box.min.y;

  if (targetHeight && size.y > 1e-4) {
    wrapper.scale.setScalar(targetHeight / size.y);
  }
  normalizeModelMaterials(wrapper);
  return { object: wrapper, size };
}

function createContactShadowTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
  g.addColorStop(0, 'rgba(6, 9, 12, 0.72)');
  g.addColorStop(0.55, 'rgba(8, 12, 16, 0.35)');
  g.addColorStop(1, 'rgba(8, 12, 16, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createRtsRingTexture(hexColor = '#38bdf8') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = hexColor;
  ctx.lineWidth = 8;
  ctx.globalAlpha = 0.72;
  const arcs = [
    [-0.36, 0.36],
    [Math.PI / 2 - 0.36, Math.PI / 2 + 0.36],
    [Math.PI - 0.36, Math.PI + 0.36],
    [(Math.PI * 3) / 2 - 0.36, (Math.PI * 3) / 2 + 0.36],
  ];
  for (const [a0, a1] of arcs) {
    ctx.beginPath();
    ctx.arc(128, 128, 110, a0, a1);
    ctx.stroke();
  }
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.arc(128, 128, 102, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createFlashTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, 'rgba(255, 250, 220, 1)');
  g.addColorStop(0.28, 'rgba(255, 175, 65, 0.92)');
  g.addColorStop(0.65, 'rgba(235, 90, 20, 0.35)');
  g.addColorStop(1, 'rgba(235, 60, 10, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSmokeTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
  g.addColorStop(0, 'rgba(218, 212, 202, 0.85)');
  g.addColorStop(0.38, 'rgba(165, 158, 148, 0.52)');
  g.addColorStop(0.72, 'rgba(110, 105, 98, 0.16)');
  g.addColorStop(1, 'rgba(90, 86, 80, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWeatheredArmorMaterial(baseMat, armorMaps, posScale, { tintHex, roughness, metalness, mudMix }) {
  const mat = new THREE.MeshStandardMaterial({
    color: tintHex,
    roughness,
    metalness,
    envMapIntensity: 1.15,
  });

  mat.customProgramCacheKey = () => `tank-triplanar-armor-v1-${Math.round(posScale * 10)}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uArmorDiff = { value: armorMaps.diff };
    shader.uniforms.uArmorNor = { value: armorMaps.nor };
    shader.uniforms.uArmorRough = { value: armorMaps.rough };
    shader.uniforms.uPosScale = { value: posScale };
    shader.uniforms.uMudMix = { value: mudMix };

    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `varying vec3 vTriPos;
varying vec3 vTriNorm;
varying vec3 vViewAxisX;
varying vec3 vViewAxisY;
varying vec3 vViewAxisZ;
uniform float uPosScale;
void main() {`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vTriPos = transformed * uPosScale;
vTriNorm = normalize(objectNormal);
vViewAxisX = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
vViewAxisY = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
vViewAxisZ = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vTriPos;
varying vec3 vTriNorm;
varying vec3 vViewAxisX;
varying vec3 vViewAxisY;
varying vec3 vViewAxisZ;
uniform sampler2D uArmorDiff;
uniform sampler2D uArmorNor;
uniform sampler2D uArmorRough;
uniform float uMudMix;
vec2 armorRot(vec2 p, float c, float s) {
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}
void sampleCrossSteel(sampler2D tDiff, sampler2D tNor, sampler2D tRough, vec2 uv, out vec3 outDiff, out vec3 outNor, out float outRough) {
  vec2 uv1 = armorRot(uv * 0.42, 0.7986, 0.6018);
  vec2 uv2 = armorRot(uv * 0.78, 0.6018, -0.7986) + vec2(0.37, 0.71);
  outDiff = (texture2D(tDiff, uv1).rgb + texture2D(tDiff, uv2).rgb) * 0.5;
  outNor = normalize((texture2D(tNor, uv1).xyz * 2.0 - 1.0) + (texture2D(tNor, uv2).xyz * 2.0 - 1.0));
  outRough = (texture2D(tRough, uv1).g + texture2D(tRough, uv2).g) * 0.5;
}
void main() {
  vec3 triW = pow(abs(normalize(vTriNorm)), vec3(4.5));
  triW /= max(dot(triW, vec3(1.0)), 1e-4);
  vec2 uvX = vTriPos.zy;
  vec2 uvY = vTriPos.xz;
  vec2 uvZ = vTriPos.xy;

  vec3 aX, nX, aY, nY, aZ, nZ;
  float rX, rY, rZ;
  sampleCrossSteel(uArmorDiff, uArmorNor, uArmorRough, uvX, aX, nX, rX);
  sampleCrossSteel(uArmorDiff, uArmorNor, uArmorRough, uvY, aY, nY, rY);
  sampleCrossSteel(uArmorDiff, uArmorNor, uArmorRough, uvZ, aZ, nZ, rZ);

  vec3 armorCol = aX * triW.x + aY * triW.y + aZ * triW.z;
  float armorLum = dot(armorCol, vec3(0.299, 0.587, 0.114));
  float wear = clamp((armorLum - 0.50) * 1.9 + 0.50, 0.25, 1.35);
  float armorRgh = rX * triW.x + rY * triW.y + rZ * triW.z;

  vec3 objPerturb = vec3(0.0, nX.y, nX.x) * triW.x + vec3(nY.x, 0.0, nY.y) * triW.y + vec3(nZ.x, nZ.y, 0.0) * triW.z;
  float mudFactor = smoothstep(0.68, 0.02, vTriPos.y + 0.18) * uMudMix;
  float topHighlight = smoothstep(0.55, 0.96, normalize(vTriNorm).y);
  float lowerAo = smoothstep(-0.2, 1.15, vTriPos.y);
`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
diffuseColor.rgb *= mix(0.62, 1.20, wear) * mix(0.74, 1.05, lowerAo) * mix(1.0, 0.92, topHighlight * 0.42);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.085, 0.065), mudFactor * 0.78);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = clamp(mix(roughness * mix(0.55, 1.32, armorRgh), 0.95, mudFactor * 0.78), 0.22, 0.96);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
vec3 viewPerturb = vViewAxisX * objPerturb.x + vViewAxisY * objPerturb.y + vViewAxisZ * objPerturb.z;
normal = normalize(normal + viewPerturb * (0.42 * (1.0 - mudFactor * 0.6)));`
      );
  };

  return mat;
}

function buildRiggedTank({ tankGltf, armorMaps, contactTex, ringTex, position, yaw, turretYawOffset, scheme = 'allied' }) {
  const clone = SkeletonUtils.clone(tankGltf.scene);
  const root = new THREE.Group();
  root.scale.setScalar(0.38);
  root.add(clone);
  root.position.copy(position);
  root.rotation.y = yaw;
  root.updateMatrixWorld(true);

  const palette = scheme === 'allied'
    ? {
        Main: { tintHex: 0x314559, roughness: 0.44, metalness: 0.44, mudMix: 0.6 },
        Main_Dark: { tintHex: 0x1d232b, roughness: 0.48, metalness: 0.52, mudMix: 0.72 },
        Main_Light: { tintHex: 0x617385, roughness: 0.40, metalness: 0.40, mudMix: 0.42 },
        Main_Details: { tintHex: 0x343c44, roughness: 0.38, metalness: 0.62, mudMix: 0.45 },
        Wheels: { tintHex: 0x221e1a, roughness: 0.84, metalness: 0.18, mudMix: 0.94 },
      }
    : {
        Main: { tintHex: 0x414b37, roughness: 0.46, metalness: 0.40, mudMix: 0.65 },
        Main_Dark: { tintHex: 0x20241d, roughness: 0.50, metalness: 0.48, mudMix: 0.75 },
        Main_Light: { tintHex: 0x6f755e, roughness: 0.42, metalness: 0.36, mudMix: 0.45 },
        Main_Details: { tintHex: 0x343830, roughness: 0.38, metalness: 0.58, mudMix: 0.5 },
        Wheels: { tintHex: 0x231f1a, roughness: 0.85, metalness: 0.18, mudMix: 0.95 },
      };

  const wSizeVec = new THREE.Vector3();
  const gSizeVec = new THREE.Vector3();
  clone.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    obj.geometry.boundingBox.getSize(gSizeVec);
    new THREE.Box3().setFromObject(obj).getSize(wSizeVec);
    const posScale = wSizeVec.length() / Math.max(gSizeVec.length(), 1e-6);

    const replaceMat = (orig) => {
      const cfg = palette[orig?.name] || palette.Main;
      return makeWeatheredArmorMaterial(orig, armorMaps, posScale, cfg);
    };
    obj.material = Array.isArray(obj.material) ? obj.material.map(replaceMat) : replaceMat(obj.material);
  });

  // Reparent Tank_Gun cleanly under a pivot at Tank_Turret so turret rotation swings cannon too
  const turretObj = clone.getObjectByName('Tank_Turret');
  const gunObj = clone.getObjectByName('Tank_Gun');
  const turretPivot = new THREE.Group();
  let gunRestX = 0;

  if (turretObj) {
    const turretWorldPos = new THREE.Vector3();
    turretObj.getWorldPosition(turretWorldPos);
    clone.worldToLocal(turretWorldPos);
    turretPivot.position.copy(turretWorldPos);
    clone.add(turretPivot);
    turretPivot.attach(turretObj);
    if (gunObj) {
      turretPivot.attach(gunObj);
      gunRestX = gunObj.position.x;
    }
    turretPivot.rotation.y = turretYawOffset;
  }

  // Ground tank cleanly on terrain
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  root.position.y += terrainHeight(position.x, position.z) - bounds.min.y - 0.03;

  // Tilt slightly to terrain slope
  const surfNorm = terrainNormal(position.x, position.z);
  const upQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), surfNorm);
  const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  root.quaternion.copy(upQuat).multiply(yawQuat);

  // Decal contact shadow + crisp emerald/cyan RTS bracket ring
  const shadowDecal = new THREE.Mesh(
    new THREE.PlaneGeometry(8.2, 5.2),
    new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, opacity: 0.85 })
  );
  shadowDecal.rotation.x = -Math.PI / 2;
  shadowDecal.rotation.z = yaw;
  shadowDecal.position.set(position.x, terrainHeight(position.x, position.z) + 0.04, position.z);

  const ringDecal = new THREE.Mesh(
    new THREE.PlaneGeometry(6.8, 6.8),
    new THREE.MeshBasicMaterial({
      map: ringTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
    })
  );
  ringDecal.rotation.x = -Math.PI / 2;
  ringDecal.position.set(position.x, terrainHeight(position.x, position.z) + 0.05, position.z);

  // Muzzle anchor sits at -X tip of Tank_Gun under turretPivot (unit tank scale, immune to gun node 100x scale)
  const muzzleAnchor = new THREE.Object3D();
  if (gunObj) {
    gunObj.updateMatrixWorld(true);
    const gBox = new THREE.Box3().setFromObject(gunObj);
    const tipWorld = new THREE.Vector3(gBox.min.x, (gBox.min.y + gBox.max.y) * 0.5, (gBox.min.z + gBox.max.z) * 0.5);
    turretPivot.worldToLocal(tipWorld);
    muzzleAnchor.position.copy(tipWorld);
    turretPivot.add(muzzleAnchor);
  }

  return {
    root,
    shadowDecal,
    ringDecal,
    turretPivot,
    gunObj,
    gunRestX,
    baseTurretYaw: turretYawOffset,
    muzzleAnchor,
  };
}

function buildSoldierUnit({ soldierGltf, contactTex, ringTex, position, patrolEnd = null, clipName = 'Idle', yaw = 0 }) {
  const { object } = normalizeWholeGltf(soldierGltf.scene, {
    targetHeight: 1.82,
    groundMinY: true,
    facePlusZFromMinusZ: true,
  });

  object.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    if (obj.material && obj.material.isMeshStandardMaterial) {
      const m = obj.material.clone();
      m.roughness = Math.max(m.roughness, 0.58);
      m.envMapIntensity = 0.92;
      obj.material = m;
    }
  });

  object.position.copy(position);
  object.position.y = terrainHeight(position.x, position.z);
  object.rotation.y = yaw;

  const mixer = new THREE.AnimationMixer(object);
  const clip = THREE.AnimationClip.findByName(soldierGltf.animations, clipName) || soldierGltf.animations[0];
  if (clip) {
    const action = mixer.clipAction(clip);
    action.play();
  }

  const shadowDecal = new THREE.Mesh(
    new THREE.PlaneGeometry(1.45, 1.45),
    new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, opacity: 0.78 })
  );
  shadowDecal.rotation.x = -Math.PI / 2;
  shadowDecal.position.set(position.x, position.y + 0.03, position.z);

  const ringDecal = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshBasicMaterial({
      map: ringTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.36,
      blending: THREE.AdditiveBlending,
    })
  );
  ringDecal.rotation.x = -Math.PI / 2;
  ringDecal.position.set(position.x, position.y + 0.04, position.z);

  return {
    root: object,
    mixer,
    shadowDecal,
    ringDecal,
    startPos: position.clone(),
    endPos: patrolEnd ? patrolEnd.clone() : null,
    phase: Math.random() * 10,
  };
}

function buildWarFactoryCompound({
  factoryGltf,
  generatorGltf,
  crateGltf,
  fuelGltf,
  barrierGltf,
  sandbagsGltf,
  armorMaps,
  concreteTexSet,
  origin,
}) {
  const group = new THREE.Group();
  group.position.set(origin.x, terrainHeight(origin.x, origin.z), origin.z);
  group.rotation.y = 0.34;

  // Textured concrete apron base plinth with hazard yellow/black steel curbing
  const padMat = new THREE.MeshStandardMaterial({
    map: concreteTexSet.diff,
    normalMap: concreteTexSet.nor,
    roughnessMap: concreteTexSet.rough,
    roughness: 0.88,
    metalness: 0.05,
    color: 0xaab0b6,
  });
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(15.6, 0.45, 12.6), padMat);
  plinth.position.y = 0.14;
  plinth.receiveShadow = true;
  plinth.castShadow = true;
  group.add(plinth);

  // Dark steel armor backing core inside factory structure so window cutouts never show sky leaks
  const coreMat = new THREE.MeshStandardMaterial({
    map: armorMaps.diff,
    normalMap: armorMaps.nor,
    roughnessMap: armorMaps.rough,
    color: 0x39444f,
    roughness: 0.54,
    metalness: 0.45,
  });
  const coreHall = new THREE.Mesh(new THREE.BoxGeometry(10.8, 3.35, 8.2), coreMat);
  coreHall.position.set(-0.2, 0.36 + 1.675, -0.4);
  coreHall.castShadow = true;
  coreHall.receiveShadow = true;
  group.add(coreHall);

  // Cladding from Poly Haven modular_factory_facade.glb
  const factoryScene = factoryGltf.scene;
  const fBaseY = 0.36;

  // Front double garage bay facing +Z tank rollout ramp
  const garageWall = extractCenteredSubnode(factoryScene, 'wall_door_garage_double_01');
  garageWall.object.position.set(-0.2, fBaseY, 3.74);
  group.add(garageWall.object);

  const garageDoor = extractCenteredSubnode(factoryScene, 'door_garage_double_01');
  garageDoor.object.position.set(-0.2, fBaseY, 3.66);
  group.add(garageDoor.object);

  const garageWallSide = extractCenteredSubnode(factoryScene, 'wall_standard_standard_01');
  garageWallSide.object.position.set(4.5, fBaseY, 3.74);
  garageWallSide.object.scale.set(0.42, 1, 1);
  group.add(garageWallSide.object);

  // Corner concrete piers
  for (const [px, pz] of [[-5.65, 3.74], [5.25, 3.74], [-5.65, -4.54], [5.25, -4.54]]) {
    const pier = extractCenteredSubnode(factoryScene, 'wall_pier_corner_01');
    pier.object.position.set(px, fBaseY, pz);
    pier.object.scale.set(1.6, 1.08, 1.6);
    group.add(pier.object);
  }

  // East wall facing camera (+X): two tall factory window bays + standard wall bay
  const eastPlacements = [
    { wall: 'wall_window_tall_large_01', win: 'window_tall_large_01', z: -2.5 },
    { wall: 'wall_standard_standard_01', win: null, z: 0.5 },
    { wall: 'wall_window_tall_large_01', win: 'window_tall_large_01', z: 2.3 },
  ];
  for (const ep of eastPlacements) {
    const wPart = extractCenteredSubnode(factoryScene, ep.wall);
    wPart.object.rotation.y = Math.PI / 2;
    wPart.object.position.set(5.22, fBaseY, ep.z);
    group.add(wPart.object);
    if (ep.win) {
      const winPart = extractCenteredSubnode(factoryScene, ep.win, { groundMinY: true });
      const winRelY = winPart.rawBox.min.y - wPart.rawBox.min.y;
      winPart.object.rotation.y = Math.PI / 2;
      winPart.object.position.set(5.26, fBaseY + Math.max(0.45, winRelY), ep.z);
      group.add(winPart.object);
    }
  }

  // Industrial cornice crown + sloped steel blast roof
  const frontCrown = extractCenteredSubnode(factoryScene, 'cornice01_standard_standard_01');
  frontCrown.object.scale.set(3.6, 1.2, 1.2);
  frontCrown.object.position.set(-0.2, fBaseY + 3.05, 3.8);
  group.add(frontCrown.object);

  // Tiled weathered steel panel material for roof deck & command gantry
  const cloneTiledTex = (tex, rx, ry) => {
    const t = tex.clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    return t;
  };
  const roofMat = new THREE.MeshStandardMaterial({
    map: cloneTiledTex(armorMaps.diff, 5, 3.5),
    normalMap: cloneTiledTex(armorMaps.nor, 5, 3.5),
    roughnessMap: cloneTiledTex(armorMaps.rough, 5, 3.5),
    normalScale: new THREE.Vector2(1.2, 1.2),
    color: 0x454e57,
    roughness: 0.54,
    metalness: 0.52,
  });

  const roofDeck = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.42, 8.9), roofMat);
  roofDeck.position.set(-0.2, fBaseY + 3.55, -0.4);
  roofDeck.castShadow = true;
  roofDeck.receiveShadow = true;
  group.add(roofDeck);

  // Structural steel roof I-beam cross-ribs, parapet trim & twin armored exhaust stacks
  for (const rz of [-3.6, -1.4, 0.8, 3.0]) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(11.8, 0.24, 0.28), coreMat);
    rib.position.set(-0.2, fBaseY + 3.84, rz);
    rib.castShadow = true;
    rib.receiveShadow = true;
    group.add(rib);
  }
  for (const [ex, ez] of [[-4.6, -3.3], [-4.6, -2.0]]) {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 1.85, 12), coreMat);
    stack.position.set(ex, fBaseY + 4.55, ez);
    stack.castShadow = true;
    group.add(stack);
  }

  // Allied War Factory command gantry + glowing cyan core conduit + rotating radar
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.25, 3.6), roofMat);
  bridge.position.set(-2.4, fBaseY + 4.35, -1.6);
  bridge.castShadow = true;
  group.add(bridge);

  const radarPivot = new THREE.Group();
  radarPivot.position.set(-2.4, fBaseY + 5.1, -1.6);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.1, 10), coreMat);
  mast.position.y = 0.55;
  const dish = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.55, 0.24), coreMat);
  dish.position.y = 1.25;
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0x5eead4,
    emissive: 0x38bdf8,
    emissiveIntensity: 1.55,
    roughness: 0.2,
  });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), beaconMat);
  beacon.position.set(0, 1.65, 0);
  radarPivot.add(mast, dish, beacon);
  group.add(radarPivot);

  // Glowing reactor strip above garage bay (subtle bloom anchor)
  const bayStrip = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.16, 0.18), beaconMat);
  bayStrip.position.set(-0.2, fBaseY + 2.92, 3.92);
  group.add(bayStrip);

  // Roof industrial cooling units using portable_generator.glb + real ground props
  for (const gx of [1.8, 3.2]) {
    const roofGen = normalizeWholeGltf(generatorGltf.scene, { targetHeight: 1.05 });
    roofGen.object.position.set(gx, fBaseY + 3.76, -1.4);
    roofGen.object.rotation.y = Math.PI / 2;
    group.add(roofGen.object);
  }

  // Ground equipment around apron: generator, fuel cylinders, wooden supply crates, barriers, sandbags
  const yardGen = normalizeWholeGltf(generatorGltf.scene, { targetHeight: 0.92 });
  yardGen.object.position.set(6.2, fBaseY, 1.8);
  yardGen.object.rotation.y = -0.6;
  group.add(yardGen.object);

  for (const [fx, fz, fyaw] of [[6.2, -0.3, 0.2], [6.65, -0.75, 1.1], [6.15, -1.0, 2.3]]) {
    const fuel = normalizeWholeGltf(fuelGltf.scene, { targetHeight: 0.96 });
    fuel.object.position.set(fx, fBaseY, fz);
    fuel.object.rotation.y = fyaw;
    group.add(fuel.object);
  }

  for (const [cx, cyOff, cz, ry, sc] of [
    [6.1, 0, 3.6, 0.15, 0.95],
    [7.05, 0, 3.4, -0.25, 0.95],
    [6.55, 0.72, 3.55, 0.42, 0.88],
    [-6.6, 0, 2.4, 0.08, 1.0],
  ]) {
    const crate = normalizeWholeGltf(crateGltf.scene, { targetHeight: 0.78 * sc });
    crate.object.position.set(cx, fBaseY + cyOff, cz);
    crate.object.rotation.y = ry;
    group.add(crate.object);
  }

  // Perimeter Jersey barriers flanking base apron
  for (const [bx, bz, byaw] of [[-5.2, 5.9, 0.05], [-3.2, 5.9, -0.04], [4.9, 5.7, 0.18], [6.8, 5.1, -0.32]]) {
    const bar = normalizeWholeGltf(barrierGltf.scene, { targetHeight: 0.96 });
    bar.object.position.set(bx, 0.34, bz);
    bar.object.rotation.y = byaw;
    group.add(bar.object);
  }

  const bags = normalizeWholeGltf(sandbagsGltf.scene, { targetHeight: 0.56 });
  bags.object.position.set(4.1, 0.34, 6.2);
  bags.object.rotation.y = 0.2;
  group.add(bags.object);

  return { group, radarPivot };
}

function extractFoliageOnlyCanopy(rootScene, nodeName) {
  const { object } = extractCenteredSubnode(rootScene, nodeName, { groundMinY: true });
  object.traverse((child) => {
    if (!child.isMesh) return;
    const matName = Array.isArray(child.material)
      ? child.material.map((m) => m?.name || '').join(',')
      : (child.material?.name || '');
    if (!/(twig|leaf|shrub|foliage)/i.test(matName)) {
      child.visible = false;
    }
  });
  return object;
}

function createShrubCluster(shrubGltf, scaleBase = 2.1, seed = 0) {
  const cluster = new THREE.Group();
  const count = 3 + (Math.round(seed * 7) % 2);
  for (let i = 0; i < count; i++) {
    const s = extractCenteredSubnode(shrubGltf.scene, 'shrub_01_a', { groundMinY: true });
    const ang = seed * 3.1 + (i * Math.PI) / count;
    const sc = scaleBase * (0.85 + ((i * 37) % 10) * 0.03);
    s.object.scale.set(sc, sc * 1.35, sc * 1.5);
    s.object.rotation.set(((i % 2) - 0.5) * 0.28, ang, (((i + 1) % 2) - 0.5) * 0.24);
    s.object.position.set(Math.cos(ang) * 0.22, -0.02, Math.sin(ang) * 0.22);
    s.object.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = true;
      }
    });
    cluster.add(s.object);
  }
  return cluster;
}

function scatterNatureAndFortifications({ treeGltf, shrubGltf, boulderGltf, barrierGltf, sandbagsGltf, crateGltf, fuelGltf }) {
  const group = new THREE.Group();
  const treeVariants = ['fir_tree_01_a_LOD0', 'fir_tree_01_b_LOD0'];

  const isClearOfPlayLane = (x, z) => {
    if (terrainHeight(x, z) < WATER_LEVEL + 0.6) return false;
    if (roadDistance(x, z) < 5.4 && z < 24 && z > -10) return false;
    if (Math.hypot(x + 12.5, z + 8.5) < 12.5) return false;
    if (Math.hypot(x - SHOWCASE_PAD.x, z - SHOWCASE_PAD.z) < 6.4) return false;
    if (Math.hypot(x - 3.6, z - 6.0) < 5.4) return false;
    if (Math.hypot(x + 2.2, z - 3.6) < 4.8) return false;
    return true;
  };

  // Curated hero ridge + flanking dense pine forest clusters (skip below waterline)
  const treeCoords = [
    [-25, -24, 1.05], [-19, -28, 0.92], [-12, -26, 1.12], [-4, -29, 0.98],
    [4, -27, 1.08], [12, -24, 0.94], [20, -21, 1.02], [27, -14, 0.90],
    [25, -4, 0.96], [28, 6, 1.04], [24, 17, 0.85], [-27, -11, 0.96],
    [-29, 0, 1.06], [-23, 6, 0.92], [14, -15, 0.86], [-8, -21, 0.94],
    [32, -25, 1.15], [-33, -21, 1.1], [9, -34, 1.18], [-17, -34, 1.06],
    [-1, -21, 0.88], [18, -9, 0.92], [-22, -16, 0.96],
  ];

  treeCoords.forEach(([x, z, scaleMul], idx) => {
    const h = terrainHeight(x, z);
    if (h < WATER_LEVEL + 0.6) return;

    const vName = treeVariants[idx % treeVariants.length];
    const treeRoot = new THREE.Group();
    const { object } = extractCenteredSubnode(treeGltf.scene, vName, { groundMinY: true });
    treeRoot.add(object);

    // Layer one fuller conifer bough skirt lower onto the trunk
    const midBoughs = extractFoliageOnlyCanopy(treeGltf.scene, 'fir_tree_01_a_LOD0');
    midBoughs.position.y = -3.4;
    midBoughs.scale.set(1.12, 0.94, 1.12);
    midBoughs.rotation.y = 1.9;
    treeRoot.add(midBoughs);

    treeRoot.position.set(x, h - 0.16, z);
    treeRoot.scale.setScalar(0.84 * scaleMul);
    treeRoot.rotation.y = hash2D(x, z) * Math.PI * 2;
    group.add(treeRoot);

    // Cluster 3D ground bushes right around pine bases
    for (let s = 0; s < 2; s++) {
      const ang = idx * 2.1 + s * 2.5;
      const sx = x + Math.cos(ang) * (1.8 + s * 1.1);
      const sz = z + Math.sin(ang) * (1.8 + s * 1.1);
      if (!isClearOfPlayLane(sx, sz)) continue;
      const bush = createShrubCluster(shrubGltf, 1.9 + hash2D(sx, sz) * 0.6, sx + sz);
      bush.position.set(sx, terrainHeight(sx, sz) - 0.04, sz);
      group.add(bush);
    }
  });

  // Craggy boulders along shoreline bay, road shoulder & forest edges
  const boulderCoords = [
    [-11, 16.5, 1.4], [-8.8, 17.8, 0.95], [14, 23, 1.25], [16.4, 21.8, 0.85],
    [13.5, -6, 1.5], [15.2, -5.2, 0.9], [-20.5, 4.5, 1.65], [-19.4, 6.4, 1.05],
    [-4, -22, 1.45], [19, 10, 1.2], [20.5, 11.2, 0.8], [-14.5, 12.2, 1.35],
    [5.2, -14, 1.15], [23, -12, 1.7], [-6.2, 14.8, 1.2],
  ];
  boulderCoords.forEach(([x, z, sc], i) => {
    const b = extractCenteredSubnode(boulderGltf.scene, 'boulder_01', { groundMinY: true });
    b.object.position.set(x, terrainHeight(x, z) - 0.22, z);
    b.object.scale.setScalar(sc * 1.25);
    b.object.rotation.set((i % 3) * 0.08, i * 1.37, ((i + 1) % 3) * 0.06);
    group.add(b.object);

    if (terrainHeight(x + 1.0, z + 0.6) > WATER_LEVEL + 0.4) {
      const bush = createShrubCluster(shrubGltf, 2.0, i * 1.3);
      bush.position.set(x + 1.0, terrainHeight(x + 1.0, z + 0.6) - 0.04, z + 0.6);
      group.add(bush);
    }
  });

  // Forward defensive checkpoint cleanly clear (>= 2.2m) from tank tracks & patrol paths
  const checkpointProps = [
    { gltf: barrierGltf, h: 0.96, x: 7.9, z: 3.9, yaw: -0.45 },
    { gltf: barrierGltf, h: 0.96, x: 9.7, z: 5.2, yaw: -0.35 },
    { gltf: barrierGltf, h: 0.96, x: -5.6, z: 7.4, yaw: 0.72 },
    { gltf: sandbagsGltf, h: 0.58, x: 7.2, z: 2.9, yaw: -0.42 },
    { gltf: sandbagsGltf, h: 0.58, x: 5.9, z: 2.2, yaw: -0.42 },
    { gltf: sandbagsGltf, h: 0.58, x: 9.2, z: 9.6, yaw: -0.82 },
    { gltf: crateGltf, h: 0.82, x: 10.1, z: 8.6, yaw: 0.35 },
    { gltf: crateGltf, h: 0.82, x: 10.8, z: 8.2, yaw: -0.2 },
    { gltf: fuelGltf, h: 0.98, x: 10.4, z: 9.8, yaw: 0.9 },
  ];
  for (const p of checkpointProps) {
    const inst = normalizeWholeGltf(p.gltf.scene, { targetHeight: p.h });
    inst.object.position.set(p.x, terrainHeight(p.x, p.z) - 0.03, p.z);
    inst.object.rotation.y = p.yaw;
    group.add(inst.object);
  }

  // Concrete framing around the foreground drop-inspection showcase pad
  const padCornerAngles = [0.65, 2.5, 4.1, 5.5];
  for (const ang of padCornerAngles) {
    const bx = SHOWCASE_PAD.x + Math.cos(ang) * 3.1;
    const bz = SHOWCASE_PAD.z + Math.sin(ang) * 3.1;
    const bar = normalizeWholeGltf(barrierGltf.scene, { targetHeight: 0.78 });
    bar.object.position.set(bx, terrainHeight(bx, bz) - 0.03, bz);
    bar.object.rotation.y = -ang + Math.PI / 2;
    group.add(bar.object);
  }

  return group;
}

function updateStatsPill(stats) {
  if (!dom.assetsPill) return;
  const rawMb = (stats.compressedPolyHavenRawKb / 1024).toFixed(1);
  const optMb = (stats.compressedPolyHavenOptKb / 1024).toFixed(1);
  const ratio = Math.round(stats.compressedPolyHavenRawKb / Math.max(stats.compressedPolyHavenOptKb, 1));
  const diskMb = (stats.showcaseTotalDiskKb / 1024).toFixed(1);
  dom.assetsPill.textContent = `实景资产: Poly Haven 原 ${rawMb} MB -> ${optMb} MB (${ratio}x) · 全场景 ${diskMb} MB`;
}

async function init() {
  if (!dom.canvas) return;

  const renderer = new THREE.WebGLRenderer({
    canvas: dom.canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LIGHTING_PRESETS[0].exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(LIGHTING_PRESETS[0].fogColor, LIGHTING_PRESETS[0].fogDensity);
  scene.background = new THREE.Color(LIGHTING_PRESETS[0].fogColor);

  const camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.2, 260);
  camera.position.copy(CAMERA_PRESETS.cinematic.pos);

  const controls = new OrbitControls(camera, dom.canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.target.copy(CAMERA_PRESETS.cinematic.target);
  controls.minDistance = 4.5;
  controls.maxDistance = 72;
  controls.maxPolarAngle = Math.PI * 0.47;

  // Lights: key shadow sun, sky-ground hemisphere bounce, cold rim highlight
  const sunLight = new THREE.DirectionalLight(LIGHTING_PRESETS[0].sunColor, LIGHTING_PRESETS[0].sunIntensity);
  sunLight.position.copy(LIGHTING_PRESETS[0].sunPos);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 2;
  sunLight.shadow.camera.far = 140;
  sunLight.shadow.camera.left = -46;
  sunLight.shadow.camera.right = 46;
  sunLight.shadow.camera.top = 46;
  sunLight.shadow.camera.bottom = -46;
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.025;
  sunLight.shadow.radius = 2.0;
  scene.add(sunLight);

  const hemiLight = new THREE.HemisphereLight(
    LIGHTING_PRESETS[0].hemiSky,
    LIGHTING_PRESETS[0].hemiGround,
    LIGHTING_PRESETS[0].hemiIntensity
  );
  scene.add(hemiLight);

  const rimLight = new THREE.DirectionalLight(LIGHTING_PRESETS[0].rimColor, LIGHTING_PRESETS[0].rimIntensity);
  rimLight.position.set(-34, 18, -28);
  scene.add(rimLight);

  // Postprocessing pipeline: multisampled HalfFloat render target + subtle bloom on flashes/beacons
  renderer.info.autoReset = false;
  let sceneCalls = 0;
  let sceneTris = 0;

  const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  const statCapturePass = {
    enabled: true,
    needsSwap: false,
    renderToScreen: false,
    setSize() {},
    dispose() {},
    render() {
      sceneCalls = renderer.info.render.calls;
      sceneTris = renderer.info.render.triangles;
    },
  };
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.26,
    0.55,
    0.94
  );
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(statCapturePass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);

  // Fetch verified asset stats
  fetch('./assets/plan-a/stats.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => updateStatsPill(json?.totals || DEFAULT_STATS))
    .catch(() => updateStatsPill(DEFAULT_STATS));

  setLoadingProgress(0.08, '加载 1K Sky HDRI 环境光贴图...');
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const hdrLoader = new HDRLoader();
  const skyHdrTex = await hdrLoader.loadAsync('./assets/plan-a/sky.hdr');
  skyHdrTex.mapping = THREE.EquirectangularReflectionMapping;
  const envRT = pmrem.fromEquirectangular(skyHdrTex);
  pmrem.dispose();

  scene.environment = envRT.texture;
  scene.background = skyHdrTex;
  scene.backgroundBlurriness = 0.08;
  scene.backgroundIntensity = LIGHTING_PRESETS[0].bgIntensity;
  scene.environmentIntensity = LIGHTING_PRESETS[0].envIntensity;

  setLoadingProgress(0.24, '加载 5 套扫描 PBR 地形贴图 + 装甲金属纹理...');
  const texLoader = new THREE.TextureLoader();
  const loadTex = (url, srgb = false) =>
    texLoader.loadAsync(url).then((t) => {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return t;
    });

  const [terrainMesh, armorDiff, armorNor, armorRough, concDiff, concNor, concRough] = await Promise.all([
    createTerrainMesh(renderer.capabilities.getMaxAnisotropy()),
    loadTex('./assets/plan-a/armor_diff.jpg', true),
    loadTex('./assets/plan-a/armor_nor.jpg', false),
    loadTex('./assets/plan-a/armor_rough.jpg', false),
    loadTex('./assets/textures/terrain/concrete_diff.jpg', true),
    loadTex('./assets/textures/terrain/concrete_nor.jpg', false),
    loadTex('./assets/textures/terrain/concrete_rough.jpg', false),
  ]);
  concDiff.repeat.set(3, 3);
  concNor.repeat.set(3, 3);
  concRough.repeat.set(3, 3);
  scene.add(terrainMesh);

  const { water, waterMat, waterNormal } = createWaterMesh();
  scene.add(water);

  const armorMaps = { diff: armorDiff, nor: armorNor, rough: armorRough };
  const concreteTexSet = { diff: concDiff, nor: concNor, rough: concRough };

  setLoadingProgress(0.45, '加载 GLB 军事建筑、坦克、士兵与扫描植被...');
  const gltfLoader = new GLTFLoader();

  const assetNames = [
    'tank',
    'soldier',
    'factory',
    'tree',
    'shrub',
    'boulder',
    'barrier',
    'generator',
    'crate',
    'fuel',
    'sandbags',
  ];
  let loadedCount = 0;
  const loadedGltfs = {};
  await Promise.all(
    assetNames.map(async (name) => {
      loadedGltfs[name] = await gltfLoader.loadAsync(`./assets/plan-a/${name}.glb`);
      loadedCount += 1;
      setLoadingProgress(0.45 + (loadedCount / assetNames.length) * 0.45, `加载模型 (${loadedCount}/${assetNames.length}): ${name}.glb`);
    })
  );

  setLoadingProgress(0.92, '优化植被针叶 Alpha 遮罩与装配战区场景...');
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  enhanceFoliageTextures(loadedGltfs.tree.scene, { alphaPow: 0.36, tint: [0.68, 0.96, 0.56], anisotropy: maxAniso });
  enhanceFoliageTextures(loadedGltfs.shrub.scene, { alphaPow: 0.40, tint: [0.74, 0.98, 0.62], anisotropy: maxAniso });

  const contactTex = createContactShadowTexture();
  const ringTex = createRtsRingTexture('#38bdf8');
  const flashTex = createFlashTexture();
  const smokeTex = createSmokeTexture();

  // Foreground drop inspection pad indicator ring
  const padRing = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 5.6),
    new THREE.MeshBasicMaterial({
      map: ringTex,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  padRing.rotation.x = -Math.PI / 2;
  padRing.position.set(SHOWCASE_PAD.x, terrainHeight(SHOWCASE_PAD.x, SHOWCASE_PAD.z) + 0.05, SHOWCASE_PAD.z);
  scene.add(padRing);

  const factoryBuilt = buildWarFactoryCompound({
    factoryGltf: loadedGltfs.factory,
    generatorGltf: loadedGltfs.generator,
    crateGltf: loadedGltfs.crate,
    fuelGltf: loadedGltfFallback(loadedGltfs.fuel),
    barrierGltf: loadedGltfs.barrier,
    sandbagsGltf: loadedGltfs.sandbags,
    armorMaps,
    concreteTexSet,
    origin: new THREE.Vector3(-12.5, 0, -8.5),
  });
  scene.add(factoryBuilt.group);

  const natureGroup = scatterNatureAndFortifications({
    treeGltf: loadedGltfs.tree,
    shrubGltf: loadedGltfs.shrub,
    boulderGltf: loadedGltfs.boulder,
    barrierGltf: loadedGltfs.barrier,
    sandbagsGltf: loadedGltfs.sandbags,
    crateGltf: loadedGltfs.crate,
    fuelGltf: loadedGltfs.fuel,
  });
  scene.add(natureGroup);

  // 3x Weathered Heavy Tanks (gun muzzle faces -X locally, so yaw flips -X to face Southeast/Northeast!)
  const tanks = [
    buildRiggedTank({
      tankGltf: loadedGltfs.tank,
      armorMaps,
      contactTex,
      ringTex,
      position: new THREE.Vector3(-2.2, 0, 3.6),
      yaw: 2.35,
      turretYawOffset: -0.22,
      scheme: 'allied',
    }),
    buildRiggedTank({
      tankGltf: loadedGltfs.tank,
      armorMaps,
      contactTex,
      ringTex,
      position: new THREE.Vector3(2.8, 0, 5.6),
      yaw: 2.15,
      turretYawOffset: -0.35,
      scheme: 'allied',
    }),
    buildRiggedTank({
      tankGltf: loadedGltfs.tank,
      armorMaps,
      contactTex,
      ringTex,
      position: new THREE.Vector3(-12.2, 0, -0.4),
      yaw: 2.02,
      turretYawOffset: 0.08,
      scheme: 'olive',
    }),
  ];
  for (const t of tanks) {
    scene.add(t.root, t.shadowDecal, t.ringDecal);
  }

  // 4x Soldiers: 2 patrolling road guards + 2 stationary sandbag/barrier sentries (clear >= 2.2m of tanks)
  const soldiers = [
    buildSoldierUnit({
      soldierGltf: loadedGltfs.soldier,
      contactTex,
      ringTex,
      position: new THREE.Vector3(-6.2, 0, 1.8),
      patrolEnd: new THREE.Vector3(-3.8, 0, 10.6),
      clipName: 'Walk',
    }),
    buildSoldierUnit({
      soldierGltf: loadedGltfs.soldier,
      contactTex,
      ringTex,
      position: new THREE.Vector3(-8.4, 0, -2.0),
      patrolEnd: new THREE.Vector3(-2.6, 0, -4.8),
      clipName: 'Walk',
    }),
    buildSoldierUnit({
      soldierGltf: loadedGltfs.soldier,
      contactTex,
      ringTex,
      position: new THREE.Vector3(6.6, 0, 3.2),
      clipName: 'Idle',
      yaw: 0.65,
    }),
    buildSoldierUnit({
      soldierGltf: loadedGltfs.soldier,
      contactTex,
      ringTex,
      position: new THREE.Vector3(8.4, 0, 8.8),
      clipName: 'Idle',
      yaw: -0.55,
    }),
  ];
  for (const s of soldiers) {
    scene.add(s.root, s.shadowDecal, s.ringDecal);
  }

  // Hero tank muzzle flash + shell tracer + smoke burst pool (world-space meters)
  const firingTank = tanks[1];
  const muzzleFlashSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: flashTex, color: 0xffd28a, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 })
  );
  muzzleFlashSprite.scale.set(2.4, 2.4, 1);
  muzzleFlashSprite.visible = false;
  scene.add(muzzleFlashSprite);

  const muzzlePointLight = new THREE.PointLight(0xff9b3d, 0, 18, 2);
  scene.add(muzzlePointLight);

  const tracerMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe4a0 })
  );
  tracerMesh.visible = false;
  scene.add(tracerMesh);

  const smokePuffs = Array.from({ length: 14 }, () => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: smokeTex,
        color: 0xbcb5aa,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      })
    );
    sprite.visible = false;
    scene.add(sprite);
    return { mesh: sprite, life: 0, maxLife: 1, vel: new THREE.Vector3(), spin: (Math.random() - 0.5) * 1.4 };
  });

  // Runtime state & interactive controls
  let presetIdx = 0;
  let hdriEnabled = true;
  let postEnabled = true;
  let actionEnabled = true;
  let camAnim = null;
  let droppedObject = null;

  function loadedGltfFallback(obj) {
    return obj;
  }

  function applyLightingPreset(idx) {
    const p = LIGHTING_PRESETS[idx % LIGHTING_PRESETS.length];
    sunLight.color.setHex(p.sunColor);
    sunLight.intensity = hdriEnabled ? p.sunIntensity : p.sunIntensity * 1.15;
    sunLight.position.copy(p.sunPos);
    hemiLight.color.setHex(p.hemiSky);
    hemiLight.groundColor.setHex(p.hemiGround);
    hemiLight.intensity = hdriEnabled ? p.hemiIntensity : 0.85;
    rimLight.color.setHex(p.rimColor);
    rimLight.intensity = hdriEnabled ? p.rimIntensity : 0.15;
    renderer.toneMappingExposure = p.exposure;
    scene.fog.color.setHex(p.fogColor);
    scene.fog.density = p.fogDensity;
    waterMat.color.setHex(p.waterColor);
    scene.environment = hdriEnabled ? envRT.texture : null;
    scene.environmentIntensity = hdriEnabled ? p.envIntensity : 0;
    scene.background = hdriEnabled ? skyHdrTex : new THREE.Color(p.fogColor);
    scene.backgroundIntensity = hdriEnabled ? p.bgIntensity : 1.0;
    if (dom.btnTime) dom.btnTime.textContent = p.label;
  }

  function transitionCameraTo(presetName) {
    const p = CAMERA_PRESETS[presetName];
    if (!p) return;
    camAnim = {
      startPos: camera.position.clone(),
      startTarget: controls.target.clone(),
      endPos: p.pos.clone(),
      endTarget: p.target.clone(),
      t: 0,
    };
    dom.presetButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.cam === presetName);
    });
  }

  dom.presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => transitionCameraTo(btn.dataset.cam));
  });

  dom.btnTime?.addEventListener('click', () => {
    presetIdx = (presetIdx + 1) % LIGHTING_PRESETS.length;
    applyLightingPreset(presetIdx);
  });

  dom.btnHdri?.addEventListener('click', () => {
    hdriEnabled = !hdriEnabled;
    dom.btnHdri.textContent = hdriEnabled ? 'Sky HDRI + IBL' : '无 HDRI (对照塑性感)';
    dom.btnHdri.classList.toggle('active', hdriEnabled);
    applyLightingPreset(presetIdx);
  });

  dom.btnPost?.addEventListener('click', () => {
    postEnabled = !postEnabled;
    dom.btnPost.textContent = postEnabled ? 'ACES + Bloom 后处理' : '关闭 Bloom';
    dom.btnPost.classList.toggle('active', postEnabled);
  });

  dom.btnAction?.addEventListener('click', () => {
    actionEnabled = !actionEnabled;
    dom.btnAction.textContent = actionEnabled ? '战备演示: 开启' : '战备演示: 暂停';
    dom.btnAction.classList.toggle('active', actionEnabled);
  });

  // Live .glb drag-and-drop inspector
  function disposeObjectTree(rootObj) {
    rootObj.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const m of mats) m.dispose();
      }
    });
  }

  async function inspectDroppedGlb(file) {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.glb') && !lower.endsWith('.gltf')) {
      if (dom.dropStatus) dom.dropStatus.textContent = '仅支持 .glb / .gltf 模型文件';
      return;
    }
    if (file.size > 64 * 1024 * 1024) {
      if (dom.dropStatus) dom.dropStatus.textContent = '文件过大（限制 <= 64 MB），建议先运行 optimize-glb';
      return;
    }

    if (dom.dropStatus) dom.dropStatus.textContent = `解析 ${file.name} (${(file.size / 1024).toFixed(0)} KB)...`;
    try {
      const buf = await file.arrayBuffer();
      const gltf = await new Promise((res, rej) => gltfLoader.parse(buf, '', res, rej));
      if (droppedObject) {
        scene.remove(droppedObject);
        disposeObjectTree(droppedObject);
        droppedObject = null;
      }

      const wrapper = new THREE.Group();
      wrapper.add(gltf.scene);
      wrapper.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);
      gltf.scene.position.set(-center.x, -box.min.y, -center.z);

      const maxDim = Math.max(size.x, size.y, size.z, 0.01);
      const scale = 2.8 / maxDim;
      wrapper.scale.setScalar(scale);
      normalizeModelMaterials(wrapper);

      wrapper.position.set(SHOWCASE_PAD.x, terrainHeight(SHOWCASE_PAD.x, SHOWCASE_PAD.z) + 0.04, SHOWCASE_PAD.z);
      scene.add(wrapper);
      droppedObject = wrapper;

      let triCount = 0;
      wrapper.traverse((o) => {
        if (o.isMesh && o.geometry) {
          triCount += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
        }
      });

      if (dom.dropStatus) {
        dom.dropStatus.textContent = `已加载 ${file.name} (${(file.size / 1024).toFixed(0)} KB · ${Math.round(triCount).toLocaleString()} tris) 至前场检验区`;
      }

      camAnim = {
        startPos: camera.position.clone(),
        startTarget: controls.target.clone(),
        endPos: new THREE.Vector3(SHOWCASE_PAD.x + 5.6, terrainHeight(SHOWCASE_PAD.x, SHOWCASE_PAD.z) + 3.2, SHOWCASE_PAD.z + 6.4),
        endTarget: new THREE.Vector3(SHOWCASE_PAD.x, terrainHeight(SHOWCASE_PAD.x, SHOWCASE_PAD.z) + 1.15, SHOWCASE_PAD.z),
        t: 0,
      };
    } catch (err) {
      if (dom.dropStatus) dom.dropStatus.textContent = `解析失败: ${err?.message || err}`;
    }
  }

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) inspectDroppedGlb(file);
  });

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloomPass.resolution.set(w, h);
  });

  // Trigger a crisp shell burst quickly on first boot (~1.2s) and every 4.2s thereafter
  let fireTimer = 3.0;
  let fireCooldown = 0;
  let tracerTimer = -1;
  const tracerStart = new THREE.Vector3();
  const tracerDir = new THREE.Vector3();

  function spawnMuzzleBurst() {
    fireCooldown = 0.36;
    tracerTimer = 0.0;
    firingTank.muzzleAnchor.getWorldPosition(tracerStart);
    const muzzleQ = new THREE.Quaternion();
    firingTank.muzzleAnchor.getWorldQuaternion(muzzleQ);
    // Tank gun barrel points along local -X in Quaternius Tank
    tracerDir.set(-1, 0.035, 0).applyQuaternion(muzzleQ).normalize();

    muzzleFlashSprite.visible = true;
    muzzleFlashSprite.position.copy(tracerStart);
    muzzleFlashSprite.material.opacity = 1.0;
    muzzleFlashSprite.material.rotation = Math.random() * Math.PI * 2;
    muzzlePointLight.position.copy(tracerStart);
    muzzlePointLight.intensity = 18;

    for (let i = 0; i < smokePuffs.length; i++) {
      const p = smokePuffs[i];
      p.mesh.visible = true;
      p.mesh.position.copy(tracerStart).addScaledVector(tracerDir, i * 0.16);
      const sz = 0.65 + Math.random() * 0.6;
      p.mesh.scale.set(sz, sz, 1);
      p.mesh.material.opacity = 0.42;
      p.mesh.material.rotation = Math.random() * Math.PI * 2;
      p.life = 0;
      p.maxLife = 0.9 + Math.random() * 0.65;
      p.vel.set(
        (Math.random() - 0.5) * 1.4 + tracerDir.x * 2.1,
        0.75 + Math.random() * 0.9,
        (Math.random() - 0.5) * 1.4 + tracerDir.z * 2.1
      );
    }
  }

  applyLightingPreset(0);
  dom.presetButtons.forEach((b) => b.classList.toggle('active', b.dataset.cam === 'cinematic'));
  if (dom.dropStatus) {
    dom.dropStatus.textContent = '场景就绪 · 将任意本地 .glb / .gltf 模型直接拖入前场检验区实时检视';
  }
  setLoadingProgress(1.0, '就绪');
  hideLoadingOverlay();

  let prevTime = performance.now();
  let fpsAccum = 0;
  let fpsFrames = 0;
  let simTime = 0;

  function animate(now) {
    requestAnimationFrame(animate);
    const rawDt = Math.min(0.05, Math.max(0.001, (now - prevTime) / 1000));
    prevTime = now;

    // Smooth camera preset interpolation
    if (camAnim) {
      camAnim.t = Math.min(1, camAnim.t + rawDt * 2.2);
      const e = camAnim.t < 0.5 ? 4 * camAnim.t * camAnim.t * camAnim.t : 1 - Math.pow(-2 * camAnim.t + 2, 3) / 2;
      camera.position.lerpVectors(camAnim.startPos, camAnim.endPos, e);
      controls.target.lerpVectors(camAnim.startTarget, camAnim.endTarget, e);
      if (camAnim.t >= 1) camAnim = null;
    }

    if (actionEnabled) {
      simTime += rawDt;

      // Water scroll ripples
      waterNormal.offset.x = (simTime * 0.018) % 1;
      waterNormal.offset.y = (simTime * 0.011) % 1;

      // War Factory radar sweep
      factoryBuilt.radarPivot.rotation.y += rawDt * 1.05;

      // Turret scan & gun recoil
      tanks[0].turretPivot.rotation.y = tanks[0].baseTurretYaw + Math.sin(simTime * 0.55) * 0.28;
      tanks[1].turretPivot.rotation.y = tanks[1].baseTurretYaw + Math.sin(simTime * 0.42 + 1.1) * 0.22;
      tanks[2].turretPivot.rotation.y = tanks[2].baseTurretYaw + Math.sin(simTime * 0.35 + 2.4) * 0.14;

      fireTimer += rawDt;
      if (fireTimer >= 4.2) {
        fireTimer = 0;
        spawnMuzzleBurst();
      }

      if (fireCooldown > 0) {
        fireCooldown = Math.max(0, fireCooldown - rawDt);
        const k = fireCooldown / 0.36;
        muzzleFlashSprite.visible = k > 0.02;
        muzzleFlashSprite.material.opacity = k * k;
        muzzlePointLight.intensity = 18 * k * k;
        if (firingTank.gunObj) {
          firingTank.gunObj.position.x = firingTank.gunRestX + Math.sin(k * Math.PI) * 0.65;
        }
      } else {
        muzzleFlashSprite.visible = false;
        muzzlePointLight.intensity = 0;
        if (firingTank.gunObj) {
          firingTank.gunObj.position.x = firingTank.gunRestX;
        }
      }

      if (tracerTimer >= 0) {
        tracerTimer += rawDt;
        const speed = 54;
        tracerMesh.visible = true;
        tracerMesh.position
          .copy(tracerStart)
          .addScaledVector(tracerDir, tracerTimer * speed);
        tracerMesh.position.y -= 1.2 * tracerTimer * tracerTimer;
        if (tracerTimer > 0.65) {
          tracerTimer = -1;
          tracerMesh.visible = false;
        }
      }

      for (const p of smokePuffs) {
        if (!p.mesh.visible) continue;
        p.life += rawDt;
        const t = p.life / p.maxLife;
        if (t >= 1) {
          p.mesh.visible = false;
          continue;
        }
        p.mesh.position.addScaledVector(p.vel, rawDt);
        p.vel.multiplyScalar(0.95);
        p.mesh.scale.x += rawDt * 1.6;
        p.mesh.scale.y += rawDt * 1.6;
        p.mesh.material.rotation += p.spin * rawDt;
        p.mesh.material.opacity = 0.40 * (1 - t) * (1 - t);
      }

      // Infantry patrol & animation mixers
      for (const s of soldiers) {
        s.mixer.update(rawDt);
        if (s.endPos) {
          const cycle = ((simTime * 0.14 + s.phase) % 2 + 2) % 2;
          const forward = cycle < 1;
          const u = forward ? cycle : 2 - cycle;
          const smoothU = u * u * (3 - 2 * u);
          s.root.position.lerpVectors(s.startPos, s.endPos, smoothU);
          s.root.position.y = terrainHeight(s.root.position.x, s.root.position.z);

          const aimTarget = forward ? s.endPos : s.startPos;
          const dx = aimTarget.x - s.root.position.x;
          const dz = aimTarget.z - s.root.position.z;
          if (dx * dx + dz * dz > 1e-4) {
            s.root.rotation.y = Math.atan2(dx, dz);
          }

          s.shadowDecal.position.set(s.root.position.x, s.root.position.y + 0.03, s.root.position.z);
          s.ringDecal.position.set(s.root.position.x, s.root.position.y + 0.04, s.root.position.z);
        }
      }

      if (droppedObject) {
        droppedObject.rotation.y += rawDt * 0.35;
      }
    }

    controls.update();

    renderer.info.reset();
    if (postEnabled) {
      composer.render();
    } else {
      renderer.render(scene, camera);
      sceneCalls = renderer.info.render.calls;
      sceneTris = renderer.info.render.triangles;
    }

    fpsAccum += rawDt;
    fpsFrames += 1;
    if (fpsAccum >= 0.4 && dom.perfPill) {
      const fps = Math.round(fpsFrames / fpsAccum);
      const trisK = Math.round(sceneTris / 1000);
      dom.perfPill.textContent = `${fps} FPS · ${sceneCalls} Draw Calls · ${trisK}k tris`;
      fpsAccum = 0;
      fpsFrames = 0;
    }
  }

  requestAnimationFrame(animate);
}

init().catch((err) => {
  console.error('[Plan A Showcase Error]', err);
  setLoadingProgress(1, `初始化错误: ${err?.message || err}`);
});
