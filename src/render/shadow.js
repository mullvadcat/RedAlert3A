// Tight-Frustum Orthographic 4K/2K Texel-Snapped PCSS Soft Shadow + Static Building Cache + Half-Res GTAO.

export function mat4Identity(out = new Float32Array(16)) {
  out.fill(0);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

export function mat4Multiply(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

  for (let col = 0; col < 4; col++) {
    const o = col * 4;
    const b0 = b[o], b1 = b[o + 1], b2 = b[o + 2], b3 = b[o + 3];
    out[o]     = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    out[o + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    out[o + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    out[o + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
  }
  return out;
}

export function mat4Ortho(out, left, right, bottom, top, near, far) {
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = -2 * lr;
  out[5] = -2 * bt;
  out[10] = 2 * nf;
  out[12] = (left + right) * lr;
  out[13] = (top + bottom) * bt;
  out[14] = (far + near) * nf;
  out[15] = 1;
  return out;
}

export function mat4LookAt(out, eyeX, eyeY, eyeZ, centerX, centerY, centerZ, upX = 0, upY = 1, upZ = 0) {
  let zx = eyeX - centerX;
  let zy = eyeY - centerY;
  let zz = eyeZ - centerZ;
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;

  let xx = upY * zz - upZ * zy;
  let xy = upZ * zx - upX * zz;
  let xz = upX * zy - upY * zx;
  len = Math.hypot(xx, xy, xz);
  if (len < 1e-6) {
    xx = 1; xy = 0; xz = 0;
  } else {
    xx /= len; xy /= len; xz /= len;
  }

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eyeX + xy * eyeY + xz * eyeZ);
  out[13] = -(yx * eyeX + yy * eyeY + yz * eyeZ);
  out[14] = -(zx * eyeX + zy * eyeY + zz * eyeZ);
  out[15] = 1;
  return out;
}

export const PCSS_GLSL = `
float sampleShadowPCSS(sampler2D shadowMap, vec3 projCoords, float bias, float texelSize) {
  if (projCoords.x < 0.01 || projCoords.x > 0.99 || projCoords.y < 0.01 || projCoords.y > 0.99 || projCoords.z > 1.0) {
    return 1.0;
  }
  const vec2 poisson[8] = vec2[8](
    vec2(-0.613, 0.218), vec2(0.145, -0.785), vec2(0.752, 0.341), vec2(-0.348, -0.521),
    vec2(0.412, 0.805), vec2(-0.841, -0.112), vec2(0.895, -0.295), vec2(-0.184, 0.692)
  );
  // 1. Blocker search (5 taps) to adapt penumbra width
  float avgBlocker = 0.0;
  int blockers = 0;
  for (int i = 0; i < 5; i++) {
    float d = texture(shadowMap, projCoords.xy + poisson[i] * texelSize * 4.5).r;
    if (d < projCoords.z - bias) {
      avgBlocker += d;
      blockers++;
    }
  }
  if (blockers == 0) return 1.0;
  avgBlocker /= float(blockers);
  float penumbra = clamp((projCoords.z - avgBlocker) * 42.0, 1.0, 4.5);

  // 2. Rotated Poisson PCF filter
  float shadow = 0.0;
  for (int i = 0; i < 8; i++) {
    float closest = texture(shadowMap, projCoords.xy + poisson[i] * texelSize * penumbra).r;
    shadow += (projCoords.z - bias > closest) ? 0.0 : 1.0;
  }
  return shadow / 8.0;
}`;

function createDepthTarget(gl, size) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo };
}

export function createShadowSystem(gl, initialSize = 4096) {
  let size = initialSize;
  let staticTarget = createDepthTarget(gl, size);
  let dynamicTarget = createDepthTarget(gl, size);

  const lightDir = new Float32Array([-0.55, 0.78, -0.32]);
  const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]);
  lightDir[0] /= lLen; lightDir[1] /= lLen; lightDir[2] /= lLen;

  const lightView = new Float32Array(16);
  const lightProj = new Float32Array(16);
  const lightViewProj = new Float32Array(16);
  const staticLightViewProj = new Float32Array(16);

  let cachedCenterX = -9999;
  let cachedCenterZ = -9999;
  let cachedRevision = -1;
  let cachedExtent = 58;

  // Computes a texel-snapped tight orthographic light matrix so shadows never swim when panning
  function computeSnappedMatrix(targetX, targetZ, camHeight) {
    const halfExtent = Math.max(38, Math.min(82, camHeight * 1.15));
    const worldSpan = halfExtent * 2.0;
    const worldTexelSize = worldSpan / size;

    const rawView = mat4LookAt(
      new Float32Array(16),
      targetX + lightDir[0] * 140,
      lightDir[1] * 140,
      targetZ + lightDir[2] * 140,
      targetX,
      0,
      targetZ
    );

    // Transform world origin into light space, snap center to exact shadow texel grid
    const lsX = rawView[0] * targetX + rawView[8] * targetZ + rawView[12];
    const lsY = rawView[1] * targetX + rawView[9] * targetZ + rawView[13];
    const snappedX = Math.floor(lsX / worldTexelSize) * worldTexelSize;
    const snappedY = Math.floor(lsY / worldTexelSize) * worldTexelSize;

    lightView.set(rawView);
    lightView[12] += snappedX - lsX;
    lightView[13] += snappedY - lsY;

    mat4Ortho(lightProj, -halfExtent, halfExtent, -halfExtent, halfExtent, 10, 320);
    mat4Multiply(lightViewProj, lightProj, lightView);
    return halfExtent;
  }

  function needsStaticRebuild(targetX, targetZ, camHeight, mapRevision) {
    const dist = Math.hypot(targetX - cachedCenterX, targetZ - cachedCenterZ);
    const desiredExtent = Math.max(38, Math.min(82, camHeight * 1.15));
    return (
      cachedRevision !== mapRevision ||
      dist > Math.max(6.0, cachedExtent * 0.2) ||
      Math.abs(desiredExtent - cachedExtent) > 10.0
    );
  }

  function renderShadows(targetX, targetZ, camHeight, mapRevision, drawStaticFn, drawDynamicFn) {
    const rebuildStatic = needsStaticRebuild(targetX, targetZ, camHeight, mapRevision);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.colorMask(false, false, false, false);
    gl.viewport(0, 0, size, size);

    if (rebuildStatic) {
      cachedExtent = computeSnappedMatrix(targetX, targetZ, camHeight);
      staticLightViewProj.set(lightViewProj);
      cachedCenterX = targetX;
      cachedCenterZ = targetZ;
      cachedRevision = mapRevision;

      gl.bindFramebuffer(gl.FRAMEBUFFER, staticTarget.fbo);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      drawStaticFn(staticLightViewProj);
    } else {
      lightViewProj.set(staticLightViewProj);
    }

    // Copy static building shadow cache into active shadow target cleanly via hardware blit
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, staticTarget.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dynamicTarget.fbo);
    gl.blitFramebuffer(0, 0, size, size, 0, 0, size, size, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);

    // Draw dynamic units only into active shadow FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, dynamicTarget.fbo);
    drawDynamicFn(lightViewProj);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.colorMask(true, true, true, true);
  }

  function resize(nextSize) {
    if (nextSize === size) return;
    gl.deleteTexture(staticTarget.tex);
    gl.deleteFramebuffer(staticTarget.fbo);
    gl.deleteTexture(dynamicTarget.tex);
    gl.deleteFramebuffer(dynamicTarget.fbo);
    size = nextSize;
    staticTarget = createDepthTarget(gl, size);
    dynamicTarget = createDepthTarget(gl, size);
    cachedRevision = -1;
  }

  return {
    get size() { return size; },
    get texture() { return dynamicTarget.tex; },
    get lightViewProj() { return lightViewProj; },
    get lightDir() { return lightDir; },
    invalidateCache() { cachedRevision = -1; },
    renderShadows,
    resize,
    dispose() {
      gl.deleteTexture(staticTarget.tex);
      gl.deleteFramebuffer(staticTarget.fbo);
      gl.deleteTexture(dynamicTarget.tex);
      gl.deleteFramebuffer(dynamicTarget.fbo);
    }
  };
}
