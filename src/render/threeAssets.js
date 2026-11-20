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

  // Subtle brushed metal micro-speckle & welded panel seams
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
  dCtx.strokeStyle = 'rgba(52,58,64,0.42)';
  dCtx.lineWidth = 2;
  dCtx.strokeRect(4, 4, size - 8, size - 8);
  dCtx.beginPath();
  dCtx.moveTo(0, size * 0.5);
  dCtx.lineTo(size, size * 0.5);
  dCtx.moveTo(size * 0.5, 0);
  dCtx.lineTo(size * 0.5, size);
  dCtx.stroke();

  nCtx.strokeStyle = 'rgb(108,108,248)';
  nCtx.lineWidth = 2;
  nCtx.strokeRect(4, 4, size - 8, size - 8);

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
  disposables.push(steelMaps.diff, steelMaps.nor, steelMaps.rough);

  let revision = 1;
  let disposed = false;

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
  const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  const unitHex = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
  const unitCone = new THREE.ConeGeometry(0.5, 1, 10);
  const unitSphere = new THREE.SphereGeometry(0.5, 12, 10);
  const unitTorus = new THREE.TorusGeometry(0.5, 0.14, 8, 18);

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
  disposables.push(unitBox, unitCyl, unitHex, unitCone, unitSphere, unitTorus, jetWingGeo, tailWingGeo);

  const fogHook = (mat, key) => (worldRef?.applyFogToMaterial ? worldRef.applyFogToMaterial(mat, key) : mat);

  function makePbrArmorMat(hexCol, { roughness = 0.44, metalness = 0.68, edgeWear = 0.32, transparent = false, opacity = 1 } = {}, key = 'armor') {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(hexCol),
      map: steelMaps.diff,
      normalMap: steelMaps.nor,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: steelMaps.rough,
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
    const concreteCol = new THREE.Color(0x888b8d);

    const p = {
      team: makePbrArmorMat(paintedArmor.getHex(), { roughness: 0.46, metalness: 0.56, edgeWear: 0.36 }, `team-${ti}`),
      hull: makePbrArmorMat(gunmetal.getHex(), { roughness: 0.44, metalness: 0.78, edgeWear: 0.32 }, `hull-${ti}`),
      trim: makePbrArmorMat(brightTrim.getHex(), { roughness: 0.38, metalness: 0.44, edgeWear: 0.22 }, `trim-${ti}`),
      dark: makePbrArmorMat(0x21262b, { roughness: 0.62, metalness: 0.72, edgeWear: 0.18 }, `dark-${ti}`),
      concrete: makePbrArmorMat(concreteCol.getHex(), { roughness: 0.88, metalness: 0.08, edgeWear: 0.10 }, `conc-${ti}`),
      gold: makePbrArmorMat(0xd59f2a, { roughness: 0.42, metalness: 0.48, edgeWear: 0.22 }, `gold-${ti}`),
      copper: makePbrArmorMat(0xb66e41, { roughness: 0.34, metalness: 0.84, edgeWear: 0.25 }, `cop-${ti}`),
      glass: fogHook(new THREE.MeshPhysicalMaterial({ color: 0x162e42, roughness: 0.14, metalness: 0.2, clearcoat: 0.9 }), `glass-${ti}`),
      glowCyan: fogHook(new THREE.MeshStandardMaterial({ color: 0x45d6ff, emissive: 0x22b8ff, emissiveIntensity: 1.55, roughness: 0.2 }), `glowc-${ti}`),
      glowRed: fogHook(new THREE.MeshStandardMaterial({ color: 0xff4c38, emissive: 0xff2814, emissiveIntensity: 1.6, roughness: 0.22 }), `glowr-${ti}`),
      glowGreen: fogHook(new THREE.MeshStandardMaterial({ color: 0x48ef7a, emissive: 0x1edb5a, emissiveIntensity: 1.5, roughness: 0.24 }), `glowg-${ti}`),
      glowGold: fogHook(new THREE.MeshStandardMaterial({ color: 0xffce54, emissive: 0xffa61a, emissiveIntensity: 1.55, roughness: 0.22 }), `glowy-${ti}`),
      cloak: fogHook(new THREE.MeshStandardMaterial({ color: paintedArmor, roughness: 0.28, metalness: 0.75, transparent: true, opacity: 0.38 }), `cloak-${ti}`),
      sandbag: fogHook(new THREE.MeshStandardMaterial({ color: 0x9b8e73, roughness: 0.92, metalness: 0.04 }), `sbag-${ti}`),
      whiteMed: makePbrArmorMat(0xdce1e6, { roughness: 0.48, metalness: 0.2, edgeWear: 0.12 }, `med-${ti}`),
      medCross: fogHook(new THREE.MeshStandardMaterial({ color: 0xd92828, emissive: 0x550808, emissiveIntensity: 0.35, roughness: 0.45 }), `medc-${ti}`)
    };
    disposables.push(p.glass, p.glowCyan, p.glowRed, p.glowGreen, p.glowGold, p.cloak, p.sandbag, p.medCross);
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

  // === 1. INFANTRY BUILDER (9 types, soldier.glb Mixamo rig when loaded + role kitbash) ===
  function buildInfantry(typeId, pal, teamId) {
    const root = new THREE.Group();
    const parts = { mixer: null, actions: null, sandbags: null, weaponPivot: null, legL: null, legR: null, cloakMeshes: [] };
    const isHeavy = typeId === 'tesla_trooper' || typeId === 'sledge' || typeId === 'shadow';
    const scaleH = typeId === 'sledge' ? 2.15 : (typeId === 'tesla_trooper' ? 2.0 : 1.75);

    if (glbTemplates.soldier) {
      const soldierClone = SkeletonUtils.clone(glbTemplates.soldier);
      soldierClone.rotation.y = Math.PI; // soldier.glb Mixamo model faces -Z -> rotate to +Z
      soldierClone.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(soldierClone);
      const sz = new THREE.Vector3();
      const ctr = new THREE.Vector3();
      box.getSize(sz);
      box.getCenter(ctr);
      const inner = new THREE.Group();
      soldierClone.position.set(-ctr.x, -box.min.y, -ctr.z);
      inner.add(soldierClone);
      inner.scale.setScalar(scaleH / Math.max(0.1, sz.y));

      soldierClone.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          const isVisor = (o.name || '').toLowerCase().includes('visor');
          o.material = getSoldierTeamMaterial(o.material, isVisor, teamId);
          if (typeId === 'shadow') parts.cloakMeshes.push(o);
        }
      });
      root.add(inner);

      if (glbTemplates.soldierAnims.length > 0) {
        const mixer = new THREE.AnimationMixer(soldierClone);
        const idleClip = glbTemplates.soldierAnims.find((c) => /idle/i.test(c.name)) || glbTemplates.soldierAnims[0];
        const walkClip = glbTemplates.soldierAnims.find((c) => /walk|run/i.test(c.name)) || idleClip;
        const idleAct = mixer.clipAction(idleClip);
        const walkAct = mixer.clipAction(walkClip);
        idleAct.play();
        parts.mixer = mixer;
        parts.actions = { idle: idleAct, walk: walkAct, current: 'idle' };
      }
    } else {
      // Articulated Plan A Tactical Exo-Soldier Fallback
      const bodyMat = isHeavy ? pal.hull : pal.team;
      const legL = new THREE.Group();
      legL.position.set(-0.14, 0.72, 0);
      addBox(legL, 0.16, 0.72, 0.18, 0, -0.36, 0, pal.dark);
      addBox(legL, 0.18, 0.14, 0.24, 0, -0.65, 0.03, pal.hull);
      root.add(legL);

      const legR = new THREE.Group();
      legR.position.set(0.14, 0.72, 0);
      addBox(legR, 0.16, 0.72, 0.18, 0, -0.36, 0, pal.dark);
      addBox(legR, 0.18, 0.14, 0.24, 0, -0.65, 0.03, pal.hull);
      root.add(legR);
      parts.legL = legL;
      parts.legR = legR;

      addBox(root, isHeavy ? 0.56 : 0.44, 0.58, isHeavy ? 0.36 : 0.28, 0, 1.04, 0, bodyMat);
      addBox(root, isHeavy ? 0.68 : 0.54, 0.16, 0.24, 0, 1.28, 0, pal.trim);
      addSphere(root, isHeavy ? 0.19 : 0.16, 0, 1.48, 0.02, typeId === 'engineer' ? pal.gold : pal.hull);
      addBox(root, 0.22, 0.09, 0.08, 0, 1.49, 0.14, typeId === 'chrono' || typeId === 'shadow' ? pal.glowCyan : pal.glass);

      const armL = addBox(root, 0.14, 0.46, 0.14, -0.28, 1.05, 0.12, bodyMat, -0.45);
      const armR = addBox(root, 0.14, 0.46, 0.14, 0.28, 1.05, 0.14, bodyMat, -0.6);
      if (typeId === 'shadow') parts.cloakMeshes.push(armL, armR);
    }

    // Role Weapons & Tactical Gear
    const wPivot = new THREE.Group();
    wPivot.position.set(0.24, 1.06, 0.16);
    root.add(wPivot);
    parts.weaponPivot = wPivot;

    if (typeId === 'gi' || typeId === 'conscript') {
      addBox(wPivot, 0.08, 0.11, 0.76, 0, 0, 0.28, pal.dark);
      if (typeId === 'gi') {
        const sb = new THREE.Group();
        if (glbTemplates.sandbags) {
          clonePropInto('sandbags', sb, 0.46, 0, 0, 0.65, 0);
          clonePropInto('sandbags', sb, 0.44, -0.46, 0, 0.22, Math.PI * 0.4);
          clonePropInto('sandbags', sb, 0.44, 0.46, 0, 0.22, -Math.PI * 0.4);
        } else {
          addBox(sb, 1.05, 0.42, 0.26, 0, 0.21, 0.62, pal.sandbag);
          addBox(sb, 0.26, 0.40, 0.82, -0.48, 0.20, 0.25, pal.sandbag);
          addBox(sb, 0.26, 0.40, 0.82, 0.48, 0.20, 0.25, pal.sandbag);
        }
        sb.visible = false;
        root.add(sb);
        parts.sandbags = sb;
      }
    } else if (typeId === 'flak_trooper') {
      addCyl(wPivot, 0.11, 0.12, 0.95, 0.04, 0.18, 0.15, pal.dark, Math.PI * 0.45);
      addBox(root, 0.36, 0.42, 0.24, 0, 1.06, -0.22, pal.hull);
    } else if (typeId === 'engineer') {
      addBox(wPivot, 0.14, 0.18, 0.26, 0, -0.15, 0.06, pal.gold);
    } else if (typeId === 'rocketeer') {
      addBox(root, 0.46, 0.48, 0.26, 0, 1.08, -0.22, pal.hull);
      addCyl(root, 0.09, 0.09, 0.46, -0.16, 1.02, -0.28, pal.dark, 0.18);
      addCyl(root, 0.09, 0.09, 0.46, 0.16, 1.02, -0.28, pal.dark, 0.18);
      addSphere(root, 0.08, -0.16, 0.72, -0.32, pal.glowCyan);
      addSphere(root, 0.08, 0.16, 0.72, -0.32, pal.glowCyan);
      addBox(wPivot, 0.10, 0.10, 0.64, 0, 0, 0.22, pal.dark);
    } else if (typeId === 'tesla_trooper') {
      addCyl(root, 0.12, 0.16, 0.62, -0.24, 1.38, -0.14, pal.copper);
      addCyl(root, 0.12, 0.16, 0.62, 0.24, 1.38, -0.14, pal.copper);
      addSphere(root, 0.09, -0.24, 1.72, -0.14, pal.glowCyan);
      addSphere(root, 0.09, 0.24, 1.72, -0.14, pal.glowCyan);
      addCyl(wPivot, 0.11, 0.11, 0.64, 0, 0, 0.24, pal.glowCyan, Math.PI * 0.5);
    } else if (typeId === 'chrono') {
      addCyl(root, 0.20, 0.20, 0.52, 0, 1.12, -0.24, pal.copper);
      const cCore = addSphere(root, 0.14, 0, 1.12, -0.28, pal.glowCyan);
      parts.rotor = cCore;
      addBox(wPivot, 0.10, 0.12, 0.82, 0, 0, 0.28, pal.trim);
    } else if (typeId === 'shadow') {
      addBox(wPivot, 0.07, 0.09, 1.08, 0, 0.02, 0.42, pal.dark);
      addBox(root, 0.42, 0.75, 0.10, 0, 1.0, -0.18, pal.hull);
    } else if (typeId === 'sledge') {
      addBox(root, 0.68, 0.22, 0.32, 0, 1.36, 0, pal.team);
      addCyl(root, 0.11, 0.11, 0.85, -0.34, 1.02, 0.34, pal.dark, Math.PI * 0.5);
      addCyl(root, 0.11, 0.11, 0.85, 0.34, 1.02, 0.34, pal.dark, Math.PI * 0.5);
    }

    return { root, parts };
  }

  // === 2. TANK / ARMOR / VEHICLE BUILDER (8 types, uses tank.glb for MBTs when ready) ===
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
      modelWrap.rotation.y = Math.PI * 0.5; // tank.glb barrel points -X -> +Z
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
          addCyl(tPivot, 0.11, 0.12, 2.35, -0.34, bY, 1.45, pal.dark, Math.PI * 0.5);
          addCyl(tPivot, 0.11, 0.12, 2.35, 0.34, bY, 1.45, pal.dark, Math.PI * 0.5);
          addBox(tPivot, 1.15, 0.42, 0.72, 0, tBox.max.y + 0.18, -0.35, pal.team);
          addBox(tPivot, 0.14, 0.14, 0.65, -0.38, tBox.max.y + 0.18, 0.05, pal.glowRed);
          addBox(tPivot, 0.14, 0.14, 0.65, 0.38, tBox.max.y + 0.18, 0.05, pal.glowRed);
        } else if (typeId === 'rhino') {
          addBox(tPivot, 0.92, 0.24, 0.72, 0, tBox.max.y + 0.10, -0.22, pal.hull);
        }
        parts.turret = tPivot;
      }

      if (typeId === 'apocalypse') {
        addBox(root, 2.45, 0.36, 0.52, 0, 0.34, 1.85, pal.hull);
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
      addBox(root, 1.45, 0.68, 2.35, 0, 0.58, 0, pal.team);
      addBox(root, 1.32, 0.28, 0.68, 0, 0.82, 0.72, pal.glass, 0.35);
      for (const z of [-0.78, 0, 0.78]) {
        addCyl(root, 0.32, 0.32, 0.28, -0.78, 0.32, z, pal.dark, 0, 0, Math.PI * 0.5);
        addCyl(root, 0.32, 0.32, 0.28, 0.78, 0.32, z, pal.dark, 0, 0, Math.PI * 0.5);
      }
      const turret = new THREE.Group();
      turret.position.set(0, 1.02, -0.2);
      addBox(turret, 0.68, 0.38, 0.74, 0, 0.18, 0, pal.hull);
      addCyl(turret, 0.14, 0.14, 0.72, -0.28, 0.32, 0.1, pal.trim, Math.PI * 0.5);
      addCyl(turret, 0.14, 0.14, 0.72, 0.28, 0.32, 0.1, pal.trim, Math.PI * 0.5);
      root.add(turret);
      parts.turret = turret;
    } else if (typeId === 'v3') {
      addBox(root, 0.44, 0.50, 3.15, -0.82, 0.26, 0, pal.dark);
      addBox(root, 0.44, 0.50, 3.15, 0.82, 0.26, 0, pal.dark);
      addBox(root, 1.42, 0.58, 2.95, 0, 0.58, 0, pal.team);
      addBox(root, 1.32, 0.54, 0.82, 0, 1.06, 0.92, pal.hull);
      addBox(root, 1.18, 0.24, 0.22, 0, 1.14, 1.34, pal.glass);
      const rail = new THREE.Group();
      rail.position.set(0, 1.12, -0.35);
      rail.rotation.x = -0.32;
      addBox(rail, 0.65, 0.18, 2.25, 0, 0, 0.1, pal.dark);
      const rocket = new THREE.Group();
      addCyl(rocket, 0.24, 0.24, 2.35, 0, 0.26, 0.2, pal.trim, Math.PI * 0.5);
      addCone(rocket, 0.25, 0.72, 0, 0.26, 1.62, pal.glowRed, Math.PI * 0.5);
      rail.add(rocket);
      root.add(rail);
      parts.turret = rail;
      parts.v3Rocket = rocket;
    } else if (typeId === 'prism') {
      addBox(root, 0.44, 0.46, 2.45, -0.78, 0.25, 0, pal.dark);
      addBox(root, 0.44, 0.46, 2.45, 0.78, 0.25, 0, pal.dark);
      addBox(root, 1.38, 0.48, 2.25, 0, 0.52, 0, pal.team);
      const turret = new THREE.Group();
      turret.position.set(0, 0.88, -0.05);
      addCyl(turret, 0.48, 0.54, 0.42, 0, 0.21, 0, pal.hull);
      addBox(turret, 0.22, 0.62, 0.42, 0, 0.68, -0.1, pal.trim, 0.25);
      const orb = addSphere(turret, 0.28, 0, 0.98, 0.18, pal.glowCyan);
      parts.rotor = orb;
      root.add(turret);
      parts.turret = turret;
    } else if (typeId === 'harvester') {
      addBox(root, 0.48, 0.55, 2.65, -0.92, 0.28, -0.1, pal.dark);
      addBox(root, 0.48, 0.55, 2.65, 0.92, 0.28, -0.1, pal.dark);
      addBox(root, 1.65, 0.62, 2.45, 0, 0.64, -0.1, pal.team);
      addBox(root, 1.38, 0.56, 0.82, 0, 1.15, 0.52, pal.gold);
      addBox(root, 1.24, 0.22, 0.16, 0, 1.22, 0.94, pal.glass);
      addBox(root, 1.48, 0.56, 1.42, 0, 1.05, -0.68, pal.hull);
      const oreFill = addBox(root, 1.26, 0.35, 1.18, 0, 1.24, -0.68, pal.glowGold);
      oreFill.scale.y = 0.05;
      parts.oreFill = oreFill;
      const rollers = new THREE.Group();
      rollers.position.set(0, 0.44, 1.38);
      addCyl(rollers, 0.36, 0.36, 1.72, 0, 0, 0, pal.gold, 0, 0, Math.PI * 0.5);
      addBox(rollers, 1.78, 0.56, 0.18, 0, 0, 0, pal.dark);
      root.add(rollers);
      parts.rollers = rollers;
    } else if (typeId === 'mcv') {
      addBox(root, 1.95, 0.64, 3.25, 0, 0.64, 0, pal.team);
      for (const z of [-1.15, -0.35, 0.45, 1.2]) {
        addCyl(root, 0.42, 0.42, 0.32, -1.04, 0.42, z, pal.dark, 0, 0, Math.PI * 0.5);
        addCyl(root, 0.42, 0.42, 0.32, 1.04, 0.42, z, pal.dark, 0, 0, Math.PI * 0.5);
      }
      addBox(root, 1.56, 0.68, 0.92, 0, 1.25, 0.98, pal.hull);
      addBox(root, 1.38, 0.24, 0.14, 0, 1.35, 1.45, pal.glass);
      addBox(root, 1.65, 0.85, 1.75, 0, 1.35, -0.55, pal.trim);
      addBox(root, 0.36, 0.34, 2.35, 0, 1.92, -0.25, pal.gold);
      addSphere(root, 0.14, -0.55, 1.88, 1.0, pal.glowGold);
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
      addCyl(root, 0.12, 0.20, 1.85, 0, 0.80, -1.55, pal.dark, Math.PI * 0.5);
      addBox(root, 0.08, 0.58, 0.42, -0.35, 0.98, -2.35, pal.team, 0, 0, -0.2);
      addBox(root, 0.08, 0.58, 0.42, 0.35, 0.98, -2.35, pal.team, 0, 0, 0.2);
      const stubW = new THREE.Mesh(tailWingGeo, pal.team);
      stubW.position.set(0, 0.55, 0.15);
      stubW.scale.set(1.25, 1.0, 0.85);
      stubW.castShadow = true;
      root.add(stubW);
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
      const wing = new THREE.Mesh(jetWingGeo, pal.team);
      wing.position.set(0, 0.44, 0.05);
      wing.castShadow = true;
      wing.receiveShadow = true;
      root.add(wing);
      const tail = new THREE.Mesh(tailWingGeo, pal.hull);
      tail.position.set(0, 0.46, -1.15);
      tail.castShadow = true;
      root.add(tail);
      addBox(root, 0.09, 0.54, 0.42, -0.44, 0.74, -1.18, pal.trim, 0, 0, -0.24);
      addBox(root, 0.09, 0.54, 0.42, 0.44, 0.74, -1.18, pal.trim, 0, 0, 0.24);
      addSphere(root, 0.15, -0.18, 0.44, -1.36, pal.glowCyan);
      addSphere(root, 0.15, 0.18, 0.44, -1.36, pal.glowCyan);
    } else if (typeId === 'crimson_mig') {
      addCyl(root, 0.25, 0.34, 2.95, 0, 0.48, 0, pal.hull, Math.PI * 0.5);
      addCone(root, 0.24, 0.92, 0, 0.48, 1.88, pal.team, Math.PI * 0.5);
      addSphere(root, 0.22, 0, 0.64, 0.72, pal.glass, 0.85, 0.72, 1.9);
      const wing = new THREE.Mesh(jetWingGeo, pal.team);
      wing.position.set(0, 0.46, 0.05);
      wing.scale.set(1.08, 1.0, 1.12);
      wing.castShadow = true;
      wing.receiveShadow = true;
      root.add(wing);
      const tail = new THREE.Mesh(tailWingGeo, pal.trim);
      tail.position.set(0, 0.48, -1.25);
      tail.castShadow = true;
      root.add(tail);
      addBox(root, 0.09, 0.62, 0.46, -0.38, 0.78, -1.25, pal.team, 0, 0, -0.25);
      addBox(root, 0.09, 0.62, 0.46, 0.38, 0.78, -1.25, pal.team, 0, 0, 0.25);
      addSphere(root, 0.17, -0.20, 0.46, -1.46, pal.glowGold);
      addSphere(root, 0.17, 0.20, 0.46, -1.46, pal.glowGold);
    } else if (typeId === 'kirov') {
      // Iconic Heavy Armored Airship
      addSphere(root, 1.55, 0, 2.35, 0, pal.team, 0.96, 0.96, 2.25);
      addSphere(root, 1.58, 0, 2.35, 0.25, pal.hull, 0.99, 0.99, 0.55);
      addBox(root, 0.16, 1.85, 1.55, 0, 3.05, -2.55, pal.team);
      addBox(root, 2.45, 0.14, 1.45, 0, 2.35, -2.55, pal.team);
      addBox(root, 0.78, 0.68, 2.65, 0, 0.65, 0.15, pal.hull);
      addBox(root, 0.68, 0.26, 0.55, 0, 0.78, 1.38, pal.glass);
      const rL = addBox(root, 0.08, 0.95, 0.16, -1.18, 0.88, -0.55, pal.gold);
      const rR = addBox(root, 0.08, 0.95, 0.16, 1.18, 0.88, -0.55, pal.gold);
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
      addBox(root, 2.75, 0.52, 4.15, 0, 0.28, 0, pal.dark);
      addBox(root, 2.35, 0.24, 3.65, 0, 0.64, 0, pal.hull);
      addBox(root, 0.28, 0.44, 3.45, -1.12, 0.94, -0.1, pal.team);
      addBox(root, 0.28, 0.44, 3.45, 1.12, 0.94, -0.1, pal.team);
      addBox(root, 1.85, 0.16, 0.65, 0, 0.72, 1.92, pal.trim, 0.28);
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
      const turret = new THREE.Group();
      turret.position.set(0, 0.92, 0.65);
      addBox(turret, 0.72, 0.42, 0.72, 0, 0.18, 0, pal.trim);
      addCyl(turret, 0.08, 0.09, 1.15, -0.18, 0.28, 0.48, pal.dark, Math.PI * 0.32);
      addCyl(turret, 0.08, 0.09, 1.15, 0.18, 0.28, 0.48, pal.dark, Math.PI * 0.32);
      root.add(turret);
      parts.turret = turret;
    } else if (typeId === 'aegis') {
      addBox(root, 1.95, 0.78, 4.75, 0, 0.36, 0, pal.hull);
      addCone(root, 0.98, 1.45, 0, 0.42, 2.85, pal.hull, Math.PI * 0.5);
      addBox(root, 1.55, 0.22, 4.15, 0, 0.82, -0.1, pal.team);
      addBox(root, 1.18, 1.08, 1.42, 0, 1.42, 0.25, pal.trim);
      addBox(root, 0.28, 0.95, 0.28, 0, 2.25, 0.15, pal.hull);
      const turret = new THREE.Group();
      turret.position.set(0, 1.02, 1.45);
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
      addBox(root, 2.75, 0.92, 5.85, 0, 0.44, 0, pal.hull);
      addBox(root, 3.25, 0.24, 5.95, 0, 1.02, 0, pal.dark);
      addBox(root, 0.18, 0.04, 5.35, 0, 1.16, 0, pal.gold);
      addBox(root, 0.72, 1.35, 1.48, 1.05, 1.72, -0.35, pal.team);
      addBox(root, 0.42, 0.55, 0.55, 1.05, 2.55, -0.35, pal.hull);
      // Parked strike drones on flight deck
      for (const z of [-1.4, -0.2, 1.1]) {
        addBox(root, 0.85, 0.14, 0.75, -0.65, 1.24, z, pal.trim);
      }
    } else if (typeId === 'dreadnought') {
      addBox(root, 2.85, 0.96, 5.75, 0, 0.46, 0, pal.hull);
      addBox(root, 2.45, 0.32, 5.25, 0, 1.05, 0, pal.team);
      addBox(root, 1.65, 1.15, 1.65, 0, 1.68, -0.15, pal.hull);
      addBox(root, 1.45, 0.48, 1.15, -0.45, 1.42, -1.65, pal.glowRed);
      addBox(root, 1.45, 0.48, 1.15, 0.45, 1.42, -1.65, pal.glowRed);
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
  function buildBuilding(typeId, def, pal) {
    const root = new THREE.Group();
    const parts = { turret: null, rotor: null, pump: null, beacon: null, glowMesh: null };
    const w = (def.footprintW ?? 2) * 2;
    const h = (def.footprintH ?? 2) * 2;

    // Grounded heavy chamfered concrete foundation plinth matching footprintW x footprintH meters
    if (typeId !== 'naval_yard') {
      addBox(root, w - 0.15, 0.42, h - 0.15, 0, 0.21, 0, pal.concrete);
      addBox(root, w - 0.38, 0.12, h - 0.38, 0, 0.44, 0, pal.hull);
    }

    if (typeId === 'conyard') {
      addBox(root, w * 0.82, 1.65, h * 0.72, 0, 1.28, -0.35, pal.hull);
      addBox(root, w * 0.58, 0.85, h * 0.52, -0.65, 2.35, -0.55, pal.team);
      addBox(root, w * 0.72, 0.22, h * 0.35, 0.45, 0.62, h * 0.24, pal.trim);
      if (glbTemplates.crate) clonePropInto('crate', root, 1.15, -w * 0.28, 0.48, h * 0.26, 0.4);
      if (glbTemplates.fuel) clonePropInto('fuel', root, 1.45, w * 0.32, 0.48, -h * 0.24, 0);
      const crane = new THREE.Group();
      crane.position.set(1.15, 2.65, -0.45);
      addCyl(crane, 0.32, 0.42, 0.75, 0, 0.35, 0, pal.gold);
      addBox(crane, 0.42, 0.46, 3.85, 0, 0.95, 1.25, pal.gold, -0.35);
      addCyl(crane, 0.06, 0.06, 1.35, 0, 0.35, 2.75, pal.dark);
      addBox(crane, 0.65, 0.35, 0.65, 0, -0.35, 2.75, pal.team);
      root.add(crane);
      parts.rotor = crane;
      const bcn = addSphere(root, 0.22, -0.65, 3.05, -0.55, pal.glowCyan);
      parts.beacon = bcn;
    } else if (typeId === 'power_plant') {
      if (glbTemplates.generator) {
        clonePropInto('generator', root, 2.25, 0, 0.48, 0, Math.PI * 0.25);
      } else {
        addBox(root, w * 0.76, 1.35, h * 0.65, 0, 1.12, 0, pal.hull);
      }
      for (const sx of [-0.85, 0.85]) {
        addCyl(root, 0.48, 0.62, 2.55, sx, 1.72, -0.25, pal.team);
        const cap = addCyl(root, 0.52, 0.52, 0.24, sx, 3.02, -0.25, pal.glowCyan);
        parts.glowMesh = cap;
      }
    } else if (typeId === 'nuclear_reactor') {
      addBox(root, w * 0.82, 1.55, h * 0.78, 0, 1.22, 0, pal.hull);
      addSphere(root, 1.45, 0, 2.15, 0, pal.team, 1.0, 0.92, 1.0);
      const core = addCyl(root, 0.92, 1.02, 0.45, 0, 3.15, 0, pal.glowGreen);
      parts.glowMesh = core;
      addCyl(root, 0.42, 0.64, 3.65, -1.65, 2.25, -1.45, pal.concrete);
      addCyl(root, 0.42, 0.64, 3.65, 1.65, 2.25, -1.45, pal.concrete);
    } else if (typeId === 'refinery') {
      addBox(root, w * 0.80, 2.15, h * 0.54, 0, 1.52, -0.75, pal.team);
      addBox(root, w * 0.46, 0.28, h * 0.45, 0, 0.56, 1.25, pal.gold);
      if (glbTemplates.fuel) {
        clonePropInto('fuel', root, 2.05, -1.65, 0.48, -1.1, 0);
        clonePropInto('fuel', root, 2.05, 1.65, 0.48, -1.1, 0.4);
      } else {
        addCyl(root, 0.72, 0.72, 2.55, -1.55, 1.72, -0.95, pal.hull);
        addCyl(root, 0.72, 0.72, 2.55, 1.55, 1.72, -0.95, pal.hull);
      }
      addCyl(root, 0.34, 0.42, 3.35, 1.45, 2.15, -1.55, pal.dark);
    } else if (typeId === 'barracks') {
      addBox(root, w * 0.82, 1.65, h * 0.65, 0, 1.28, -0.35, pal.team);
      addBox(root, w * 0.88, 0.32, h * 0.68, 0, 2.18, -0.35, pal.hull);
      addBox(root, 1.45, 1.25, 0.55, 0, 1.08, h * 0.25, pal.dark);
      if (glbTemplates.sandbags) {
        clonePropInto('sandbags', root, 0.55, -1.15, 0.48, h * 0.38, 0.2);
        clonePropInto('sandbags', root, 0.55, 1.15, 0.48, h * 0.38, -0.2);
      }
    } else if (typeId === 'war_factory') {
      // Opaque dark backing hull prevents skylight gaps behind recessed garage doors & windows
      addBox(root, w * 0.78, 2.45, h * 0.70, 0, 1.65, -0.1, pal.dark);
      addBox(root, w * 0.82, 0.28, h * 0.74, 0, 2.95, -0.1, pal.hull);
      if (glbTemplates.factory) {
        const fs = glbTemplates.factory;
        const gWall = extractNamedSubnode(fs, 'wall_door_garage_double_01', 2.45);
        const gDoor = extractNamedSubnode(fs, 'door_garage_double_01', 1.95);
        const sWallL = extractNamedSubnode(fs, 'wall_tall_large_01', 2.45);
        const sWinL = extractNamedSubnode(fs, 'window_tall_large_01', 1.45);
        const sWallR = extractNamedSubnode(fs, 'wall_tall_large_01', 2.45);
        const sWinR = extractNamedSubnode(fs, 'window_tall_large_01', 1.45);
        const roofTrim = extractNamedSubnode(fs, 'cornice01_standard_standard_01', 0.42);
        if (gWall) { gWall.position.set(0, 0.48, h * 0.34); root.add(gWall); }
        if (gDoor) { gDoor.position.set(0, 0.48, h * 0.35); root.add(gDoor); }
        if (sWallL) { sWallL.rotation.y = -Math.PI * 0.5; sWallL.position.set(-w * 0.39, 0.48, -0.1); root.add(sWallL); }
        if (sWinL) { sWinL.rotation.y = -Math.PI * 0.5; sWinL.position.set(-w * 0.40, 0.95, -0.1); root.add(sWinL); }
        if (sWallR) { sWallR.rotation.y = Math.PI * 0.5; sWallR.position.set(w * 0.39, 0.48, -0.1); root.add(sWallR); }
        if (sWinR) { sWinR.rotation.y = Math.PI * 0.5; sWinR.position.set(w * 0.40, 0.95, -0.1); root.add(sWinR); }
        if (roofTrim) { roofTrim.position.set(0, 2.72, h * 0.34); root.add(roofTrim); }
      } else {
        addBox(root, w * 0.85, 2.45, h * 0.78, 0, 1.65, 0, pal.team);
        addBox(root, 3.45, 1.75, 0.45, 0, 1.32, h * 0.38, pal.dark);
      }
      if (glbTemplates.barrier) clonePropInto('barrier', root, 0.68, -w * 0.38, 0.48, h * 0.4, 0);
      if (glbTemplates.crate) clonePropInto('crate', root, 1.05, w * 0.36, 0.48, h * 0.36, 0.3);
      if (glbTemplates.fuel) clonePropInto('fuel', root, 1.45, -w * 0.42, 0.48, -h * 0.28, 0.2);
      addBox(root, 0.34, 2.65, 0.34, -w * 0.36, 1.75, h * 0.25, pal.gold);
      addBox(root, 0.34, 2.65, 0.34, w * 0.36, 1.75, h * 0.25, pal.gold);
      addBox(root, w * 0.78, 0.34, 0.42, 0, 3.05, h * 0.25, pal.gold);
    } else if (typeId === 'naval_yard') {
      // Floating sea drydock slipway at y=0
      addBox(root, 1.45, 1.45, h * 0.88, -w * 0.36, 0.75, 0, pal.hull);
      addBox(root, 1.45, 1.45, h * 0.88, w * 0.36, 0.75, 0, pal.hull);
      addBox(root, w * 0.82, 0.55, 1.55, 0, 0.45, -h * 0.34, pal.team);
      addBox(root, w * 0.85, 0.36, 0.55, 0, 3.25, 0, pal.gold);
      addBox(root, 0.42, 2.55, 0.42, -w * 0.36, 2.05, 0, pal.gold);
      addBox(root, 0.42, 2.55, 0.42, w * 0.36, 2.05, 0, pal.gold);
      addSphere(root, 0.22, -w * 0.36, 3.58, 0, pal.glowCyan);
      addSphere(root, 0.22, w * 0.36, 3.58, 0, pal.glowCyan);
    } else if (typeId === 'airforce_radar') {
      addBox(root, w * 0.78, 1.85, h * 0.78, 0, 1.38, 0, pal.hull);
      addBox(root, w * 0.72, 0.22, h * 0.65, 0, 2.38, 0, pal.trim);
      const dish = new THREE.Group();
      dish.position.set(0, 2.75, -0.45);
      addCyl(dish, 0.22, 0.26, 0.75, 0, 0.2, 0, pal.dark);
      addCone(dish, 1.15, 0.55, 0, 0.82, 0.22, pal.team, -Math.PI * 0.42);
      addSphere(dish, 0.16, 0, 0.86, 0.62, pal.glowCyan);
      root.add(dish);
      parts.rotor = dish;
    } else if (typeId === 'service_depot') {
      addBox(root, w * 0.75, 0.28, h * 0.75, 0, 0.56, 0, pal.gold);
      addBox(root, w * 0.52, 0.32, h * 0.52, 0, 0.78, 0, pal.dark);
      const crane = new THREE.Group();
      crane.position.set(-w * 0.32, 0.65, -h * 0.32);
      addCyl(crane, 0.32, 0.36, 1.85, 0, 0.9, 0, pal.gold);
      addBox(crane, 0.36, 0.32, 2.85, 0.85, 2.05, 0.85, pal.team, 0.15, Math.PI * 0.25);
      root.add(crane);
      parts.rotor = crane;
    } else if (typeId === 'battle_lab') {
      addBox(root, w * 0.82, 1.65, h * 0.82, 0, 1.28, 0, pal.hull);
      addBox(root, w * 0.54, 1.35, h * 0.54, 0, 2.55, 0, pal.team);
      const core = addSphere(root, 0.85, 0, 3.85, 0, pal.glowCyan);
      parts.glowMesh = core;
      for (const [rx, rz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
        addCyl(root, 0.12, 0.16, 2.85, rx, 2.25, rz, pal.trim);
      }
    } else if (typeId === 'pillbox') {
      addCyl(root, 0.78, 0.92, 0.88, 0, 0.75, 0, pal.concrete);
      addBox(root, 0.95, 0.24, 0.95, 0, 1.24, 0, pal.hull);
      const turret = new THREE.Group();
      turret.position.set(0, 0.92, 0);
      addCyl(turret, 0.08, 0.08, 0.95, -0.18, 0, 0.72, pal.dark, Math.PI * 0.5);
      addCyl(turret, 0.08, 0.08, 0.95, 0.18, 0, 0.72, pal.dark, Math.PI * 0.5);
      root.add(turret);
      parts.turret = turret;
    } else if (typeId === 'aa_turret') {
      addCyl(root, 0.65, 0.78, 0.78, 0, 0.68, 0, pal.hull);
      const turret = new THREE.Group();
      turret.position.set(0, 1.15, 0);
      addBox(turret, 0.96, 0.56, 0.82, 0, 0.25, 0, pal.team);
      for (const sx of [-0.28, 0.28]) {
        for (const sy of [0.15, 0.42]) {
          addCyl(turret, 0.10, 0.10, 1.15, sx, sy, 0.35, pal.dark, Math.PI * 0.32);
        }
      }
      root.add(turret);
      parts.turret = turret;
    } else if (typeId === 'prism_tower') {
      addCyl(root, 0.52, 0.82, 2.25, 0, 1.45, 0, pal.hull);
      addCyl(root, 0.38, 0.52, 1.45, 0, 3.05, 0, pal.team);
      const orb = addSphere(root, 0.44, 0, 4.18, 0, pal.glowCyan);
      parts.glowMesh = orb;
    } else if (typeId === 'tesla_coil') {
      addCyl(root, 0.62, 0.84, 1.35, 0, 1.02, 0, pal.hull);
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
      addBox(root, w * 0.82, 1.15, h * 0.82, 0, 0.98, 0, pal.hull);
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
      addBox(root, w * 0.84, 1.05, h * 0.84, 0, 0.92, 0, pal.dark);
      addBox(root, 1.1, 3.65, 1.1, -1.65, 2.4, 0, pal.team);
      addBox(root, 1.1, 3.65, 1.1, 1.65, 2.4, 0, pal.team);
      const orb = addSphere(root, 0.82, 0, 3.05, 0, pal.glowRed);
      parts.glowMesh = orb;
    } else if (typeId === 'weather_control') {
      addBox(root, w * 0.76, 1.25, h * 0.76, 0, 1.02, 0, pal.hull);
      addCyl(root, 0.42, 0.92, 4.15, 0, 3.25, 0, pal.team);
      const halo = new THREE.Mesh(unitTorus, pal.glowCyan);
      halo.scale.set(2.4, 2.4, 2.4);
      halo.rotation.x = Math.PI * 0.5;
      halo.position.y = 5.15;
      root.add(halo);
      parts.rotor = halo;
      parts.glowMesh = addSphere(root, 0.55, 0, 5.45, 0, pal.glowCyan);
    } else if (typeId === 'nuclear_silo') {
      addBox(root, w * 0.85, 1.25, h * 0.85, 0, 1.02, 0, pal.concrete);
      addCyl(root, 1.55, 1.65, 0.65, 0, 1.55, 0, pal.dark);
      addCyl(root, 0.52, 0.65, 2.95, 0, 2.35, 0, pal.trim);
      addCone(root, 0.54, 1.15, 0, 4.25, 0, pal.glowRed);
    } else if (typeId === 'oil_derrick') {
      addCyl(root, 0.42, 0.98, 4.15, 0, 2.45, 0, pal.dark);
      if (glbTemplates.fuel) clonePropInto('fuel', root, 1.55, -1.15, 0.48, 0.95, 0);
      const pump = new THREE.Group();
      pump.position.set(0.35, 3.25, 0);
      addBox(pump, 0.32, 0.34, 2.55, 0, 0, 0, pal.gold);
      root.add(pump);
      parts.pump = pump;
    } else if (typeId === 'tech_airport') {
      addBox(root, w * 0.86, 0.35, h * 0.86, 0, 0.58, 0, pal.dark);
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
      if (!mat || Array.isArray(mat)) continue;
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
        if (g.attributes.tangent) g.deleteAttribute('tangent');
        if (!g.attributes.uv && g.attributes.position) {
          g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        }
        g.applyMatrix4(m.matrix);
        tempGeos.push(g);
      }
      const merged = mergeGeometries(tempGeos, false);
      for (const tg of tempGeos) tg.dispose();
      if (!merged) continue;
      for (const m of list) root.remove(m);
      const mergedMesh = new THREE.Mesh(merged, mat);
      mergedMesh.castShadow = true;
      mergedMesh.receiveShadow = true;
      root.add(mergedMesh);
      ownedGeos.push(merged);
    }
    if (ownedGeos.length > 0) {
      root.userData.ownedGeos = ownedGeos;
    }
  }

  function buildProceduralInstance(typeId, teamId) {
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
      built = buildBuilding(typeId, def, pal);
    }
    mergeStaticMeshes(built.root, built.parts);
    return built;
  }

  // Upgrade steel PBR textures & Plan A CC0 GLB batch asynchronously
  function loadPlanAAssetSuite() {
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
