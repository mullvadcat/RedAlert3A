// Zero-dependency glTF 2.0 (.glb) binary mesh loader -> RedAlert3A InstancedMesh batch geometry.
// Produces layout identical to procedural models:
//   Vertex (10 floats): pos(3), normal(3), uv(2), aPartId(1), aTone(1).
//   Part tagging via node/mesh name conventions:
//     * turret / head / dish / crane / wing / rotor -> aPartId = 1
//     * barrel / gun / weapon / cannon / missile  -> aPartId = 2
//     * everything else                            -> aPartId = 0

function readAccessorAsArray(json, binView, binByteOffset, accessorIdx) {
  const acc = json.accessors?.[accessorIdx];
  if (!acc) return null;
  const bv = json.bufferViews?.[acc.bufferView];
  if (!bv) return null;

  const numComp = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT4: 16
  }[acc.type] ?? 1;

  const TypedMap = {
    5120: Int8Array,
    5121: Uint8Array,
    5122: Int16Array,
    5123: Uint16Array,
    5125: Uint32Array,
    5126: Float32Array
  };
  const Ctor = TypedMap[acc.componentType];
  if (!Ctor) return null;

  const elemSize = Ctor.BYTES_PER_ELEMENT;
  const byteOffset = binByteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const byteStride = bv.byteStride ?? (numComp * elemSize);

  const out = new Ctor(acc.count * numComp);
  if (byteStride === numComp * elemSize && byteOffset % elemSize === 0) {
    out.set(new Ctor(binView.buffer, byteOffset, acc.count * numComp));
    return out;
  }

  for (let i = 0; i < acc.count; i++) {
    const rowOff = byteOffset + i * byteStride;
    for (let c = 0; c < numComp; c++) {
      const off = rowOff + c * elemSize;
      switch (acc.componentType) {
        case 5120: out[i * numComp + c] = binView.getInt8(off); break;
        case 5121: out[i * numComp + c] = binView.getUint8(off); break;
        case 5122: out[i * numComp + c] = binView.getInt16(off, true); break;
        case 5123: out[i * numComp + c] = binView.getUint16(off, true); break;
        case 5125: out[i * numComp + c] = binView.getUint32(off, true); break;
        case 5126: out[i * numComp + c] = binView.getFloat32(off, true); break;
      }
    }
  }
  return out;
}

function mulMat4(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4], b1 = b[col * 4 + 1], b2 = b[col * 4 + 2], b3 = b[col * 4 + 3];
    out[col * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

function nodeToMat4(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    return new Float32Array(node.matrix);
  }
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  const [qx, qy, qz, qw] = r;
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;

  return new Float32Array([
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1
  ]);
}

function inferPartId(name = '') {
  const n = name.toLowerCase();
  if (/barrel|gun|cannon|muzzle|weapon|missile|launcher/.test(n)) return 2;
  if (/turret|head|dish|radar|crane|rotor|sail/.test(n)) return 1;
  return 0;
}

function inferToneFromMaterial(mat) {
  if (!mat) return 0;
  const name = (mat.name ?? '').toLowerCase();
  if (/glass|canopy|visor|crystal|prism/.test(name)) return 6;
  if (/glow|emissive|neon|core|thruster|optic/.test(name)) return 2;
  if (/track|tire|rubber|gunmetal|dark/.test(name)) return 1;
  if (/stripe|team|faction|accent|trim/.test(name)) return 5;
  if (/hazard|yellow|chevron/.test(name)) return 4;
  if (/sand|cloth|khaki|concrete/.test(name)) return 7;

  const em = mat.emissiveFactor;
  if (em && (em[0] + em[1] + em[2]) > 0.35) return 2;

  const pbr = mat.pbrMetallicRoughness;
  if (pbr?.baseColorFactor) {
    const [r, g, b] = pbr.baseColorFactor;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (sat > 0.35) return 5; // Saturated material mapped to faction trim
    if ((r + g + b) < 0.45) return 1; // Dark tracks / metal
  }
  return 0;
}

