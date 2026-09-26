/* WebGL2 renderer. No library, no build step, no external asset.
 *
 * WHY NOT THREE.JS. pink-sites pages are single self-contained files with no bundler and a
 * no-external-asset rule. Vendoring a 600 kB library to draw flat-shaded solids and lines would
 * cost more than it saves, and the one thing this content actually needs — readable engineering
 * linework with hidden-line removal — is a depth prepass, not a scene library. So this is a small
 * renderer that does exactly the four things the model needs:
 *
 *   solid   flat-lit triangles, optionally instanced
 *   glass   translucent triangles, depth-tested but not depth-writing
 *   line    screen-space-constant-width lines, drawn as INSTANCED quads (gl.LINES cannot do width
 *           above 1 px on most platforms, so every real line renderer expands to quads)
 *   pick    an id buffer rendered on demand, so selection is exact rather than a raycast
 *
 * HIDDEN-LINE REMOVAL comes free: the wire and lattice views run a depth-only prepass of the
 * fairing, then draw lines with depth testing on. That is what makes the wire view show design
 * rather than tessellation.
 *
 * CLIPPING is a fragment discard against up to two planes, plus an ANALYTIC cap. Because the hull
 * is a body of revolution, the cut face is exactly computable (a profile silhouette for a
 * longitudinal cut, a section ellipse for a transverse one), so the cutaway caps cleanly with no
 * stencil pass and no artefacts.
 */

import { m4identity, m4mul, m4invert, m4transform } from '../core/math.js?v=41bc1f51';
import { viewMatrix, projMatrix, cameraEye } from './camera.js?v=41bc1f51';
import { MATERIALS, resolveMaterial, rgb, TOKENS } from './palette.js?v=41bc1f51';
import { updateWorld, walk } from '../core/nodes.js?v=41bc1f51';

/* ---------- shaders --------------------------------------------------------------------------- */

const CLIP_DECL = `
uniform vec4 uClip[2];
uniform int uClipCount;
bool clipped(vec3 w) {
  for (int i = 0; i < 2; i++) {
    if (i >= uClipCount) break;
    if (dot(vec4(w, 1.0), uClip[i]) < 0.0) return true;
  }
  return false;
}`;

const SOLID_VS = `#version 300 es
precision highp float;
in vec3 aPos;
in vec3 aNor;
in mat4 aInst;
in vec4 aTint;
uniform mat4 uModel, uView, uProj;
uniform int uInstanced;
out vec3 vNor;
out vec3 vWorld;
out vec4 vTint;
void main() {
  mat4 m = uInstanced == 1 ? uModel * aInst : uModel;
  vec4 w = m * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNor = normalize(mat3(m) * aNor);
  vTint = uInstanced == 1 ? aTint : vec4(1.0);
  gl_Position = uProj * uView * w;
}`;

const SOLID_FS = `#version 300 es
precision highp float;
in vec3 vNor;
in vec3 vWorld;
in vec4 vTint;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSpec;
uniform vec3 uEye;
uniform vec3 uKey;
uniform int uUnlit;
${CLIP_DECL}
out vec4 fragColor;
void main() {
  if (clipped(vWorld)) discard;
  vec3 base = uColor * vTint.rgb;
  if (uUnlit == 1) { fragColor = vec4(base, uOpacity * vTint.a); return; }
  vec3 n = normalize(vNor);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(uEye - vWorld);
  // A soft studio setup: one key, a cool sky fill from +z, a warm ground bounce from -z, and a
  // rim that keeps the silhouette legible against a near-black page background.
  float key = max(dot(n, normalize(uKey)), 0.0);
  float sky = 0.5 + 0.5 * n.z;          // cool fill from above
  float ground = 0.5 - 0.5 * n.z;       // warm bounce from below
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  // The ground term was described in this comment but never actually applied, so every
  // downward-facing surface sat at 34% brightness — which is why a high-visibility pink underside
  // came out maroon. A hemisphere fill is also just more honest: an aircraft over terrain does get
  // light back off the ground.
  vec3 col = base * (0.30 + 0.68 * key + 0.30 * sky + 0.26 * ground);
  float spec = uSpec * pow(max(dot(reflect(-normalize(uKey), n), v), 0.0), 24.0);
  col += vec3(spec) * 0.55;
  col += base * rim * 0.55;
  // Backfaces of a cut solid read as a cut face, not as a hole.
  if (!gl_FrontFacing) col *= 0.42;
  fragColor = vec4(col, uOpacity * vTint.a);
}`;

