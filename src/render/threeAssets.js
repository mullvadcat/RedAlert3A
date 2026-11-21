import { THREE, GLTFLoader, SkeletonUtils, mergeGeometries } from './threeVendor.bundle.js';
import { ENTITY_DEFS, FACTIONS, PLAYER_COLORS, CANONICAL_ENTITY_IDS } from '../core/config.js';

const PLAN_A_GLB_URLS = {
  tank: 'assets/plan-a/tank.glb',
  soldier: 'assets/plan-a/soldier.glb',
  factory: 'assets/plan-a/factory.glb',
  generator: 'assets/plan-a/generator.glb',
  fuel: 'assets/plan-a/fuel.glb',
  crate: 'assets/plan-a/crate.glb',
  barrier: 'assets/plan-a/barrier.glb',
  sandbags: 'assets/plan-a/sandbags.glb'
};

const TEAM_RGB_LIST = [
  PLAYER_COLORS[0].rgb,
  PLAYER_COLORS[1].rgb,
  PLAYER_COLORS[2].rgb,
  PLAYER_COLORS[3].rgb,
  FACTIONS.neutral.rgb
];

function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function createProceduralSteelTextures() {
  const size = 256;
  const dCan = makeCanvas(size, size);
  const nCan = makeCanvas(size, size);
  const rCan = makeCanvas(size, size);
  const dCtx = dCan.getContext('2d');
  const nCtx = nCan.getContext('2d');
  const rCtx = rCan.getContext('2d');

  // Cast steel panel base
  dCtx.fillStyle = '#aeb4ba';
  dCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#868686';
  rCtx.fillRect(0, 0, size, size);
  nCtx.fillStyle = 'rgb(128,128,255)';
  nCtx.fillRect(0, 0, size, size);

  // Brushed metal micro-speckle
  for (let i = 0; i < 1600; i++) {
    const x = Math.floor(hash1(i * 3.1) * size);
    const y = Math.floor(hash1(i * 7.3) * size);
    const w = 1 + Math.floor(hash1(i * 11.7) * 5);
    const g = 148 + Math.floor((hash1(i * 17.1) - 0.5) * 46);
    dCtx.fillStyle = `rgb(${g},${g + 2},${g + 4})`;
    dCtx.fillRect(x, y, w, 1);
    const rv = 110 + Math.floor((hash1(i * 23.9) - 0.5) * 58);
    rCtx.fillStyle = `rgb(${rv},${rv},${rv})`;
    rCtx.fillRect(x, y, w, 1);
  }

  // Welded 2x2 military armor panel seams + rivets + ventilation louvre accents
  dCtx.strokeStyle = 'rgba(42,48,54,0.52)';
  dCtx.lineWidth = 2;
  dCtx.strokeRect(4, 4, size - 8, size - 8);
  dCtx.beginPath();
  dCtx.moveTo(0, size * 0.5);
  dCtx.lineTo(size, size * 0.5);
  dCtx.moveTo(size * 0.5, 0);
  dCtx.lineTo(size * 0.5, size);
  dCtx.stroke();

  dCtx.fillStyle = 'rgba(225,232,238,0.42)';
  for (const [rx, ry] of [[14, 14], [114, 14], [142, 14], [242, 14], [14, 114], [114, 114], [142, 142], [242, 242]]) {
    dCtx.fillRect(rx, ry, 3, 3);
  }

  nCtx.strokeStyle = 'rgb(104,104,246)';
  nCtx.lineWidth = 2;
  nCtx.strokeRect(4, 4, size - 8, size - 8);
  nCtx.beginPath();
  nCtx.moveTo(0, size * 0.5);
  nCtx.lineTo(size, size * 0.5);
  nCtx.moveTo(size * 0.5, 0);
  nCtx.lineTo(size * 0.5, size);
  nCtx.stroke();

  const mkTex = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return {
    diff: mkTex(dCan, true),
    nor: mkTex(nCan, false),
    rough: mkTex(rCan, false)
  };
}

function createHazardStripeTexture() {
  const s = 128;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d99e26';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#1f242a';
  for (let i = -s; i < s * 2; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 16, 0);
    ctx.lineTo(i + 16 - s, s);
    ctx.lineTo(i - s, s);
    ctx.closePath();
    ctx.fill();
  }
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = hash1(i * 4.7) > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.09)';
    ctx.fillRect(Math.floor(hash1(i * 2.3) * s), Math.floor(hash1(i * 9.1) * s), 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createConcretePadTexture() {
  const s = 256;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8b9094';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 2200; i++) {
    const v = 126 + Math.floor((hash1(i * 5.7) - 0.5) * 34);
    ctx.fillStyle = `rgb(${v},${v + 1},${v + 2})`;
    ctx.fillRect(Math.floor(hash1(i * 3.3) * s), Math.floor(hash1(i * 7.9) * s), 2, 2);
  }
  ctx.strokeStyle = 'rgba(42,46,52,0.52)';
  ctx.lineWidth = 2;
  const step = s / 4;
  for (let k = 0; k <= 4; k++) {
    const p = k * step;
    ctx.beginPath();
    ctx.moveTo(p, 0); ctx.lineTo(p, s);
    ctx.moveTo(0, p); ctx.lineTo(s, p);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(210,215,220,0.28)';
  for (let gx = 0; gx < 4; gx++) {
    for (let gy = 0; gy < 4; gy++) {
      ctx.fillRect(gx * step + 5, gy * step + 5, 2, 2);
      ctx.fillRect((gx + 1) * step - 7, (gy + 1) * step - 7, 2, 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createHoloDomeTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 128);
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0.0, 'rgba(130, 240, 255, 0.58)');
  grad.addColorStop(0.6, 'rgba(42, 196, 244, 0.34)');
  grad.addColorStop(1.0, 'rgba(18, 130, 210, 0.16)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 128);
  // Latitude rings & glowing longitude meridians
  ctx.strokeStyle = 'rgba(175, 248, 255, 0.85)';
  ctx.lineWidth = 1.5;
  for (let y = 16; y < 128; y += 22) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(135, 232, 255, 0.55)';
  for (let x = 0; x < 256; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 128);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const HD2D_UNIT_SPECS = {
  sledge: { url: 'assets/hd2d/sledge.png', baseColor: 'red', w: 2.76, h: 2.76, shadowR: 0.78 },
  tesla_trooper: { url: 'assets/hd2d/tesla_trooper.png', baseColor: 'red', w: 2.50, h: 2.50, shadowR: 0.68 },
  gi: {
    url: 'assets/hd2d/gi.png',
    deployedUrl: 'assets/hd2d/gi_deployed.png',
    baseColor: 'blue',
    w: 2.15,
    h: 2.15,
    deployedW: 2.80,
    deployedH: 2.25,
    shadowR: 0.58
  }
};

function createContactShadowTexture() {
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0.0, 'rgba(6, 10, 14, 0.56)');
  grad.addColorStop(0.55, 'rgba(6, 10, 14, 0.28)');
  grad.addColorStop(1.0, 'rgba(6, 10, 14, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function rgbToHsvDeg(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-5) {
    if (max === r) h = 60 * (((g - b) / d) + (g < b ? 6 : 0));
    else if (max === g) h = 60 * (((b - r) / d) + 2);
    else h = 60 * (((r - g) / d) + 4);
  }
  return [h, max > 1e-5 ? d / max : 0, max];
}

function hsvDegToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60) { rp = c; gp = x; }
  else if (h < 120) { rp = x; gp = c; }
  else if (h < 180) { gp = c; bp = x; }
  else if (h < 240) { gp = x; bp = c; }
  else if (h < 300) { rp = x; bp = c; }
  else { rp = c; bp = x; }
  return [
    Math.round((rp + m) * 255),
    Math.round((gp + m) * 255),
    Math.round((bp + m) * 255)
  ];
}

function recolorHd2dCell(srcImg, sx, sy, sw, sh, baseColor, slot) {
  const c = makeCanvas(sw, sh);
  const ctx = c.getContext('2d');
  ctx.drawImage(srcImg, sx, sy, sw, sh, 0, 0, sw, sh);

  const keepNative = (baseColor === 'red' && slot === 1) || (baseColor === 'blue' && slot === 0);
  if (keepNative) return c;

  const rgb = TEAM_RGB_LIST[slot] || TEAM_RGB_LIST[4];
  const [tH, tS] = rgbToHsvDeg(rgb[0], rgb[1], rgb[2]);
  const isNeutral = slot === 4;
  const imgData = ctx.getImageData(0, 0, sw, sh);
  const data = imgData.data;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) continue;
    const [h, s, v] = rgbToHsvDeg(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    const matchRed = baseColor === 'red' && (h < 16 || h > 340) && s > 0.24 && v > 0.14;
    const matchBlue = baseColor === 'blue' && h >= 195 && h <= 250 && s > 0.36 && v > 0.14;
    if (!matchRed && !matchBlue) continue;

    const outS = isNeutral ? s * 0.14 : Math.min(1, s * (0.72 + tS * 0.34));
    const outV = isNeutral ? v * 0.88 : Math.min(1, v * (slot === 0 && baseColor === 'red' ? 1.06 : 1.0));
    const [nr, ng, nb] = hsvDegToRgb(tH, outS, outV);
    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }
  ctx.putImageData(imgData, 0, 0);
  return c;
}

function getBoxInParentSpace(obj, parent) {
  obj.updateWorldMatrix(true, true);
  parent.updateWorldMatrix(true, false);
  const invParent = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const mat = new THREE.Matrix4();
  obj.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    const bb = child.geometry.boundingBox;
    if (!bb) return;
    mat.multiplyMatrices(invParent, child.matrixWorld);
    for (let ix = 0; ix < 2; ix++) {
      for (let iy = 0; iy < 2; iy++) {
        for (let iz = 0; iz < 2; iz++) {
          v.set(ix ? bb.max.x : bb.min.x, iy ? bb.max.y : bb.min.y, iz ? bb.max.z : bb.min.z).applyMatrix4(mat);
          box.expandByPoint(v);
        }
      }
    }
  });
  return box;
}

function countObjectVertices(root) {
  let count = 0;
  root.traverse((c) => {
    if (c.isMesh && c.geometry?.attributes?.position) {
      count += c.geometry.attributes.position.count;
    }
  });
  return count;
}

