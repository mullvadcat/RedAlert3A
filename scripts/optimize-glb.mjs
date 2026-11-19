import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelsDir = path.resolve(rootDir, 'assets/models');
const planADir = path.resolve(rootDir, 'assets/plan-a');
const UNIT_ID_RE = /^[a-z0-9_]+$/;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 0) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        flags[arg.slice(2)] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function assertAllowedOutputPath(rawOut, unitId) {
  if (!rawOut) {
    const outPath = path.resolve(modelsDir, `${unitId}.glb`);
    if (!outPath.startsWith(modelsDir + path.sep)) {
      throw new Error('Resolved output escapes assets/models/');
    }
    return outPath;
  }
  const resolved = path.resolve(rawOut);
  const allowedRoots = [modelsDir, planADir, '/tmp', '/private/tmp'];
  const allowed = allowedRoots.some((dir) => resolved.startsWith(dir + path.sep));
  if (!allowed) {
    throw new Error(`Refusing to write outside assets/models or /tmp: ${resolved}`);
  }
  return resolved;
}

function mulMat4(a, b) {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4], b1 = b[col * 4 + 1], b2 = b[col * 4 + 2], b3 = b[col * 4 + 3];
    out[col * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

function countTriangles(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (idx) {
        tris += Math.floor(idx.getCount() / 3);
      } else {
        const pos = prim.getAttribute('POSITION');
        if (pos) tris += Math.floor(pos.getCount() / 3);
      }
    }
  }
  return tris;
}

function bakeAndNormalizeBounds(doc, targetHeight) {
  const identity = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const meshTransforms = new Map();

  function walk(node, parentMat) {
    const local = node.getMatrix();
    const world = mulMat4(parentMat, local);
    const mesh = node.getMesh();
    if (mesh && !meshTransforms.has(mesh)) {
      meshTransforms.set(mesh, world);
    }
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    for (const child of node.listChildren()) {
      walk(child, world);
    }
  }

  for (const scene of doc.getRoot().listScenes()) {
    for (const rootNode of scene.listChildren()) {
      walk(rootNode, identity);
    }
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const mesh of doc.getRoot().listMeshes()) {
    const m = meshTransforms.get(mesh) || identity;
    const isIdentity = m.every((v, idx) => Math.abs(v - identity[idx]) < 1e-6);
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const nrm = prim.getAttribute('NORMAL');
      const v = [0, 0, 0];
      const n = [0, 1, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const wx = isIdentity ? v[0] : m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
        const wy = isIdentity ? v[1] : m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
        const wz = isIdentity ? v[2] : m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
        if (!isIdentity) pos.setElement(i, [wx, wy, wz]);
        if (nrm && !isIdentity) {
          nrm.getElement(i, n);
          const nx = m[0] * n[0] + m[4] * n[1] + m[8] * n[2];
          const ny = m[1] * n[0] + m[5] * n[1] + m[9] * n[2];
          const nz = m[2] * n[0] + m[6] * n[1] + m[10] * n[2];
          const len = Math.hypot(nx, ny, nz) || 1;
          nrm.setElement(i, [nx / len, ny / len, nz / len]);
        }
        if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
        if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
        if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
      }
    }
  }

  if (!Number.isFinite(minY)) return { height: 0 };
  const cx = (minX + maxX) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const rawHeight = maxY - minY;
  const scale = Number.isFinite(targetHeight) && targetHeight > 0 && rawHeight > 1e-4
    ? targetHeight / rawHeight
    : 1.0;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        pos.setElement(i, [(v[0] - cx) * scale, (v[1] - minY) * scale, (v[2] - cz) * scale]);
      }
    }
  }
  return { height: rawHeight * scale };
}