/* Lines: one unit quad, instanced per segment. The quad is expanded in CLIP SPACE so the width is
 * constant in pixels regardless of distance — the thing that makes technical linework read. */
const LINE_VS = `#version 300 es
precision highp float;
in vec2 aCorner;        // (t along segment 0..1, side -1..1)
in vec3 aA;
in vec3 aB;
in float aWeight;
uniform mat4 uModel, uView, uProj;
uniform vec2 uViewport;
uniform float uWidth;
uniform float uWeightGain;
out vec3 vWorld;
out float vWeight;
void main() {
  vec4 wa = uModel * vec4(aA, 1.0);
  vec4 wb = uModel * vec4(aB, 1.0);
  vWorld = mix(wa.xyz, wb.xyz, aCorner.x);
  vWeight = aWeight;
  vec4 ca = uProj * uView * wa;
  vec4 cb = uProj * uView * wb;
  vec4 c = mix(ca, cb, aCorner.x);
  vec2 sa = ca.xy / max(ca.w, 1e-5);
  vec2 sb = cb.xy / max(cb.w, 1e-5);
  vec2 dir = normalize((sb - sa) * uViewport + vec2(1e-6));
  vec2 nrm = vec2(-dir.y, dir.x);
  float w = uWidth * (0.35 + uWeightGain * aWeight);
  c.xy += nrm * aCorner.y * (w / uViewport) * c.w;
  gl_Position = c;
}`;

