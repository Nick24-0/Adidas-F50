/* F50 Hyperfast Elite — 3D viewer (vanilla WebGL). Geometry + texture come from assets/f50-model.js */
(function () {
  'use strict';
  const viewer = document.getElementById('viewer');
  if (!viewer) return;
  const host = viewer.querySelector('.v-float');
  const fallback = () => { host.innerHTML = '<img src="assets/hero-cleats.webp" alt="adidas F50 Hyperfast Elite" style="width:100%;height:100%;object-fit:contain">'; viewer.classList.add('ready'); };
  const DATA = window.F50_MODEL;
  const canvas = document.createElement('canvas');
  canvas.className = 'v-canvas';
  const gl = DATA && canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl || !gl.getExtension('OES_element_index_uint')) { fallback(); return; }
  host.appendChild(canvas);

  const { PI, sin, cos, abs, min, max } = Math;
  const clamp = (x, a, b) => min(b, max(a, x));

  /* ---------- orientation of the source model (Tripo export: Y up, length on X) ---------- */
  // Model-space tweaks so the toe points to +X and the sole sits at -Y. Adjust here if needed.
  const FLIP_X = window.F50_FLIP_X ?? -1;  // 1 or -1 (rotates the model 180° so the toe faces forward)
  const TARGET_LEN = 2.8;                 // scene units for the shoe length

  /* ---------- decode model ---------- */
  const b64 = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  const q = new Uint16Array(b64(DATA.pos)), nq = new Int8Array(b64(DATA.nor)), uvq = new Uint16Array(b64(DATA.uv)), idx = new Uint32Array(b64(DATA.idx));
  const n = DATA.count, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const S = DATA.scale / 65535;
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    const v = DATA.min[k] + q[i * 3 + k] * S; pos[i * 3 + k] = v; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v;
  }
  const ctr = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2], fit = TARGET_LEN / (mx[0] - mn[0]);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (pos[i * 3] - ctr[0]) * fit * FLIP_X; pos[i * 3 + 1] = (pos[i * 3 + 1] - ctr[1]) * fit; pos[i * 3 + 2] = (pos[i * 3 + 2] - ctr[2]) * fit * FLIP_X;
    nor[i * 3] = nq[i * 3] / 127 * FLIP_X; nor[i * 3 + 1] = nq[i * 3 + 1] / 127; nor[i * 3 + 2] = nq[i * 3 + 2] / 127 * FLIP_X;
    uv[i * 2] = uvq[i * 2] / 65535; uv[i * 2 + 1] = 1 - uvq[i * 2 + 1] / 65535;
  }

  /* ---------- GL ---------- */
  const VS = `attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aUv;
  uniform mat4 uModel, uVP; varying vec3 vN, vW; varying vec2 vUv;
  void main(){ vec4 w=uModel*vec4(aPos,1.); vW=w.xyz; vN=mat3(uModel)*aNor; vUv=aUv; gl_Position=uVP*w; }`;
  const FS = `precision highp float;
  uniform sampler2D uTex; uniform vec3 uCam; varying vec3 vN, vW; varying vec2 vUv;
  vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
  vec3 L(vec3 N, vec3 V, vec3 dir, vec3 col, vec3 base, float sp){
    vec3 l=normalize(dir); float w=max((dot(N,l)+.45)/1.45,0.);
    vec3 h=normalize(l+V); return col*(base*w + pow(max(dot(N,h),0.),48.)*sp);
  }
  void main(){
    vec3 base = lin(texture2D(uTex,vUv).rgb);
    vec3 N = normalize(vN); vec3 V = normalize(uCam-vW);
    if(dot(N,V) < -.2) N = -N;
    vec3 c = base*mix(vec3(.05,.055,.09), vec3(.22,.23,.3), N.y*.5+.5);
    c += L(N,V,vec3(.35,1.,.6), vec3(.95,.93,.9), base, .35);
    c += L(N,V,vec3(.1,.25,1.), vec3(.65,.65,.68), base, .2);
    c += L(N,V,vec3(-.9,.25,-.55), vec3(.12,.24,.85), base, .5);
    c += L(N,V,vec3(.95,.1,-.45), vec3(.45,.08,.14), base, .4);
    float fr = pow(1.-max(dot(N,V),0.),3.5);
    c += fr*vec3(.25,.42,1.)*.25;
    gl_FragColor = vec4(pow(aces(c*1.15), vec3(1./2.2)), 1.);
  }`;
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(o); return o; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
  const buf = (arr, tgt = gl.ARRAY_BUFFER) => { const b = gl.createBuffer(); gl.bindBuffer(tgt, b); gl.bufferData(tgt, arr, gl.STATIC_DRAW); return b; };
  const bPos = buf(pos), bNor = buf(nor), bUv = buf(uv), bIdx = buf(idx, gl.ELEMENT_ARRAY_BUFFER);
  const attr = (name, b, size) => { const l = gl.getAttribLocation(prog, name); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0); };
  attr('aPos', bPos, 3); attr('aNor', bNor, 3); attr('aUv', bUv, 2);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIdx);
  const U = {}; ['uModel', 'uVP', 'uTex', 'uCam'].forEach(k => U[k] = gl.getUniformLocation(prog, k));

  let ready = false;
  const img = new Image();
  img.onload = () => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const an = gl.getExtension('EXT_texture_filter_anisotropic'); if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    gl.uniform1i(U.uTex, 0); ready = true; viewer.classList.add('ready');
  };
  img.onerror = fallback;
  img.src = DATA.tex;

  /* ---------- matrices ---------- */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const M = {
    mul(a, b) { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; },
    persp(f, a, nr, fa) { const t = 1 / Math.tan(f / 2), o = new Float32Array(16); o[0] = t / a; o[5] = t; o[10] = (fa + nr) / (nr - fa); o[11] = -1; o[14] = 2 * fa * nr / (nr - fa); return o; },
    look(e, c, up) { const z = nrm(sub(e, c)), x = nrm(cross(up, z)), y = cross(z, x); return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1]); },
    rx(a) { const c = cos(a), s = sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
    ry(a) { const c = cos(a), s = sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
    rz(a) { const c = cos(a), s = sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
    tr(x, y, z) { const o = new Float32Array(16); o[0] = o[5] = o[10] = o[15] = 1; o[12] = x; o[13] = y; o[14] = z; return o; },
  };

  /* ---------- interaction ---------- */
  const REST_PITCH = .28;
  const st8 = { yaw: -.75, pitch: REST_PITCH, roll: 0, vy: 0, tRoll: 0, tYaw: null, drag: false, lx: 0, ly: 0, idle: performance.now(), auto: !matchMedia('(prefers-reduced-motion: reduce)').matches };
  const hint = document.getElementById('vhint'), soleBtn = document.getElementById('vsole'), badge = document.getElementById('spin360'), label = document.getElementById('vlabel');
  const hideHint = () => hint && hint.classList.add('hide');
  let sole = false;
  function setSole(on) {
    sole = on; st8.tRoll = on ? -1.42 : 0;
    st8.tYaw = on ? Math.round(st8.yaw / (2 * PI)) * 2 * PI : null;
    viewer.classList.toggle('sole', on);
    if (soleBtn) { soleBtn.setAttribute('aria-pressed', on); soleBtn.textContent = on ? 'Ver capellada' : 'Ver suela'; }
    if (label) label.textContent = on ? 'Suela' : 'Modelo 3D interactivo';
    st8.idle = performance.now();
  }
  canvas.addEventListener('pointerdown', e => { st8.drag = true; st8.lx = e.clientX; st8.ly = e.clientY; st8.vy = 0; st8.tYaw = null; canvas.setPointerCapture(e.pointerId); hideHint(); });
  canvas.addEventListener('pointermove', e => {
    if (!st8.drag) return;
    const dx = e.clientX - st8.lx, dy = e.clientY - st8.ly;
    st8.yaw += dx * .011; st8.vy = dx * .011;
    st8.pitch = clamp(st8.pitch + dy * .007, -.7, .9);
    st8.lx = e.clientX; st8.ly = e.clientY; st8.idle = performance.now();
  });
  const end = () => { st8.drag = false; st8.idle = performance.now(); };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  viewer.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { st8.vy = -.06; hideHint(); e.preventDefault(); }
    if (e.key === 'ArrowRight') { st8.vy = .06; hideHint(); e.preventDefault(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { setSole(!sole); hideHint(); e.preventDefault(); }
    st8.idle = performance.now();
  });
  soleBtn && soleBtn.addEventListener('click', () => { setSole(!sole); hideHint(); });
  if (badge) {
    badge.classList.toggle('on', st8.auto); badge.setAttribute('aria-pressed', st8.auto);
    badge.addEventListener('click', () => { st8.auto = !st8.auto; badge.classList.toggle('on', st8.auto); badge.setAttribute('aria-pressed', st8.auto); if (st8.auto) { setSole(false); st8.idle = 0; } hideHint(); });
  }
  setTimeout(hideHint, 4500);

  /* ---------- render ---------- */
  let W = 0, H = 0, visible = true;
  function resize() { const r = viewer.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2); W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr)); canvas.width = W; canvas.height = H; }
  new ResizeObserver(resize).observe(viewer); resize();
  new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(viewer);

  function frame(now) {
    requestAnimationFrame(frame);
    if (!ready || !visible || document.hidden) return;
    if (!st8.drag) {
      if (st8.tYaw !== null) st8.yaw += (st8.tYaw - st8.yaw) * .1;
      else if (abs(st8.vy) > .0005) { st8.yaw += st8.vy; st8.vy *= .94; }
      else if (st8.auto && !sole && now - st8.idle > 2200) st8.yaw += .006;
      st8.pitch += ((sole ? .05 : REST_PITCH) - st8.pitch) * .05;
    }
    st8.roll += (st8.tRoll - st8.roll) * .09;
    gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    const asp = W / H, eye = [0, .2, 6.3], fov = (asp < 1 ? 30 / asp : 30) * PI / 180;
    const VP = M.mul(M.persp(fov, asp, .1, 50), M.look(eye, [0, 0, 0], [0, 1, 0]));
    let m = M.tr(0, sin(now / 1000 * 2 * PI / 6) * .05, 0);
    m = M.mul(m, M.rx(st8.pitch)); m = M.mul(m, M.ry(st8.yaw)); m = M.mul(m, M.rz(-.06)); m = M.mul(m, M.rx(st8.roll));
    gl.uniformMatrix4fv(U.uModel, false, m); gl.uniformMatrix4fv(U.uVP, false, VP); gl.uniform3fv(U.uCam, eye);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
  }
  requestAnimationFrame(frame);
  window.__f50 = st8;
})();