function splitTurretGeometry(doc, splitRatio, totalHeight) {
  if (!(splitRatio > 0 && splitRatio < 1) || totalHeight <= 1e-4) return;
  const splitY = totalHeight * splitRatio;
  const scene = doc.getRoot().listScenes()[0] || doc.getRoot().getDefaultScene();
  if (!scene) return;

  for (const node of [...doc.getRoot().listNodes()]) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const turretMesh = doc.createMesh('turret');
    let addedTurret = false;

    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      if (!pos || !idx) continue;

      const hullArr = [];
      const turretArr = [];
      const arr = idx.getArray();
      const v0 = [0, 0, 0], v1 = [0, 0, 0], v2 = [0, 0, 0];

      for (let i = 0; i + 2 < arr.length; i += 3) {
        const a = arr[i], b = arr[i + 1], c = arr[i + 2];
        pos.getElement(a, v0);
        pos.getElement(b, v1);
        pos.getElement(c, v2);
        const cy = (v0[1] + v1[1] + v2[1]) / 3;
        if (cy > splitY) {
          turretArr.push(a, b, c);
        } else {
          hullArr.push(a, b, c);
        }
      }

      if (turretArr.length > 0 && hullArr.length > 0) {
        idx.setArray(new Uint32Array(hullArr));
        const cloned = prim.clone();
        const tIdx = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(turretArr)).setBuffer(idx.getBuffer());
        cloned.setIndices(tIdx);
        turretMesh.addPrimitive(cloned);
        addedTurret = true;
      }
    }

    if (addedTurret) {
      const turretNode = doc.createNode('turret').setMesh(turretMesh);
      node.addChild(turretNode);
    } else {
      turretMesh.dispose();
    }
  }
}

