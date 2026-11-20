// RedAlert3A Main Rendering Pipeline Facade (Plan A Three.js PBR Engine).
// Preserves full legacy contract consumed by main.js, input.js, minimap.js, and verification suites.

import { createThreeRenderPipeline } from './threePipeline.js';

export function compileProgram(gl, vsSrc, fsSrc) {
  const compileShader = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(sh) || 'Unknown shader compile error';
      gl.deleteShader(sh);
      throw new Error(`WebGL2 Shader Error (${type === gl.VERTEX_SHADER ? 'VS' : 'FS'}): ${info}`);
    }
    return sh;
  };

  const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog) || 'Unknown program link error';
    gl.deleteProgram(prog);
    throw new Error(`WebGL2 Program Link Error: ${info}`);
  }
  return prog;
}

export function createRenderPipeline(canvas, initialQuality = 'high') {
  return createThreeRenderPipeline(canvas, initialQuality);
}