function decodeDataUri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('data:')) return null;
  const commaIdx = uri.indexOf(',');
  if (commaIdx < 0) return null;
  const meta = uri.slice(5, commaIdx);
  const mimeType = meta.split(';')[0] || 'image/png';
  const payload = uri.slice(commaIdx + 1);
  if (!meta.includes(';base64')) return null;
  if (typeof atob === 'function') {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mimeType };
  }
  if (typeof Buffer !== 'undefined') {
    return { bytes: new Uint8Array(Buffer.from(payload, 'base64')), mimeType };
  }
  return null;
}

function readGlbImageBytes(json, arrayBuffer, binOffset, imgDef) {
  if (!imgDef) return null;
  if (imgDef.bufferView !== undefined) {
    const bv = json.bufferViews?.[imgDef.bufferView];
    if (!bv) return null;
    const start = binOffset + (bv.byteOffset ?? 0);
    const len = bv.byteLength ?? 0;
    if (start < 0 || start + len > arrayBuffer.byteLength || len <= 0) return null;
    return {
      bytes: new Uint8Array(arrayBuffer.slice(start, start + len)),
      mimeType: imgDef.mimeType || 'image/png'
    };
  }
  if (imgDef.uri) {
    return decodeDataUri(imgDef.uri);
  }
  return null;
}

function resolveTextureImage(json, arrayBuffer, binOffset, texIndex) {
  if (texIndex === undefined || texIndex === null) return null;
  const texDef = json.textures?.[texIndex];
  const imgIdx = texDef?.source;
  const imgDef = imgIdx !== undefined ? json.images?.[imgIdx] : null;
  return readGlbImageBytes(json, arrayBuffer, binOffset, imgDef);
}

function extractEmbeddedPbrTextures(json, arrayBuffer, binOffset, firstTexMaterialIdx) {
  const materials = Array.isArray(json.materials) ? json.materials : [];
  const candidates = [];
  if (firstTexMaterialIdx >= 0 && materials[firstTexMaterialIdx]) {
    candidates.push(materials[firstTexMaterialIdx]);
  }
  for (let i = 0; i < materials.length; i++) {
    if (i !== firstTexMaterialIdx && materials[i]) candidates.push(materials[i]);
  }

  let primaryMat = candidates[0] || null;
  for (const m of candidates) {
    if (m?.pbrMetallicRoughness?.baseColorTexture?.index !== undefined) {
      primaryMat = m;
      break;
    }
  }

  let albedoImage = null;
  let normalImage = null;
  let mrImage = null;
  let emissiveImage = null;

  const pbr = primaryMat?.pbrMetallicRoughness;
  const f = Array.isArray(pbr?.baseColorFactor) ? pbr.baseColorFactor : [1, 1, 1, 1];
  const metallicFactor = typeof pbr?.metallicFactor === 'number' ? pbr.metallicFactor : 1.0;
  const roughnessFactor = typeof pbr?.roughnessFactor === 'number' ? pbr.roughnessFactor : 1.0;
  const normalScale = typeof primaryMat?.normalTexture?.scale === 'number' ? primaryMat.normalTexture.scale : 1.0;
  const emissiveFactor = Array.isArray(primaryMat?.emissiveFactor) ? primaryMat.emissiveFactor : [0, 0, 0];

  const baseDecoded = resolveTextureImage(json, arrayBuffer, binOffset, pbr?.baseColorTexture?.index);
  if (baseDecoded) {
    albedoImage = {
      bytes: baseDecoded.bytes,
      mimeType: baseDecoded.mimeType,
      baseColorFactor: [f[0] ?? 1, f[1] ?? 1, f[2] ?? 1, f[3] ?? 1]
    };
  } else if (Array.isArray(json.images) && json.images.length > 0) {
    const fallbackDecoded = readGlbImageBytes(json, arrayBuffer, binOffset, json.images[0]);
    if (fallbackDecoded) {
      albedoImage = {
        bytes: fallbackDecoded.bytes,
        mimeType: fallbackDecoded.mimeType,
        baseColorFactor: [f[0] ?? 1, f[1] ?? 1, f[2] ?? 1, f[3] ?? 1]
      };
    }
  }

  const norDecoded = resolveTextureImage(json, arrayBuffer, binOffset, primaryMat?.normalTexture?.index);
  if (norDecoded) {
    normalImage = { bytes: norDecoded.bytes, mimeType: norDecoded.mimeType, normalScale };
  }

  const mrDecoded = resolveTextureImage(json, arrayBuffer, binOffset, pbr?.metallicRoughnessTexture?.index);
  if (mrDecoded) {
    mrImage = { bytes: mrDecoded.bytes, mimeType: mrDecoded.mimeType, metallicFactor, roughnessFactor };
  }

  const emDecoded = resolveTextureImage(json, arrayBuffer, binOffset, primaryMat?.emissiveTexture?.index);
  if (emDecoded) {
    emissiveImage = { bytes: emDecoded.bytes, mimeType: emDecoded.mimeType, emissiveFactor };
  }

  return {
    albedoImage,
    normalImage,
    mrImage,
    emissiveImage,
    materialFactors: { metallicFactor, roughnessFactor, normalScale }
  };
}

