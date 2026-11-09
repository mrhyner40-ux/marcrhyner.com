/*
 * Glow Shape: an edge-lit shape with LED emitters, a floor reflection,
 * and a light that follows the pointer.
 *
 * It is plain WebGL with a single fragment shader and no dependencies.
 * Each pixel measures its distance to the shape's outline (a signed
 * distance field, or SDF) and turns that distance into light. If WebGL
 * is unavailable, the static fallback image stays visible.
 *
 * Markup:
 *   <div data-glow data-shape="hexagon">
 *     <canvas class="glow-canvas"></canvas>
 *     <img class="glow-fallback" ...>
 *   </div>
 * Click the canvas to cycle shapes, or pick one with ?shape=star in the URL.
 */
(function () {
  "use strict";

  var SHAPES = ["triangle", "square", "diamond", "hexagon", "circle", "star"];

  var VERT = [
    "attribute vec2 aPos;",
    "void main() { gl_Position = vec4(aPos, 0.0, 1.0); }"
  ].join("\n");

  var FRAG = [
    "precision highp float;",
    "uniform vec2  uRes;",
    "uniform float uScale;   // pixels per shader unit",
    "uniform float uTime;",
    "uniform vec2  uLight;   // light position, in shader space",
    "uniform float uFrom;    // shape we are morphing from",
    "uniform float uTo;      // shape we are morphing to",
    "uniform float uMix;     // 0..1 morph progress",
    "uniform float uPulse;   // brief flash when the shape changes",
    "uniform vec3  uColor;",
    "",
    "const vec2 CENTER = vec2(0.0, 0.05);",
    "const float FLOOR = -0.245;",
    "",
    "float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    "float noise(vec2 p) {",
    "  vec2 i = floor(p), f = fract(p);",
    "  f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),",
    "             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);",
    "}",
    "",
    "// Signed distance functions: negative inside, positive outside.",
    "float sdTriangle(vec2 p, float r) {",
    "  const float k = 1.7320508;",
    "  p.x = abs(p.x) - r;",
    "  p.y = p.y + r / k;",
    "  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;",
    "  p.x -= clamp(p.x, -2.0 * r, 0.0);",
    "  return -length(p) * sign(p.y);",
    "}",
    "float sdBox(vec2 p, vec2 b) {",
    "  vec2 d = abs(p) - b;",
    "  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);",
    "}",
    "float sdRhombus(vec2 p, vec2 b) {",
    "  p = abs(p);",
    "  vec2 q = b - 2.0 * p;",
    "  float h = clamp((q.x * b.x - q.y * b.y) / dot(b, b), -1.0, 1.0);",
    "  float d = length(p - 0.5 * b * vec2(1.0 - h, 1.0 + h));",
    "  return d * sign(p.x * b.y + p.y * b.x - b.x * b.y);",
    "}",
    "float sdHexagon(vec2 p, float r) {",
    "  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);",
    "  p = abs(p.yx);",
    "  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;",
    "  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);",
    "  return length(p) * sign(p.y);",
    "}",
    "float sdStar(vec2 p, float r, float rf) {",
    "  const vec2 k1 = vec2(0.809016994, -0.587785252);",
    "  const vec2 k2 = vec2(-0.809016994, -0.587785252);",
    "  p.x = abs(p.x);",
    "  p -= 2.0 * max(dot(k1, p), 0.0) * k1;",
    "  p -= 2.0 * max(dot(k2, p), 0.0) * k2;",
    "  p.x = abs(p.x);",
    "  p.y -= r;",
    "  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);",
    "  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);",
    "  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);",
    "}",
    "",
    "float shape(vec2 p, float id) {",
    "  if (id < 0.5) return sdTriangle(p + vec2(0.0, 0.035), 0.29);",
    "  if (id < 1.5) return sdBox(p, vec2(0.19));",
    "  if (id < 2.5) return sdRhombus(p, vec2(0.2, 0.27));",
    "  if (id < 3.5) return sdHexagon(p, 0.205);",
    "  if (id < 4.5) return length(p) - 0.235;",
    "  return sdStar(p + vec2(0.0, 0.02), 0.29, 0.45);",
    "}",
    "",
    "// Morphing between two shapes is a blend of their distances.",
    "float scene(vec2 p) {",
    "  vec2 q = p - CENTER;",
    "  return mix(shape(q, uFrom), shape(q, uTo), uMix);",
    "}",
    "",
    "void main() {",
    "  vec2 frag = gl_FragCoord.xy;",
    "  vec2 p = (frag - 0.5 * uRes) / uScale;",
    "  float px = 1.0 / uScale;",
    "  vec3 warm = vec3(1.0, 0.94, 0.82);",
    "  vec3 col = vec3(0.0);",
    "",
    "  // How strongly the pointer light reaches this pixel.",
    "  float ld = length(p - uLight);",
    "  float lit = 0.3 + 1.5 * exp(-ld * ld * 7.0) + uPulse;",
    "",
    "  // Edge glow: a hot core line, a tight halo and a wide soft halo.",
    "  float d = scene(p);",
    "  float e = abs(d);",
    "  float core = smoothstep(1.5 * px + 0.0012, 0.0, e);",
    "  col += uColor * lit * (0.55 * core + 0.38 * exp(-e * 34.0) + 0.13 * exp(-e * 7.0));",
    "  col += warm * core * lit * 0.75;",
    "",
    "  // Soft light inside the shape, brighter on the side facing the light.",
    "  if (d < 0.0) {",
    "    col += uColor * 0.07 * exp(d * 9.0) * lit;",
    "    col += uColor * 0.05 * exp(-ld * 3.0);",
    "  }",
    "",
    "  // LED emitters: a ring of dots sitting just outside the edge.",
    "  vec2 q = p - CENTER;",
    "  float N = 54.0;",
    "  float cell = (atan(q.y, q.x) / 6.2831853 + 0.5) * N;",
    "  float id = floor(cell);",
    "  float along = (fract(cell) - 0.5) * 6.2831853 / N * length(q);",
    "  float dotD = length(vec2(along, d - 0.022));",
    "  float flicker = 0.55 + 0.45 * sin(uTime * (1.5 + 2.5 * hash(vec2(id, 3.0))) + hash(vec2(id, 7.0)) * 6.2831);",
    "  float led = smoothstep(0.0042 + px, 0.0018, dotD);",
    "  col += mix(uColor, warm, 0.5) * led * flicker * (0.35 + 0.9 * exp(-ld * ld * 9.0) + uPulse);",
    "  col += uColor * exp(-dotD * 90.0) * 0.12 * flicker * lit;",
    "",
    "  // Floor: a blurred mirror image of the shape, glow spill and grain.",
    "  float depth = FLOOR - p.y;",
    "  if (depth > 0.0) {",
    "    vec2 rp = vec2(p.x, FLOOR + depth * 1.7);",
    "    float re = abs(scene(rp));",
    "    float blur = 1.0 + depth * 9.0;",
    "    float rlit = 0.3 + 1.5 * exp(-pow(length(rp - uLight), 2.0) * 7.0) + uPulse;",
    "    float grain = 0.7 + 0.6 * noise(p * vec2(90.0, 260.0));",
    "    col += uColor * rlit * (exp(-re * 40.0 / blur) * 0.5 + smoothstep(0.004 * blur, 0.0, re) * 0.35) * exp(-depth * 5.0) * grain;",
    "    col += uColor * 0.2 * exp(-p.x * p.x * 7.0) * exp(-depth * 7.0) * grain;",
    "    // a pool of light under the pointer",
    "    col += uColor * 0.1 * exp(-pow(p.x - uLight.x, 2.0) * 10.0) * exp(-depth * 9.0) * grain;",
    "  }",
    "  // Horizon line where the floor begins.",
    "  col += uColor * 0.22 * exp(-abs(depth) * 260.0) * exp(-p.x * p.x * 5.0);",
    "",
    "  // Faint bloom around the whole shape.",
    "  col += uColor * 0.05 * exp(-length(q) * 2.6);",
    "",
    "  // Tone map, fade toward the canvas edges, add film grain.",
    "  col = 1.0 - exp(-col * 1.35);",
    "  vec2 uv = frag / uRes;",
    "  float edge = smoothstep(0.0, 0.18, uv.x) * smoothstep(1.0, 0.82, uv.x)",
    "             * smoothstep(0.0, 0.12, uv.y) * smoothstep(1.0, 0.9, uv.y);",
    "  col *= edge;",
    "  col += (hash(frag + fract(uTime) * 91.0) - 0.5) * 0.035 * edge;",
    "  col = max(col, 0.0);",
    "",
    "  // Premultiplied alpha, so the glow sits on top of the page background.",
    "  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);",
    "  gl_FragColor = vec4(col, a);",
    "}"
  ].join("\n");

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("glow-shape:", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
    if (!m) return [0.95, 0.66, 0.23];
    var n = parseInt(m[1], 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  function init(root) {
    var canvas = root.querySelector("canvas");
    if (!canvas) return;

    var gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) { root.classList.add("no-webgl"); return; }

    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { root.classList.add("no-webgl"); return; }
    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { root.classList.add("no-webgl"); return; }
    gl.useProgram(prog);

    // One triangle that covers the whole canvas.
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    var U = {};
    ["uRes", "uScale", "uTime", "uLight", "uFrom", "uTo", "uMix", "uPulse", "uColor"].forEach(function (n) {
      U[n] = gl.getUniformLocation(prog, n);
    });

    var accent = getComputedStyle(document.documentElement).getPropertyValue("--accent");
    gl.uniform3fv(U.uColor, hexToRgb(root.getAttribute("data-color") || accent));

    root.classList.add("has-glow");

    // ---- shape state ----
    function shapeIndex(name) {
      var i = SHAPES.indexOf(name);
      return i < 0 ? 3 : i;
    }
    var params = new URLSearchParams(location.search);
    var current = shapeIndex(params.get("shape") || root.getAttribute("data-shape"));
    var from = current, mix = 1, pulse = 0, morphStart = -1;

    function setShape(i) {
      if (i === current) return;
      from = current;
      current = i;
      mix = 0;
      morphStart = -1;
      pulse = 0.9;
      kick();
    }
    canvas.addEventListener("click", function () { setShape((current + 1) % SHAPES.length); });

    // ---- pointer-driven light ----
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var light = [0.25, 0.2], target = null, lastMove = -1e9;

    window.addEventListener("pointermove", function (ev) {
      var r = canvas.getBoundingClientRect();
      if (!r.height) return;
      var s = scaleFor(r.width, r.height);
      target = [
        (ev.clientX - r.left - r.width / 2) / s,
        -(ev.clientY - r.top - r.height / 2) / s
      ];
      lastMove = performance.now();
      kick();
    }, { passive: true });

    // ---- sizing ----
    // Fit the scene to the canvas height, or to its width on narrow screens.
    function scaleFor(w, h) { return Math.min(h, w * 0.72); }
    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    }
    window.addEventListener("resize", function () { resize(); kick(); });

    // ---- render loop (pauses when offscreen or the tab is hidden) ----
    var visible = true, raf = 0, t0 = performance.now();

    function frame(now) {
      raf = 0;
      var t = (now - t0) / 1000;

      // When the pointer has been still for a while, let the light drift on its own.
      var idle = now - lastMove > 2500 || !target;
      var goal = idle && !reduced
        ? [Math.cos(t * 0.45) * 0.38, 0.06 + Math.sin(t * 0.7) * 0.16]
        : (target || light);
      var ease = idle ? 0.02 : 0.09;
      light[0] += (goal[0] - light[0]) * ease;
      light[1] += (goal[1] - light[1]) * ease;

      if (mix < 1) {
        if (morphStart < 0) morphStart = now;
        var k = Math.min((now - morphStart) / 700, 1);
        mix = k < 1 ? 1 - Math.pow(1 - k, 3) : 1;
        if (mix >= 1) from = current;
      }
      pulse *= 0.93;

      resize();
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uScale, scaleFor(canvas.width, canvas.height));
      gl.uniform1f(U.uTime, reduced ? 0 : t);
      gl.uniform2f(U.uLight, light[0], light[1]);
      gl.uniform1f(U.uFrom, from);
      gl.uniform1f(U.uTo, current);
      gl.uniform1f(U.uMix, mix);
      gl.uniform1f(U.uPulse, pulse);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // With reduced motion, only keep drawing while something is still settling.
      var settling = mix < 1 || pulse > 0.01 || (target && Math.abs(goal[0] - light[0]) + Math.abs(goal[1] - light[1]) > 0.001);
      if (visible && (!reduced || settling)) kick();
    }

    function kick() {
      if (!raf && visible) raf = requestAnimationFrame(frame);
    }

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting && !document.hidden;
        kick();
      }).observe(canvas);
    }
    document.addEventListener("visibilitychange", function () {
      visible = !document.hidden;
      kick();
    });

    kick();
  }

  function start() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-glow]"), init);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