export function createThreeAssetLibrary(renderer, worldRef) {
  const disposables = [];
  const steelMaps = createProceduralSteelTextures();
  const hazardTex = createHazardStripeTexture();
  const concreteTex = createConcretePadTexture();
  const holoTex = createHoloDomeTexture();
  const contactShadowTex = createContactShadowTexture();
  disposables.push(steelMaps.diff, steelMaps.nor, steelMaps.rough, hazardTex, concreteTex, holoTex, contactShadowTex);

  let revision = 1;
  let disposed = false;

  const hd2dImages = new Map();
  const hd2dDeployedImages = new Map();
  const hd2dMatCache = new Map();
  const hd2dGeos = new Map();
  const contactShadowGeo = new THREE.CircleGeometry(1, 20);
  contactShadowGeo.rotateX(-Math.PI * 0.5);
  const contactShadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.92
  });
  disposables.push(contactShadowGeo, contactShadowMat);

  const glbTemplates = {
    tank: null,
    soldier: null,
    soldierAnims: [],
    factory: null,
    generator: null,
    fuel: null,
    crate: null,
    barrier: null,
    sandbags: null
  };

  // Custom drag/drop or manifest overrides per canonical typeId
  const customGlbOverrides = new Map();
  const customSpriteOverrides = new Map();
  const glbLoadedTypes = new Set();

  // Shared Geometries (reused heavily for minimal memory & GC pressure)
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
  const unitOct = new THREE.CylinderGeometry(0.46, 0.54, 1, 8);
  const unitHex = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
  const unitCone = new THREE.ConeGeometry(0.5, 1, 10);
  const unitSphere = new THREE.SphereGeometry(0.5, 12, 10);
  const unitTorus = new THREE.TorusGeometry(0.5, 0.14, 8, 18);

  function buildCoolingTowerGeo() {
    const pts = [
      new THREE.Vector2(0.01, 0),
      new THREE.Vector2(0.62, 0),
      new THREE.Vector2(0.53, 0.45),
      new THREE.Vector2(0.45, 0.95),
      new THREE.Vector2(0.41, 1.45),
      new THREE.Vector2(0.42, 1.85),
      new THREE.Vector2(0.46, 2.20),
      new THREE.Vector2(0.39, 2.20),
      new THREE.Vector2(0.35, 1.85),
      new THREE.Vector2(0.01, 1.85)
    ];
    const g = new THREE.LatheGeometry(pts, 18);
    g.computeVertexNormals();
    return g;
  }

  function buildRadarDishGeo() {
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const r = (i / 6) * 1.05;
      pts.push(new THREE.Vector2(r, 0.34 * r * r));
    }
    for (let i = 6; i >= 0; i--) {
      const r = (i / 6) * 1.05;
      pts.push(new THREE.Vector2(r, 0.34 * r * r - 0.08));
    }
    const g = new THREE.LatheGeometry(pts, 16);
    g.rotateX(-Math.PI * 0.42);
    g.computeVertexNormals();
    return g;
  }

  function buildSlopedCabGeo() {
    const s = new THREE.Shape();
    s.moveTo(-0.5, -0.5);
    s.lineTo(0.5, -0.5);
    s.lineTo(0.24, 0.5);
    s.lineTo(-0.5, 0.5);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 1.0,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 2
    });
    g.center();
    g.rotateY(-Math.PI * 0.5); // Slopes toward +Z
    g.computeVertexNormals();
    return g;
  }

  function buildSweptWingGeo(halfSpan = 1.65, rootChord = 1.15, tipChord = 0.36, sweep = 0.78) {
    const s = new THREE.Shape();
    s.moveTo(0, rootChord * 0.5);
    s.lineTo(halfSpan, rootChord * 0.5 - sweep);
    s.lineTo(halfSpan, rootChord * 0.5 - sweep - tipChord);
    s.lineTo(0, -rootChord * 0.5);
    s.lineTo(-halfSpan, rootChord * 0.5 - sweep - tipChord);
    s.lineTo(-halfSpan, rootChord * 0.5 - sweep);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 0.075,
      bevelEnabled: true,
      bevelThickness: 0.018,
      bevelSize: 0.025,
      bevelSegments: 2
    });
    geo.rotateX(-Math.PI * 0.5);
    geo.computeVertexNormals();
    return geo;
  }
  const jetWingGeo = buildSweptWingGeo(1.75, 1.25, 0.38, 0.85);
  const tailWingGeo = buildSweptWingGeo(0.72, 0.52, 0.22, 0.32);

  function buildShipBowGeo(halfBeam = 0.96, bowLen = 1.65, hullDepth = 0.76) {
    const s = new THREE.Shape();
    s.moveTo(-halfBeam, 0);
    s.lineTo(0, bowLen);
    s.lineTo(halfBeam, 0);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: hullDepth,
      bevelEnabled: true,
      bevelThickness: 0.06,
      bevelSize: 0.05,
      bevelSegments: 2
    });
    g.rotateX(-Math.PI * 0.5);
    g.computeVertexNormals();
    return g;
  }
  function buildHangarArchGeo() {
    const s = new THREE.Shape();
    s.moveTo(-0.50, 0.00);
    s.lineTo(-0.50, 0.50);
    s.lineTo(-0.30, 0.92);
    s.lineTo(-0.16, 1.00);
    s.lineTo(0.16, 1.00);
    s.lineTo(0.30, 0.92);
    s.lineTo(0.50, 0.50);
    s.lineTo(0.50, 0.00);
    s.lineTo(0.35, 0.00);
    s.lineTo(0.35, 0.44);
    s.lineTo(0.20, 0.78);
    s.lineTo(-0.20, 0.78);
    s.lineTo(-0.35, 0.44);
    s.lineTo(-0.35, 0.00);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, steps: 1 });
    g.translate(0, 0, -0.5);
    g.computeVertexNormals();
    return g;
  }

  const shipBowGeo = buildShipBowGeo(0.95, 1.55, 0.72);
  const coolingTowerGeo = buildCoolingTowerGeo();
  const radarDishGeo = buildRadarDishGeo();
  const slopedCabGeo = buildSlopedCabGeo();
  const hangarArchGeo = buildHangarArchGeo();
  disposables.push(
    unitBox, unitCyl, unitOct, unitHex, unitCone, unitSphere, unitTorus,
    jetWingGeo, tailWingGeo, shipBowGeo, coolingTowerGeo, radarDishGeo, slopedCabGeo, hangarArchGeo
  );

  const fogHook = (mat, key) => (worldRef?.applyFogToMaterial ? worldRef.applyFogToMaterial(mat, key) : mat);

  function getHd2dBundle(typeId, teamId) {
    const spec = HD2D_UNIT_SPECS[typeId];
    const baseImg = hd2dImages.get(typeId);
    if (!spec || !baseImg) return null;
    const slot = (teamId === undefined || teamId === null || teamId < 0 || teamId >= TEAM_RGB_LIST.length - 1) ? 4 : teamId;
    const key = `${typeId}-${slot}`;
    if (hd2dMatCache.has(key)) return hd2dMatCache.get(key);

    let geos = hd2dGeos.get(typeId);
    if (!geos) {
      const geo = new THREE.PlaneGeometry(spec.w, spec.h);
      geo.translate(0, spec.h * 0.475, 0);
      disposables.push(geo);
      let depGeo = null;
      if (spec.deployedUrl) {
        depGeo = new THREE.PlaneGeometry(spec.deployedW, spec.deployedH);
        depGeo.translate(0, spec.deployedH * 0.47, 0);
        disposables.push(depGeo);
      }
      geos = { geo, depGeo };
      hd2dGeos.set(typeId, geos);
    }

    const cw = Math.floor(baseImg.width / 2);
    const ch = Math.floor(baseImg.height / 2);
    const quads = [[0, 0], [cw, 0], [0, ch], [cw, ch]];
    const aniso = Math.min(4, renderer?.capabilities?.getMaxAnisotropy?.() || 4);
    const mats = [];
    const depthMats = [];

    for (let q = 0; q < 4; q++) {
      const [qx, qy] = quads[q];
      const canvas = recolorHd2dCell(baseImg, qx, qy, cw, ch, spec.baseColor, slot);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = aniso;
      tex.needsUpdate = true;
      const mat = fogHook(new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.48,
        roughness: 0.88,
        metalness: 0.04,
        alphaTest: 0.42,
        side: THREE.DoubleSide
      }), `hd2d-${key}-${q}`);
      const dMat = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: tex,
        alphaTest: 0.42
      });
      disposables.push(tex, mat, dMat);
      mats.push(mat);
      depthMats.push(dMat);
    }

    let deployedMat = null;
    let deployedDepthMat = null;
    const depImg = spec.deployedUrl ? hd2dDeployedImages.get(typeId) : null;
    if (depImg) {
      const dc = recolorHd2dCell(depImg, 0, 0, depImg.width, depImg.height, spec.baseColor, slot);
      const dTex = new THREE.CanvasTexture(dc);
      dTex.colorSpace = THREE.SRGBColorSpace;
      dTex.anisotropy = aniso;
      dTex.needsUpdate = true;
      deployedMat = fogHook(new THREE.MeshStandardMaterial({
        map: dTex,
        emissiveMap: dTex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.48,
        roughness: 0.88,
        metalness: 0.04,
        alphaTest: 0.42,
        side: THREE.DoubleSide
      }), `hd2d-${key}-dep`);
      deployedDepthMat = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: dTex,
        alphaTest: 0.42
      });
      disposables.push(dTex, deployedMat, deployedDepthMat);
    }

    const bundle = { spec, geos, mats, depthMats, deployedMat, deployedDepthMat };
    hd2dMatCache.set(key, bundle);
    return bundle;
  }

  function makePbrArmorMat(hexCol, { roughness = 0.44, metalness = 0.68, edgeWear = 0.32, transparent = false, opacity = 1, mapOverride = null } = {}, key = 'armor') {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(hexCol),
      map: mapOverride || steelMaps.diff,
      normalMap: mapOverride ? null : steelMaps.nor,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: mapOverride ? null : steelMaps.rough,
      roughness,
      metalness,
      envMapIntensity: 1.12,
      transparent,
      opacity
    });
    const prevKey = `ra3a-${key}-${Math.round(metalness * 10)}`;
    mat.customProgramCacheKey = () => prevKey;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uEdgeWear = { value: edgeWear };
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying vec3 vArmorWNorm;\nvarying float vArmorHeight;\nvoid main() {')
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
vec4 _aWp = modelMatrix * vec4(transformed, 1.0);
vArmorWNorm = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
vArmorHeight = clamp(_aWp.y - (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y, 0.0, 2.0);`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'varying vec3 vArmorWNorm;\nvarying float vArmorHeight;\nuniform float uEdgeWear;\nvoid main() {')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float _edge = clamp(length(fwidth(normalize(vArmorWNorm))) * 3.8, 0.0, 1.0) * uEdgeWear;
float _grime = smoothstep(0.0, 0.85, vArmorHeight);
diffuseColor.rgb = mix(diffuseColor.rgb * 0.72, diffuseColor.rgb, _grime);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.65, 0.68), _edge * 0.55);`
        );
    };
    fogHook(mat, prevKey);
    disposables.push(mat);
    return mat;
  }

  // Palette cache per team slot (0..4) — weathered gunmetal & muted military livery
  const teamPalettes = TEAM_RGB_LIST.map((rgb, ti) => {
    const teamColor = new THREE.Color(rgb[0], rgb[1], rgb[2]);
    const gunmetal = new THREE.Color(0x3a4046).lerp(teamColor, 0.08);
    const paintedArmor = new THREE.Color(0x4c545c).lerp(teamColor, 0.36);
    const brightTrim = new THREE.Color(0xd2d7dc).lerp(teamColor, 0.68);

    const p = {
      team: makePbrArmorMat(paintedArmor.getHex(), { roughness: 0.46, metalness: 0.56, edgeWear: 0.36 }, `team-${ti}`),
      hull: makePbrArmorMat(gunmetal.getHex(), { roughness: 0.44, metalness: 0.78, edgeWear: 0.32 }, `hull-${ti}`),
      trim: makePbrArmorMat(brightTrim.getHex(), { roughness: 0.38, metalness: 0.44, edgeWear: 0.22 }, `trim-${ti}`),
      dark: makePbrArmorMat(0x21262b, { roughness: 0.62, metalness: 0.72, edgeWear: 0.18 }, `dark-${ti}`),
      concrete: makePbrArmorMat(0xe6eaee, { roughness: 0.88, metalness: 0.06, edgeWear: 0.10, mapOverride: concreteTex }, `conc-${ti}`),
      hazard: makePbrArmorMat(0xf5f5f5, { roughness: 0.48, metalness: 0.22, edgeWear: 0.14, mapOverride: hazardTex }, `haz-${ti}`),
      gold: makePbrArmorMat(0xd59f2a, { roughness: 0.42, metalness: 0.48, edgeWear: 0.22 }, `gold-${ti}`),
      copper: makePbrArmorMat(0xb66e41, { roughness: 0.34, metalness: 0.84, edgeWear: 0.25 }, `cop-${ti}`),
      skin: makePbrArmorMat(0xd6a584, { roughness: 0.78, metalness: 0.02, edgeWear: 0.04 }, `skin-${ti}`),
      olive: makePbrArmorMat(0x5b6446, { roughness: 0.72, metalness: 0.14, edgeWear: 0.12 }, `olive-${ti}`),
      leather: makePbrArmorMat(0x3d2a20, { roughness: 0.76, metalness: 0.08, edgeWear: 0.10 }, `leath-${ti}`),
      silver: makePbrArmorMat(0xcfd8e2, { roughness: 0.30, metalness: 0.68, edgeWear: 0.18 }, `silv-${ti}`),
      teamSuit: makePbrArmorMat(new THREE.Color(0x28323e).lerp(teamColor, 0.72).getHex(), { roughness: 0.64, metalness: 0.18, edgeWear: 0.05 }, `tsuit-${ti}`),
      darkSuit: makePbrArmorMat(0x1b2026, { roughness: 0.68, metalness: 0.22, edgeWear: 0.04 }, `dsuit-${ti}`),
      glass: fogHook(new THREE.MeshPhysicalMaterial({ color: 0x162e42, roughness: 0.14, metalness: 0.2, clearcoat: 0.9 }), `glass-${ti}`),
      glowCyan: fogHook(new THREE.MeshStandardMaterial({ color: 0x3bc2f2, emissive: 0x1694d4, emissiveIntensity: 1.08, roughness: 0.22 }), `glowc-${ti}`),
      glowRed: fogHook(new THREE.MeshStandardMaterial({ color: 0xf24a38, emissive: 0xd82012, emissiveIntensity: 1.15, roughness: 0.24 }), `glowr-${ti}`),
      glowGreen: fogHook(new THREE.MeshStandardMaterial({ color: 0x42df74, emissive: 0x18ba4e, emissiveIntensity: 1.10, roughness: 0.24 }), `glowg-${ti}`),
      glowGold: fogHook(new THREE.MeshStandardMaterial({ color: 0xf0be48, emissive: 0xd98614, emissiveIntensity: 1.12, roughness: 0.24 }), `glowy-${ti}`),
      glowViolet: fogHook(new THREE.MeshStandardMaterial({ color: 0xb054ff, emissive: 0x8d24f2, emissiveIntensity: 1.25, roughness: 0.20 }), `glowv-${ti}`),
      chitin: makePbrArmorMat(0x281e36, { roughness: 0.38, metalness: 0.64, edgeWear: 0.32 }, `chitin-${ti}`),
      cloak: fogHook(new THREE.MeshStandardMaterial({ color: paintedArmor, roughness: 0.28, metalness: 0.75, transparent: true, opacity: 0.38 }), `cloak-${ti}`),
      sandbag: fogHook(new THREE.MeshStandardMaterial({ color: 0x9b8e73, roughness: 0.92, metalness: 0.04 }), `sbag-${ti}`),
      whiteMed: makePbrArmorMat(0xdce1e6, { roughness: 0.48, metalness: 0.2, edgeWear: 0.12 }, `med-${ti}`),
      medCross: fogHook(new THREE.MeshStandardMaterial({ color: 0xd92828, emissive: 0x550808, emissiveIntensity: 0.35, roughness: 0.45 }), `medc-${ti}`),
      holoDome: fogHook(new THREE.MeshStandardMaterial({
        color: 0x62e8ff,
        emissive: 0x22ccff,
        emissiveIntensity: 1.35,
        map: holoTex,
        emissiveMap: holoTex,
        transparent: true,
        opacity: 0.64,
        depthWrite: false,
        roughness: 0.14,
        side: THREE.DoubleSide
      }), `holo-${ti}`)
    };
    disposables.push(p.glass, p.glowCyan, p.glowRed, p.glowGreen, p.glowGold, p.glowViolet, p.cloak, p.sandbag, p.medCross, p.holoDome);
    return p;
  });

  function getPalette(teamId) {
    if (teamId === undefined || teamId === null || teamId < 0 || teamId >= TEAM_RGB_LIST.length - 1) {
      return teamPalettes[4];
    }
    return teamPalettes[teamId];
  }

  function addBox(parent, sx, sy, sz, x, y, z, mat, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(unitBox, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  function addCyl(parent, rTop, rBot, h, x, y, z, mat, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(unitCyl, mat);
    m.scale.set(rBot * 2, h, rTop * 2);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  function addCone(parent, r, h, x, y, z, mat, rx = 0) {
    const m = new THREE.Mesh(unitCone, mat);
    m.scale.set(r * 2, h, r * 2);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  function addSphere(parent, r, x, y, z, mat, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Mesh(unitSphere, mat);
    m.scale.set(r * 2 * sx, r * 2 * sy, r * 2 * sz);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  function addOct(parent, radius, h, x, y, z, mat, ry = Math.PI / 8) {
    const m = new THREE.Mesh(unitOct, mat);
    m.scale.set(radius * 2, h, radius * 2);
    m.position.set(x, y, z);
    if (ry) m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  function addGeo(parent, geo, mat, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  function addTrussBoom(parent, length, width, height, x, y, z, rx, ry, rz, chordMat, braceMat) {
    const boom = new THREE.Group();
    boom.position.set(x, y, z);
    if (rx || ry || rz) boom.rotation.set(rx, ry, rz);
    const hw = width * 0.5;
    const hh = height * 0.5;
    const barT = Math.max(0.045, Math.min(width, height) * 0.14);
    for (const cx of [-hw, hw]) {
      for (const cy of [-hh, hh]) {
        addBox(boom, barT, barT, length, cx, cy, length * 0.5, chordMat);
      }
    }
    const segs = Math.max(4, Math.round(length / 0.55));
    const dz = length / segs;
    const diagLen = Math.hypot(dz, height);
    const diagPitch = Math.atan2(height, dz);
    for (let i = 0; i <= segs; i++) {
      const sz = i * dz;
      addBox(boom, width + barT, barT * 0.85, barT * 0.85, 0, hh, sz, braceMat);
      addBox(boom, width + barT, barT * 0.85, barT * 0.85, 0, -hh, sz, braceMat);
      addBox(boom, barT * 0.85, height, barT * 0.85, -hw, 0, sz, braceMat);
      addBox(boom, barT * 0.85, height, barT * 0.85, hw, 0, sz, braceMat);
      if (i < segs) {
        const cz = sz + dz * 0.5;
        const flip = (i % 2 === 0) ? 1 : -1;
        addBox(boom, barT * 0.72, barT * 0.72, diagLen, -hw, 0, cz, braceMat, flip * diagPitch, 0, 0);
        addBox(boom, barT * 0.72, barT * 0.72, diagLen, hw, 0, cz, braceMat, -flip * diagPitch, 0, 0);
      }
    }
    parent.add(boom);
    return boom;
  }

  const fogClonedMats = new WeakMap();
  const soldierMatCache = new Map();

  function getFogWrappedMaterial(origMat, keySuffix = 'glb') {
    if (!origMat) return null;
    const hit = fogClonedMats.get(origMat);
    if (hit) return hit;
    const cloned = origMat.clone();
    fogHook(cloned, keySuffix);
    fogClonedMats.set(origMat, cloned);
    disposables.push(cloned);
    return cloned;
  }

  function getSoldierTeamMaterial(origMat, isVisor, teamId) {
    const slot = (teamId === undefined || teamId === null || teamId < 0 || teamId >= TEAM_RGB_LIST.length - 1) ? 4 : teamId;
    const cacheKey = `${slot}-${isVisor ? 'v' : 'b'}`;
    if (soldierMatCache.has(cacheKey)) return soldierMatCache.get(cacheKey);
    const rgb = TEAM_RGB_LIST[slot];
    const teamCol = new THREE.Color(rgb[0], rgb[1], rgb[2]);
    const mat = origMat ? origMat.clone() : new THREE.MeshStandardMaterial();
    if (isVisor) {
      mat.color = teamCol.clone();
      mat.emissive = teamCol.clone();
      mat.emissiveIntensity = 1.45;
    } else {
      mat.color = new THREE.Color(0xd8dde2).lerp(teamCol, 0.42);
      mat.roughness = Math.max(mat.roughness ?? 0.5, 0.42);
      mat.envMapIntensity = Math.max(mat.envMapIntensity ?? 1.0, 1.05);
    }
    fogHook(mat, `sol-${cacheKey}`);
    soldierMatCache.set(cacheKey, mat);
    disposables.push(mat);
    return mat;
  }

  function clonePropInto(tplKey, parent, targetH, x, y, z, rotY = 0) {
    const tpl = glbTemplates[tplKey];
    if (!tpl) return null;
    const c = SkeletonUtils.clone(tpl);
    c.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(c);
    const sz = new THREE.Vector3();
    const ctr = new THREE.Vector3();
    box.getSize(sz);
    box.getCenter(ctr);
    const scale = targetH / Math.max(0.01, sz.y);
    const wrap = new THREE.Group();
    c.position.set(-ctr.x, -box.min.y, -ctr.z);
    wrap.add(c);
    wrap.scale.setScalar(scale);
    wrap.position.set(x, y, z);
    wrap.rotation.y = rotY;
    wrap.traverse((n) => {
      if (n.isMesh) {
        n.castShadow = true;
        n.receiveShadow = true;
        if (n.material && !Array.isArray(n.material)) {
          n.material = getFogWrappedMaterial(n.material, `prop-${tplKey}`);
        }
      }
    });
    parent.add(wrap);
    return wrap;
  }

  function extractNamedSubnode(rootScene, nodeName, targetH) {
    const src = rootScene?.getObjectByName(nodeName);
    if (!src) return null;
    const c = SkeletonUtils.clone(src);
    c.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(c);
    const sz = new THREE.Vector3();
    const ctr = new THREE.Vector3();
    box.getSize(sz);
    box.getCenter(ctr);
    const wrap = new THREE.Group();
    c.position.set(-ctr.x, -box.min.y, -ctr.z);
    wrap.add(c);
    if (targetH && sz.y > 0.01) {
      wrap.scale.setScalar(targetH / sz.y);
    }
    wrap.traverse((n) => {
      if (n.isMesh) {
        n.castShadow = true;
        n.receiveShadow = true;
        if (n.material && !Array.isArray(n.material)) {
          n.material = getFogWrappedMaterial(n.material, `fac-${nodeName.slice(0, 12)}`);
        }
      }
    });
    return wrap;
  }

  // === 1. INFANTRY BUILDER (HD-2D concept-art rigs for demo units + bespoke 3D rigs) ===
  function buildInfantry(typeId, pal, teamId) {
    const root = new THREE.Group();
    const parts = { mixer: null, actions: null, sandbags: null, weaponPivot: null, legL: null, legR: null, cloakMeshes: [] };

    const hd2d = getHd2dBundle(typeId, teamId);
    if (hd2d) {
      const shadowMesh = new THREE.Mesh(contactShadowGeo, contactShadowMat);
      shadowMesh.scale.setScalar(hd2d.spec.shadowR);
      shadowMesh.position.y = 0.04;
      shadowMesh.renderOrder = 1;
      root.add(shadowMesh);

      const mesh = new THREE.Mesh(hd2d.geos.geo, hd2d.mats[0]);
      mesh.customDepthMaterial = hd2d.depthMats[0];
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      root.add(mesh);

      let deployedMesh = null;
      if (hd2d.geos.depGeo && hd2d.deployedMat) {
        deployedMesh = new THREE.Mesh(hd2d.geos.depGeo, hd2d.deployedMat);
        deployedMesh.customDepthMaterial = hd2d.deployedDepthMat;
        deployedMesh.castShadow = true;
        deployedMesh.receiveShadow = false;
        deployedMesh.visible = false;
        root.add(deployedMesh);
      }

      parts.hd2d = {
        mesh,
        deployedMesh,
        mats: hd2d.mats,
        depthMats: hd2d.depthMats,
        dirIdx: 0
      };
      parts.hd2dMeshes = deployedMesh ? [mesh, shadowMesh, deployedMesh] : [mesh, shadowMesh];
      return { root, parts };
    }

    const track = (m) => {
      if (typeId === 'shadow' && m?.isMesh) parts.cloakMeshes.push(m);
      return m;
    };
    const pBox = (parent, sx, sy, sz, x, y, z, mat, rx = 0, ry = 0, rz = 0) =>
      track(addBox(parent, sx, sy, sz, x, y, z, mat, rx, ry, rz));
    const pCyl = (parent, rt, rb, h, x, y, z, mat, rx = 0, ry = 0, rz = 0) =>
      track(addCyl(parent, rt, rb, h, x, y, z, mat, rx, ry, rz));
    const pSph = (parent, r, x, y, z, mat, sx = 1, sy = 1, sz = 1) =>
      track(addSphere(parent, r, x, y, z, mat, sx, sy, sz));
    const pOct = (parent, r, h, x, y, z, mat) =>
      track(addOct(parent, r, h, x, y, z, mat));
    const pCone = (parent, r, h, x, y, z, mat, rx = 0, ry = 0, rz = 0) =>
      track(addCone(parent, r, h, x, y, z, mat, rx, ry, rz));
    const pTorus = (parent, mat, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(unitTorus, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      if (rx || ry || rz) m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return track(m);
    };

    const s = typeId === 'sledge' ? 1.24 : (typeId === 'tesla_trooper' ? 1.14 : (typeId === 'shadow' ? 1.02 : 1.0));
    const b = typeId === 'sledge' ? 1.34 : (typeId === 'tesla_trooper' ? 1.26 : (typeId === 'flak_trooper' ? 1.08 : (typeId === 'shadow' ? 0.94 : 1.0)));

    function buildBipedBase(cfg) {
      const lw = cfg.limbScale ?? 1.0;
      const tw = cfg.torsoScale ?? 1.0;
      const hipX = 0.125 * b * tw * s;
      const hipY = 0.80 * s;
      for (const side of [-1, 1]) {
        const leg = new THREE.Group();
        leg.position.set(side * hipX, hipY, 0);
        // Sculpted Thigh + Knee Pad + Shin Greave + Combat Boot
        pCyl(leg, 0.088 * b * lw * s, 0.072 * b * lw * s, 0.34 * s, 0, -0.17 * s, 0, cfg.legMat);
        pBox(leg, 0.13 * b * lw * s, 0.11 * s, 0.12 * b * lw * s, 0, -0.34 * s, 0.03 * b * lw * s, cfg.kneeMat);
        pCyl(leg, 0.074 * b * lw * s, 0.064 * b * lw * s, 0.32 * s, 0, -0.50 * s, -0.005 * s, cfg.shinMat);
        if (cfg.shinPlateMat) {
          pBox(leg, 0.12 * b * lw * s, 0.22 * s, 0.06 * b * lw * s, 0, -0.50 * s, 0.06 * b * lw * s, cfg.shinPlateMat);
        }
        pBox(leg, 0.145 * b * lw * s, 0.125 * s, 0.25 * s, 0, -0.73 * s, 0.045 * s, cfg.bootMat);
        pSph(leg, 0.072 * b * lw * s, 0, -0.72 * s, 0.12 * s, cfg.bootMat, 1.0, 0.72, 1.0);
        root.add(leg);
        if (side < 0) parts.legL = leg;
        else parts.legR = leg;
      }

      // Sculpted Pelvis & Utility Belt + Front Pouches
      const torsoCore = pCyl(root, 0.155 * b * tw * s, 0.155 * b * tw * s, 0.20 * s, 0, 0.86 * s, 0, cfg.pelvisMat);
      torsoCore.scale.x *= 1.16;
      torsoCore.scale.z *= 0.82;
      const beltMesh = pCyl(root, 0.165 * b * tw * s, 0.165 * b * tw * s, 0.075 * s, 0, 0.91 * s, 0, cfg.beltMat);
      beltMesh.scale.x *= 1.18;
      beltMesh.scale.z *= 0.84;
      for (const px of [-0.11, 0, 0.11]) {
        pBox(root, 0.075 * s, 0.085 * s, 0.065 * s, px * b * tw * s, 0.90 * s, 0.145 * b * tw * s, cfg.pouchMat);
      }

      // Sculpted Ribcage / Chest Cuirass
      const chest = pCyl(root, 0.185 * b * tw * s, 0.185 * b * tw * s, 0.42 * s, 0, 1.14 * s, 0, cfg.torsoMat);
      chest.scale.x *= 1.24;
      chest.scale.z *= 0.76;
      if (cfg.chestPlateMat) {
        pBox(root, 0.34 * b * tw * s, 0.28 * s, 0.12 * b * tw * s, 0, 1.18 * s, 0.105 * b * tw * s, cfg.chestPlateMat);
        pBox(root, 0.30 * b * tw * s, 0.22 * s, 0.10 * b * tw * s, 0, 1.18 * s, -0.105 * b * tw * s, cfg.chestPlateMat);
      }

      // Collar / Neck & Sculpted Head
      pCyl(root, 0.075 * s, 0.095 * s, 0.10 * s, 0, 1.38 * s, 0, cfg.collarMat || cfg.torsoMat);
      if (cfg.openFace) {
        pSph(root, 0.122 * s, 0, 1.49 * s, 0.015 * s, pal.skin, 0.92, 1.12, 0.98);
        pBox(root, 0.14 * s, 0.032 * s, 0.04 * s, 0, 1.515 * s, 0.115 * s, pal.darkSuit);
        pBox(root, 0.035 * s, 0.045 * s, 0.035 * s, 0, 1.48 * s, 0.125 * s, pal.skin);
      } else {
        pSph(root, 0.132 * s, 0, 1.49 * s, 0.01 * s, cfg.headMat, 0.95, 1.10, 1.02);
      }

      // Shoulders & Arms (posed symmetrically or per-role)
      const shX = 0.265 * b * tw * s;
      const shY = 1.29 * s;
      const armAngles = cfg.armAngles || { lRx: -0.78, lRz: -0.22, rRx: -0.92, rRz: 0.18 };
      for (const side of [-1, 1]) {
        const isLeft = side > 0;
        const rx = isLeft ? armAngles.lRx : armAngles.rRx;
        const rz = isLeft ? armAngles.lRz : armAngles.rRz;
        pSph(root, 0.092 * b * lw * s, side * shX, shY, 0, cfg.pauldronMat, 1.08, 0.95, 1.05);
        if (cfg.heavyPauldron) {
          pSph(root, 0.135 * b * s, side * (shX + 0.035 * b * s), shY + 0.035 * s, 0, cfg.pauldronMat, 1.12, 0.96, 1.24);
          pSph(root, 0.115 * b * s, side * (shX + 0.045 * b * s), shY - 0.02 * s, 0, pal.hull, 1.10, 0.55, 1.26);
        }
        const arm = new THREE.Group();
        arm.position.set(side * shX, shY - 0.02 * s, 0);
        arm.rotation.set(rx, 0, rz);
        pCyl(arm, 0.066 * b * lw * s, 0.056 * b * lw * s, 0.24 * s, 0, -0.13 * s, 0, cfg.armMat);
        pSph(arm, 0.058 * b * lw * s, 0, -0.26 * s, 0, cfg.kneeMat);
        pCyl(arm, 0.058 * b * lw * s, 0.048 * b * lw * s, 0.23 * s, 0, -0.38 * s, 0.03 * s, cfg.armMat, -0.35);
        if (cfg.bracerMat) {
          pBox(arm, 0.105 * b * lw * s, 0.16 * s, 0.075 * b * lw * s, 0, -0.38 * s, 0.07 * s, cfg.bracerMat, -0.35);
        }
        pSph(arm, 0.054 * lw * s, 0, -0.49 * s, 0.075 * s, cfg.gloveMat);
        root.add(arm);
      }
    }

    const wPivot = new THREE.Group();
    if (typeId === 'sledge') {
      wPivot.position.set(-0.24 * s, 1.04 * s, 0.24 * s);
    } else if (typeId === 'flak_trooper') {
      wPivot.position.set(-0.24 * s, 1.38 * s, 0.08 * s);
    } else if (typeId === 'engineer') {
      wPivot.position.set(0.30 * s, 0.88 * s, 0.14 * s);
    } else if (typeId === 'tesla_trooper') {
      wPivot.position.set(-0.30 * s, 0.96 * s, 0.22 * s);
    } else if (typeId === 'rocketeer') {
      wPivot.position.set(-0.32 * s, 0.92 * s, 0.10 * s);
    } else {
      wPivot.position.set(-0.20 * s, 1.04 * s, 0.20 * s);
    }
    root.add(wPivot);
    parts.weaponPivot = wPivot;

    if (typeId === 'gi') {
      // 1:1 Allied GI (infantry_classes.jpg TL): Rich blue M1 helmet & uniform + shoulder gold star + leather webbing + M60 LMG w/ olive ammo box & bipod + deployed staggered sandbags
      buildBipedBase({
        legMat: pal.teamSuit, kneeMat: pal.darkSuit, shinMat: pal.teamSuit, bootMat: pal.leather,
        pelvisMat: pal.teamSuit, beltMat: pal.leather, pouchMat: pal.leather,
        torsoMat: pal.teamSuit, chestPlateMat: pal.hull, pauldronMat: pal.teamSuit,
        armMat: pal.teamSuit, gloveMat: pal.leather, openFace: true,
        armAngles: { lRx: -1.05, lRz: -0.38, rRx: -1.05, rRz: 0.12 }
      });
      // M1 Helmet dome + rim + twin shoulder rank stars
      pSph(root, 0.155 * s, 0, 1.565 * s, -0.005 * s, pal.teamSuit, 1.04, 0.78, 1.08);
      pCyl(root, 0.168 * s, 0.168 * s, 0.042 * s, 0, 1.525 * s, 0.005 * s, pal.teamSuit);
      pBox(root, 0.045, 0.065, 0.055, -0.33, 1.24, 0, pal.gold);
      pBox(root, 0.045, 0.065, 0.055, 0.33, 1.24, 0, pal.gold);
      // Leather chest Y-webbing & tactical backpack
      pBox(root, 0.055, 0.34, 0.26, -0.10, 1.15, 0.01, pal.leather);
      pBox(root, 0.055, 0.34, 0.26, 0.10, 1.15, 0.01, pal.leather);
      pBox(root, 0.30, 0.34, 0.18, 0, 1.14, -0.20, pal.hull);
      // Heavy M60 LMG with olive belt box & folded bipod
      pBox(wPivot, 0.09, 0.13, 0.56, 0.10, 0, 0.24, pal.hull, 0, 0.24, 0);
      pBox(wPivot, 0.12, 0.14, 0.16, -0.02, -0.04, 0.26, pal.olive, 0, 0.24, 0);
      pCyl(wPivot, 0.026, 0.026, 0.48, 0.20, 0.02, 0.68, pal.darkSuit, Math.PI * 0.5, 0, -0.24);
      pCyl(wPivot, 0.014, 0.014, 0.28, 0.14, -0.06, 0.62, pal.darkSuit, 0.35, 0, -0.25);
      pCyl(wPivot, 0.014, 0.014, 0.28, 0.22, -0.06, 0.60, pal.darkSuit, 0.35, 0, 0.25);

      const sb = new THREE.Group();
      for (const [bx, by, bz, ry] of [
        [0, 0.12, 0.64, 0], [-0.34, 0.12, 0.52, 0.42], [0.34, 0.12, 0.52, -0.42],
        [-0.54, 0.12, 0.28, 0.95], [0.54, 0.12, 0.28, -0.95],
        [-0.17, 0.30, 0.60, 0.20], [0.17, 0.30, 0.60, -0.20]
      ]) {
        pBox(sb, 0.38, 0.19, 0.22, bx, by, bz, pal.sandbag, 0, ry, 0);
      }
      sb.visible = false;
      root.add(sb);
      parts.sandbags = sb;
    } else if (typeId === 'conscript') {
      // 1:1 Conscript (infantry_classes.jpg BL): Flared gunmetal steel helmet + long flared greatcoat (matching sleeves & lapels) + leather belt, cross-strap & tall boots + assault rifle
      buildBipedBase({
        legMat: pal.teamSuit, kneeMat: pal.leather, shinMat: pal.leather, bootMat: pal.leather,
        pelvisMat: pal.teamSuit, beltMat: pal.leather, pouchMat: pal.leather,
        torsoMat: pal.teamSuit, chestPlateMat: null, pauldronMat: pal.teamSuit,
        armMat: pal.teamSuit, gloveMat: pal.leather, openFace: true,
        armAngles: { lRx: -1.02, lRz: -0.34, rRx: -0.98, rRz: 0.16 }
      });
      // Iconic full-round flared-brim Red Alert helmet
      pSph(root, 0.154, 0, 1.56, -0.005, pal.hull, 1.04, 0.80, 1.06);
      pCyl(root, 0.180, 0.180, 0.045, 0, 1.52, 0, pal.hull);
      // Long flared trenchcoat tails, standing collar lapels, brown leather cross-strap & dark front coat seam
      pCyl(root, 0.17, 0.19, 0.12, 0, 1.36, -0.01, pal.teamSuit);
      pBox(root, 0.055, 0.44, 0.28, 0, 1.15, 0.01, pal.leather, 0, 0, -0.48);
      pBox(root, 0.042, 0.36, 0.04, 0, 1.14, 0.145, pal.darkSuit);
      pBox(root, 0.42, 0.50, 0.14, 0, 0.65, -0.14, pal.teamSuit, 0.15, 0, 0);
      pBox(root, 0.12, 0.46, 0.26, -0.23, 0.67, -0.02, pal.teamSuit, 0.04, 0, -0.14);
      pBox(root, 0.12, 0.46, 0.26, 0.23, 0.67, -0.02, pal.teamSuit, 0.04, 0, 0.14);
      // Assault rifle w/ upper carry handle & curved magazine
      pBox(wPivot, 0.075, 0.12, 0.54, 0.10, 0.02, 0.22, pal.darkSuit, 0, 0.22, 0);
      pBox(wPivot, 0.045, 0.06, 0.26, 0.10, 0.10, 0.22, pal.hull, 0, 0.22, 0);
      pCyl(wPivot, 0.022, 0.022, 0.34, 0.18, 0.03, 0.60, pal.hull, Math.PI * 0.5, 0, -0.22);
      pBox(wPivot, 0.045, 0.16, 0.075, 0.12, -0.09, 0.30, pal.darkSuit, 0.32, 0.22, 0);
    } else if (typeId === 'flak_trooper') {
      // 1:1 Flak Trooper (infantry_classes.jpg BR-left): Olive steel helmet + visible face + thick gunmetal flak vest & pouches over olive fatigues + level shoulder flak cannon
      buildBipedBase({
        legMat: pal.olive, kneeMat: pal.darkSuit, shinMat: pal.olive, bootMat: pal.darkSuit,
        pelvisMat: pal.olive, beltMat: pal.leather, pouchMat: pal.darkSuit,
        torsoMat: pal.olive, chestPlateMat: pal.hull, pauldronMat: pal.hull,
        armMat: pal.olive, gloveMat: pal.darkSuit, openFace: true,
        armAngles: { lRx: -1.24, lRz: -0.44, rRx: -1.45, rRz: 0.12 }
      });
      pSph(root, 0.156 * s, 0, 1.56 * s, -0.005, pal.olive, 1.04, 0.78, 1.08);
      pCyl(root, 0.168, 0.168, 0.045, 0, 1.52, 0, pal.olive);
      // Extra chest vest pouches & twin drum flak ammunition backpack
      pBox(root, 0.30, 0.14, 0.14, 0, 1.12, 0.14, pal.darkSuit);
      pBox(root, 0.38, 0.44, 0.22, 0, 1.12, -0.20, pal.hull);
      pCyl(root, 0.10, 0.10, 0.40, -0.10, 1.14, -0.28, pal.darkSuit);
      pCyl(root, 0.10, 0.10, 0.40, 0.10, 1.14, -0.28, pal.darkSuit);
      // Level heavy shoulder-mounted wide-bore flak cannon barrel w/ flared muzzle & rear venturi
      pCyl(wPivot, 0.12, 0.12, 1.08, 0, 0.08, 0.16, pal.olive, Math.PI * 0.50);
      pCyl(wPivot, 0.15, 0.15, 0.18, 0, 0.08, 0.72, pal.darkSuit, Math.PI * 0.50);
      pCyl(wPivot, 0.135, 0.105, 0.18, 0, 0.08, -0.40, pal.darkSuit, Math.PI * 0.50);
      pBox(wPivot, 0.08, 0.12, 0.22, 0.12, 0.12, 0.26, pal.gold);
    } else if (typeId === 'engineer') {
      // 1:1 Engineer (infantry_classes.jpg TR-left): Yellow hazmat suit + yellow breastplate w/ dark ribs + silver pauldrons + dark steel toolbox (-X) + large open-jaw silver wrench (+X)
      buildBipedBase({
        legMat: pal.gold, kneeMat: pal.hull, shinMat: pal.gold, bootMat: pal.darkSuit,
        pelvisMat: pal.gold, beltMat: pal.leather, pouchMat: pal.hull,
        torsoMat: pal.gold, chestPlateMat: pal.gold, pauldronMat: pal.silver,
        armMat: pal.gold, gloveMat: pal.darkSuit, headMat: pal.gold, openFace: false,
        armAngles: { lRx: -0.64, lRz: 0.18, rRx: -0.16, rRz: -0.16 }
      });
      // Hazmat Respirator Helmet + Glowing Amber Twin Goggles & Dark Ribbed Abdomen Accents
      pSph(root, 0.155, 0, 1.54, 0, pal.gold, 1.02, 0.94, 1.06);
      pBox(root, 0.16, 0.12, 0.12, 0, 1.44, 0.11, pal.darkSuit);
      pSph(root, 0.042, -0.052, 1.52, 0.135, pal.glowGold, 1.1, 0.85, 0.7);
      pSph(root, 0.042, 0.052, 1.52, 0.135, pal.glowGold, 1.1, 0.85, 0.7);
      pBox(root, 0.24, 0.08, 0.08, 0, 1.00, 0.135, pal.hull);
      // Diagnostic Hazard Backpack
      pBox(root, 0.34, 0.40, 0.20, 0, 1.14, -0.20, pal.darkSuit);
      pBox(root, 0.28, 0.14, 0.22, 0, 1.24, -0.22, pal.hazard);
      // Right hand (-X): True Dark Iron-Grey Heavy Steel Toolbox
      pBox(root, 0.16, 0.28, 0.40, -0.35, 0.74, 0.08, pal.darkSuit);
      pBox(root, 0.17, 0.05, 0.41, -0.35, 0.83, 0.08, pal.silver);
      pBox(root, 0.05, 0.06, 0.14, -0.35, 0.91, 0.08, pal.darkSuit);
      // Left hand (+X / wPivot): Larger Open-Jaw Silver Crescent Wrench
      pCyl(wPivot, 0.036, 0.036, 0.74, 0.04, 0.05, 0.20, pal.silver, Math.PI * 0.28);
      pBox(wPivot, 0.055, 0.13, 0.18, 0.04, 0.28, 0.48, pal.silver, -0.58);
      pBox(wPivot, 0.055, 0.055, 0.14, 0.04, 0.36, 0.56, pal.silver, -0.58);
      pBox(wPivot, 0.055, 0.055, 0.14, 0.04, 0.21, 0.53, pal.silver, -0.58);
    } else if (typeId === 'rocketeer') {
      // 1:1 Rocketeer (infantry_classes.jpg BR-right): Sleek contoured blue flight armor + dark midriff + bright cyan-silver visor + swept flight pose w/ wrist micro-blasters + twin jetpack pods
      buildBipedBase({
        legMat: pal.teamSuit, kneeMat: pal.darkSuit, shinMat: pal.teamSuit, bootMat: pal.hull,
        pelvisMat: pal.darkSuit, beltMat: pal.darkSuit, pouchMat: pal.hull,
        torsoMat: pal.teamSuit, chestPlateMat: pal.teamSuit, pauldronMat: pal.teamSuit,
        armMat: pal.teamSuit, gloveMat: pal.darkSuit, headMat: pal.teamSuit, openFace: false,
        armAngles: { lRx: -0.44, lRz: 0.26, rRx: -0.44, rRz: -0.26 }
      });
      // Aero flight helmet w/ bright reflective cyan-silver faceplate & segmented midriff
      pSph(root, 0.152, 0, 1.54, 0, pal.teamSuit, 0.98, 1.02, 1.12);
      pSph(root, 0.118, 0, 1.52, 0.078, pal.silver, 0.98, 0.92, 0.85);
      pBox(root, 0.145, 0.095, 0.075, 0, 1.535, 0.135, pal.glowCyan);
      pBox(root, 0.26, 0.10, 0.08, 0, 1.01, 0.125, pal.darkSuit);
      // Twin tall contoured jetpack thruster pods & glowing cyan exhaust cones
      pBox(root, 0.38, 0.38, 0.18, 0, 1.18, -0.20, pal.hull);
      for (const tx of [-0.17, 0.17]) {
        pCyl(root, 0.082, 0.095, 0.56, tx, 1.24, -0.26, pal.silver, 0.12);
        pCyl(root, 0.070, 0.105, 0.14, tx, 0.92, -0.30, pal.darkSuit, 0.12);
        pBox(root, 0.032, 0.26, 0.18, tx * 1.35, 1.36, -0.30, pal.teamSuit, 0.12, 0, tx > 0 ? -0.24 : 0.24);
        pCone(root, 0.096, 0.40, tx, 0.66, -0.34, pal.glowCyan, Math.PI + 0.12);
      }
      // Sleek forearm-mounted dual wrist micro-blasters (no clunky rifle!)
      pBox(wPivot, 0.075, 0.085, 0.24, -0.02, -0.02, 0.10, pal.silver);
      pSph(wPivot, 0.035, -0.02, -0.02, 0.24, pal.glowCyan);
      pBox(root, 0.075, 0.085, 0.24, 0.34, 0.90, 0.20, pal.silver);
      pSph(root, 0.035, 0.34, 0.90, 0.34, pal.glowCyan);
    } else if (typeId === 'tesla_trooper') {
      // 1:1 Tesla Trooper (infantry_classes.jpg BC): Massive bulky power armor + oversized domed pauldrons + narrow visor + twin copper Tesla coils + integrated forearm Tesla arc gauntlet & power conduit
      buildBipedBase({
        legMat: pal.hull, kneeMat: pal.teamSuit, shinMat: pal.teamSuit, bootMat: pal.darkSuit,
        pelvisMat: pal.darkSuit, beltMat: pal.hull, pouchMat: pal.teamSuit,
        torsoMat: pal.teamSuit, chestPlateMat: pal.teamSuit, pauldronMat: pal.teamSuit,
        armMat: pal.hull, gloveMat: pal.teamSuit, headMat: pal.teamSuit, heavyPauldron: true, openFace: false,
        armAngles: { lRx: -0.92, lRz: 0.14, rRx: -0.96, rRz: -0.08 }
      });
      // Heavy Domed Armored Helmet + Narrow Glowing Visor Slit
      pSph(root, 0.175 * s, 0, 1.52 * s, 0, pal.teamSuit, 1.06, 0.96, 1.06);
      pBox(root, 0.18 * s, 0.048 * s, 0.08 * s, 0, 1.51 * s, 0.155 * s, pal.glowCyan);
      pBox(root, 0.44 * s, 0.14 * s, 0.34 * s, 0, 1.36 * s, -0.02 * s, pal.hull);
      // Twin Iconic Angled Copper Tesla Coils sprouting V-shaped from Armored Power Pack
      pBox(root, 0.52 * s, 0.48 * s, 0.26 * s, 0, 1.18 * s, -0.24 * s, pal.hull);
      for (const side of [-1, 1]) {
        const coilG = new THREE.Group();
        coilG.position.set(side * 0.18 * s, 1.38 * s, -0.26 * s);
        coilG.rotation.set(-0.24, 0, -side * 0.32);
        pCyl(coilG, 0.068 * s, 0.085 * s, 0.58 * s, 0, 0.28 * s, 0, pal.darkSuit);
        for (let r = 0; r < 4; r++) {
          pTorus(coilG, pal.copper, 0, (0.12 + r * 0.11) * s, 0, 0.22 * s, 0.22 * s, 0.20 * s, Math.PI * 0.5);
        }
        pSph(coilG, 0.085 * s, 0, 0.60 * s, 0, pal.glowGold);
        pSph(coilG, 0.055 * s, 0, 0.68 * s, 0, pal.glowCyan);
        root.add(coilG);
      }
      // Arched high-voltage power conduit cable from backpack to forearm gauntlet
      pCyl(root, 0.036 * s, 0.036 * s, 0.54 * s, -0.34 * s, 1.06 * s, -0.04 * s, pal.darkSuit, 1.05, 0, 0.24);
      // Integrated Forearm Tesla Arc Gauntlet (snugly fitted onto forearm instead of floating long gun)
      pCyl(wPivot, 0.105 * s, 0.115 * s, 0.34 * s, -0.02 * s, 0, 0.06 * s, pal.hull, Math.PI * 0.5);
      pTorus(wPivot, pal.copper, -0.02 * s, 0, 0.10 * s, 0.26 * s, 0.26 * s, 0.22 * s);
      pTorus(wPivot, pal.copper, -0.02 * s, 0, 0.20 * s, 0.24 * s, 0.24 * s, 0.22 * s);
      pSph(wPivot, 0.095 * s, -0.02 * s, 0, 0.28 * s, pal.glowCyan);
    } else if (typeId === 'chrono') {
      // 1:1 Chrono Legionnaire (infantry_classes.jpg TC): Sleek lean silver-white & blue futuristic exo-suit + glowing oval cyan visor + chest arc core + spinning chrono gyro + chrono beam rifle
      buildBipedBase({
        legMat: pal.silver, kneeMat: pal.teamSuit, shinMat: pal.whiteMed, shinPlateMat: pal.teamSuit, bootMat: pal.silver,
        pelvisMat: pal.teamSuit, beltMat: pal.silver, pouchMat: pal.teamSuit,
        torsoMat: pal.whiteMed, chestPlateMat: pal.silver, pauldronMat: pal.teamSuit,
        armMat: pal.whiteMed, gloveMat: pal.silver, headMat: pal.whiteMed, openFace: false,
        limbScale: 0.80, torsoScale: 0.88,
        armAngles: { lRx: -1.04, lRz: -0.34, rRx: -0.96, rRz: 0.16 }
      });
      // Sleek Futuristic Helmet w/ Large Oval Glowing Cyan Faceplate + Chest Core Node
      pSph(root, 0.144, 0, 1.54, 0, pal.whiteMed, 0.94, 1.04, 1.06);
      pSph(root, 0.105, 0, 1.53, 0.075, pal.glowCyan, 0.88, 1.05, 0.72);
      pCyl(root, 0.095, 0.095, 0.055, 0, 1.20, 0.155, pal.glowCyan, Math.PI * 0.5);
      // Large Circular Chrono Sphere & Gyro Backpack
      pCyl(root, 0.22, 0.22, 0.16, 0, 1.18, -0.22, pal.silver, Math.PI * 0.5);
      const cGyro = new THREE.Group();
      cGyro.position.set(0, 1.18, -0.30);
      pTorus(cGyro, pal.glowCyan, 0, 0, 0, 0.52, 0.52, 0.45);
      const cCore = pSph(cGyro, 0.14, 0, 0, 0, pal.glowCyan);
      root.add(cGyro);
      parts.rotor = cGyro;
      parts.glowMesh = cCore;
      // Sleek Silver-Dark Chrono Beam Rifle w/ Cyan Rails
      pBox(wPivot, 0.085, 0.11, 0.82, 0.08, 0.02, 0.34, pal.silver, 0, 0.18, 0);
      pBox(wPivot, 0.04, 0.05, 0.62, 0.11, 0.06, 0.42, pal.glowCyan, 0, 0.18, 0);
      pSph(wPivot, 0.065, 0.16, 0.02, 0.76, pal.glowCyan);
    } else if (typeId === 'shadow') {
      // 1:1 Shadow Commando (infantry_classes.jpg TR-right): Lean matte black stealth suit & balaclava + vibrant blue chest/shoulder/forearm/shin plates + wide tactical dual-wield suppressed pistols
      buildBipedBase({
        legMat: pal.darkSuit, kneeMat: pal.teamSuit, shinMat: pal.darkSuit, shinPlateMat: pal.teamSuit, bootMat: pal.darkSuit,
        pelvisMat: pal.darkSuit, beltMat: pal.leather, pouchMat: pal.darkSuit,
        torsoMat: pal.darkSuit, chestPlateMat: pal.teamSuit, pauldronMat: pal.teamSuit,
        armMat: pal.darkSuit, bracerMat: pal.teamSuit, gloveMat: pal.darkSuit, headMat: pal.darkSuit, openFace: false,
        limbScale: 0.88, torsoScale: 0.94,
        armAngles: { lRx: -1.06, lRz: 0.28, rRx: -1.06, rRz: -0.28 }
      });
      // Black balaclava w/ narrow tactical eye-slit
      pSph(root, 0.130 * s, 0, 1.50 * s, 0.01, pal.darkSuit, 0.94, 1.08, 1.02);
      pBox(root, 0.11 * s, 0.028 * s, 0.045 * s, 0, 1.515 * s, 0.125 * s, pal.skin);
      pBox(root, 0.022 * s, 0.032 * s, 0.05 * s, 0, 1.515 * s, 0.128 * s, pal.darkSuit);
      // Right suppressed tactical pistol in wPivot (held out wide & angled cleanly forward)
      pBox(wPivot, 0.055, 0.10, 0.28, -0.18, 0.02, 0.14, pal.darkSuit, 0, -0.16, 0);
      pBox(wPivot, 0.05, 0.12, 0.065, -0.16, -0.07, 0.02, pal.hull, -0.2, -0.16, 0);
      pCyl(wPivot, 0.032, 0.032, 0.24, -0.22, 0.03, 0.38, pal.silver, Math.PI * 0.5, 0, 0.16);
      // Left suppressed tactical pistol
      pBox(root, 0.055, 0.10, 0.28, 0.36, 1.06, 0.34, pal.darkSuit, 0, 0.16, 0);
      pBox(root, 0.05, 0.12, 0.065, 0.34, 0.97, 0.22, pal.hull, -0.2, 0.16, 0);
      pCyl(root, 0.032, 0.032, 0.24, 0.40, 1.07, 0.58, pal.silver, Math.PI * 0.5, 0, -0.16);
    } else if (typeId === 'sledge') {
      // 1:1 Hero Sledge (roster_hero_air_support_1794749281119.jpg TL): Towering power armor + cyan T-visor & chest core + chamfered forward-angled yellow riot shield + raised 6-barrel gatling minigun
      buildBipedBase({
        legMat: pal.hull, kneeMat: pal.teamSuit, shinMat: pal.teamSuit, bootMat: pal.darkSuit,
        pelvisMat: pal.darkSuit, beltMat: pal.hull, pouchMat: pal.hull,
        torsoMat: pal.teamSuit, chestPlateMat: pal.teamSuit, pauldronMat: pal.teamSuit,
        armMat: pal.hull, gloveMat: pal.darkSuit, headMat: pal.teamSuit, heavyPauldron: true, openFace: false,
        armAngles: { lRx: -0.95, lRz: -0.10, rRx: -1.05, rRz: 0.24 }
      });
      // Heavy Domed Helmet + Glowing Cyan T-Visor & Glowing Arc Chest Reactor Core
      pSph(root, 0.168 * s, 0, 1.52 * s, 0, pal.teamSuit, 1.05, 0.96, 1.08);
      pBox(root, 0.18 * s, 0.042 * s, 0.07 * s, 0, 1.52 * s, 0.155 * s, pal.glowCyan);
      pBox(root, 0.048 * s, 0.095 * s, 0.07 * s, 0, 1.48 * s, 0.155 * s, pal.glowCyan);
      pCyl(root, 0.115 * s, 0.115 * s, 0.06 * s, 0, 1.18 * s, 0.195 * s, pal.darkSuit, Math.PI * 0.5);
      pCyl(root, 0.082 * s, 0.082 * s, 0.075 * s, 0, 1.18 * s, 0.205 * s, pal.glowCyan, Math.PI * 0.5);
      // Twin Vertical Armored Exhaust Stacks on Backpack
      pBox(root, 0.54 * s, 0.46 * s, 0.26 * s, 0, 1.18 * s, -0.24 * s, pal.hull);
      pCyl(root, 0.065 * s, 0.075 * s, 0.38 * s, -0.18 * s, 1.52 * s, -0.26 * s, pal.darkSuit);
      pCyl(root, 0.065 * s, 0.075 * s, 0.38 * s, 0.18 * s, 1.52 * s, -0.26 * s, pal.darkSuit);

      // Left Arm (+X side): Massive Battered Yellow Ballistic Riot Shield w/ upper bevel & diagonal ribs
      const shield = new THREE.Group();
      shield.position.set(0.46 * s, 1.06 * s, 0.26 * s);
      shield.rotation.set(-0.08, -1.12, 0);
      pBox(shield, 0.10 * s, 1.14 * s, 0.66 * s, 0, 0, 0, pal.gold);
      pBox(shield, 0.11 * s, 0.24 * s, 0.48 * s, 0, 0.60 * s, 0, pal.gold, 0.12);
      pBox(shield, 0.125 * s, 0.09 * s, 0.52 * s, 0, 0.70 * s, 0, pal.hull);
      pBox(shield, 0.12 * s, 0.11 * s, 0.70 * s, 0, -0.54 * s, 0, pal.hull);
      pBox(shield, 0.12 * s, 1.06 * s, 0.085 * s, 0, 0, -0.31 * s, pal.hull);
      pBox(shield, 0.12 * s, 1.06 * s, 0.085 * s, 0, 0, 0.31 * s, pal.hull);
      pBox(shield, 0.13 * s, 0.11 * s, 0.36 * s, 0.02 * s, 0.34 * s, 0, pal.darkSuit);
      pBox(shield, 0.125 * s, 0.08 * s, 0.50 * s, 0.015 * s, -0.22 * s, 0, pal.hazard);
      root.add(shield);

      // Giant Raised 6-Barrel Rotary Gatling Minigun & Heavy Drum Magazine in wPivot
      pBox(wPivot, 0.18 * s, 0.22 * s, 0.44 * s, 0.06 * s, 0, 0.16 * s, pal.hull, 0, 0.26, 0);
      pCyl(wPivot, 0.15 * s, 0.15 * s, 0.22 * s, 0.04 * s, -0.18 * s, 0.18 * s, pal.darkSuit, 0, 0.26, Math.PI * 0.5);
      pCyl(wPivot, 0.11 * s, 0.11 * s, 0.06 * s, 0.20 * s, 0, 0.64 * s, pal.trim, Math.PI * 0.5, 0, -0.26);
      pCyl(wPivot, 0.11 * s, 0.11 * s, 0.06 * s, 0.25 * s, 0, 0.84 * s, pal.trim, Math.PI * 0.5, 0, -0.26);
      for (let bi = 0; bi < 6; bi++) {
        const ang = (bi / 6) * Math.PI * 2;
        const bx = Math.cos(ang) * 0.068 * s;
        const by = Math.sin(ang) * 0.068 * s;
        pCyl(wPivot, 0.020 * s, 0.020 * s, 0.62 * s, 0.20 * s + bx, by, 0.66 * s, pal.darkSuit, Math.PI * 0.5, 0, -0.26);
      }
    }

    return { root, parts };
  }

  // === 2. TANK / ARMOR / VEHICLE BUILDER (8 types, articulated MBT + Hero MCV) ===
  function buildVehicle(typeId, pal) {
    const root = new THREE.Group();
    const parts = { turret: null, barrel: null, v3Rocket: null, rollers: null, oreFill: null, rotor: null };

    if ((typeId === 'grizzly' || typeId === 'rhino' || typeId === 'apocalypse') && glbTemplates.tank) {
      const tankClone = SkeletonUtils.clone(glbTemplates.tank);
      const scaleMap = { grizzly: 0.255, rhino: 0.285, apocalypse: 0.345 };
      const s = scaleMap[typeId] ?? 0.26;

      tankClone.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        const n = (o.name || '').toLowerCase();
        if (n.includes('track') || n.includes('gun')) o.material = pal.dark;
        else if (n.includes('turret')) o.material = pal.team;
        else o.material = pal.hull;
      });

      tankClone.updateMatrixWorld(true);
      const fullBox = new THREE.Box3().setFromObject(tankClone);
      const fullCtr = new THREE.Vector3();
      fullBox.getCenter(fullCtr);

      const modelWrap = new THREE.Group();
      tankClone.position.set(-fullCtr.x, -fullBox.min.y, -fullCtr.z);
      modelWrap.add(tankClone);
      modelWrap.rotation.y = Math.PI * 0.5;
      modelWrap.scale.setScalar(s);
      root.add(modelWrap);
      root.updateMatrixWorld(true);

      const rawTurret = tankClone.getObjectByName('Tank_Turret');
      const rawGun = tankClone.getObjectByName('Tank_Gun');
      if (rawTurret) {
        const tBox = getBoxInParentSpace(rawTurret, root);
        const tPivot = new THREE.Group();
        tPivot.position.set((tBox.min.x + tBox.max.x) * 0.5, 0, (tBox.min.z + tBox.max.z) * 0.5);
        root.add(tPivot);
        root.updateMatrixWorld(true);
        tPivot.attach(rawTurret);
        if (rawGun) tPivot.attach(rawGun);

        if (typeId === 'apocalypse') {
          const bY = tBox.max.y * 0.68;
          addCyl(tPivot, 0.11, 0.12, 2.45, -0.34, bY, 1.48, pal.dark, Math.PI * 0.5);
          addCyl(tPivot, 0.11, 0.12, 2.45, 0.34, bY, 1.48, pal.dark, Math.PI * 0.5);
          addBox(tPivot, 0.92, 0.28, 0.42, 0, bY, 0.58, pal.hull);
          addBox(tPivot, 1.24, 0.44, 0.78, 0, tBox.max.y + 0.20, -0.38, pal.team);
          addBox(tPivot, 0.16, 0.16, 0.68, -0.40, tBox.max.y + 0.20, 0.08, pal.glowRed);
          addBox(tPivot, 0.16, 0.16, 0.68, 0.40, tBox.max.y + 0.20, 0.08, pal.glowRed);
        } else if (typeId === 'rhino') {
          addBox(tPivot, 0.96, 0.26, 0.78, 0, tBox.max.y + 0.12, -0.24, pal.hull);
          addBox(tPivot, 0.36, 0.18, 0.36, -0.24, tBox.max.y + 0.28, -0.18, pal.team);
        } else {
          addCyl(tPivot, 0.16, 0.18, 0.18, 0.24, tBox.max.y + 0.08, -0.16, pal.hull);
          addCyl(tPivot, 0.02, 0.02, 0.72, -0.32, tBox.max.y + 0.34, -0.32, pal.trim);
        }
        parts.turret = tPivot;
      }

      if (typeId === 'apocalypse') {
        addBox(root, 2.55, 0.42, 0.54, 0, 0.34, 1.88, pal.hazard, 0.22);
        addBox(root, 0.26, 0.54, 3.35, -1.24, 0.42, 0, pal.hull);
        addBox(root, 0.26, 0.54, 3.35, 1.24, 0.42, 0, pal.hull);
      } else if (typeId === 'rhino') {
        addBox(root, 1.85, 0.26, 0.42, 0, 0.44, 1.62, pal.hazard, 0.30);
        addCyl(root, 0.18, 0.18, 0.85, -0.52, 0.78, -1.52, pal.dark, 0, 0, Math.PI * 0.5);
        addCyl(root, 0.18, 0.18, 0.85, 0.52, 0.78, -1.52, pal.dark, 0, 0, Math.PI * 0.5);
      } else {
        addBox(root, 0.18, 0.36, 2.55, -0.96, 0.38, 0, pal.team);
        addBox(root, 0.18, 0.36, 2.55, 0.96, 0.38, 0, pal.team);
      }
      return { root, parts };
    }

    if (typeId === 'grizzly' || typeId === 'rhino' || typeId === 'apocalypse') {
      const sc = typeId === 'apocalypse' ? 1.32 : (typeId === 'rhino' ? 1.12 : 1.0);
      addBox(root, 0.52 * sc, 0.56 * sc, 2.75 * sc, -0.88 * sc, 0.28 * sc, 0, pal.dark);
      addBox(root, 0.52 * sc, 0.56 * sc, 2.75 * sc, 0.88 * sc, 0.28 * sc, 0, pal.dark);
      addBox(root, 1.48 * sc, 0.52 * sc, 2.48 * sc, 0, 0.58 * sc, 0, pal.team);
      addBox(root, 1.44 * sc, 0.34 * sc, 0.56 * sc, 0, 0.64 * sc, 1.12 * sc, pal.hull, 0.34);

      const turret = new THREE.Group();
      turret.position.set(0, 0.92 * sc, -0.1 * sc);
      addBox(turret, 1.18 * sc, 0.44 * sc, 1.34 * sc, 0, 0.22 * sc, -0.05 * sc, pal.team);
      addBox(turret, 0.85 * sc, 0.16 * sc, 0.88 * sc, 0, 0.46 * sc, -0.1 * sc, pal.trim);
      if (typeId === 'apocalypse') {
        addCyl(turret, 0.10 * sc, 0.11 * sc, 2.05 * sc, -0.26 * sc, 0.24 * sc, 1.28 * sc, pal.dark, Math.PI * 0.5);
        addCyl(turret, 0.10 * sc, 0.11 * sc, 2.05 * sc, 0.26 * sc, 0.24 * sc, 1.28 * sc, pal.dark, Math.PI * 0.5);
        addBox(turret, 1.05 * sc, 0.34 * sc, 0.55 * sc, 0, 0.62 * sc, -0.45 * sc, pal.dark);
      } else {
        addCyl(turret, 0.09 * sc, 0.10 * sc, 1.85 * sc, 0, 0.24 * sc, 1.18 * sc, pal.dark, Math.PI * 0.5);
      }
      root.add(turret);
      parts.turret = turret;
    } else if (typeId === 'ifv') {
      addBox(root, 1.48, 0.62, 2.38, 0, 0.56, -0.08, pal.team);
      addGeo(root, slopedCabGeo, pal.hull, 1.42, 0.62, 0.72, 0, 0.60, 1.22);
      addBox(root, 1.26, 0.24, 0.56, 0, 0.86, 0.88, pal.glass, 0.35);
      addBox(root, 1.56, 0.16, 0.24, 0, 0.38, 1.52, pal.hazard);
      for (const z of [-0.82, 0, 0.82]) {
        for (const sx of [-1, 1]) {
          addCyl(root, 0.34, 0.34, 0.28, sx * 0.82, 0.34, z, pal.dark, 0, 0, Math.PI * 0.5);
          addCyl(root, 0.16, 0.16, 0.31, sx * 0.82, 0.34, z, pal.hull, 0, 0, Math.PI * 0.5);
        }
      }
      const turret = new THREE.Group();
      turret.position.set(0, 1.02, -0.2);
      addBox(turret, 0.68, 0.38, 0.74, 0, 0.18, 0, pal.hull);
      addCyl(turret, 0.14, 0.14, 0.72, -0.28, 0.32, 0.1, pal.trim, Math.PI * 0.5);
      addCyl(turret, 0.14, 0.14, 0.72, 0.28, 0.32, 0.1, pal.trim, Math.PI * 0.5);
      root.add(turret);
      parts.turret = turret;
    } else if (typeId === 'v3') {
      addBox(root, 0.44, 0.50, 3.25, -0.84, 0.26, 0, pal.dark);
      addBox(root, 0.44, 0.50, 3.25, 0.84, 0.26, 0, pal.dark);
      addBox(root, 1.46, 0.54, 3.05, 0, 0.56, 0, pal.team);
      addGeo(root, slopedCabGeo, pal.hull, 1.38, 0.58, 0.92, 0, 0.98, 1.02);
      addBox(root, 1.18, 0.24, 0.22, 0, 1.12, 1.36, pal.glass);
      addBox(root, 0.26, 0.52, 0.32, -0.96, 0.28, -1.35, pal.hazard);
      addBox(root, 0.26, 0.52, 0.32, 0.96, 0.28, -1.35, pal.hazard);
      const rail = new THREE.Group();
      rail.position.set(0, 1.12, -0.35);
      rail.rotation.x = -0.34;
      addBox(rail, 0.68, 0.18, 2.35, 0, 0, 0.1, pal.dark);
      const rocket = new THREE.Group();
      addCyl(rocket, 0.24, 0.24, 2.35, 0, 0.26, 0.2, pal.trim, Math.PI * 0.5);
      addCone(rocket, 0.25, 0.72, 0, 0.26, 1.62, pal.glowRed, Math.PI * 0.5);
      rail.add(rocket);
      root.add(rail);
      parts.turret = rail;
      parts.v3Rocket = rocket;
    } else if (typeId === 'prism') {
      addBox(root, 0.44, 0.46, 2.55, -0.80, 0.25, 0, pal.dark);
      addBox(root, 0.44, 0.46, 2.55, 0.80, 0.25, 0, pal.dark);
      addBox(root, 1.42, 0.48, 2.35, 0, 0.52, 0, pal.team);
      addGeo(root, slopedCabGeo, pal.hull, 1.36, 0.34, 0.56, 0, 0.58, 1.15);
      const turret = new THREE.Group();
      turret.position.set(0, 0.88, -0.05);
      addOct(turret, 0.56, 0.42, 0, 0.21, 0, pal.hull);
      addBox(turret, 0.24, 0.68, 0.46, 0, 0.72, -0.1, pal.trim, 0.24);
      addCyl(turret, 0.30, 0.34, 0.22, 0, 0.94, 0.18, pal.copper, 0.35);
      const orb = addSphere(turret, 0.28, 0, 1.05, 0.22, pal.glowCyan);
      parts.rotor = orb;
      root.add(turret);
      parts.turret = turret;
    } else if (typeId === 'harvester') {
      addBox(root, 0.50, 0.56, 2.75, -0.94, 0.28, -0.1, pal.dark);
      addBox(root, 0.50, 0.56, 2.75, 0.94, 0.28, -0.1, pal.dark);
      addBox(root, 1.68, 0.60, 2.52, 0, 0.62, -0.1, pal.team);
      addGeo(root, slopedCabGeo, pal.gold, 1.42, 0.58, 0.88, 0, 1.14, 0.55);
      addBox(root, 1.24, 0.22, 0.16, 0, 1.22, 0.96, pal.glass);
      addBox(root, 1.72, 0.24, 0.22, 0, 0.44, 1.22, pal.hazard);
      addBox(root, 1.52, 0.58, 1.48, 0, 1.05, -0.68, pal.hull);
      const oreFill = addBox(root, 1.26, 0.36, 1.18, 0, 1.24, -0.68, pal.glowGold);
      oreFill.scale.y = 0.05;
      parts.oreFill = oreFill;
      const rollers = new THREE.Group();
      rollers.position.set(0, 0.44, 1.42);
      addCyl(rollers, 0.38, 0.38, 1.78, 0, 0, 0, pal.hazard, 0, 0, Math.PI * 0.5);
      addBox(rollers, 1.84, 0.60, 0.18, 0, 0, 0, pal.dark);
      root.add(rollers);
      parts.rollers = rollers;
    } else if (typeId === 'mcv') {
      // Heavy 8x8 Mobile Construction Vehicle — Armored Command Tractor + Stowed Outriggers + Trussed Crane
      addBox(root, 1.88, 0.36, 4.18, 0, 0.42, -0.02, pal.dark);
      addBox(root, 2.02, 0.28, 3.85, 0, 0.68, -0.02, pal.hull);
      addBox(root, 2.08, 0.32, 0.32, 0, 0.46, 2.12, pal.hazard);
      addBox(root, 1.98, 0.28, 0.26, 0, 0.50, -2.14, pal.hazard);

      // 8 heavy off-road tires with recessed wheel hubs & upper fenders
      for (const z of [-1.46, -0.52, 0.42, 1.38]) {
        for (const sx of [-1, 1]) {
          addCyl(root, 0.42, 0.42, 0.34, sx * 1.08, 0.42, z, pal.dark, 0, 0, Math.PI * 0.5);
          addCyl(root, 0.21, 0.21, 0.38, sx * 1.08, 0.42, z, pal.hull, 0, 0, Math.PI * 0.5);
          addBox(root, 0.34, 0.12, 0.72, sx * 1.08, 0.88, z, pal.hull);
        }
      }

      // 4 side-stowed hydraulic outrigger jack legs (echoing the deployed Conyard anchors)
      for (const [ox, oz] of [[-1.16, 0.90], [1.16, 0.90], [-1.16, -0.98], [1.16, -0.98]]) {
        addBox(root, 0.24, 0.48, 0.32, ox, 0.64, oz, pal.dark, 0, 0, ox < 0 ? 0.25 : -0.25);
        addBox(root, 0.28, 0.14, 0.36, ox * 1.05, 0.44, oz, pal.hazard);
      }

      // Sloped armored forward Command Cab + panoramic windshield & twin warm headlights
      addGeo(root, slopedCabGeo, pal.team, 1.82, 0.88, 1.24, 0, 1.18, 1.36);
      addBox(root, 1.56, 0.28, 0.18, 0, 1.28, 1.94, pal.glass, -0.18);
      addBox(root, 0.14, 0.34, 0.20, 0, 1.28, 1.96, pal.hull, -0.18);
      addSphere(root, 0.11, -0.66, 0.68, 2.08, pal.glowGold);
      addSphere(root, 0.11, 0.66, 0.68, 2.08, pal.glowGold);

      // Dual chrome/dark vertical exhaust stacks behind cab
      addCyl(root, 0.08, 0.10, 1.05, -0.78, 1.58, 0.62, pal.dark);
      addCyl(root, 0.08, 0.10, 1.05, 0.78, 1.58, 0.62, pal.dark);

      // Rear heavy fabrication module + armored side louver ribs + folded gantry crane boom
      addBox(root, 1.88, 0.92, 2.38, 0, 1.24, -0.68, pal.team);
      addBox(root, 1.96, 0.18, 2.15, 0, 1.48, -0.68, pal.hull);
      addBox(root, 0.24, 0.56, 1.65, -0.98, 1.22, -0.68, pal.dark);
      addBox(root, 0.24, 0.56, 1.65, 0.98, 1.22, -0.68, pal.dark);
      addBox(root, 0.46, 0.34, 2.55, 0, 1.86, -0.45, pal.hazard);
      addBox(root, 0.56, 0.38, 0.68, 0, 1.92, 0.65, pal.gold);
      addBox(root, 0.68, 0.44, 0.72, 0, 1.94, -1.65, pal.dark);

      // Spinning rooftop radar scanner + warm strobe beacon
      const mcvRadar = new THREE.Group();
      mcvRadar.position.set(0, 1.86, 1.18);
      addCyl(mcvRadar, 0.10, 0.12, 0.24, 0, 0.10, 0, pal.hull);
      addBox(mcvRadar, 0.85, 0.12, 0.18, 0, 0.26, 0, pal.trim);
      root.add(mcvRadar);
      parts.rotor = mcvRadar;
      addSphere(root, 0.12, -0.62, 1.72, 1.18, pal.glowGold);
    }

    return { root, parts };
  }

  // === 3. AIRCRAFT BUILDER (4 types) ===
  function buildAircraft(typeId, pal) {
    const root = new THREE.Group();
    const parts = { rotor: null, rotorL: null, rotorR: null };

    if (typeId === 'nighthawk') {
      addCyl(root, 0.34, 0.44, 2.55, 0, 0.68, 0.05, pal.hull, Math.PI * 0.5);
      addSphere(root, 0.38, 0, 0.72, 1.15, pal.glass, 0.92, 0.78, 1.35);
      addBox(root, 0.24, 0.22, 0.52, 0, 0.42, 1.25, pal.dark);
      addCyl(root, 0.12, 0.20, 1.85, 0, 0.80, -1.55, pal.dark, Math.PI * 0.5);
      addBox(root, 0.08, 0.58, 0.42, -0.35, 0.98, -2.35, pal.team, 0, 0, -0.2);
      addBox(root, 0.08, 0.58, 0.42, 0.35, 0.98, -2.35, pal.team, 0, 0, 0.2);
      addGeo(root, tailWingGeo, pal.team, 1.25, 1.0, 0.85, 0, 0.55, 0.15);
      const rotor = new THREE.Group();
      rotor.position.set(0, 1.14, 0.12);
      addCyl(rotor, 0.16, 0.18, 0.26, 0, -0.06, 0, pal.hull);
      addBox(rotor, 4.1, 0.035, 0.19, 0, 0.06, 0, pal.dark);
      addBox(rotor, 0.19, 0.035, 4.1, 0, 0.06, 0, pal.dark);
      root.add(rotor);
      parts.rotor = rotor;
    } else if (typeId === 'stormhawk') {
      addCyl(root, 0.22, 0.32, 2.75, 0, 0.46, 0, pal.hull, Math.PI * 0.5);
      addCone(root, 0.22, 0.85, 0, 0.46, 1.75, pal.team, Math.PI * 0.5);
      addSphere(root, 0.22, 0, 0.62, 0.65, pal.glass, 0.88, 0.72, 2.0);
      addGeo(root, jetWingGeo, pal.team, 1.0, 1.0, 1.0, 0, 0.44, 0.05);
      addGeo(root, tailWingGeo, pal.hull, 1.0, 1.0, 1.0, 0, 0.46, -1.15);
      addCyl(root, 0.06, 0.06, 0.72, -0.85, 0.34, -0.15, pal.trim, Math.PI * 0.5);
      addCyl(root, 0.06, 0.06, 0.72, 0.85, 0.34, -0.15, pal.trim, Math.PI * 0.5);
      addBox(root, 0.09, 0.54, 0.42, -0.44, 0.74, -1.18, pal.trim, 0, 0, -0.24);
      addBox(root, 0.09, 0.54, 0.42, 0.44, 0.74, -1.18, pal.trim, 0, 0, 0.24);
      addSphere(root, 0.15, -0.18, 0.44, -1.36, pal.glowCyan);
      addSphere(root, 0.15, 0.18, 0.44, -1.36, pal.glowCyan);
    } else if (typeId === 'crimson_mig') {
      addCyl(root, 0.25, 0.34, 2.95, 0, 0.48, 0, pal.hull, Math.PI * 0.5);
      addCone(root, 0.24, 0.92, 0, 0.48, 1.88, pal.team, Math.PI * 0.5);
      addSphere(root, 0.22, 0, 0.64, 0.72, pal.glass, 0.85, 0.72, 1.9);
      addGeo(root, jetWingGeo, pal.team, 1.08, 1.0, 1.12, 0, 0.46, 0.05);
      addGeo(root, tailWingGeo, pal.trim, 1.0, 1.0, 1.0, 0, 0.48, -1.25);
      addCyl(root, 0.07, 0.07, 0.78, -0.92, 0.36, -0.15, pal.dark, Math.PI * 0.5);
      addCyl(root, 0.07, 0.07, 0.78, 0.92, 0.36, -0.15, pal.dark, Math.PI * 0.5);
      addBox(root, 0.09, 0.62, 0.46, -0.38, 0.78, -1.25, pal.team, 0, 0, -0.25);
      addBox(root, 0.09, 0.62, 0.46, 0.38, 0.78, -1.25, pal.team, 0, 0, 0.25);
      addSphere(root, 0.17, -0.20, 0.46, -1.46, pal.glowGold);
      addSphere(root, 0.17, 0.20, 0.46, -1.46, pal.glowGold);
    } else if (typeId === 'kirov') {
      // Iconic Heavy Armored Airship with Hazard Prow & Slung Bomb Gondola
      addSphere(root, 1.55, 0, 2.38, 0, pal.team, 0.96, 0.96, 2.25);
      addSphere(root, 1.58, 0, 2.38, 0.35, pal.hull, 0.99, 0.99, 0.48);
      addSphere(root, 1.52, 0, 2.38, -0.95, pal.hull, 0.96, 0.96, 0.34);
      addSphere(root, 1.48, 0, 2.38, 1.88, pal.hazard, 0.85, 0.85, 0.52);
      addCone(root, 0.45, 0.65, 0, 2.38, 3.25, pal.dark, Math.PI * 0.5);
      addBox(root, 0.16, 1.95, 1.65, 0, 3.15, -2.55, pal.team);
      addBox(root, 0.16, 1.35, 1.25, 0, 1.55, -2.55, pal.hull);
      addBox(root, 2.65, 0.14, 1.55, 0, 2.38, -2.55, pal.team);
      addBox(root, 0.84, 0.72, 2.85, 0, 0.65, 0.15, pal.hull);
      addBox(root, 0.72, 0.28, 0.58, 0, 0.78, 1.46, pal.glass);
      addBox(root, 0.58, 0.16, 1.35, 0, 0.28, 0.05, pal.hazard);
      addCyl(root, 0.24, 0.28, 0.85, -1.18, 0.88, -0.25, pal.dark, Math.PI * 0.5);
      addCyl(root, 0.24, 0.28, 0.85, 1.18, 0.88, -0.25, pal.dark, Math.PI * 0.5);
      const rL = addBox(root, 0.08, 1.05, 0.16, -1.18, 0.88, -0.72, pal.gold);
      const rR = addBox(root, 0.08, 1.05, 0.16, 1.18, 0.88, -0.72, pal.gold);
      parts.rotorL = rL;
      parts.rotorR = rR;
    }

    return { root, parts };
  }

  // === 4. NAVAL VESSEL BUILDER (7 types) ===
  function buildNaval(typeId, pal) {
    const root = new THREE.Group();
    const parts = { turret: null, rotor: null, submarineHull: null };

    if (typeId === 'hover_transport') {
      addBox(root, 2.78, 0.52, 4.18, 0, 0.28, 0, pal.dark);
      addBox(root, 2.35, 0.24, 3.65, 0, 0.64, 0, pal.hull);
      addBox(root, 0.28, 0.44, 3.45, -1.12, 0.94, -0.1, pal.team);
      addBox(root, 0.28, 0.44, 3.45, 1.12, 0.94, -0.1, pal.team);
      addBox(root, 1.85, 0.16, 0.65, 0, 0.72, 1.92, pal.hazard, 0.28);
      addCyl(root, 0.52, 0.52, 0.48, -0.78, 1.25, -1.45, pal.hull, Math.PI * 0.5);
      addCyl(root, 0.52, 0.52, 0.48, 0.78, 1.25, -1.45, pal.hull, Math.PI * 0.5);
    } else if (typeId === 'dolphin') {
      addSphere(root, 0.44, 0, 0.26, 0, pal.hull, 0.75, 0.72, 2.35);
      addBox(root, 0.14, 0.56, 0.36, 0, 0.64, -0.05, pal.team, -0.35);
      addBox(root, 1.05, 0.12, 0.42, 0, 0.28, -1.08, pal.hull);
      const sonar = addCyl(root, 0.24, 0.24, 0.16, 0, 0.68, 0.32, pal.glowCyan);
      parts.rotor = sonar;
    } else if (typeId === 'sea_scorpion') {
      addBox(root, 0.58, 0.55, 3.25, -0.68, 0.25, 0, pal.hull);
      addBox(root, 0.58, 0.55, 3.25, 0.68, 0.25, 0, pal.hull);
      addBox(root, 1.85, 0.36, 2.85, 0, 0.58, -0.08, pal.team);
      addBox(root, 0.95, 0.55, 0.98, 0, 0.96, -0.45, pal.hull);
      addBox(root, 0.85, 0.22, 0.28, 0, 1.08, 0.04, pal.glass);
      const turret = new THREE.Group();
      turret.position.set(0, 0.92, 0.65);
      addBox(turret, 0.72, 0.42, 0.72, 0, 0.18, 0, pal.trim);
      addCyl(turret, 0.08, 0.09, 1.15, -0.18, 0.28, 0.48, pal.dark, Math.PI * 0.32);
      addCyl(turret, 0.08, 0.09, 1.15, 0.18, 0.28, 0.48, pal.dark, Math.PI * 0.32);
      root.add(turret);
      parts.turret = turret;
    } else if (typeId === 'aegis') {
      addBox(root, 1.92, 0.78, 4.35, 0, 0.36, -0.2, pal.hull);
      addGeo(root, shipBowGeo, pal.hull, 1, 1, 1, 0, -0.02, 1.96);
      addBox(root, 1.58, 0.20, 3.95, 0, 0.82, -0.18, pal.team);
      addBox(root, 1.24, 1.04, 1.52, 0, 1.40, 0.12, pal.trim);
      addBox(root, 1.32, 0.38, 0.62, 0, 1.65, 0.55, pal.glass);
      addBox(root, 0.96, 0.12, 1.12, 0, 0.94, -1.55, pal.dark);
      addBox(root, 0.26, 1.05, 0.26, 0, 2.35, 0.02, pal.hull);
      addSphere(root, 0.32, 0, 2.75, 0.02, pal.trim);
      const turret = new THREE.Group();
      turret.position.set(0, 1.02, 1.48);
      addBox(turret, 0.92, 0.48, 0.92, 0, 0.22, 0, pal.team);
      addBox(turret, 0.16, 0.58, 0.28, -0.22, 0.62, 0.18, pal.glowCyan, -0.45);
      addBox(turret, 0.16, 0.58, 0.28, 0.22, 0.62, 0.18, pal.glowCyan, -0.45);
      root.add(turret);
      parts.turret = turret;
    } else if (typeId === 'typhoon') {
      const sub = new THREE.Group();
      addSphere(sub, 0.68, 0, 0.22, 0, pal.dark, 0.85, 0.78, 3.05);
      addBox(sub, 0.42, 0.78, 1.15, 0, 0.84, 0.35, pal.hull);
      addBox(sub, 0.36, 0.16, 0.26, 0, 1.16, 0.42, pal.team);
      addBox(sub, 1.15, 0.08, 0.32, 0, 0.82, 0.35, pal.dark);
      addCyl(sub, 0.06, 0.06, 0.48, 0, 1.38, 0.46, pal.trim);
      root.add(sub);
      parts.submarineHull = sub;
    } else if (typeId === 'carrier') {
      addBox(root, 2.75, 0.92, 5.45, 0, 0.44, -0.1, pal.hull);
      addGeo(root, shipBowGeo, pal.hull, 1.42, 1.22, 1.15, 0, -0.02, 2.60);
      addBox(root, 3.35, 0.24, 6.15, -0.15, 1.02, 0.05, pal.dark);
      addBox(root, 0.16, 0.04, 5.55, -0.25, 1.16, 0.05, pal.gold);
      addBox(root, 1.95, 0.05, 0.24, -0.25, 1.16, 2.85, pal.hazard);
      addBox(root, 0.72, 1.38, 1.52, 1.12, 1.72, -0.35, pal.team);
      addBox(root, 0.44, 0.65, 0.62, 1.12, 2.58, -0.35, pal.hull);
      for (const z of [-1.45, -0.2, 1.15]) {
        addGeo(root, jetWingGeo, pal.trim, 0.24, 0.65, 0.24, -0.72, 1.22, z);
      }
    } else if (typeId === 'dreadnought') {
      addBox(root, 2.85, 0.96, 5.25, 0, 0.46, -0.25, pal.hull);
      addGeo(root, shipBowGeo, pal.hull, 1.46, 1.28, 1.18, 0, -0.02, 2.36);
      addBox(root, 2.45, 0.32, 4.95, 0, 1.05, -0.1, pal.team);
      addBox(root, 1.65, 1.18, 1.72, 0, 1.68, -0.12, pal.hull);
      addBox(root, 1.52, 0.34, 0.72, 0, 1.92, 0.42, pal.glass);
      addBox(root, 1.15, 0.46, 1.15, -0.52, 1.38, -1.62, pal.dark);
      addBox(root, 1.15, 0.46, 1.15, 0.52, 1.38, -1.62, pal.dark);
      addBox(root, 0.92, 0.16, 0.92, -0.52, 1.64, -1.62, pal.glowRed);
      addBox(root, 0.92, 0.16, 0.92, 0.52, 1.64, -1.62, pal.glowRed);
      const turret = new THREE.Group();
      turret.position.set(0, 1.25, 1.65);
      addBox(turret, 1.25, 0.55, 1.25, 0, 0.25, 0, pal.team);
      addCyl(turret, 0.11, 0.12, 1.85, -0.28, 0.32, 1.05, pal.dark, Math.PI * 0.5);
      addCyl(turret, 0.11, 0.12, 1.85, 0.28, 0.32, 1.05, pal.dark, Math.PI * 0.5);
      root.add(turret);
      parts.turret = turret;
    }

    return { root, parts };
  }

  // === 5. BUILDINGS, DEFENSES, SUPERWEAPONS & NEUTRALS (21 types) ===
  function buildBuilding(typeId, def, pal, opts = {}) {
    const root = new THREE.Group();
    const parts = { turret: null, rotor: null, pump: null, beacon: null, glowMesh: null };
    const w = (def.footprintW ?? 2) * 2;
    const h = (def.footprintH ?? 2) * 2;

    // Abyss-0 Sovereign Bio-Mechanical Hive Core variant (EX13 finale)
    if (typeId === 'conyard' && (opts?.factionId === 'abyss0' || opts?.campaignTag === 'ex13_hive')) {
      addCyl(root, w * 0.46, w * 0.52, 0.55, 0, 0.28, 0, pal.chitin);
      addCyl(root, w * 0.34, w * 0.40, 0.95, 0, 0.95, 0, pal.dark);
      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * Math.PI * 2 + Math.PI * 0.25;
        addBox(
          root,
          0.95, 3.65, 1.15,
          Math.cos(ang) * 2.15, 2.05, Math.sin(ang) * 2.15,
          pal.chitin,
          Math.sin(ang) * 0.26, ang, -Math.cos(ang) * 0.26
        );
      }
      const crystalCore = addSphere(root, 1.05, 0, 2.35, 0, pal.glowViolet, 0.92, 1.38, 0.92);
      const ring = new THREE.Group();
      ring.position.set(0, 2.45, 0);
      const t = new THREE.Mesh(unitTorus, pal.glowViolet);
      t.scale.setScalar(3.4);
      t.rotation.x = Math.PI * 0.5;
      ring.add(t);
      root.add(ring);
      parts.rotor = ring;
      parts.glowMesh = crystalCore;
      return { root, parts };
    }

    // Grounded heavy chamfered concrete foundation plinth matching footprintW x footprintH meters
    if (typeId !== 'naval_yard') {
      addBox(root, w - 0.15, 0.42, h - 0.15, 0, 0.21, 0, pal.concrete);
      addBox(root, w - 0.40, 0.12, h - 0.40, 0, 0.44, 0, pal.hull);
    }

    if (typeId === 'conyard') {
      // 1:1 Prototype Construction Yard — 3-Tier Octagonal Citadel, Blue Vertical Ribs, 4 Corner Hydraulic Outriggers, Holo Dome, Twin Lattice Cranes & Beacon
      const octR = Math.min(w, h) * 0.34;

      // 4 Heavy Deployed Corner Hydraulic Outrigger Legs gripping the pad
      for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const ox = cx * (w * 0.43);
        const oz = cz * (h * 0.43);
        addBox(root, 0.96, 0.24, 0.96, ox, 0.50, oz, pal.hull);
        addBox(root, 0.72, 0.14, 0.72, ox, 0.66, oz, pal.hazard);
        const legRotX = cz * 0.54;
        const legRotZ = -cx * 0.54;
        addBox(root, 0.38, 1.38, 0.38, ox * 0.76, 1.04, oz * 0.76, pal.dark, legRotX, 0, legRotZ);
        addBox(root, 0.22, 1.15, 0.22, ox * 0.80, 1.00, oz * 0.80, pal.trim, legRotX, 0, legRotZ);
        addBox(root, 0.48, 0.36, 0.48, ox * 0.62, 1.48, oz * 0.62, pal.team);
      }

      // 3-Tiered Octagonal Armored Citadel
      addOct(root, octR, 1.38, 0, 1.16, 0, pal.hull);
      addOct(root, octR * 1.03, 0.16, 0, 1.82, 0, pal.dark);
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2 + Math.PI / 8;
        const rx = Math.cos(ang) * (octR * 0.96);
        const rz = Math.sin(ang) * (octR * 0.96);
        addBox(root, 0.34, 1.36, 0.48, rx, 1.18, rz, pal.team, 0, -ang);
      }
      // Front armored fabrication gate & warm bay indicator
      addBox(root, 2.05, 1.08, 0.36, 0, 1.04, octR * 0.96, pal.dark);
      addBox(root, 2.34, 0.22, 0.42, 0, 1.62, octR * 0.98, pal.team);
      addBox(root, 1.72, 0.10, 0.14, 0, 1.42, octR * 1.03, pal.glowGold);
      addBox(root, 2.25, 0.14, 0.72, 0, 0.38, octR * 1.15, pal.concrete, 0.22);

      // Mid Octagonal Command Tier w/ wraparound viewport & blue armor ribs
      addOct(root, octR * 0.74, 0.96, 0, 2.28, 0, pal.team);
      addOct(root, octR * 0.76, 0.24, 0, 2.42, 0, pal.glass);
      addOct(root, octR * 0.78, 0.16, 0, 2.74, 0, pal.hull);

      // Upper Emitter Collar & Translucent Glowing Cyan Holographic Dome
      addOct(root, octR * 0.54, 0.34, 0, 2.98, 0, pal.hull);
      addOct(root, octR * 0.48, 0.12, 0, 3.16, 0, pal.glowCyan);
      addCyl(root, 0.48, 0.56, 0.55, 0, 3.38, 0, pal.glowCyan);
      const holoDome = addSphere(root, octR * 0.46, 0, 3.16, 0, pal.holoDome, 1.0, 0.86, 1.0);
      holoDome.castShadow = false;
      holoDome.receiveShadow = false;

      // Twin Open-Lattice Industrial Tower Cranes (left stationary, right slewing rotor)
      const buildLatticeCrane = (cx, cz, yaw, boomLen) => {
        const cr = new THREE.Group();
        cr.position.set(cx, 0.50, cz);
        cr.rotation.y = yaw;
        addCyl(cr, 0.42, 0.50, 0.45, 0, 0.22, 0, pal.hull);
        addTrussBoom(cr, 2.35, 0.44, 0.44, 0, 0.42, 0, -Math.PI * 0.5, 0, 0, pal.team, pal.dark);
        addBox(cr, 0.88, 0.56, 1.05, 0, 2.86, -0.24, pal.team);
        addBox(cr, 0.78, 0.44, 0.52, 0, 2.80, -0.82, pal.hull);
        const pitch = -0.34;
        addTrussBoom(cr, boomLen, 0.36, 0.36, 0, 3.04, 0.18, pitch, 0, 0, pal.gold, pal.dark);
        const tipY = 3.04 + boomLen * Math.sin(-pitch);
        const tipZ = 0.18 + boomLen * Math.cos(-pitch);
        const cableLen = 1.65;
        addCyl(cr, 0.035, 0.035, cableLen, 0, tipY - cableLen * 0.5, tipZ, pal.dark);
        addBox(cr, 0.36, 0.28, 0.36, 0, tipY - cableLen - 0.14, tipZ, pal.gold);
        root.add(cr);
        return cr;
      };
      buildLatticeCrane(-w * 0.28, -h * 0.16, 0.55, 3.55);
      parts.rotor = buildLatticeCrane(w * 0.28, -h * 0.16, -0.55, 3.80);

      // Small Front-Left Blue-Tipped Signal Beacon
      addBox(root, 0.42, 0.28, 0.42, -w * 0.34, 0.62, h * 0.34, pal.hull);
      addCyl(root, 0.06, 0.09, 0.95, -w * 0.34, 1.18, h * 0.34, pal.trim);
      const bcn = addSphere(root, 0.17, -w * 0.34, 1.72, h * 0.34, pal.glowCyan);
      parts.beacon = bcn;
    } else if (typeId === 'power_plant') {
      if (glbTemplates.generator) {
        clonePropInto('generator', root, 1.44, 0, 0.48, 0.88, 0);
      } else {
        addBox(root, w * 0.72, 1.05, h * 0.38, 0, 0.98, 0.82, pal.gold);
      }
      addBox(root, w * 0.76, 0.16, 0.26, 0, 0.54, h * 0.42, pal.hazard);
      addBox(root, w * 0.68, 0.32, 0.42, 0, 0.72, -0.10, pal.dark);
      addBox(root, 1.65, 0.16, 0.35, 0, 1.52, -0.88, pal.dark);
      for (const sx of [-0.94, 0.94]) {
        addGeo(root, coolingTowerGeo, pal.hull, 0.88, 1.0, 0.88, sx, 0.48, -0.88);
        addCyl(root, 0.56, 0.58, 0.20, sx, 1.12, -0.88, pal.hazard);
        const cap = addCyl(root, 0.36, 0.38, 0.14, sx, 2.48, -0.88, pal.glowCyan);
        parts.glowMesh = cap;
      }
    } else if (typeId === 'nuclear_reactor') {
      // 1:1 Prototype Nuclear Reactor — Central Hyperboloid Concrete Cooling Tower, 6 Exterior Buttress Ribs, Upper Compression Ring & Green Throat Glow
      addGeo(root, coolingTowerGeo, pal.concrete, 2.25, 2.05, 2.25, 0, 0.48, 0);

      // Lower foundation ring & upper compression ring collar wrapping cooling tower
      const lowRing = new THREE.Mesh(unitTorus, pal.hull);
      lowRing.scale.set(2.86, 2.86, 1.45);
      lowRing.rotation.x = Math.PI * 0.5;
      lowRing.position.set(0, 0.64, 0);
      lowRing.castShadow = true;
      lowRing.receiveShadow = true;
      root.add(lowRing);

      const topRing = new THREE.Mesh(unitTorus, pal.hull);
      topRing.scale.set(2.14, 2.14, 1.35);
      topRing.rotation.x = Math.PI * 0.5;
      topRing.position.set(0, 4.78, 0);
      topRing.castShadow = true;
      topRing.receiveShadow = true;
      root.add(topRing);

      // 6 Heavy Radial Exterior Faction-Colored Buttress Ribs gripping the tower
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2 + Math.PI / 6;
        const cosA = Math.cos(ang);
        const sinA = Math.sin(ang);
        addBox(root, 0.88, 0.38, 0.52, cosA * 1.56, 0.66, sinA * 1.56, pal.hull, 0, -ang);
        addBox(root, 0.72, 4.05, 0.34, cosA * 1.24, 2.62, sinA * 1.24, pal.team, 0, -ang);
        addBox(root, 0.58, 0.34, 0.42, cosA * 1.08, 4.46, sinA * 1.08, pal.hull, 0, -ang);
      }

      // Front reactor control vestibule & coolant manifold pipes
      addBox(root, 1.75, 0.86, 0.92, 0, 0.92, 1.42, pal.hull);
      addBox(root, 1.25, 0.16, 0.16, 0, 1.12, 1.88, pal.glowGreen);
      addCyl(root, 0.22, 0.22, 1.85, -1.55, 1.22, 0, pal.dark, 0, 0, Math.PI * 0.28);
      addCyl(root, 0.22, 0.22, 1.85, 1.55, 1.22, 0, pal.dark, 0, 0, -Math.PI * 0.28);

      // Green Reactor Throat Glow radiating from the top mouth
      const core = addCyl(root, 0.78, 0.76, 0.36, 0, 4.42, 0, pal.glowGreen);
      addSphere(root, 0.58, 0, 4.56, 0, pal.glowGreen, 1.15, 0.45, 1.15);
      parts.glowMesh = core;
    } else if (typeId === 'refinery') {
      // 1:1 Prototype Ore Refinery — Front Smelter Intake Hall, Sloped Ribbed Ore Conveyor Ramp, Twin Domed Storage Silos w/ Transfer Pipes & Twin Rear Smokestacks
      // Front Smelter Intake Hall
      addBox(root, w * 0.82, 1.88, h * 0.44, 0, 1.42, 0.12, pal.team);
      addGeo(root, slopedCabGeo, pal.hull, w * 0.84, 0.52, h * 0.46, 0, 2.58, 0.12);
      addBox(root, w * 0.48, 1.12, 0.32, -w * 0.12, 1.06, h * 0.28, pal.dark);
      addBox(root, w * 0.54, 0.18, 0.36, -w * 0.12, 1.68, h * 0.30, pal.hazard);
      addBox(root, w * 0.36, 0.16, 0.14, -w * 0.12, 1.38, h * 0.34, pal.glowGold);

      // Sloped Ribbed Ore Conveyor Ramp leading into the smelter intake
      addBox(root, 1.48, 0.18, 1.85, w * 0.20, 0.56, h * 0.32, pal.hazard);
      addBox(root, 1.18, 0.22, 2.25, w * 0.20, 1.18, h * 0.24, pal.dark, 0.46);
      addBox(root, 0.14, 0.34, 2.28, w * 0.20 - 0.58, 1.24, h * 0.24, pal.hull, 0.46);
      addBox(root, 0.14, 0.34, 2.28, w * 0.20 + 0.58, 1.24, h * 0.24, pal.hull, 0.46);
      for (let r = 0; r < 6; r++) {
        const t = (r - 2.5) * 0.32;
        addBox(root, 1.04, 0.10, 0.10, w * 0.20, 1.28 - t * 0.44, h * 0.24 + t * 0.88, pal.hazard, 0.46);
      }

      // Twin Tall Domed Industrial Storage Silos w/ Transfer Pipes
      for (const sx of [-w * 0.24, w * 0.24]) {
        addCyl(root, 0.84, 0.88, 2.68, sx, 1.82, -h * 0.18, pal.hull);
        addCyl(root, 0.88, 0.88, 0.24, sx, 1.12, -h * 0.18, pal.team);
        addCyl(root, 0.88, 0.88, 0.20, sx, 2.65, -h * 0.18, pal.hazard);
        addSphere(root, 0.84, sx, 3.16, -h * 0.18, pal.trim, 1.0, 0.72, 1.0);
        // Transfer feed pipe connecting silo forward into smelter hall
        addCyl(root, 0.16, 0.16, 1.45, sx, 2.28, -h * 0.02, pal.copper, Math.PI * 0.5);
      }
      // Cross-over overhead transfer pipe joining twin silos
      addCyl(root, 0.18, 0.18, w * 0.48, 0, 2.86, -h * 0.18, pal.copper, 0, 0, Math.PI * 0.5);

      // Twin Tall Rear Smokestacks
      for (const sx of [-w * 0.30, w * 0.30]) {
        addCyl(root, 0.26, 0.36, 4.05, sx, 2.50, -h * 0.37, pal.dark);
        addCyl(root, 0.31, 0.33, 0.30, sx, 4.18, -h * 0.37, pal.hazard);
        addCyl(root, 0.27, 0.27, 0.10, sx, 4.52, -h * 0.37, pal.glowGold);
      }
    } else if (typeId === 'barracks') {
      // 1:1 Prototype Barracks — Sloped Armored Bunker w/ Corner Ribs, Wide Warm-Amber Visor Slit, Armored Entrance Arch & Rooftop Comms Mast w/ Radar Dish & Red Beacon
      addBox(root, w * 0.82, 1.48, h * 0.68, 0, 1.22, -0.18, pal.team);
      addGeo(root, slopedCabGeo, pal.hull, w * 0.86, 0.62, h * 0.70, 0, 2.24, -0.18);

      // 4 Heavy Corner Armor Ribs
      for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        addBox(root, 0.42, 1.65, 0.48, cx * (w * 0.40), 1.30, -0.18 + cz * (h * 0.32), pal.hull, cz * -0.12, 0, cx * 0.12);
      }

      // Wide Warm-Amber Horizontal Visor Slit beneath Armored Visor Hood
      addBox(root, w * 0.66, 0.24, 0.22, 0, 1.72, h * 0.15, pal.dark);
      addBox(root, w * 0.58, 0.12, 0.18, 0, 1.72, h * 0.18, pal.glowGold);
      addBox(root, w * 0.70, 0.14, 0.34, 0, 1.90, h * 0.18, pal.hull);

      // Armored Entrance Arch (front center)
      addBox(root, 1.76, 1.32, 0.72, 0, 1.12, h * 0.26, pal.hull);
      addBox(root, 1.48, 1.12, 0.22, 0, 1.04, h * 0.36, pal.team);
      addBox(root, 1.12, 0.88, 0.22, 0, 0.94, h * 0.38, pal.dark);
      addBox(root, 1.66, 0.16, 0.26, 0, 1.62, h * 0.34, pal.hazard);
      addBox(root, 1.85, 0.14, 0.56, 0, 0.36, h * 0.44, pal.concrete, 0.22);

      // Rooftop Comms Mast w/ Parabolic Radar Dish & Tiny Red Beacon
      addBox(root, 0.95, 0.36, 0.95, 0.95, 2.66, -0.62, pal.hull);
      addCyl(root, 0.055, 0.075, 1.35, 1.05, 3.45, -0.62, pal.trim);
      addGeo(root, radarDishGeo, pal.trim, 0.62, 0.62, 0.62, 0.82, 3.22, -0.45, 0, -0.35, 0);
      const bcn = addSphere(root, 0.12, 1.05, 4.18, -0.62, pal.glowRed);
      parts.beacon = bcn;
    } else if (typeId === 'war_factory') {
      // 1:1 Prototype War Factory — Chamfered Arched Armored Hangar, 4 Protruding Faction Structural Arch Ribs, Deep Warm-Lit Interior w/ Exit Ramp & 4 External Gold Gantry Cranes
      // Outer Chamfered Arched Hangar Shell + 4 Protruding Faction Structural Arch Ribs
      addGeo(root, hangarArchGeo, pal.hull, w * 0.78, 3.15, h * 0.82, 0, 0.48, -0.04);
      for (const rz of [-h * 0.36, -h * 0.12, h * 0.12, h * 0.35]) {
        addGeo(root, hangarArchGeo, pal.team, w * 0.84, 3.36, 0.34, 0, 0.46, rz);
      }

      // Deep Recessed Warm-Lit Garage Interior & Exit Floor Ramp
      addBox(root, w * 0.52, 2.28, 0.26, 0, 1.62, -h * 0.42, pal.dark);
      addBox(root, w * 0.54, 0.10, h * 0.74, 0, 0.50, -0.02, pal.dark);
      addBox(root, w * 0.36, 0.14, h * 0.62, 0, 2.34, -0.04, pal.glowGold);
      addBox(root, w * 0.44, 0.14, 0.22, 0, 2.22, h * 0.20, pal.gold);
      addBox(root, w * 0.56, 0.14, 0.32, 0, 0.52, h * 0.38, pal.hazard);
      addBox(root, w * 0.56, 0.18, 0.96, 0, 0.36, h * 0.47, pal.concrete, 0.22);

      // 4 External Orange-Gold Overhead Open-Lattice Gantry Cranes (2 left, 2 right)
      for (const side of [-1, 1]) {
        for (const gz of [-h * 0.20, h * 0.18]) {
          const baseX = side * (w * 0.42);
          addBox(root, 0.42, 0.26, 0.42, baseX, 0.58, gz, pal.hull);
          addTrussBoom(root, 3.10, 0.30, 0.30, baseX, 0.62, gz, -Math.PI * 0.5, 0, 0, pal.gold, pal.dark);
          // Cantilevered horizontal lattice gantry jib extending inward over the roof/bay
          const boomDirY = side > 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
          addTrussBoom(root, 2.15, 0.28, 0.28, baseX, 3.72, gz, -0.14, boomDirY, 0, pal.gold, pal.dark);
          const hookX = baseX - side * 1.92;
          const hookY = 3.72 + 2.15 * Math.sin(0.14);
          addCyl(root, 0.03, 0.03, 0.85, hookX, hookY - 0.42, gz, pal.dark);
          addBox(root, 0.26, 0.20, 0.26, hookX, hookY - 0.90, gz, pal.gold);
        }
      }

      // Rear rooftop exhaust vents
      addCyl(root, 0.20, 0.24, 0.72, -1.25, 3.85, -h * 0.26, pal.dark);
      addCyl(root, 0.20, 0.24, 0.72, 1.25, 3.85, -h * 0.26, pal.dark);
    } else if (typeId === 'naval_yard') {
      addBox(root, 1.48, 1.48, h * 0.88, -w * 0.36, 0.75, 0, pal.hull);
      addBox(root, 1.48, 1.48, h * 0.88, w * 0.36, 0.75, 0, pal.hull);
      addBox(root, w * 0.82, 0.56, 1.55, 0, 0.45, -h * 0.34, pal.team);
      addBox(root, w * 0.86, 0.38, 0.56, 0, 3.25, 0, pal.hazard);
      addBox(root, 0.42, 2.55, 0.42, -w * 0.36, 2.05, 0, pal.gold);
      addBox(root, 0.42, 2.55, 0.42, w * 0.36, 2.05, 0, pal.gold);
      addSphere(root, 0.22, -w * 0.36, 3.58, 0, pal.glowCyan);
      addSphere(root, 0.22, w * 0.36, 3.58, 0, pal.glowCyan);
    } else if (typeId === 'airforce_radar') {
      addBox(root, w * 0.78, 1.85, h * 0.78, 0, 1.38, 0, pal.hull);
      addBox(root, w * 0.74, 0.22, h * 0.68, 0, 2.38, 0, pal.team);
      addBox(root, 1.65, 0.08, 1.65, 1.25, 2.52, 0.95, pal.hazard);
      const dish = new THREE.Group();
      dish.position.set(-0.65, 2.75, -0.55);
      addCyl(dish, 0.22, 0.26, 0.75, 0, 0.2, 0, pal.dark);
      addGeo(dish, radarDishGeo, pal.trim, 1.0, 1.0, 1.0, 0, 0.85, 0.12);
      addSphere(dish, 0.15, 0, 0.88, 0.68, pal.glowCyan);
      root.add(dish);
      parts.rotor = dish;
    } else if (typeId === 'service_depot') {
      addBox(root, w * 0.78, 0.28, h * 0.78, 0, 0.56, 0, pal.hazard);
      addBox(root, w * 0.54, 0.32, h * 0.54, 0, 0.76, 0, pal.dark);
      addBox(root, 1.15, 1.12, 1.25, -w * 0.28, 1.02, -h * 0.28, pal.team);
      const crane = new THREE.Group();
      crane.position.set(-w * 0.28, 1.55, -h * 0.28);
      addCyl(crane, 0.28, 0.34, 1.35, 0, 0.45, 0, pal.gold);
      addBox(crane, 0.34, 0.32, 2.95, 0.85, 1.45, 0.85, pal.hazard, 0.15, Math.PI * 0.25);
      root.add(crane);
      parts.rotor = crane;
    } else if (typeId === 'battle_lab') {
      // 1:1 Prototype Battle Lab — Sleek White-Silver Multi-Tier Sci-Fi Dome, Recessed Cyan Channels, Cyan Front Portal, Left Rotating Parabolic Dish & Right Levitating 4-Crystal Cluster
      const labR = Math.min(w, h) * 0.36;

      // Multi-Tier White-Silver Sci-Fi Rotunda w/ Recessed Glowing Cyan Channels
      addOct(root, labR, 0.88, 0, 0.92, 0, pal.whiteMed);
      addOct(root, labR * 1.015, 0.14, 0, 1.32, 0, pal.glowCyan);
      addCyl(root, labR * 0.78, labR * 0.86, 0.96, 0, 1.86, 0, pal.whiteMed);
      addCyl(root, labR * 0.80, labR * 0.80, 0.12, 0, 2.28, 0, pal.glowCyan);

      // Sleek Sci-Fi Dome & Vertical Meridian Fins
      addSphere(root, labR * 0.74, 0, 2.32, 0, pal.whiteMed, 1.0, 0.84, 1.0);
      addCyl(root, 0.34, 0.44, 0.24, 0, 3.68, 0, pal.team);
      addSphere(root, 0.24, 0, 3.84, 0, pal.glowCyan);
      for (const ang of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]) {
        const fx = Math.cos(ang) * (labR * 0.82);
        const fz = Math.sin(ang) * (labR * 0.82);
        addBox(root, 0.22, 1.65, 0.38, fx, 1.62, fz, pal.team, 0, -ang + Math.PI * 0.5);
        addBox(root, 0.08, 1.45, 0.12, fx * 1.05, 1.62, fz * 1.05, pal.glowCyan, 0, -ang + Math.PI * 0.5);
      }

      // Cyan Front Portal
      addBox(root, 1.56, 1.18, 0.56, 0, 1.06, labR * 0.94, pal.whiteMed);
      addBox(root, 1.26, 0.96, 0.18, 0, 1.00, labR * 1.04, pal.trim);
      addBox(root, 0.94, 0.82, 0.14, 0, 0.94, labR * 1.08, pal.glowCyan);
      addBox(root, 1.68, 0.14, 0.52, 0, 0.36, labR * 1.18, pal.concrete, 0.22);

      // Left Rotating Parabolic Radar Dish
      addBox(root, 1.05, 0.86, 1.05, -w * 0.34, 0.90, 0.05, pal.whiteMed);
      addCyl(root, 0.36, 0.42, 0.18, -w * 0.34, 1.38, 0.05, pal.glowCyan);
      const dish = new THREE.Group();
      dish.position.set(-w * 0.34, 1.46, 0.05);
      addCyl(dish, 0.16, 0.20, 0.78, 0, 0.36, 0, pal.trim);
      addGeo(dish, radarDishGeo, pal.whiteMed, 0.92, 0.92, 0.92, 0, 0.98, 0.10);
      addSphere(dish, 0.14, 0, 1.02, 0.62, pal.glowCyan);
      root.add(dish);
      parts.rotor = dish;

      // Right Levitating Cluster of 4 Cyan Crystals
      addBox(root, 1.05, 0.56, 1.05, w * 0.34, 0.76, 0.05, pal.whiteMed);
      addCyl(root, 0.44, 0.48, 0.14, w * 0.34, 1.08, 0.05, pal.glowCyan);
      const crystalCluster = new THREE.Group();
      crystalCluster.position.set(w * 0.34, 1.88, 0.05);
      const shardSpecs = [
        { x: 0.00, y: 0.24, z: 0.00, r: 0.24, h: 1.15, rx: 0.06, rz: -0.04 },
        { x: -0.30, y: -0.06, z: 0.16, r: 0.16, h: 0.82, rx: 0.22, rz: 0.26 },
        { x: 0.30, y: 0.02, z: 0.18, r: 0.17, h: 0.88, rx: 0.20, rz: -0.24 },
        { x: 0.04, y: -0.08, z: -0.30, r: 0.16, h: 0.78, rx: -0.26, rz: 0.08 }
      ];
      for (const cs of shardSpecs) {
        addOct(crystalCluster, cs.r, cs.h * 0.55, cs.x, cs.y, cs.z, pal.glowCyan);
        addCone(crystalCluster, cs.r, cs.h * 0.45, cs.x, cs.y + cs.h * 0.48, cs.z, pal.glowCyan, cs.rx, 0, cs.rz);
      }
      root.add(crystalCluster);
      parts.glowMesh = crystalCluster;
    } else if (typeId === 'pillbox') {
      addOct(root, 0.96, 0.88, 0, 0.75, 0, pal.concrete);
      addOct(root, 0.76, 0.24, 0, 1.24, 0, pal.hull);
      const turret = new THREE.Group();
      turret.position.set(0, 0.92, 0);
      addCyl(turret, 0.08, 0.08, 0.95, -0.18, 0, 0.72, pal.dark, Math.PI * 0.5);
      addCyl(turret, 0.08, 0.08, 0.95, 0.18, 0, 0.72, pal.dark, Math.PI * 0.5);
      root.add(turret);
      parts.turret = turret;
    } else if (typeId === 'aa_turret') {
      addOct(root, 0.84, 0.82, 0, 0.68, 0, pal.hull);
      const turret = new THREE.Group();
      turret.position.set(0, 1.15, 0);
      addBox(turret, 0.98, 0.58, 0.84, 0, 0.25, 0, pal.team);
      for (const sx of [-0.28, 0.28]) {
        for (const sy of [0.15, 0.42]) {
          addCyl(turret, 0.10, 0.10, 1.15, sx, sy, 0.35, pal.dark, Math.PI * 0.32);
        }
      }
      root.add(turret);
      parts.turret = turret;
    } else if (typeId === 'prism_tower') {
      addOct(root, 0.86, 2.25, 0, 1.45, 0, pal.hull);
      addOct(root, 0.56, 1.45, 0, 3.05, 0, pal.team);
      for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * Math.PI * 2;
        addBox(root, 0.14, 1.35, 0.38, Math.cos(ang) * 0.54, 3.75, Math.sin(ang) * 0.54, pal.trim, 0, -ang);
      }
      const orb = addSphere(root, 0.44, 0, 4.22, 0, pal.glowCyan);
      parts.glowMesh = orb;
    } else if (typeId === 'tesla_coil') {
      addOct(root, 0.88, 1.35, 0, 1.02, 0, pal.hull);
      addCyl(root, 0.24, 0.34, 2.55, 0, 2.65, 0, pal.copper);
      const t1 = new THREE.Mesh(unitTorus, pal.copper);
      t1.scale.set(1.15, 1.15, 1.15);
      t1.rotation.x = Math.PI * 0.5;
      t1.position.y = 2.65;
      root.add(t1);
      const t2 = new THREE.Mesh(unitTorus, pal.copper);
      t2.scale.set(0.88, 0.88, 0.88);
      t2.rotation.x = Math.PI * 0.5;
      t2.position.y = 3.35;
      root.add(t2);
      const tip = addSphere(root, 0.38, 0, 4.18, 0, pal.glowCyan);
      parts.glowMesh = tip;
    } else if (typeId === 'chrono_sphere') {
      addOct(root, w * 0.44, 1.15, 0, 0.98, 0, pal.hull);
      const gyro = new THREE.Group();
      gyro.position.set(0, 2.75, 0);
      const r1 = new THREE.Mesh(unitTorus, pal.copper);
      r1.scale.setScalar(3.3);
      const r2 = new THREE.Mesh(unitTorus, pal.team);
      r2.scale.setScalar(2.6);
      r2.rotation.y = Math.PI * 0.5;
      gyro.add(r1, r2);
      const orb = addSphere(gyro, 0.72, 0, 0, 0, pal.glowCyan);
      parts.rotor = gyro;
      parts.glowMesh = orb;
      root.add(gyro);
    } else if (typeId === 'iron_curtain') {
      addOct(root, w * 0.45, 1.05, 0, 0.92, 0, pal.dark);
      addBox(root, 1.12, 3.65, 1.12, -1.65, 2.4, 0, pal.team);
      addBox(root, 1.12, 3.65, 1.12, 1.65, 2.4, 0, pal.team);
      addBox(root, 4.2, 0.42, 0.65, 0, 4.25, 0, pal.hull);
      const orb = addSphere(root, 0.82, 0, 3.05, 0, pal.glowRed);
      parts.glowMesh = orb;
    } else if (typeId === 'weather_control') {
      addOct(root, w * 0.42, 1.25, 0, 1.02, 0, pal.hull);
      addCyl(root, 0.42, 0.92, 4.15, 0, 3.25, 0, pal.team);
      const halo = new THREE.Mesh(unitTorus, pal.glowCyan);
      halo.scale.set(2.4, 2.4, 2.4);
      halo.rotation.x = Math.PI * 0.5;
      halo.position.y = 5.15;
      root.add(halo);
      parts.rotor = halo;
      parts.glowMesh = addSphere(root, 0.55, 0, 5.45, 0, pal.glowCyan);
    } else if (typeId === 'nuclear_silo') {
      addOct(root, w * 0.45, 1.25, 0, 1.02, 0, pal.concrete);
      addCyl(root, 1.68, 1.75, 0.24, 0, 1.62, 0, pal.hazard);
      addCyl(root, 1.48, 1.56, 0.45, 0, 1.85, 0, pal.dark);
      addCyl(root, 0.52, 0.65, 2.95, 0, 2.45, 0, pal.trim);
      addCone(root, 0.54, 1.15, 0, 4.35, 0, pal.glowRed);
    } else if (typeId === 'oil_derrick') {
      addCyl(root, 0.42, 0.98, 4.15, 0, 2.45, 0, pal.dark);
      if (glbTemplates.fuel) clonePropInto('fuel', root, 1.55, -1.15, 0.48, 0.95, 0);
      const pump = new THREE.Group();
      pump.position.set(0.35, 3.25, 0);
      addBox(pump, 0.34, 0.36, 2.55, 0, 0, 0, pal.hazard);
      root.add(pump);
      parts.pump = pump;
    } else if (typeId === 'tech_airport') {
      addBox(root, w * 0.86, 0.35, h * 0.86, 0, 0.58, 0, pal.dark);
      addBox(root, w * 0.72, 0.08, 0.45, 0.6, 0.78, 0.8, pal.hazard);
      addBox(root, 1.65, 2.45, 1.65, -1.45, 1.68, -1.45, pal.concrete);
      addBox(root, 1.95, 0.72, 1.95, -1.45, 3.05, -1.45, pal.glass);
      const dish = addBox(root, 1.45, 0.22, 0.28, -1.45, 3.72, -1.45, pal.glowGold);
      parts.rotor = dish;
    } else if (typeId === 'hospital') {
      addBox(root, w * 0.82, 1.95, h * 0.76, 0, 1.38, 0, pal.whiteMed);
      addBox(root, 1.65, 0.16, 0.48, 0, 2.42, 0, pal.medCross);
      addBox(root, 0.48, 0.16, 1.65, 0, 2.42, 0, pal.medCross);
      addBox(root, 1.55, 0.78, 0.65, 0, 0.95, h * 0.38, pal.glass);
    } else {
      addBox(root, w * 0.75, 1.5, h * 0.75, 0, 1.15, 0, pal.team);
    }

    return { root, parts };
  }

  function mergeStaticMeshes(root, parts) {
    if (!root || !mergeGeometries) return;
    const protectedSet = new Set();
    for (const v of Object.values(parts || {})) {
      if (Array.isArray(v)) {
        for (const item of v) protectedSet.add(item);
      } else if (v) {
        protectedSet.add(v);
      }
    }
    const groups = new Map();
    const candidates = [];
    for (const child of root.children) {
      if (!child.isMesh || !child.geometry || child.isSkinnedMesh || protectedSet.has(child)) continue;
      const mat = child.material;
      if (!mat || Array.isArray(mat) || mat.transparent) continue;
      let list = groups.get(mat);
      if (!list) {
        list = [];
        groups.set(mat, list);
      }
      list.push(child);
      candidates.push(child);
    }
    if (candidates.length === 0) return;

    const ownedGeos = [];
    for (const [mat, list] of groups) {
      if (list.length < 2) continue;
      const tempGeos = [];
      for (const m of list) {
        m.updateMatrix();
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const attr of Object.keys(g.attributes)) {
          if (attr !== 'position' && attr !== 'normal' && attr !== 'uv') {
            g.deleteAttribute(attr);
          }
        }
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv && g.attributes.position) {
          g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        }
        g.applyMatrix4(m.matrix);
        tempGeos.push(g);
      }
      const merged = mergeGeometries(tempGeos, false);
      for (const tg of tempGeos) tg.dispose();
      if (!merged) continue;
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      for (const m of list) root.remove(m);
      const mergedMesh = new THREE.Mesh(merged, mat);
      const isEmissiveMat = mat === root.userData?.emissiveSkipShadow;
      mergedMesh.castShadow = !isEmissiveMat;
      mergedMesh.receiveShadow = true;
      root.add(mergedMesh);
      ownedGeos.push(merged);
    }
    if (ownedGeos.length > 0) {
      root.userData.ownedGeos = ownedGeos;
    }
  }

  function buildProceduralInstance(typeId, teamId, opts = {}) {
    // Check custom GLB or Sprite overrides first
    const customGlb = customGlbOverrides.get(typeId);
    if (customGlb) {
      const wrap = new THREE.Group();
      const clone = SkeletonUtils.clone(customGlb.scene);
      clone.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });
      wrap.add(clone);
      return { root: wrap, parts: {}, isCustom: true };
    }
    const customSprite = customSpriteOverrides.get(typeId);
    if (customSprite) {
      const wrap = new THREE.Group();
      const sp = new THREE.Sprite(customSprite.material);
      const sc = customSprite.scale;
      sp.scale.set(sc, sc, 1);
      sp.position.y = sc * 0.5;
      wrap.add(sp);
      return { root: wrap, parts: {}, isCustom: true };
    }

    const def = ENTITY_DEFS[typeId];
    const pal = getPalette(teamId);
    let built;
    if (!def) {
      const root = new THREE.Group();
      addBox(root, 1.2, 1.2, 1.2, 0, 0.6, 0, pal.team);
      built = { root, parts: {} };
    } else if (def.category === 'infantry') {
      built = buildInfantry(typeId, pal, teamId);
    } else if (def.category === 'vehicle') {
      built = buildVehicle(typeId, pal);
    } else if (def.category === 'air') {
      built = buildAircraft(typeId, pal);
    } else if (def.category === 'naval') {
      built = buildNaval(typeId, pal);
    } else {
      built = buildBuilding(typeId, def, pal, opts);
    }
    if (!built.parts?.hd2d) {
      mergeStaticMeshes(built.root, built.parts);
    }
    return built;
  }

  // Upgrade steel PBR textures, HD-2D sprite sheets & Plan A CC0 GLB batch asynchronously
  function loadPlanAAssetSuite() {
    if (typeof Image !== 'undefined') {
      for (const [typeId, spec] of Object.entries(HD2D_UNIT_SPECS)) {
        const loadImg = (src, cb) => {
          const im = new Image();
          im.decoding = 'async';
          im.onload = () => { if (!disposed) cb(im); };
          im.onerror = () => {};
          im.src = src;
        };
        if (spec.deployedUrl) {
          let baseLoaded = null;
          let depLoaded = null;
          const finishBoth = () => {
            if (!baseLoaded || !depLoaded || disposed) return;
            hd2dImages.set(typeId, baseLoaded);
            hd2dDeployedImages.set(typeId, depLoaded);
            revision++;
          };
          loadImg(spec.url, (im) => { baseLoaded = im; finishBoth(); });
          loadImg(spec.deployedUrl, (im) => { depLoaded = im; finishBoth(); });
        } else {
          loadImg(spec.url, (im) => {
            hd2dImages.set(typeId, im);
            revision++;
          });
        }
      }
    }

    const texLoader = new THREE.TextureLoader();
    const upgradeTex = (url, targetTex) => {
      texLoader.load(
        url,
        (loaded) => {
          if (disposed || !loaded?.image) return;
          targetTex.image = loaded.image;
          targetTex.needsUpdate = true;
        },
        undefined,
        () => {}
      );
    };
    upgradeTex('assets/plan-a/armor_diff.jpg', steelMaps.diff);
    upgradeTex('assets/plan-a/armor_nor.jpg', steelMaps.nor);
    upgradeTex('assets/plan-a/armor_rough.jpg', steelMaps.rough);

    const gltfLoader = new GLTFLoader();
    const entries = Object.entries(PLAN_A_GLB_URLS);
    let pending = entries.length;
    for (const [key, url] of entries) {
      gltfLoader.load(
        url,
        (gltf) => {
          if (disposed) return;
          if (key === 'soldier') {
            glbTemplates.soldier = gltf.scene;
            glbTemplates.soldierAnims = gltf.animations || [];
          } else {
            glbTemplates[key] = gltf.scene;
          }
          revision++;
        },
        undefined,
        () => {
          pending--;
        }
      );
    }
  }
  loadPlanAAssetSuite();

  // Custom Upload / Manifest Overrides (.glb & .png/.webp)
  function loadGlbBufferOverride(typeId, buffer, _meta = {}) {
    if (!typeId || !buffer) return Promise.resolve({ vertexCount: 0 });
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.parse(
        buffer,
        '',
        (gltf) => {
          const def = ENTITY_DEFS[typeId];
          const rootScene = gltf.scene || new THREE.Group();
          rootScene.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(rootScene);
          const sz = new THREE.Vector3();
          const ctr = new THREE.Vector3();
          box.getSize(sz);
          box.getCenter(ctr);

          const targetSpan = def?.isBuilding
            ? Math.max(def.footprintW ?? 2, def.footprintH ?? 2) * 1.85
            : Math.max(1.6, (def?.radius ?? 1.0) * 2.15);
          const curSpan = Math.max(0.01, Math.max(sz.x, sz.z, sz.y));
          const s = targetSpan / curSpan;

          const normGroup = new THREE.Group();
          rootScene.position.set(-ctr.x * s, -box.min.y * s, -ctr.z * s);
          rootScene.scale.setScalar(s);
          normGroup.add(rootScene);

          customGlbOverrides.set(typeId, { scene: normGroup });
          customSpriteOverrides.delete(typeId);
          glbLoadedTypes.add(typeId);
          revision++;
          resolve({ vertexCount: countObjectVertices(normGroup) });
        },
        (err) => reject(err)
      );
    });
  }

  function loadSpriteBufferOverride(typeId, buffer, mime = 'image/png', _meta = {}) {
    if (!typeId || !buffer) return Promise.resolve({ vertexCount: 0 });
    return new Promise((resolve, reject) => {
      const blob = new Blob([buffer], { type: mime });
      const url = URL.createObjectURL(blob);
      const loader = new THREE.TextureLoader();
      loader.load(
        url,
        (tex) => {
          URL.revokeObjectURL(url);
          tex.colorSpace = THREE.SRGBColorSpace;
          const def = ENTITY_DEFS[typeId];
          const sc = def?.isBuilding ? Math.max(def.footprintW ?? 2, def.footprintH ?? 2) * 2.1 : Math.max(1.8, (def?.radius ?? 1.0) * 2.5);
          const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
          customSpriteOverrides.set(typeId, { material: mat, texture: tex, scale: sc });
          customGlbOverrides.delete(typeId);
          glbLoadedTypes.add(typeId);
          disposables.push(tex, mat);
          revision++;
          resolve({ vertexCount: 4 });
        },
        undefined,
        (err) => {
          URL.revokeObjectURL(url);
          reject(err);
        }
      );
    });
  }

  function restoreProceduralModel(typeId) {
    customGlbOverrides.delete(typeId);
    customSpriteOverrides.delete(typeId);
    glbLoadedTypes.delete(typeId);
    revision++;
  }

  async function syncManifestOverrides() {
    try {
      const [mRes, sRes] = await Promise.all([
        fetch('assets/models/manifest.json').catch(() => null),
        fetch('assets/sprites/manifest.json').catch(() => null)
      ]);
      if (mRes?.ok) {
        const mJson = await mRes.json();
        const models = mJson?.models || {};
        for (const [id, url] of Object.entries(models)) {
          if (!CANONICAL_ENTITY_IDS.includes(id) || typeof url !== 'string') continue;
          const r = await fetch(url).catch(() => null);
          if (r?.ok) await loadGlbBufferOverride(id, await r.arrayBuffer());
        }
      }
      if (sRes?.ok) {
        const sJson = await sRes.json();
        const sprites = sJson?.sprites || {};
        for (const [id, url] of Object.entries(sprites)) {
          if (!CANONICAL_ENTITY_IDS.includes(id) || typeof url !== 'string') continue;
          const r = await fetch(url).catch(() => null);
          if (r?.ok) {
            const ct = r.headers.get('content-type') || 'image/png';
            await loadSpriteBufferOverride(id, await r.arrayBuffer(), ct);
          }
        }
      }
    } catch {
      // Non-fatal manifest miss
    }
  }

  function dispose() {
    disposed = true;
    for (const d of disposables) d?.dispose?.();
  }

  return {
    get revision() {
      return revision;
    },
    glbLoadedTypes,
    buildInstance: buildProceduralInstance,
    loadGlbBufferOverride,
    loadSpriteBufferOverride,
    restoreProceduralModel,
    syncManifestOverrides,
    dispose
  };
}
