// 1024-Slot Ring-Buffer Projected Ground Decals (Craters, Scorch Marks, Tank Tracks).
// Renders all ground decals in 1 single instanced draw call.

export const MAX_DECALS = 1024;
const FLOATS_PER_DECAL = 8; // x, y, z, radius, yaw, type(0=crater,1=track,2=radiation), alpha, age

const DECAL_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aQuad;
layout(location = 1) in vec4 iPosRadius; // x, y, z, radius
layout(location = 2) in vec4 iParams;    // yaw, type, alpha, age

uniform mat4 uViewProj;

out vec2 vUv;
out vec4 vParams;

void main() {
  vUv = aQuad + 0.5;
  vParams = iParams;

  float c = cos(iParams.x);
  float s = sin(iParams.x);
  vec2 rot = vec2(aQuad.x * c + aQuad.y * s, -aQuad.x * s + aQuad.y * c) * iPosRadius.w;
  vec3 worldPos = iPosRadius.xyz + vec3(rot.x, 0.08, rot.y);
  gl_Position = uViewProj * vec4(worldPos, 1.0);
}`;

const DECAL_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec4 vParams;

out vec4 outColor;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;

  float typeId = vParams.y;
  float alpha = vParams.z;
  if (typeId < 0.5) {
    // Crater scorch decal
    float ring = smoothstep(1.0, 0.55, r);
    float rim = smoothstep(0.62, 0.72, r) * smoothstep(0.95, 0.78, r);
    vec3 col = mix(vec3(0.06, 0.05, 0.04), vec3(0.24, 0.19, 0.14), rim);
    outColor = vec4(col, ring * 0.85 * alpha);
  } else if (typeId < 1.5) {
    // Dual tank tread imprint
    float treadX = abs(abs(p.x) - 0.55);
    if (treadX > 0.24 || abs(p.y) > 0.85) discard;
    float cleat = step(0.42, fract(p.y * 5.0));
    outColor = vec4(vec3(0.08, 0.07, 0.06), (0.35 + 0.3 * cleat) * alpha);
  } else {
    // Glowing green radiation patch
    float pulse = 0.65 + 0.35 * sin(r * 6.0);
    outColor = vec4(vec3(0.22, 0.95, 0.34) * pulse, (1.0 - r * r) * 0.55 * alpha);
  }
}`;

export function createDecalPool(gl, compileProgram) {
  const prog = compileProgram(gl, DECAL_VS, DECAL_FS);
  const uViewProj = gl.getUniformLocation(prog, 'uViewProj');

  const vao = gl.createVertexArray();
  const quadVbo = gl.createBuffer();
  const ibo = gl.createBuffer();
  const instVbo = gl.createBuffer();
  const ring = new Float32Array(MAX_DECALS * FLOATS_PER_DECAL);

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, instVbo);
  gl.bufferData(gl.ARRAY_BUFFER, ring.byteLength, gl.DYNAMIC_DRAW);
  const stride = FLOATS_PER_DECAL * 4;
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16); gl.vertexAttribDivisor(2, 1);
  gl.bindVertexArray(null);

  let writeCursor = 0;
  let activeCount = 0;
  let dirty = false;

  function addDecal(x, y, z, radius = 2.4, yaw = 0, type = 0, alpha = 1.0) {
    const off = writeCursor * FLOATS_PER_DECAL;
    ring[off + 0] = x;
    ring[off + 1] = y;
    ring[off + 2] = z;
    ring[off + 3] = radius;
    ring[off + 4] = yaw;
    ring[off + 5] = type;
    ring[off + 6] = alpha;
    ring[off + 7] = 1;
    writeCursor = (writeCursor + 1) % MAX_DECALS;
    if (activeCount < MAX_DECALS) activeCount++;
    dirty = true;
  }

  function clear() {
    writeCursor = 0;
    activeCount = 0;
    dirty = false;
  }

  function render(ctx) {
    if (activeCount === 0) return;
    if (dirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, instVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, ring.subarray(0, activeCount * FLOATS_PER_DECAL));
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      dirty = false;
    }

    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniformMatrix4fv(uViewProj, false, ctx.viewProj);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, activeCount);
    ctx.calls++;
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  return {
    addDecal,
    clear,
    render,
    get count() { return activeCount; },
    dispose() {
      gl.deleteProgram(prog);
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(quadVbo);
      gl.deleteBuffer(ibo);
      gl.deleteBuffer(instVbo);
    }
  };
}