const LINE_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in float vWeight;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uWeightFade;
${CLIP_DECL}
out vec4 fragColor;
void main() {
  if (clipped(vWorld)) discard;
  // Weight also modulates brightness, so load-path density survives a greyscale print and a
  // viewer who cannot separate the hues.
  float a = uOpacity * mix(1.0 - uWeightFade, 1.0, clamp(vWeight, 0.0, 1.0));
  fragColor = vec4(uColor * (0.72 + 0.28 * clamp(vWeight, 0.0, 1.0)), a);
}`;

const PICK_VS = `#version 300 es
precision highp float;
in vec3 aPos;
in mat4 aInst;
in float aPickId;
uniform mat4 uModel, uView, uProj;
uniform int uInstanced;
uniform float uBaseId;
out float vId;
out vec3 vWorld;
void main() {
  mat4 m = uInstanced == 1 ? uModel * aInst : uModel;
  vec4 w = m * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vId = uInstanced == 1 ? aPickId : uBaseId;
  gl_Position = uProj * uView * w;
}`;

const PICK_FS = `#version 300 es
precision highp float;
in float vId;
in vec3 vWorld;
${CLIP_DECL}
out vec4 fragColor;
void main() {
  if (clipped(vWorld)) discard;
  float id = vId;
  float r = mod(id, 256.0);
  float g = mod(floor(id / 256.0), 256.0);
  float b = mod(floor(id / 65536.0), 256.0);
  fragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
}`;

/* ---------- program helpers -------------------------------------------------------------------- */

function compile(gl, type, src, name) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`${name} shader: ${gl.getShaderInfoLog(s)}`);
  }
  return s;
}

function program(gl, vs, fs, name) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, `${name} vertex`));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, `${name} fragment`));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`${name} link: ${gl.getProgramInfoLog(p)}`);
  }
  const u = {}, a = {};
  const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nu; i++) {
    const info = gl.getActiveUniform(p, i);
    const base = info.name.replace(/\[0\]$/, '');
    u[base] = gl.getUniformLocation(p, info.name);
  }
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) {
    const info = gl.getActiveAttrib(p, i);
    a[info.name] = gl.getAttribLocation(p, info.name);
  }
  return { p, u, a };
}

/* ---------- the renderer ------------------------------------------------------------------------ */

let _webgl2 = null;
/**
 * Is WebGL 2 usable here? Cached, because the probe itself costs a context and browsers cap how
 * many exist at once — a page with several viewers on it would otherwise spend its whole budget
 * asking the question.
 */
export function isWebGL2Available() {
  if (_webgl2 !== null) return _webgl2;
  try {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2');
    _webgl2 = !!g;
    if (g) {
      const ext = g.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  } catch (e) {
    _webgl2 = false;
  }
  return _webgl2;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts { maxPixelRatio, background, onContextLost }
 */
export function createRenderer(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2', {
    antialias: true, alpha: true, depth: true, stencil: false,
    powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
  });
  if (!gl) return null;

  const progs = {
    solid: program(gl, SOLID_VS, SOLID_FS, 'solid'),
    line: program(gl, LINE_VS, LINE_FS, 'line'),
    pick: program(gl, PICK_VS, PICK_FS, 'pick'),
  };

  const bufs = new WeakMap();       // geometry record -> GPU buffers
  const instBufs = new WeakMap();   // node.inst -> GPU buffers
  const stats = {
    drawCalls: 0, triangles: 0, lines: 0, programs: 3, buffers: 0,
    frameMs: 0, fps: 0, bufferBytes: 0,
  };
  let maxPixelRatio = opts.maxPixelRatio || 2;
  let lost = false;

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    if (opts.onContextLost) opts.onContextLost();
  });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; });

  /* -- static line quad, instanced per segment -- */
  const quadVao = gl.createVertexArray();
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1,
  ]), gl.STATIC_DRAW);

  function geomBuffers(g) {
    let b = bufs.get(g);
    if (b) return b;
    b = { kind: g.kind };
    if (g.kind === 'solid') {
      b.pos = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b.pos);
      gl.bufferData(gl.ARRAY_BUFFER, g.pos, gl.STATIC_DRAW);
      b.nor = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b.nor);
      gl.bufferData(gl.ARRAY_BUFFER, g.nor, gl.STATIC_DRAW);
      b.idx = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.idx, gl.STATIC_DRAW);
      b.count = g.idx.length;
      stats.bufferBytes += g.pos.byteLength + g.nor.byteLength + g.idx.byteLength;
    } else {
      // Segment endpoints and weight, one record per segment, for instanced quad expansion.
      const n = g.segs;
      const A = new Float32Array(n * 3), B = new Float32Array(n * 3), Wt = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        A[i * 3] = g.pos[i * 6]; A[i * 3 + 1] = g.pos[i * 6 + 1]; A[i * 3 + 2] = g.pos[i * 6 + 2];
        B[i * 3] = g.pos[i * 6 + 3]; B[i * 3 + 1] = g.pos[i * 6 + 4]; B[i * 3 + 2] = g.pos[i * 6 + 5];
        Wt[i] = g.wid[i * 2];
      }
      b.a = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b.a); gl.bufferData(gl.ARRAY_BUFFER, A, gl.STATIC_DRAW);
      b.b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b.b); gl.bufferData(gl.ARRAY_BUFFER, B, gl.STATIC_DRAW);
      b.w = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b.w); gl.bufferData(gl.ARRAY_BUFFER, Wt, gl.STATIC_DRAW);
      b.count = n;
      stats.bufferBytes += A.byteLength + B.byteLength + Wt.byteLength;
    }
    stats.buffers += 1;
    bufs.set(g, b);
    return b;
  }

  function instanceBuffers(inst) {
    let b = instBufs.get(inst);
    if (!b) {
      b = { xf: gl.createBuffer(), tint: gl.createBuffer(), pid: gl.createBuffer() };
      instBufs.set(inst, b);
      stats.buffers += 2;
      inst.dirty = true;
    }
    if (inst.dirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, b.xf);
      gl.bufferData(gl.ARRAY_BUFFER, inst.xf, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.tint);
      gl.bufferData(gl.ARRAY_BUFFER, inst.tint, gl.DYNAMIC_DRAW);
      inst.dirty = false;
    }
    return b;
  }

  function bindSolid(prog, g, inst) {
    const b = geomBuffers(g);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.pos);
    gl.enableVertexAttribArray(prog.a.aPos);
    gl.vertexAttribPointer(prog.a.aPos, 3, gl.FLOAT, false, 0, 0);
    if (prog.a.aNor !== undefined && prog.a.aNor >= 0 && b.nor) {
      gl.bindBuffer(gl.ARRAY_BUFFER, b.nor);
      gl.enableVertexAttribArray(prog.a.aNor);
      gl.vertexAttribPointer(prog.a.aNor, 3, gl.FLOAT, false, 0, 0);
    }
    if (inst && prog.a.aInst !== undefined && prog.a.aInst >= 0) {
      const ib = instanceBuffers(inst);
      gl.bindBuffer(gl.ARRAY_BUFFER, ib.xf);
      for (let k = 0; k < 4; k++) {
        const loc = prog.a.aInst + k;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 64, k * 16);
        gl.vertexAttribDivisor(loc, 1);
      }
      if (prog.a.aTint !== undefined && prog.a.aTint >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, ib.tint);
        gl.enableVertexAttribArray(prog.a.aTint);
        gl.vertexAttribPointer(prog.a.aTint, 4, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(prog.a.aTint, 1);
      }
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idx);
    return b;
  }

  function unbindInstance(prog) {
    if (prog.a.aInst !== undefined && prog.a.aInst >= 0) {
      for (let k = 0; k < 4; k++) {
        gl.vertexAttribDivisor(prog.a.aInst + k, 0);
        gl.disableVertexAttribArray(prog.a.aInst + k);
      }
    }
    if (prog.a.aTint !== undefined && prog.a.aTint >= 0) {
      gl.vertexAttribDivisor(prog.a.aTint, 0);
      gl.disableVertexAttribArray(prog.a.aTint);
    }
  }

  function setClips(prog, clips) {
    const arr = new Float32Array(8);
    const n = Math.min(2, clips ? clips.length : 0);
    for (let i = 0; i < n; i++) arr.set(clips[i], i * 4);
    if (prog.u.uClip) gl.uniform4fv(prog.u.uClip, arr);
    if (prog.u.uClipCount) gl.uniform1i(prog.u.uClipCount, n);
  }

  function resize(width, height, dpr) {
    const r = Math.min(maxPixelRatio, dpr || 1);
    const w = Math.max(1, Math.round(width * r));
    const h = Math.max(1, Math.round(height * r));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    return [w, h];
  }

  /* -- pick buffer -- */
  let pickFbo = null, pickTex = null, pickRb = null, pickW = 0, pickH = 0;
  function ensurePickTarget(w, h) {
    if (pickFbo && pickW === w && pickH === h) return;
    if (pickFbo) { gl.deleteFramebuffer(pickFbo); gl.deleteTexture(pickTex); gl.deleteRenderbuffer(pickRb); }
    pickW = w; pickH = h;
    pickTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, pickTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    pickRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, pickRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    pickFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pickTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, pickRb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Collect the draw list once per frame: resolved material, world matrix, visibility.
   * `styleFor(node)` lets the scene override material and visibility per view mode without the
   * renderer knowing anything about view modes.
   */
  function collect(root, styleFor) {
    const solids = [], glasses = [], lineList = [], preOnly = [];
    walk(root, (n) => {
      if (n.visible === false) return false;
      if (!n.geom) return true;
      const st = styleFor ? styleFor(n) : null;
      if (st && st.prepassOnly) { preOnly.push({ n, mat: resolveMaterial(n.material), opacity: 1 }); return true; }
      if (st && st.hidden) return true;
      const mat = (st && st.material) || resolveMaterial(n.material);
      const op = (st && st.opacity !== undefined ? st.opacity : 1) * (n.opacity === undefined ? 1 : n.opacity);
      if (op <= 0.002) return true;
      const rec = { n, mat, opacity: op * (mat.opacity === undefined ? 1 : mat.opacity) };
      if (n.geom.kind === 'lines') lineList.push(rec);
      else if (mat.kind === 'glass' || rec.opacity < 0.995) glasses.push(rec);
      else solids.push(rec);
      return true;
    });
    return { solids, glasses, lineList, preOnly };
  }

  /**
   * Draw one frame.
   * @param {object} scene { root, camera, clips, styleFor, background, depthPrepassIds, lineWidth }
   */
  function render(scene) {
    if (lost) return stats;
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const [w, h] = resize(scene.width, scene.height, scene.dpr);
    gl.viewport(0, 0, w, h);
    const bg = rgb(scene.background || TOKENS.bg);
    gl.clearColor(bg[0], bg[1], bg[2], scene.transparent ? 0 : 1);
    gl.clearDepth(1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);       // cut solids must show their backfaces as cut faces
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    stats.drawCalls = 0; stats.triangles = 0; stats.lines = 0;

    updateWorld(scene.root);
    const cam = scene.camera;
    const view = viewMatrix(cam);
    const proj = projMatrix(cam, w / h);
    const eye = cameraEye(cam);
    const key = scene.keyLight || [0.55, 0.35, 0.75];
    const { solids, glasses, lineList, preOnly } = collect(scene.root, scene.styleFor);

    /* -- depth prepass: what the lines are allowed to hide behind ------------------------------ */
    const pre = scene.depthPrepass;
    if (pre && pre.length) {
      const P = progs.solid;
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.uView, false, view);
      gl.uniformMatrix4fv(P.u.uProj, false, proj);
      gl.uniform3fv(P.u.uEye, eye);
      gl.uniform3fv(P.u.uKey, key);
      gl.uniform1i(P.u.uUnlit, 1);
      gl.uniform1f(P.u.uOpacity, 1);
      gl.uniform1f(P.u.uSpec, 0);
      gl.uniform3fv(P.u.uColor, rgb(scene.background || TOKENS.bg));
      setClips(P, scene.clips);
      gl.colorMask(false, false, false, false);
      for (const rec of solids.concat(glasses, preOnly)) {
        if (!pre.includes(rec.n.id)) continue;
        drawSolid(P, rec.n, 1);
      }
      gl.colorMask(true, true, true, true);
    }

    /* -- opaque -------------------------------------------------------------------------------- */
    {
      const P = progs.solid;
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.uView, false, view);
      gl.uniformMatrix4fv(P.u.uProj, false, proj);
      gl.uniform3fv(P.u.uEye, eye);
      gl.uniform3fv(P.u.uKey, key);
      setClips(P, scene.clips);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      for (const rec of solids) {
        gl.uniform3fv(P.u.uColor, rgb(rec.mat.color));
        gl.uniform1f(P.u.uOpacity, rec.opacity);
        gl.uniform1f(P.u.uSpec, rec.mat.spec || 0);
        gl.uniform1i(P.u.uUnlit, rec.mat.kind === 'flat' ? 1 : 0);
        drawSolid(P, rec.n, rec.opacity);
      }
    }

    /* -- lines ---------------------------------------------------------------------------------- */
    if (lineList.length) {
      const P = progs.line;
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.uView, false, view);
      gl.uniformMatrix4fv(P.u.uProj, false, proj);
      gl.uniform2f(P.u.uViewport, w, h);
      setClips(P, scene.clips);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      const px = (scene.dpr || 1);
      for (const rec of lineList) {
        gl.uniform3fv(P.u.uColor, rgb(rec.mat.color));
        gl.uniform1f(P.u.uOpacity, rec.opacity);
        gl.uniform1f(P.u.uWidth, (rec.mat.weight || 1) * (scene.lineWidth || 1) * px);
        gl.uniform1f(P.u.uWeightGain, scene.weightGain === undefined ? 0.85 : scene.weightGain);
        gl.uniform1f(P.u.uWeightFade, scene.weightFade === undefined ? 0.45 : scene.weightFade);
        drawLines(P, rec.n);
      }
      gl.depthMask(true);
    }

    /* -- translucent, back to front ------------------------------------------------------------- */
    if (glasses.length) {
      const P = progs.solid;
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.uView, false, view);
      gl.uniformMatrix4fv(P.u.uProj, false, proj);
      gl.uniform3fv(P.u.uEye, eye);
      gl.uniform3fv(P.u.uKey, key);
      setClips(P, scene.clips);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      const tmp = [0, 0, 0];
      glasses.sort((a, b) => depthOf(b, eye, tmp) - depthOf(a, eye, tmp));
      for (const rec of glasses) {
        gl.uniform3fv(P.u.uColor, rgb(rec.mat.color));
        gl.uniform1f(P.u.uOpacity, rec.opacity);
        gl.uniform1f(P.u.uSpec, rec.mat.spec || 0);
        gl.uniform1i(P.u.uUnlit, rec.mat.kind === 'flat' ? 1 : 0);
        drawSolid(P, rec.n, rec.opacity);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    stats.frameMs = t1 - t0;
    stats.fps = stats.frameMs > 0 ? 1000 / Math.max(stats.frameMs, 0.5) : 0;
    return stats;
  }

  function depthOf(rec, eye, tmp) {
    m4transform(rec.n.world, [0, 0, 0], tmp);
    const dx = tmp[0] - eye[0], dy = tmp[1] - eye[1], dz = tmp[2] - eye[2];
    return dx * dx + dy * dy + dz * dz;
  }

  function drawSolid(P, n) {
    const g = n.geom;
    gl.uniformMatrix4fv(P.u.uModel, false, n.world);
    if (n.inst) {
      gl.uniform1i(P.u.uInstanced, 1);
      bindSolid(P, g, n.inst);
      gl.drawElementsInstanced(gl.TRIANGLES, g.idx.length, gl.UNSIGNED_INT, 0, n.inst.count);
      unbindInstance(P);
      stats.triangles += g.tris * n.inst.count;
    } else {
      gl.uniform1i(P.u.uInstanced, 0);
      if (P.a.aInst !== undefined && P.a.aInst >= 0) {
        for (let k = 0; k < 4; k++) gl.vertexAttrib4f(P.a.aInst + k, k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0, k === 3 ? 1 : 0);
      }
      if (P.a.aTint !== undefined && P.a.aTint >= 0) gl.vertexAttrib4f(P.a.aTint, 1, 1, 1, 1);
      bindSolid(P, g, null);
      gl.drawElements(gl.TRIANGLES, g.idx.length, gl.UNSIGNED_INT, 0);
      stats.triangles += g.tris;
    }
    stats.drawCalls++;
  }

  function drawLines(P, n) {
    const g = n.geom;
    const b = geomBuffers(g);
    gl.uniformMatrix4fv(P.u.uModel, false, n.world);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(P.a.aCorner);
    gl.vertexAttribPointer(P.a.aCorner, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(P.a.aCorner, 0);
    for (const [attr, buf, size] of [['aA', b.a, 3], ['aB', b.b, 3], ['aWeight', b.w, 1]]) {
      const loc = P.a[attr];
      if (loc === undefined || loc < 0) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, b.count);
    for (const attr of ['aA', 'aB', 'aWeight']) {
      const loc = P.a[attr];
      if (loc !== undefined && loc >= 0) gl.vertexAttribDivisor(loc, 0);
    }
    stats.lines += b.count;
    stats.drawCalls++;
  }

  /**
   * Pick the id under a canvas pixel. Renders an id buffer on demand — exact, and cheaper than it
   * looks because it only runs on a click.
   * @returns {string|null} node id or instance id
   */
  function pick(scene, cssX, cssY) {
    if (lost) return null;
    const [w, h] = resize(scene.width, scene.height, scene.dpr);
    ensurePickTarget(w, h);
    const px = Math.floor(cssX * (w / scene.width));
    const py = Math.floor((scene.height - cssY) * (h / scene.height));
    if (px < 0 || py < 0 || px >= w || py >= h) return null;

    updateWorld(scene.root);
    const view = viewMatrix(scene.camera);
    const proj = projMatrix(scene.camera, w / h);

    const idList = [null];            // index 0 = background
    const P = progs.pick;
    gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uView, false, view);
    gl.uniformMatrix4fv(P.u.uProj, false, proj);
    setClips(P, scene.clips);

    const { solids, glasses } = collect(scene.root, scene.styleFor);
    for (const rec of solids.concat(glasses)) {
      const n = rec.n;
      if (n.geom.kind !== 'solid') continue;
      gl.uniformMatrix4fv(P.u.uModel, false, n.world);
      if (n.inst) {
        // One pick id per instance, uploaded as a per-instance attribute.
        const ib = instanceBuffers(n.inst);
        const ids = new Float32Array(n.inst.count);
        for (let i = 0; i < n.inst.count; i++) {
          idList.push(n.inst.ids[i]);
          ids[i] = idList.length - 1;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, ib.pid);
        gl.bufferData(gl.ARRAY_BUFFER, ids, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(P.a.aPickId);
        gl.vertexAttribPointer(P.a.aPickId, 1, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(P.a.aPickId, 1);
        gl.uniform1i(P.u.uInstanced, 1);
        bindSolid(P, n.geom, n.inst);
        gl.drawElementsInstanced(gl.TRIANGLES, n.geom.idx.length, gl.UNSIGNED_INT, 0, n.inst.count);
        unbindInstance(P);
        gl.vertexAttribDivisor(P.a.aPickId, 0);
        gl.disableVertexAttribArray(P.a.aPickId);
      } else {
        if (!n.selectable) continue;
        idList.push(n.id);
        gl.uniform1i(P.u.uInstanced, 0);
        gl.uniform1f(P.u.uBaseId, idList.length - 1);
        if (P.a.aInst !== undefined && P.a.aInst >= 0) {
          for (let k = 0; k < 4; k++) {
            gl.vertexAttrib4f(P.a.aInst + k, k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0, k === 3 ? 1 : 0);
          }
        }
        bindSolid(P, n.geom, null);
        gl.drawElements(gl.TRIANGLES, n.geom.idx.length, gl.UNSIGNED_INT, 0);
      }
    }

    const buf = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const idx = buf[0] + buf[1] * 256 + buf[2] * 65536;
    return idx > 0 && idx < idList.length ? idList[idx] : null;
  }

  function dispose() {
    for (const p of Object.values(progs)) gl.deleteProgram(p.p);
    gl.deleteBuffer(quadBuf);
    gl.deleteVertexArray(quadVao);
    if (pickFbo) { gl.deleteFramebuffer(pickFbo); gl.deleteTexture(pickTex); gl.deleteRenderbuffer(pickRb); }
    // Geometry buffers live in a WeakMap keyed by the geometry records; dropping the model drops
    // them. The extension is the reliable way to force the context down on unmount.
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  }

  return {
    gl, stats, render, pick, dispose,
    setMaxPixelRatio: (v) => { maxPixelRatio = v; },
    get maxPixelRatio() { return maxPixelRatio; },
    get contextLost() { return lost; },
  };
}

void m4identity; void m4mul; void m4invert; void MATERIALS;
