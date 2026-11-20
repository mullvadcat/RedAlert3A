import {
  THREE,
  EffectComposer,
  RenderPass,
  GTAOPass,
  UnrealBloomPass,
  OutputPass,
  ShaderPass
} from './threeVendor.bundle.js';
import { CELL_SIZE, MAP_SIZE, WORLD_SIZE, getElevationAtWorld } from '../world/map.js';
import { ECONOMY_CONFIG, ENTITY_DEFS, FACTIONS, PLAYER_COLORS, QUALITY_PRESETS } from '../core/config.js';
import { FOG_DETECTED, FOG_EXPLORED, FOG_VISIBLE } from '../gameplay/fogCpu.js';
import { createDebrisSystem } from '../world/destruction.js';
import { createThreeWorld } from './threeWorld.js';
import { createThreeAssetLibrary } from './threeAssets.js';

const FilmicSplitGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSplitStrength: { value: 0.22 },
    uVignette: { value: 0.14 },
    uSaturation: { value: 1.06 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uSplitStrength;
    uniform float uVignette;
    uniform float uSaturation;
    varying vec2 vUv;
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      float luma = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = col.rgb * vec3(0.90, 0.95, 1.07);
      vec3 highTint = col.rgb * vec3(1.06, 1.01, 0.93);
      float wHigh = smoothstep(0.18, 0.82, luma);
      vec3 graded = mix(col.rgb, mix(shadowTint, highTint, wHigh), uSplitStrength);
      float gLuma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
      graded = mix(vec3(gLuma), graded, uSaturation);
      vec2 centered = (vUv - 0.5) * vec2(1.18, 1.0);
      float vig = smoothstep(1.18, 0.35, length(centered));
      graded *= mix(1.0 - uVignette, 1.0, vig);
      gl_FragColor = vec4(clamp(graded, 0.0, 1.0), col.a);
    }
  `
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function createSelectionRingTexture() {
  const s = 128;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(64, 64, 46, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createScorchDecalTexture() {
  const s = 128;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
  g.addColorStop(0.0, 'rgba(14,12,10,0.92)');
  g.addColorStop(0.45, 'rgba(24,20,16,0.68)');
  g.addColorStop(0.8, 'rgba(30,26,22,0.22)');
  g.addColorStop(1.0, 'rgba(30,26,22,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function resolveQualityPreset(presetId) {
  if (presetId === 'low' || presetId === 'medium' || presetId === 'balanced') {
    return { ...QUALITY_PRESETS.balanced };
  }
  if (presetId === 'ultra') {
    return { ...QUALITY_PRESETS.ultra };
  }
  return { ...QUALITY_PRESETS.high };
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function createThreeRenderPipeline(canvas, initialQuality = 'high') {
  let quality = resolveQualityPreset(initialQuality);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance'
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();

  // World & 49-Entity Assets
  const world = createThreeWorld(renderer, scene);
  const assets = createThreeAssetLibrary(renderer, world);

  // Camera Rig
  const DEFAULT_CAM = {
    targetX: 88,
    targetZ: 256,
    height: 44,
    yaw: 0.0,
    pitchDeg: 50,
    isoMode: false
  };

  const threeCamera = new THREE.PerspectiveCamera(40, 16 / 9, 0.8, 720);
  const raycaster = new THREE.Raycaster();
  const ndcVec = new THREE.Vector2();
  const hitVec = new THREE.Vector3();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.6);

  let cssW = 1280;
  let cssH = 720;
  let targetW = 1280;
  let targetH = 720;

  function syncCameraTransform() {
    const fov = camera.isoMode ? 28 : 40;
    if (threeCamera.fov !== fov) {
      threeCamera.fov = fov;
      threeCamera.updateProjectionMatrix();
    }
    const pitchRad = (camera.pitchDeg * Math.PI) / 180;
    const baseDist = camera.height / Math.max(0.25, Math.tan(pitchRad));
    const fovBoost = camera.isoMode ? 1.44 : 1.0;
    const horizDist = baseDist * fovBoost;
    const camY = 1.6 + camera.height * fovBoost;
    threeCamera.position.set(
      camera.targetX - Math.sin(camera.yaw) * horizDist,
      camY,
      camera.targetZ + Math.cos(camera.yaw) * horizDist
    );
    threeCamera.lookAt(camera.targetX, 1.6, camera.targetZ);
    threeCamera.updateMatrixWorld();
  }

  const camera = {
    targetX: DEFAULT_CAM.targetX,
    targetZ: DEFAULT_CAM.targetZ,
    height: DEFAULT_CAM.height,
    yaw: DEFAULT_CAM.yaw,
    pitchDeg: DEFAULT_CAM.pitchDeg,
    isoMode: DEFAULT_CAM.isoMode,

    toggleIsoMode() {
      this.isoMode = !this.isoMode;
      this.pitchDeg = this.isoMode ? 55 : 50;
      syncCameraTransform();
      return this.isoMode;
    },

    pan(screenDx, screenDz) {
      const cos = Math.cos(this.yaw);
      const sin = Math.sin(this.yaw);
      const scale = Math.max(0.65, this.height / 44);
      const wx = (screenDx * cos + screenDz * sin) * scale;
      const wz = (-screenDx * sin + screenDz * cos) * scale;
      this.targetX = Math.max(8, Math.min(WORLD_SIZE - 8, this.targetX + wx));
      this.targetZ = Math.max(8, Math.min(WORLD_SIZE - 8, this.targetZ + wz));
      syncCameraTransform();
    },

    panByScreenDrag(prevX, prevY, nextX, nextY) {
      const a = this.screenToWorld(prevX, prevY, 1.6);
      const b = this.screenToWorld(nextX, nextY, 1.6);
      if (a.hit && b.hit) {
        this.targetX = Math.max(8, Math.min(WORLD_SIZE - 8, this.targetX + (a.x - b.x)));
        this.targetZ = Math.max(8, Math.min(WORLD_SIZE - 8, this.targetZ + (a.z - b.z)));
        syncCameraTransform();
      }
    },

    zoom(deltaHeight) {
      this.height = Math.max(14, Math.min(96, this.height + deltaHeight));
      syncCameraTransform();
    },

    orbit(dYaw, dPitchRad = 0) {
      this.yaw += dYaw;
      this.pitchDeg = Math.max(26, Math.min(78, this.pitchDeg + (dPitchRad * 180) / Math.PI));
      syncCameraTransform();
    },

    resetOrientation() {
      this.yaw = DEFAULT_CAM.yaw;
      this.pitchDeg = this.isoMode ? 55 : DEFAULT_CAM.pitchDeg;
      syncCameraTransform();
    },

    jumpTo(x, z) {
      this.targetX = Math.max(8, Math.min(WORLD_SIZE - 8, x));
      this.targetZ = Math.max(8, Math.min(WORLD_SIZE - 8, z));
      syncCameraTransform();
    },

    screenToWorld(clientX, clientY, planeY = 1.6) {
      syncCameraTransform();
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, rect.width || cssW);
      const h = Math.max(1, rect.height || cssH);
      ndcVec.set(((clientX - rect.left) / w) * 2 - 1, -((clientY - rect.top) / h) * 2 + 1);
      raycaster.setFromCamera(ndcVec, threeCamera);
      groundPlane.constant = -planeY;
      const res = raycaster.ray.intersectPlane(groundPlane, hitVec);
      if (!res) {
        return { x: this.targetX, z: this.targetZ, hit: false };
      }
      return {
        x: Math.max(0, Math.min(WORLD_SIZE, res.x)),
        z: Math.max(0, Math.min(WORLD_SIZE, res.z)),
        hit: true
      };
    },

    worldToScreen(wx, wy, wz) {
      syncCameraTransform();
      hitVec.set(wx, wy, wz).project(threeCamera);
      return {
        x: (hitVec.x * 0.5 + 0.5) * cssW,
        y: (-hitVec.y * 0.5 + 0.5) * cssH,
        visible: hitVec.z >= -1 && hitVec.z <= 1
      };
    },

    getViewRectBounds() {
      const rect = canvas.getBoundingClientRect();
      const l = rect.left;
      const t = rect.top;
      const r = rect.left + (rect.width || cssW);
      const b = rect.top + (rect.height || cssH);
      const pts = [
        this.screenToWorld(l, t),
        this.screenToWorld(r, t),
        this.screenToWorld(r, b),
        this.screenToWorld(l, b)
      ];
      return pts.map((p) => {
        if (!p.hit) return { x: this.targetX, z: this.targetZ };
        const dx = Math.max(-96, Math.min(96, p.x - this.targetX));
        const dz = Math.max(-96, Math.min(96, p.z - this.targetZ));
        return { x: this.targetX + dx, z: this.targetZ + dz };
      });
    }
  };
  syncCameraTransform();

  // Post-Processing EffectComposer (RenderPass -> Half-Res GTAO -> Bloom -> Output -> Split-Grade)
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, threeCamera);
  composer.addPass(renderPass);

  let gtaoPass = null;
  let gtaoEnabledRuntime = true;
  try {
    gtaoPass = new GTAOPass(scene, threeCamera, 640, 360);
    gtaoPass.output = GTAOPass.OUTPUT.Default;
    gtaoPass.blendIntensity = 0.58;
    gtaoPass.updateGtaoMaterial?.({
      radius: 1.25,
      distanceExponent: 1.8,
      thickness: 2.0,
      scale: 1.0,
      samples: 8,
      distanceFallOff: 1.0
    });
    const origGtaoRender = gtaoPass.render.bind(gtaoPass);
    gtaoPass.render = (r, wb, rb, dt, ma) => {
      const hidden = [];
      scene.traverse((obj) => {
        if (obj.userData?.skipGtao && obj.visible) {
          obj.visible = false;
          hidden.push(obj);
        }
      });
      try {
        origGtaoRender(r, wb, rb, dt, ma);
      } finally {
        for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
      }
    };
    gtaoPass.enabled = Boolean(quality.gtaoEnabled);
    composer.addPass(gtaoPass);
  } catch {
    gtaoEnabledRuntime = false;
  }

  const bloomPass = new UnrealBloomPass(new THREE.Vector2(640, 360), 0.25, 0.42, 1.12);
  bloomPass.enabled = Boolean(quality.bloomEnabled);
  composer.addPass(bloomPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  const gradePass = new ShaderPass(FilmicSplitGradeShader);
  composer.addPass(gradePass);

  function ensureSize() {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(320, Math.round(rect.width || canvas.clientWidth || 1280));
    cssH = Math.max(240, Math.round(rect.height || canvas.clientHeight || 720));
    const dpr = Math.min(typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1, quality.pixelRatioCap);
    const w = Math.max(320, Math.round(cssW * dpr));
    const h = Math.max(240, Math.round(cssH * dpr));
    if (w !== targetW || h !== targetH) {
      targetW = w;
      targetH = h;
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false);
      threeCamera.aspect = w / Math.max(1, h);
      threeCamera.updateProjectionMatrix();
      composer.setSize(w, h);
      if (gtaoPass && gtaoEnabledRuntime) {
        gtaoPass.setSize(Math.max(160, Math.floor(w * 0.5)), Math.max(120, Math.floor(h * 0.5)));
      }
      bloomPass.setSize(Math.max(160, Math.floor(w * 0.5)), Math.max(120, Math.floor(h * 0.5)));
    }
  }

  // === Tactical Overlays & Pooled Instanced Systems ===
  const overlayGroup = new THREE.Group();
  overlayGroup.userData.skipGtao = true;
  scene.add(overlayGroup);

  // Selection Rings
  const MAX_SELECT = 256;
  const ringTex = createSelectionRingTexture();
  const ringGeo = new THREE.PlaneGeometry(1, 1);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    map: ringTex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2
  });
  const ringInst = new THREE.InstancedMesh(ringGeo, ringMat, MAX_SELECT);
  ringInst.userData.skipGtao = true;
  ringInst.frustumCulled = false;
  ringInst.renderOrder = 5;
  ringInst.setColorAt(0, new THREE.Color(0xffffff));
  ringInst.count = 0;
  overlayGroup.add(ringInst);

  // Health Bars + Veterancy Stars (background + colored fill)
  const MAX_HP_BARS = 512;
  const barGeo = new THREE.PlaneGeometry(1, 1);
  const hpBgMat = new THREE.MeshBasicMaterial({ color: 0x0b0f14, transparent: true, opacity: 0.82, depthTest: false });
  const hpFillMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
  const hpBgInst = new THREE.InstancedMesh(barGeo, hpBgMat, MAX_HP_BARS);
  const hpFillInst = new THREE.InstancedMesh(barGeo, hpFillMat, MAX_HP_BARS);
  hpBgInst.renderOrder = 20;
  hpFillInst.renderOrder = 21;
  hpBgInst.frustumCulled = false;
  hpFillInst.frustumCulled = false;
  hpBgInst.userData.skipGtao = true;
  hpFillInst.userData.skipGtao = true;
  hpFillInst.setColorAt(0, new THREE.Color(0xffffff));
  hpBgInst.count = 0;
  hpFillInst.count = 0;
  overlayGroup.add(hpBgInst, hpFillInst);

  // Placement Ghost & Conyard Build Radius Ring
  const ghostGeo = new THREE.PlaneGeometry(1, 1);
  ghostGeo.rotateX(-Math.PI / 2);
  const ghostMat = new THREE.MeshBasicMaterial({
    color: 0x3ae872,
    transparent: true,
    opacity: 0.42,
    depthWrite: false
  });
  const ghostMesh = new THREE.Mesh(ghostGeo, ghostMat);
  ghostMesh.visible = false;
  ghostMesh.renderOrder = 6;
  ghostMesh.userData.skipGtao = true;
  overlayGroup.add(ghostMesh);

  const buildRingGeo = new THREE.RingGeometry(0.985, 1.0, 64);
  buildRingGeo.rotateX(-Math.PI / 2);
  const buildRingMat = new THREE.MeshBasicMaterial({
    color: 0x4ca8ff,
    transparent: true,
    opacity: 0.48,
    depthWrite: false
  });
  const buildRingMesh = new THREE.Mesh(buildRingGeo, buildRingMat);
  buildRingMesh.visible = false;
  buildRingMesh.renderOrder = 6;
  buildRingMesh.userData.skipGtao = true;
  overlayGroup.add(buildRingMesh);

  // Scorch & Crater Decal Pool (max 256)
  const MAX_DECALS = 256;
  const decalTex = createScorchDecalTexture();
  const decalGeo = new THREE.PlaneGeometry(1, 1);
  decalGeo.rotateX(-Math.PI / 2);
  const decalMat = new THREE.MeshBasicMaterial({
    map: decalTex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1
  });
  const decalInst = new THREE.InstancedMesh(decalGeo, decalMat, MAX_DECALS);
  decalInst.userData.skipGtao = true;
  decalInst.frustumCulled = false;
  decalInst.renderOrder = 4;
  decalInst.count = 0;
  overlayGroup.add(decalInst);

  const decalEntries = [];
  let decalCursor = 0;
  const decalObj = new THREE.Object3D();
  const decalPool = {
    addDecal(x, y, z, radius = 1.1, rot = 0, _kind = 0, alpha = 0.7) {
      const sc = radius * 2.1;
      decalObj.position.set(x, y + 0.04, z);
      decalObj.rotation.set(0, rot, 0);
      decalObj.scale.set(sc, 1, sc);
      decalObj.updateMatrix();
      const idx = decalEntries.length < MAX_DECALS ? decalEntries.length : decalCursor;
      decalCursor = (decalCursor + 1) % MAX_DECALS;
      decalEntries[idx] = { m: decalObj.matrix.clone(), alpha };
      decalInst.setMatrixAt(idx, decalEntries[idx].m);
      decalInst.count = decalEntries.length;
      decalInst.instanceMatrix.needsUpdate = true;
    },
    clear() {
      decalEntries.length = 0;
      decalCursor = 0;
      decalInst.count = 0;
    },
    dispose() {
      decalGeo.dispose();
      decalMat.dispose();
      decalTex.dispose();
    }
  };

  // Pooled Instanced VFX Mesh (projectiles, beams, explosions, order rings, debris, smoke)
  const MAX_VFX = 2400;
  const vfxGeo = new THREE.BoxGeometry(1, 1, 1);
  const vfxMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const vfxInst = new THREE.InstancedMesh(vfxGeo, vfxMat, MAX_VFX);
  vfxInst.userData.skipGtao = true;
  vfxInst.frustumCulled = false;
  vfxInst.renderOrder = 10;
  vfxInst.setColorAt(0, new THREE.Color(0xffffff));
  vfxInst.count = 0;
  overlayGroup.add(vfxInst);

  // Live Entity Sync Store
  const entityGroup = new THREE.Group();
  scene.add(entityGroup);
  const entityMap = new Map();
  const debrisSys = createDebrisSystem(256);
  const transientFx = [];

  function pushTransientFx(fx) {
    if (transientFx.length < 320) transientFx.push(fx);
  }

  function clearTransientVisuals() {
    transientFx.length = 0;
    debrisSys.chunks.length = 0;
    decalPool.clear();
  }

  function restoreContext(_state, _playerId = 0, _noFog = false) {
    clearTransientVisuals();
    world.gpuFog.reset();
  }

  const dummy = new THREE.Object3D();
  const colTmp = new THREE.Color();
  const tmpVec = new THREE.Vector3();
  const camRightVec = new THREE.Vector3();
  const camUpVec = new THREE.Vector3();
  const mixerCandidates = [];
  let prevElapsed = 0;

  function syncEntities(state, alpha, uiState, elapsedSec, dtSec) {
    const ents = state.entities ?? [];
    const selectedIds = uiState?.selectedIds;
    const hoveredId = uiState?.hoveredEntityId;
    const humanFog = state.fogGrids?.[0];
    const noFog = Boolean(uiState?.noFog);
    const activeIds = new Set();

    mixerCandidates.length = 0;
    let ringCount = 0;
    let hpCount = 0;

    // Camera basis for billboarded HP bars
    camRightVec.setFromMatrixColumn(threeCamera.matrixWorld, 0).normalize();
    camUpVec.setFromMatrixColumn(threeCamera.matrixWorld, 1).normalize();
    const billboardQuat = threeCamera.quaternion;

    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!e.alive) continue;
      activeIds.add(e.id);

      let rec = entityMap.get(e.id);
      if (!rec || rec.typeId !== e.typeId || rec.teamId !== e.teamId || rec.assetRev !== assets.revision) {
        if (rec) {
          entityGroup.remove(rec.root);
          rec.parts?.mixer?.stopAllAction?.();
          for (const g of rec.root.userData?.ownedGeos ?? []) g.dispose();
        }
        const built = assets.buildInstance(e.typeId, e.teamId);
        rec = {
          id: e.id,
          typeId: e.typeId,
          teamId: e.teamId,
          assetRev: assets.revision,
          root: built.root,
          parts: built.parts || {},
          smoothYaw: e.yaw ?? 0
        };
        entityMap.set(e.id, rec);
        entityGroup.add(rec.root);
      }

      // Fog of War Visibility Rules
      let vis = true;
      if (!noFog && humanFog && e.playerId !== 0) {
        const gx = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor((e.x ?? 0) / CELL_SIZE)));
        const gz = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor((e.z ?? 0) / CELL_SIZE)));
        const f = humanFog[gz * MAP_SIZE + gx];
        if (e.isBuilding || e.isStructure) {
          vis = (f & (FOG_VISIBLE | FOG_EXPLORED)) !== 0;
        } else {
          const detected = (f & FOG_DETECTED) !== 0 || (e.detectedTicks ?? 0) > 0;
          vis = (f & FOG_VISIBLE) !== 0 && (!e.stealth || detected);
        }
      }
      rec.root.visible = vis;
      if (!vis) continue;

      const def = ENTITY_DEFS[e.typeId];
      const ix = e.prevX !== undefined ? e.prevX + (e.x - e.prevX) * alpha : e.x;
      const iz = e.prevZ !== undefined ? e.prevZ + (e.z - e.prevZ) * alpha : e.z;
      const baseY = e.y !== undefined
        ? (e.prevY !== undefined ? e.prevY + (e.y - e.prevY) * alpha : e.y)
        : (state.map ? getElevationAtWorld(state.map, ix, iz) : 1.6);

      // Height & wave offsets per domain
      let drawY = baseY;
      let pitchRollX = 0;
      let pitchRollZ = 0;
      if (e.category === 'naval') {
        const groundElev = state.map ? getElevationAtWorld(state.map, ix, iz) : baseY;
        const inWater = groundElev < 0.05;
        drawY = inWater ? (e.typeId === 'typhoon' && e.stealth ? -1.1 : 0.0) : Math.max(0.0, groundElev);
        if (inWater) {
          pitchRollX = Math.sin(elapsedSec * 1.9 + e.id * 0.7) * 0.025;
          pitchRollZ = Math.cos(elapsedSec * 1.5 + e.id * 1.1) * 0.028;
        }
      } else if (e.typeId === 'naval_yard') {
        const groundElev = state.map ? getElevationAtWorld(state.map, ix, iz) : baseY;
        drawY = Math.max(0.0, groundElev);
      } else if (e.category === 'air' || e.typeId === 'rocketeer') {
        drawY = Math.max(baseY + 4.8, (e.y ?? 7.5)) + Math.sin(elapsedSec * 2.4 + e.id) * 0.24;
        if (e.category === 'air') {
          pitchRollZ = Math.sin(elapsedSec * 1.2 + e.id) * 0.04;
        }
      }

      const targetYaw = e.yaw ?? 0;
      rec.smoothYaw = lerpAngle(rec.smoothYaw, targetYaw, Math.min(1, dtSec * 14 + 0.12));
      rec.root.position.set(ix, drawY, iz);
      rec.root.rotation.set(pitchRollX, rec.smoothYaw, pitchRollZ);

      // Cloak shimmer for shadow / stealth
      if (rec.parts.cloakMeshes?.length) {
        const cloaked = Boolean(e.stealth && (e.playerId === 0 || (e.detectedTicks ?? 0) === 0));
        for (const cm of rec.parts.cloakMeshes) {
          if (cm.material) {
            cm.material.transparent = cloaked;
            cm.material.opacity = cloaked ? 0.55 : 1.0;
          }
        }
      }

      // Role part animations
      const p = rec.parts;
      if (p.turret) {
        p.turret.rotation.y = (e.turretYaw ?? rec.smoothYaw) - rec.smoothYaw;
      }
      if (p.rotor) {
        const speed = e.typeId === 'nighthawk' ? 18.0 : (e.typeId === 'conyard' ? 0.45 : 1.6);
        p.rotor.rotation.y += dtSec * speed;
      }
      if (p.rotorL && p.rotorR) {
        p.rotorL.rotation.z += dtSec * 14.0;
        p.rotorR.rotation.z -= dtSec * 14.0;
      }
      if (p.pump) {
        p.pump.rotation.x = Math.sin(elapsedSec * 2.6 + e.id) * 0.28;
      }
      if (p.sandbags) {
        p.sandbags.visible = Boolean(e.deployed);
      }
      if (p.oreFill) {
        const fill = Math.max(0.04, Math.min(1, (e.cargo ?? 0) / ECONOMY_CONFIG.maxHarvesterCargoCells));
        p.oreFill.scale.y = fill * 0.42;
        p.oreFill.visible = (e.cargo ?? 0) > 0;
      }
      if (p.rollers && e.harvestingTicks > 0) {
        p.rollers.rotation.x += dtSec * 10.0;
      }
      if (p.v3Rocket) {
        p.v3Rocket.visible = (e.cooldown ?? 0) < (def?.weapon?.cooldownTicks ?? 210) * 0.65;
      }

      // Infantry locomotion (mixamo mixer budgeted to closest <= 48 units + fallback leg swing)
      const isMoving = Math.hypot((e.vx ?? 0), (e.vz ?? 0)) > 0.25 ||
        (e.prevX !== undefined && Math.hypot(e.x - e.prevX, e.z - e.prevZ) > 0.015);
      if (p.mixer) {
        const d2 = Math.hypot(ix - camera.targetX, iz - camera.targetZ);
        mixerCandidates.push({ rec, d2, isMoving });
      } else if (p.legL && p.legR) {
        const sw = isMoving ? Math.sin(elapsedSec * 11 + e.id) * 0.48 : 0;
        p.legL.rotation.x = sw;
        p.legR.rotation.x = -sw;
      }

      // Selection Ring
      const isSel = selectedIds?.has(e.id);
      const isHov = hoveredId === e.id;
      if (isSel && ringCount < MAX_SELECT) {
        const rSize = e.isBuilding
          ? Math.max(def?.footprintW ?? 2, def?.footprintH ?? 2) * 2.35
          : Math.max(1.8, (e.radius ?? 1.0) * 2.75);
        dummy.position.set(ix, e.category === 'naval' ? 0.14 : baseY + 0.10, iz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(rSize, 1, rSize);
        dummy.updateMatrix();
        ringInst.setMatrixAt(ringCount, dummy.matrix);
        colTmp.setHex(e.playerId === 0 ? 0x45f286 : (e.playerId >= 0 ? 0xf24a42 : 0x56c8ff));
        ringInst.setColorAt(ringCount, colTmp);
        ringCount++;
      }

      // Health Bar
      if ((isSel || isHov || (e.maxHp > 0 && e.hp < e.maxHp)) && hpCount < MAX_HP_BARS) {
        const barW = e.isBuilding ? Math.max(2.6, (def?.footprintW ?? 2) * 1.45) : Math.max(1.35, (e.radius ?? 0.9) * 1.8);
        const barY = drawY + (e.isBuilding ? 3.8 : (e.category === 'infantry' ? 2.25 : 2.15));
        const ratio = Math.max(0.0, Math.min(1.0, e.hp / Math.max(1, e.maxHp)));

        dummy.position.set(ix, barY, iz);
        dummy.quaternion.copy(billboardQuat);
        dummy.scale.set(barW + 0.12, 0.24, 1);
        dummy.updateMatrix();
        hpBgInst.setMatrixAt(hpCount, dummy.matrix);

        const fillW = Math.max(0.02, barW * ratio);
        const shift = (fillW - barW) * 0.5;
        dummy.position.set(ix + camRightVec.x * shift, barY + camRightVec.y * shift, iz + camRightVec.z * shift);
        tmpVec.subVectors(threeCamera.position, dummy.position).normalize();
        dummy.position.addScaledVector(tmpVec, 0.04);
        dummy.scale.set(fillW, 0.14, 1);
        dummy.updateMatrix();
        hpFillInst.setMatrixAt(hpCount, dummy.matrix);
        colTmp.setHex(ratio > 0.55 ? 0x3ee86e : (ratio > 0.25 ? 0xf2bf36 : 0xe83b3b));
        hpFillInst.setColorAt(hpCount, colTmp);
        hpCount++;
      }
    }

    // Remove dead entities cleanly
    for (const [id, rec] of entityMap) {
      if (!activeIds.has(id)) {
        entityGroup.remove(rec.root);
        rec.parts?.mixer?.stopAllAction?.();
        for (const g of rec.root.userData?.ownedGeos ?? []) g.dispose();
        entityMap.delete(id);
      }
    }

    // Update closest <= 48 skeletal animation mixers
    if (mixerCandidates.length > 0) {
      mixerCandidates.sort((a, b) => a.d2 - b.d2);
      const limit = Math.min(48, mixerCandidates.length);
      for (let i = 0; i < limit; i++) {
        const { rec, isMoving } = mixerCandidates[i];
        const acts = rec.parts.actions;
        if (acts) {
          const desired = isMoving ? 'walk' : 'idle';
          if (acts.current !== desired) {
            acts[acts.current]?.fadeOut(0.15);
            acts[desired]?.reset().fadeIn(0.15).play();
            acts.current = desired;
          }
        }
        rec.parts.mixer.update(Math.min(0.05, dtSec));
      }
    }

    ringInst.count = ringCount;
    ringInst.instanceMatrix.needsUpdate = true;
    if (ringInst.instanceColor) ringInst.instanceColor.needsUpdate = true;

    hpBgInst.count = hpCount;
    hpFillInst.count = hpCount;
    hpBgInst.instanceMatrix.needsUpdate = true;
    hpFillInst.instanceMatrix.needsUpdate = true;
    if (hpFillInst.instanceColor) hpFillInst.instanceColor.needsUpdate = true;

    // Placement Ghost + Conyard Build Radius Ring
    if (uiState?.placementTypeId && uiState?.hoverFootprint) {
      const fp = uiState.hoverFootprint;
      const cx = (fp.gx + fp.w * 0.5) * CELL_SIZE;
      const cz = (fp.gz + fp.h * 0.5) * CELL_SIZE;
      const gY = state.map ? getElevationAtWorld(state.map, cx, cz) : 1.6;
      ghostMesh.visible = true;
      ghostMesh.position.set(cx, Math.max(0.18, gY + 0.16), cz);
      ghostMesh.scale.set(fp.w * CELL_SIZE, 1, fp.h * CELL_SIZE);
      ghostMat.color.setHex(uiState.placementValid ? 0x35eb74 : 0xf23838);

      const conyard = ents.find((e) => e.alive && e.playerId === 0 && e.typeId === 'conyard');
      if (conyard) {
        const rad = ECONOMY_CONFIG.buildRadiusConyardCells * CELL_SIZE;
        buildRingMesh.visible = true;
        buildRingMesh.position.set(conyard.x, (conyard.y ?? 1.6) + 0.16, conyard.z);
        buildRingMesh.scale.set(rad, 1, rad);
      } else {
        buildRingMesh.visible = false;
      }
    } else {
      ghostMesh.visible = false;
      buildRingMesh.visible = false;
    }
  }

  function populateVfx(state, alpha, elapsedSec) {
    let count = 0;
    const writeVfx = (x, y, z, yaw, sx, sy, sz, pitch, r, g, b) => {
      if (count >= MAX_VFX) return;
      dummy.position.set(x, y, z);
      dummy.rotation.set(pitch, yaw, 0);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      vfxInst.setMatrixAt(count, dummy.matrix);
      colTmp.setRGB(r, g, b);
      vfxInst.setColorAt(count, colTmp);
      count++;
    };

    // Projectiles & Missile Contrails
    const projs = state.projectiles ?? [];
    for (let i = 0; i < projs.length; i++) {
      const p = projs[i];
      const ix = p.prevX + (p.x - p.prevX) * alpha;
      const iy = p.prevY + (p.y - p.prevY) * alpha;
      const iz = p.prevZ + (p.z - p.prevZ) * alpha;
      const yaw = Math.atan2(p.targetX - ix, p.targetZ - iz);
      const isMissile = p.damageType === 'Missile' || p.damageType === 'HighExplosive';
      if (isMissile) {
        const vx = Math.sin(yaw);
        const vz = Math.cos(yaw);
        writeVfx(ix, iy, iz, yaw, 0.28, 0.28, 1.25, 0, 0.92, 0.92, 0.96);
        writeVfx(ix - vx * 0.7, iy, iz - vz * 0.7, yaw, 0.36, 0.36, 0.65, 0, 1.0, 0.62, 0.16);
        for (let t = 1; t <= 3; t++) {
          const lag = 1.1 + t * 1.1;
          const s = 0.28 + t * 0.14;
          const sh = 0.56 - t * 0.1;
          writeVfx(ix - vx * lag, iy + t * 0.05, iz - vz * lag, elapsedSec * 2 + t, s, s, s, 0.2, sh, sh, sh);
        }
      } else {
        writeVfx(ix, iy, iz, yaw, 0.18, 0.18, 0.95, 0, 1.0, 0.85, 0.35);
      }
    }

    // Carrier & Orphan Drones
    const ents = state.entities ?? [];
    for (let i = 0; i < ents.length; i++) {
      const ent = ents[i];
      if (!ent.alive) continue;
      if (ent.typeId === 'carrier' && ent.drones) {
        for (let j = 0; j < ent.drones.length; j++) {
          const d = ent.drones[j];
          if (d.fsmState === 'D_DOCKED' || d.fsmState === 'D_REARMING') continue;
          writeVfx(d.x, d.y, d.z, d.yaw ?? 0, 1.25, 0.22, 1.1, 0, 0.3, 0.68, 1.0);
        }
      }
      if (ent.ironCurtainTicks > 0) {
        const s = (ent.radius ?? 1.6) * 2.1;
        writeVfx(ent.x, (ent.y ?? 1.6) + 0.9, ent.z, elapsedSec * 1.8, s, 1.75, s, 0, 0.92, 0.16, 0.22);
      }
      if (ent.empTicks > 0) {
        writeVfx(
          ent.x + Math.sin(elapsedSec * 24 + ent.id) * 0.45,
          (ent.y ?? 1.6) + 1.35,
          ent.z + Math.cos(elapsedSec * 21 + ent.id) * 0.45,
          elapsedSec * 6.0,
          0.26, 1.15, 0.26, 0.35, 0.32, 0.88, 1.0
        );
      }
      if (ent.maxHp > 0 && ent.hp < ent.maxHp * 0.5 && (ent.category === 'building' || ent.category === 'vehicle' || ent.category === 'naval')) {
        for (let k = 0; k < 2; k++) {
          const cyc = (elapsedSec * 0.6 + ent.id * 0.31 + k * 0.5) % 1.0;
          const sc = (ent.category === 'building' ? 0.85 : 0.48) * (0.65 + cyc * 1.1);
          const shade = 0.18 + cyc * 0.15;
          writeVfx(
            ent.x + Math.sin(elapsedSec * 1.3 + k + ent.id) * 0.6,
            (ent.y ?? 1.6) + 1.5 + cyc * 3.0,
            ent.z + Math.cos(elapsedSec * 1.1 + k) * 0.5,
            cyc * 2.5,
            sc, sc * 0.85, sc, 0.2, shade, shade, shade
          );
        }
      }
    }

    for (const d of state.orphanDrones ?? []) {
      writeVfx(d.x, d.y, d.z, d.yaw ?? 0, 1.25, 0.22, 1.1, 0, 0.95, 0.45, 0.25);
    }

    // Area Effects
    for (const fx of state.areaEffects ?? []) {
      const rad = fx.radius ?? 10;
      if (fx.kind === 'sw_warning') {
        const isNuke = fx.swTypeId === 'nuclear_silo';
        const r = isNuke ? 1.0 : 0.35;
        const g = isNuke ? 0.22 : 0.82;
        const b = isNuke ? 0.15 : 1.0;
        writeVfx(fx.x, 8.0, fx.z, elapsedSec * 2.5, 0.45, 16.0, 0.45, 0, r, g, b);
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2 + elapsedSec * 1.4;
          writeVfx(fx.x + Math.cos(ang) * rad, 2.2, fx.z + Math.sin(ang) * rad, -ang, 0.42, 0.42, rad * 0.62, 0, r, g, b);
        }
      } else if (fx.kind === 'radiation' || fx.type === 'radiation') {
        for (let k = 0; k < 5; k++) {
          const ang = (k / 5) * Math.PI * 2 + elapsedSec * 0.8;
          writeVfx(fx.x + Math.cos(ang) * rad * 0.55, 2.0, fx.z + Math.sin(ang) * rad * 0.55, ang, 1.0, 0.24, 1.0, 0, 0.38, 0.95, 0.22);
        }
      } else if (fx.kind === 'satellite') {
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2 - elapsedSec * 1.2;
          writeVfx(fx.x + Math.cos(ang) * rad, 3.0, fx.z + Math.sin(ang) * rad, -ang, 0.28, 0.28, 2.8, 0, 0.24, 0.88, 1.0);
        }
      } else if (fx.kind === 'lightning_storm') {
        writeVfx(fx.x, 12.5, fx.z, elapsedSec, 8.2, 0.85, 8.2, 0, 0.35, 0.58, 1.0);
      }
    }

    // Transient Flashes / Explosions / Beams / Order Rings
    for (let i = transientFx.length - 1; i >= 0; i--) {
      const fx = transientFx[i];
      const age = elapsedSec - fx.startSec;
      if (age >= fx.duration) {
        transientFx.splice(i, 1);
        continue;
      }
      const prog = age / fx.duration;
      if (fx.kind === 'explosion') {
        const baseS = (fx.scale ?? 1.2) * (0.65 + prog * 1.75);
        writeVfx(fx.x, fx.y + 0.7 + prog * 0.9, fx.z, prog * 2.2, baseS, baseS * (1.1 - prog * 0.3), baseS, 0.3, 1.0, 0.72 - prog * 0.4, 0.16);
        for (let k = 0; k < 3; k++) {
          const ang = (k / 3) * Math.PI * 2 + prog * 1.2;
          const rOff = (fx.scale ?? 1.2) * (0.35 + prog * 1.15);
          const smS = (fx.scale ?? 1.2) * (0.75 + prog * 1.85);
          writeVfx(fx.x + Math.cos(ang) * rOff, fx.y + 1.1 + prog * 3.0, fx.z + Math.sin(ang) * rOff, ang, smS, smS * 0.9, smS, 0.35, 0.24, 0.22, 0.22);
        }
      } else if (fx.kind === 'beam') {
        const dx = fx.tx - fx.x;
        const dz = fx.tz - fx.z;
        const dist = Math.hypot(dx, dz);
        const fade = Math.max(0.25, 1.0 - prog);
        if (dist < 0.05 && fx.y > 8.0) {
          writeVfx(fx.x, fx.y * 0.5, fx.z, elapsedSec * 12.0, 0.34 * fade, fx.y, 0.34 * fade, 0, fx.r, fx.g, fx.b);
        } else {
          const d = dist || 1;
          writeVfx((fx.x + fx.tx) * 0.5, fx.y, (fx.z + fx.tz) * 0.5, Math.atan2(dx, dz), 0.22 * fade, 0.22 * fade, d, 0, fx.r, fx.g, fx.b);
        }
      } else if (fx.kind === 'order') {
        const s = 1.5 * (1.0 - prog * 0.65);
        writeVfx(fx.x, fx.y + 0.3, fx.z, elapsedSec * 4.0, s, 0.16, s, 0, fx.r, fx.g, fx.b);
      }
    }

    // Debris Chunks
    const chunks = debrisSys.chunks;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      writeVfx(c.x, c.y, c.z, c.yaw, c.sx, c.sy, c.sz, c.pitch, c.r, c.g, c.b);
    }

    vfxInst.count = count;
    vfxInst.instanceMatrix.needsUpdate = true;
    if (vfxInst.instanceColor) vfxInst.instanceColor.needsUpdate = true;
  }

  function renderFrame(state, alpha, uiState, elapsedSec) {
    ensureSize();
    syncCameraTransform();

    const dtSec = Math.max(0.001, Math.min(0.1, elapsedSec - prevElapsed));
    prevElapsed = elapsedSec;

    world.gpuFog.updateFromCpu(state.fogGrids?.[0], Boolean(uiState?.noFog), state.tickCount <= 2);
    world.syncMap(state.map, state.tickCount);
    world.updateSunFocus(camera.targetX, camera.targetZ, camera.height);
    world.updateAtmosphere(elapsedSec, camera.targetX, camera.targetZ);

    syncEntities(state, alpha, uiState, elapsedSec, dtSec);
    populateVfx(state, alpha, elapsedSec);

    renderer.info.reset();
    composer.render(dtSec);
    rendererInfo.render.calls = renderer.info.render.calls;
  }

  const rendererInfo = { render: { calls: 0 } };

  const gpuFogAdapter = {
    updateFromCpu: (fogGrid, noFog, force) => world.gpuFog.updateFromCpu(fogGrid, noFog, force),
    reset: () => world.gpuFog.reset(),
    dispose: () => world.gpuFog.dispose()
  };

  const shadowAdapter = {
    lightDir: new Float32Array([0.48, 0.72, 0.50]),
    invalidateCache() {},
    dispose() {}
  };

  const modelFactoryAdapter = {
    loadGlbBufferOverride: (typeId, buf, meta) => assets.loadGlbBufferOverride(typeId, buf, meta),
    loadSpriteBufferOverride: (typeId, buf, mime, meta) => assets.loadSpriteBufferOverride(typeId, buf, mime, meta),
    restoreProceduralModel: (typeId) => assets.restoreProceduralModel(typeId),
    syncManifestOverrides: () => assets.syncManifestOverrides(),
    glbLoadedTypes: assets.glbLoadedTypes,
    dispose: () => assets.dispose()
  };

  function setQualityPreset(presetId) {
    quality = resolveQualityPreset(presetId);
    if (gtaoPass && gtaoEnabledRuntime) {
      gtaoPass.enabled = Boolean(quality.gtaoEnabled);
    }
    bloomPass.enabled = Boolean(quality.bloomEnabled);
    targetW = 0;
    ensureSize();
    return quality;
  }

  function dispose() {
    assets.dispose();
    world.dispose();
    decalPool.dispose();
    ringGeo.dispose();
    ringMat.dispose();
    ringTex.dispose();
    barGeo.dispose();
    hpBgMat.dispose();
    hpFillMat.dispose();
    ghostGeo.dispose();
    ghostMat.dispose();
    buildRingGeo.dispose();
    buildRingMat.dispose();
    vfxGeo.dispose();
    vfxMat.dispose();
    gtaoPass?.dispose?.();
    bloomPass?.dispose?.();
    composer?.dispose?.();
    renderer.dispose();
  }

  return {
    camera,
    info: rendererInfo,
    decalPool,
    debrisSys,
    shadowSys: shadowAdapter,
    gpuFog: gpuFogAdapter,
    modelFactory: modelFactoryAdapter,
    get quality() {
      return quality;
    },
    setQuality: setQualityPreset,
    setQualityPreset,
    syncTerrainMap: (map, tickCount, force) => world.syncMap(map, tickCount, force),
    pushTransientFx,
    clearTransientVisuals,
    restoreContext,
    renderFrame,
    dispose
  };
}