async function compressTextures(doc, maxTexSize) {
  const baseColorTextures = new Set();
  for (const mat of doc.getRoot().listMaterials()) {
    const tex = mat.getBaseColorTexture();
    if (tex) baseColorTextures.add(tex);
  }

  let processed = 0;
  for (const tex of doc.getRoot().listTextures()) {
    const raw = tex.getImage();
    if (!raw || raw.byteLength === 0) continue;

    const img = sharp(raw);
    const meta = await img.metadata();
    let keepAlpha = false;
    if (baseColorTextures.has(tex) && meta.hasAlpha) {
      const stats = await sharp(raw).stats();
      if (stats.channels[3] && stats.channels[3].min < 245) {
        keepAlpha = true;
      }
    }

    const resized = sharp(raw).resize({
      width: maxTexSize,
      height: maxTexSize,
      fit: 'inside',
      withoutEnlargement: true
    });

    let outBuf;
    let outMime;
    if (keepAlpha) {
      outBuf = await resized.png({ palette: true, quality: 80, compressionLevel: 9 }).toBuffer();
      outMime = 'image/png';
    } else {
      outBuf = await resized.removeAlpha().jpeg({ quality: 84, mozjpeg: true }).toBuffer();
      outMime = 'image/jpeg';
    }

    const needsResize = (meta.width || 0) > maxTexSize || (meta.height || 0) > maxTexSize;
    if (needsResize || outBuf.byteLength < raw.byteLength) {
      tex.setImage(new Uint8Array(outBuf)).setMimeType(outMime);
      processed++;
    }
  }
  return processed;
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (positional.length < 2) {
    console.error('Usage: node scripts/optimize-glb.mjs <input.glb|.gltf> <unit_id> [--tris=3500] [--tex=512] [--height=<m>] [--split-turret=<0..1>] [--register] [--out=<path>]');
    process.exit(1);
  }

  const [rawInput, unitId] = positional;
  if (!UNIT_ID_RE.test(unitId)) {
    throw new Error(`Invalid unit_id "${unitId}" (must match /^[a-z0-9_]+$/)`);
  }

  const absInput = path.resolve(rawInput);
  if (!fs.existsSync(absInput) || !fs.statSync(absInput).isFile()) {
    throw new Error(`Input file not found: ${absInput}`);
  }

  const ext = path.extname(absInput).toLowerCase();
  if (ext === '.glb') {
    const fd = fs.openSync(absInput, 'r');
    const hdr = Buffer.alloc(4);
    fs.readSync(fd, hdr, 0, 4, 0);
    fs.closeSync(fd);
    if (hdr.readUInt32LE(0) !== 0x46546c67) {
      throw new Error(`Invalid .glb magic header: ${absInput}`);
    }
  } else if (ext !== '.gltf') {
    throw new Error(`Unsupported input extension "${ext}" (expected .glb or .gltf)`);
  }

  const outPath = assertAllowedOutputPath(typeof flags.out === 'string' ? flags.out : null, unitId);
  const targetTris = Math.max(200, Number.parseInt(String(flags.tris ?? '3500'), 10) || 3500);
  const texSize = Math.max(64, Math.min(2048, Number.parseInt(String(flags.tex ?? '512'), 10) || 512));
  const targetHeight = flags.height !== undefined ? Number.parseFloat(String(flags.height)) : NaN;
  const splitTurret = flags['split-turret'] !== undefined ? Number.parseFloat(String(flags['split-turret'])) : NaN;

  let inputBytes = fs.statSync(absInput).size;
  if (ext === '.gltf') {
    try {
      const gltfMeta = JSON.parse(fs.readFileSync(absInput, 'utf8'));
      const baseDir = path.dirname(absInput);
      const uris = new Set([
        ...(gltfMeta.buffers || []).map((b) => b.uri).filter(Boolean),
        ...(gltfMeta.images || []).map((im) => im.uri).filter(Boolean)
      ]);
      for (const rel of uris) {
        if (/^data:/i.test(rel)) continue;
        const depPath = path.resolve(baseDir, decodeURIComponent(rel));
        if (depPath.startsWith(baseDir + path.sep) && fs.existsSync(depPath)) {
          inputBytes += fs.statSync(depPath).size;
        }
      }
    } catch {
      // keep base .gltf file size if JSON dependency walk fails
    }
  }
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(absInput);

  const beforeTris = countTriangles(doc);
  await doc.transform(weld());
  const ratio = Math.min(1, targetTris / Math.max(1, countTriangles(doc)));
  const maxError = flags.error !== undefined
    ? Number.parseFloat(String(flags.error))
    : (ratio < 0.08 ? 0.18 : 0.025);
  if (ratio < 0.999) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: maxError, lockBorder: false }));
  }

  const texCount = await compressTextures(doc, texSize);
  if (!flags['keep-nodes']) {
    const { height: finalHeight } = bakeAndNormalizeBounds(doc, targetHeight);
    if (Number.isFinite(splitTurret) && splitTurret > 0 && splitTurret < 1) {
      splitTurretGeometry(doc, splitTurret, finalHeight);
    }
  }

  await doc.transform(prune(), dedup());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await io.write(outPath, doc);

  const outputBytes = fs.statSync(outPath).size;
  const afterTris = countTriangles(doc);
  const savedRatio = outputBytes > 0 ? (inputBytes / outputBytes).toFixed(1) : 'inf';

  console.log(`[optimize-glb] ${unitId} -> ${outPath}`);
  console.log(`  Size: ${(inputBytes / 1024).toFixed(1)} KB -> ${(outputBytes / 1024).toFixed(1)} KB (${savedRatio}x smaller)`);
  console.log(`  Triangles: ${beforeTris} -> ${afterTris} (target ${targetTris})`);
  console.log(`  Textures optimized: ${texCount} (max ${texSize}px)`);

  if (flags.register) {
    const manifestPath = path.resolve(modelsDir, 'manifest.json');
    const manifest = fs.existsSync(manifestPath)
      ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      : { models: {} };
    if (!manifest.models || typeof manifest.models !== 'object') manifest.models = {};
    manifest.models[unitId] = { url: `./assets/models/${unitId}.glb` };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`  Registered "${unitId}" -> "./assets/models/${unitId}.glb" in manifest.json`);
  }
}

main().catch((err) => {
  console.error(`[optimize-glb] Error: ${err.message}`);
  process.exit(1);
});