export function parseGlbGeometry(arrayBuffer, options = {}) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 20) throw new Error('GLB too small');

  const magic = view.getUint32(0, true);
  if (magic !== 0x46546c67) throw new Error('Invalid GLB magic header');
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`Unsupported glTF version ${version}`);

  let offset = 12;
  let json = null;
  let binOffset = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkLen = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const dataOff = offset + 8;
    if (chunkType === 0x4e4f534a) {
      const jsonBytes = new Uint8Array(arrayBuffer, dataOff, chunkLen);
      json = JSON.parse(new TextDecoder().decode(jsonBytes));
    } else if (chunkType === 0x004e4942) {
      binOffset = dataOff;
    }
    offset = dataOff + chunkLen;
  }

  if (!json || !binOffset) {
    throw new Error('GLB missing JSON or BIN chunk');
  }

  const outVerts = [];
  const outIdx = [];
  let vertCount = 0;
  let firstTexMaterialIdx = -1;

  const nodes = json.nodes ?? [];
  const scenes = json.scenes ?? [];
  const rootNodes = scenes[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);

  function visitNode(nodeIdx, parentMat, inheritedPart) {
    const node = nodes[nodeIdx];
    if (!node) return;
    const localMat = nodeToMat4(node);
    const worldMat = parentMat ? mulMat4(parentMat, localMat) : localMat;
    const partId = node.name ? Math.max(inheritedPart, inferPartId(node.name)) : inheritedPart;

    if (typeof node.mesh === 'number') {
      const mesh = json.meshes?.[node.mesh];
      const meshPart = mesh?.name ? Math.max(partId, inferPartId(mesh.name)) : partId;

      for (const prim of (mesh?.primitives ?? [])) {
        if (prim.mode !== undefined && prim.mode !== 4) continue; // TRIANGLES only
        const pos = readAccessorAsArray(json, view, binOffset, prim.attributes?.POSITION);
        if (!pos) continue;

        const norm = prim.attributes?.NORMAL !== undefined
          ? readAccessorAsArray(json, view, binOffset, prim.attributes.NORMAL)
          : null;
        const uv = prim.attributes?.TEXCOORD_0 !== undefined
          ? readAccessorAsArray(json, view, binOffset, prim.attributes.TEXCOORD_0)
          : null;
        const idxArr = prim.indices !== undefined
          ? readAccessorAsArray(json, view, binOffset, prim.indices)
          : null;

        const matDef = prim.material !== undefined ? json.materials?.[prim.material] : null;
        if (firstTexMaterialIdx < 0 && matDef?.pbrMetallicRoughness?.baseColorTexture?.index !== undefined) {
          firstTexMaterialIdx = prim.material;
        }
        const tone = inferToneFromMaterial(matDef);

        const baseVert = vertCount;
        const count = pos.length / 3;
        const scale = options.scale ?? 1.0;

        for (let i = 0; i < count; i++) {
          const px = pos[i * 3 + 0], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
          const wx = (worldMat[0] * px + worldMat[4] * py + worldMat[8] * pz + worldMat[12]) * scale;
          const wy = (worldMat[1] * px + worldMat[5] * py + worldMat[9] * pz + worldMat[13]) * scale;
          const wz = (worldMat[2] * px + worldMat[6] * py + worldMat[10] * pz + worldMat[14]) * scale;

          let nx = 0, ny = 1, nz = 0;
          if (norm) {
            const lx = norm[i * 3 + 0], ly = norm[i * 3 + 1], lz = norm[i * 3 + 2];
            nx = worldMat[0] * lx + worldMat[4] * ly + worldMat[8] * lz;
            ny = worldMat[1] * lx + worldMat[5] * ly + worldMat[9] * lz;
            nz = worldMat[2] * lx + worldMat[6] * ly + worldMat[10] * lz;
            const nLen = Math.hypot(nx, ny, nz) || 1;
            nx /= nLen; ny /= nLen; nz /= nLen;
          }

          const u = uv ? uv[i * 2 + 0] : 0.5;
          const v = uv ? uv[i * 2 + 1] : 0.5;
          outVerts.push(wx, wy, wz, nx, ny, nz, u, v, meshPart, tone);
          vertCount++;
        }

        if (idxArr) {
          for (let i = 0; i < idxArr.length; i++) {
            outIdx.push(baseVert + idxArr[i]);
          }
        } else {
          for (let i = 0; i < count; i++) {
            outIdx.push(baseVert + i);
          }
        }
      }
    }

    for (const childIdx of (node.children ?? [])) {
      visitNode(childIdx, worldMat, partId);
    }
  }

  for (const rIdx of rootNodes) {
    visitNode(rIdx, null, 0);
  }

  // Center XZ, ground Y minimum at 0, and optionally normalize bounding height or horizontal radius
  if (vertCount > 0) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < vertCount; i++) {
      const x = outVerts[i * 10 + 0];
      const y = outVerts[i * 10 + 1];
      const z = outVerts[i * 10 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    const cx = options.centerXZ !== false ? (minX + maxX) * 0.5 : 0;
    const cz = options.centerXZ !== false ? (minZ + maxZ) * 0.5 : 0;
    const oy = options.groundY !== false ? minY : 0;

    let normScale = 1.0;
    const spanY = maxY - minY;
    const halfSpanXZ = Math.max(maxX - minX, maxZ - minZ) * 0.5;
    if (Number.isFinite(options.targetHeight) && options.targetHeight > 0 && spanY > 1e-4) {
      normScale = options.targetHeight / spanY;
    } else if (Number.isFinite(options.targetRadius) && options.targetRadius > 0 && halfSpanXZ > 1e-4) {
      normScale = options.targetRadius / halfSpanXZ;
    }

    if (cx !== 0 || cz !== 0 || Math.abs(oy) > 1e-4 || Math.abs(normScale - 1.0) > 1e-4) {
      for (let i = 0; i < vertCount; i++) {
        outVerts[i * 10 + 0] = (outVerts[i * 10 + 0] - cx) * normScale;
        outVerts[i * 10 + 1] = (outVerts[i * 10 + 1] - oy) * normScale;
        outVerts[i * 10 + 2] = (outVerts[i * 10 + 2] - cz) * normScale;
      }
    }
  }

  const useUint32 = vertCount > 65535;
  const pbrTex = extractEmbeddedPbrTextures(json, arrayBuffer, binOffset, firstTexMaterialIdx);
  return {
    vertices: new Float32Array(outVerts),
    indices: useUint32 ? new Uint32Array(outIdx) : new Uint16Array(outIdx),
    useUint32,
    indexCount: outIdx.length,
    vertexCount: vertCount,
    albedoImage: pbrTex.albedoImage,
    normalImage: pbrTex.normalImage,
    mrImage: pbrTex.mrImage,
    emissiveImage: pbrTex.emissiveImage,
    materialFactors: pbrTex.materialFactors
  };
}

export async function fetchAndParseGlb(url, options = {}) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  const buf = await res.arrayBuffer();
  return parseGlbGeometry(buf, options);
}
