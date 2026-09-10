/**
 * Multi-pass WebGL post pipeline (world canvas ONLY — DOM UI is unaffected).
 *
 * Passes (bloom ON):
 *  1. brightpass — threshold + soft knee extraction
 *  2. downsample  — 9-tap tent downsample to bloom resolution
 *  3-6+. separable Gaussian blur — ping-pong H/V passes (>=4, quality-scaled)
 *  7. upsample    — tent upsample back to full resolution
 *  8. composite   — base (NEAREST) + bloom (LINEAR) + night grade + restrained CRT + flash
 *
 * Base texture uses NEAREST (crisp pixels); all bloom chain textures use LINEAR.
 * Bloom intensity controllable; CRT toggle restrained (subtle scanline/CA/vignette/
 * phosphor — must NOT fake a tile grid). Settings persist to localStorage.
 * Quality high/medium/low scales bloom resolution + gaussian pass count for mobile.
 */

const VERT = `
attribute vec2 aPos;
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// brightpass: threshold + soft knee
const FRAG_BRIGHT = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uThreshold;
uniform float uKnee;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float lo = max(0.0, uThreshold - uKnee);
  float hi = uThreshold + uKnee;
  float w = smoothstep(lo, hi, lum);
  vec3 outc = c * w;
  gl_FragColor = vec4(outc, 1.0);
}
`;

// downsample: 9-tap tent
const FRAG_DOWN = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb * 4.0;
  c += texture2D(uTex, vUv + vec2(uTexel.x, 0.0)).rgb * 2.0;
  c += texture2D(uTex, vUv - vec2(uTexel.x, 0.0)).rgb * 2.0;
  c += texture2D(uTex, vUv + vec2(0.0, uTexel.y)).rgb * 2.0;
  c += texture2D(uTex, vUv - vec2(0.0, uTexel.y)).rgb * 2.0;
  c += texture2D(uTex, vUv + vec2(uTexel.x, uTexel.y)).rgb;
  c += texture2D(uTex, vUv + vec2(-uTexel.x, uTexel.y)).rgb;
  c += texture2D(uTex, vUv + vec2(uTexel.x, -uTexel.y)).rgb;
  c += texture2D(uTex, vUv + vec2(-uTexel.x, -uTexel.y)).rgb;
  gl_FragColor = vec4(c / 16.0, 1.0);
}
`;

// separable Gaussian blur — direction via uDir (H or V), linear-sampled 5-tap ~= 9-tap
const FRAG_GAUSS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
  vec2 d = uDir;
  vec3 c = texture2D(uTex, vUv).rgb * 0.227027;
  c += texture2D(uTex, vUv + d * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(uTex, vUv - d * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(uTex, vUv + d * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(uTex, vUv - d * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}
`;

// upsample: 4-tap tent
const FRAG_UP = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
void main() {
  vec2 t = uTexel * 0.5;
  vec3 c = texture2D(uTex, vUv + vec2(-t.x, -t.y)).rgb;
  c += texture2D(uTex, vUv + vec2(t.x, -t.y)).rgb;
  c += texture2D(uTex, vUv + vec2(-t.x, t.y)).rgb;
  c += texture2D(uTex, vUv + vec2(t.x, t.y)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}
`;

// composite: base NEAREST + bloom LINEAR + grade + restrained CRT + flash
const FRAG_COMP = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uBase;
uniform sampler2D uBloom;
uniform vec2 uRes;
uniform float uTime;
uniform float uNight;
uniform float uFlash;
uniform vec3 uFlashCol;
uniform float uBloomAmt;
uniform float uCrt;

vec2 barrel(vec2 uv) {
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  return uv + cc * r2 * 0.06;
}

void main() {
  vec2 uv = uCrt > 0.5 ? barrel(vUv) : vUv;
  vec2 px = 1.0 / uRes;
  vec2 cc = vUv - 0.5;
  // restrained chromatic aberration: sub-pixel, slightly stronger at edges
  float ab = uCrt > 0.5 ? (dot(cc, cc) * 1.2 + 0.15) : 0.0;
  vec3 col;
  col.r = texture2D(uBase, uv + vec2(px.x * ab, 0.0)).r;
  col.g = texture2D(uBase, uv).g;
  col.b = texture2D(uBase, uv - vec2(px.x * ab, 0.0)).b;

  vec3 bloom = texture2D(uBloom, vUv).rgb;
  col += bloom * uBloomAmt * (0.9 + uNight * 0.5);

  vec3 nightTint = vec3(0.82, 0.92, 1.12);
  vec3 dayTint = vec3(1.02, 1.0, 0.96);
  col *= mix(dayTint, nightTint, uNight);

  if (uCrt > 0.5) {
    // restrained scanline + aperture grille (very subtle, never a tile grid)
    float scan = sin(vUv.y * uRes.y * 3.14159) * 0.5 + 0.5;
    col *= 0.97 + scan * 0.03;
    float grille = sin(vUv.x * uRes.x * 3.14159 * 0.5) * 0.5 + 0.5;
    col *= 0.985 + grille * 0.015;
    float vig = smoothstep(0.95, 0.35, length(cc) * 1.6);
    col *= mix(0.85, 1.0, vig);
    float g = fract(sin(dot(vUv * (uTime + 13.0), vec2(12.9898, 78.233))) * 43758.5453);
    col += (g - 0.5) * 0.02;
  } else {
    float g = fract(sin(dot(vUv * (uTime + 13.0), vec2(12.9898, 78.233))) * 43758.5453);
    col += (g - 0.5) * 0.008;
  }

  col = mix(col, uFlashCol, uFlash * 0.45);
  gl_FragColor = vec4(col, 1.0);
}
`;

export type PostQuality = 'high' | 'medium' | 'low';

export interface PostSettings {
  bloom: boolean;
  crt: boolean;
  quality: PostQuality;
  intensity: number; // 0..2 bloom strength
}

const LS_JSON = 'jangwang-post-v1';
const LS_BLOOM = 'jangwang-post-bloom';
const LS_CRT = 'jangwang-post-crt';
const LS_QUALITY = 'jangwang-post-quality';
const LS_INTENSITY = 'jangwang-post-intensity';

function defaultQuality(): PostQuality {
  try {
    if (typeof window !== 'undefined') {
      const touch = (navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window;
      const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
      const small = window.innerWidth < 700;
      if (touch || coarse || small) return 'medium';
    }
  } catch {
    /* noop */
  }
  return 'high';
}

function loadSettings(): PostSettings {
  const fallback: PostSettings = { bloom: true, crt: true, quality: defaultQuality(), intensity: 0.9 };
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(LS_JSON);
      if (raw) {
        const p = JSON.parse(raw) as Partial<PostSettings>;
        return {
          bloom: p.bloom ?? fallback.bloom,
          crt: p.crt ?? fallback.crt,
          quality: p.quality === 'high' || p.quality === 'medium' || p.quality === 'low' ? p.quality : fallback.quality,
          intensity: Number.isFinite(p.intensity) ? Math.max(0, Math.min(2, p.intensity as number)) : fallback.intensity,
        };
      }
      // legacy individual keys
      const b = localStorage.getItem(LS_BLOOM);
      const c = localStorage.getItem(LS_CRT);
      const q = localStorage.getItem(LS_QUALITY);
      const inten = localStorage.getItem(LS_INTENSITY);
      if (b !== null || c !== null || q !== null || inten !== null) {
        return {
          bloom: b === null ? fallback.bloom : b === '1' || b === 'true',
          crt: c === null ? fallback.crt : c === '1' || c === 'true',
          quality: q === 'high' || q === 'medium' || q === 'low' ? q : fallback.quality,
          intensity: inten !== null && Number.isFinite(Number(inten)) ? Math.max(0, Math.min(2, Number(inten))) : fallback.intensity,
        };
      }
    }
  } catch {
    /* noop */
  }
  return fallback;
}

function saveSettings(s: PostSettings): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_JSON, JSON.stringify(s));
    localStorage.setItem(LS_BLOOM, s.bloom ? '1' : '0');
    localStorage.setItem(LS_CRT, s.crt ? '1' : '0');
    localStorage.setItem(LS_QUALITY, s.quality);
    localStorage.setItem(LS_INTENSITY, String(s.intensity));
  } catch {
    /* noop */
  }
}

function qualitySpec(q: PostQuality): { brightDiv: number; bloomDiv: number; gaussPasses: number } {
  if (q === 'high') return { brightDiv: 2, bloomDiv: 4, gaussPasses: 6 };
  if (q === 'medium') return { brightDiv: 3, bloomDiv: 6, gaussPasses: 4 };
  return { brightDiv: 4, bloomDiv: 8, gaussPasses: 4 };
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

export class PostFX {
  canvas: HTMLCanvasElement;
  ok = false;
  flashT = 0;
  flashCol: [number, number, number] = [1, 0.3, 0.2];
  settings: PostSettings;

  private gl: WebGLRenderingContext | null = null;
  private progBright: WebGLProgram | null = null;
  private progDown: WebGLProgram | null = null;
  private progGauss: WebGLProgram | null = null;
  private progUp: WebGLProgram | null = null;
  private progComp: WebGLProgram | null = null;

  private baseTex: WebGLTexture | null = null;
  private bright: Target | null = null;
  private bloomA: Target | null = null;
  private bloomB: Target | null = null;
  private up: Target | null = null;
  private blackTex: WebGLTexture | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.settings = loadSettings();
    try {
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.ok = false;
      });
    } catch {
      /* noop */
    }
    try {
      const gl = canvas.getContext('webgl', {
        antialias: false,
        depth: false,
        stencil: false,
        alpha: false,
        powerPreference: 'low-power',
      }) as WebGLRenderingContext | null;
      if (!gl) return;
      this.gl = gl;

      const mk = (fs: string): WebGLProgram | null => this.linkProg(VERT, fs);
      this.progBright = mk(FRAG_BRIGHT);
      this.progDown = mk(FRAG_DOWN);
      this.progGauss = mk(FRAG_GAUSS);
      this.progUp = mk(FRAG_UP);
      this.progComp = mk(FRAG_COMP);
      if (!this.progBright || !this.progDown || !this.progGauss || !this.progUp || !this.progComp) return;

      // fullscreen quad, fixed attrib locations 0=aPos 1=aUv
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );
      gl.enableVertexAttribArray(0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

      // base texture: NEAREST for crisp pixels
      const base = gl.createTexture();
      if (!base) return;
      gl.bindTexture(gl.TEXTURE_2D, base);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      this.baseTex = base;

      // bloom chain textures: LINEAR
      this.bright = this.makeTarget(2, 2);
      this.bloomA = this.makeTarget(2, 2);
      this.bloomB = this.makeTarget(2, 2);
      this.up = this.makeTarget(2, 2);
      if (!this.bright || !this.bloomA || !this.bloomB || !this.up) return;

      const black = gl.createTexture();
      if (black) {
        gl.bindTexture(gl.TEXTURE_2D, black);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      }
      this.blackTex = black;
      this.ok = true;
    } catch {
      this.ok = false;
    }
  }

  // ---------- settings API (persisted to localStorage) ----------

  getSettings(): PostSettings {
    return { ...this.settings };
  }

  setBloom(on: boolean): void {
    this.settings.bloom = !!on;
    saveSettings(this.settings);
  }

  setCrt(on: boolean): void {
    this.settings.crt = !!on;
    saveSettings(this.settings);
  }

  setQuality(q: PostQuality): void {
    if (q !== 'high' && q !== 'medium' && q !== 'low') return;
    if (this.settings.quality === q) return;
    this.settings.quality = q;
    saveSettings(this.settings);
    this.resize(this.canvas.width, this.canvas.height);
  }

  setIntensity(v: number): void {
    if (!Number.isFinite(v)) return;
    this.settings.intensity = Math.max(0, Math.min(2, v));
    saveSettings(this.settings);
  }

  toggleBloom(): boolean {
    this.setBloom(!this.settings.bloom);
    return this.settings.bloom;
  }

  toggleCrt(): boolean {
    this.setCrt(!this.settings.crt);
    return this.settings.crt;
  }

  cycleQuality(): PostQuality {
    const next: PostQuality = this.settings.quality === 'high' ? 'medium' : this.settings.quality === 'medium' ? 'low' : 'high';
    this.setQuality(next);
    return next;
  }

  /** Ordered post pass list for the current settings (for HUD/report/tests). */
  getPassList(): string[] {
    if (!this.settings.bloom) {
      return this.settings.crt ? ['composite+crt'] : ['composite'];
    }
    const spec = qualitySpec(this.settings.quality);
    const out = ['brightpass', 'downsample'];
    for (let i = 0; i < spec.gaussPasses; i++) {
      out.push(i % 2 === 0 ? `gauss-h${Math.floor(i / 2) + 1}` : `gauss-v${Math.floor(i / 2) + 1}`);
    }
    out.push('upsample');
    out.push(this.settings.crt ? 'composite+crt' : 'composite');
    return out;
  }

  // ---------- GL helpers ----------

  private shader(type: number, src: string): WebGLShader | null {
    const gl = this.gl;
    if (!gl) return null;
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
    return sh;
  }

  private linkProg(vsSrc: string, fsSrc: string): WebGLProgram | null {
    const gl = this.gl;
    if (!gl) return null;
    const vs = this.shader(gl.VERTEX_SHADER, vsSrc);
    const fs = this.shader(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    if (!prog) return null;
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.bindAttribLocation(prog, 1, 'aUv');
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    return prog;
  }

  private makeTarget(w: number, h: number): Target | null {
    const gl = this.gl;
    if (!gl) return null;
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  private resizeTarget(t: Target, w: number, h: number): void {
    const gl = this.gl;
    if (!gl) return;
    w = Math.max(2, Math.floor(w));
    h = Math.max(2, Math.floor(h));
    if (t.w === w && t.h === h) return;
    t.w = w;
    t.h = h;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(2, Math.floor(w));
    this.canvas.height = Math.max(2, Math.floor(h));
    const gl = this.gl;
    if (!gl || !this.bright || !this.bloomA || !this.bloomB || !this.up) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const spec = qualitySpec(this.settings.quality);
    const bw = Math.max(2, Math.floor(this.canvas.width / spec.brightDiv));
    const bh = Math.max(2, Math.floor(this.canvas.height / spec.brightDiv));
    const mw = Math.max(2, Math.floor(this.canvas.width / spec.bloomDiv));
    const mh = Math.max(2, Math.floor(this.canvas.height / spec.bloomDiv));
    this.resizeTarget(this.bright, bw, bh);
    this.resizeTarget(this.bloomA, mw, mh);
    this.resizeTarget(this.bloomB, mw, mh);
    this.resizeTarget(this.up, this.canvas.width, this.canvas.height);
  }

  addFlash(kind: string): void {
    this.flashT = 0.3;
    this.flashCol = kind === 'gold' ? [1, 0.76, 0.3] : [1, 0.3, 0.2];
  }

  private u(prog: WebGLProgram | null, name: string): WebGLUniformLocation | null {
    if (!this.gl || !prog) return null;
    return this.gl.getUniformLocation(prog, name);
  }

  render(src: HTMLCanvasElement, time: number, night: number, dt: number): void {
    const gl = this.gl;
    if (!gl || !this.ok || !this.progComp || !this.baseTex) return;
    try {
      if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);

      // upload world canvas to base NEAREST texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.baseTex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      } catch {
        return;
      }

      const bloomOn = this.settings.bloom;
      const crtOn = this.settings.crt;
      const intensity = this.settings.intensity;
      const threshold = 0.6 - night * 0.15;
      const knee = 0.22;

      let bloomTex: WebGLTexture | null = this.blackTex;

      if (bloomOn && this.progBright && this.progDown && this.progGauss && this.progUp && this.bright && this.bloomA && this.bloomB && this.up) {
        const spec = qualitySpec(this.settings.quality);

        // 1. brightpass (threshold + soft knee) -> bright target
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bright.fbo);
        gl.viewport(0, 0, this.bright.w, this.bright.h);
        gl.useProgram(this.progBright);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.baseTex);
        gl.uniform1i(this.u(this.progBright, 'uTex'), 0);
        gl.uniform1f(this.u(this.progBright, 'uThreshold'), threshold);
        gl.uniform1f(this.u(this.progBright, 'uKnee'), knee);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // 2. downsample -> bloomA
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
        gl.viewport(0, 0, this.bloomA.w, this.bloomA.h);
        gl.useProgram(this.progDown);
        gl.bindTexture(gl.TEXTURE_2D, this.bright.tex);
        gl.uniform1i(this.u(this.progDown, 'uTex'), 0);
        gl.uniform2f(this.u(this.progDown, 'uTexel'), 1 / this.bright.w, 1 / this.bright.h);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // 3-6+. separable Gaussian ping-pong (H/V alternating)
        let read: Target = this.bloomA;
        let write: Target = this.bloomB;
        gl.useProgram(this.progGauss);
        gl.uniform1i(this.u(this.progGauss, 'uTex'), 0);
        const uDir = this.u(this.progGauss, 'uDir');
        for (let i = 0; i < spec.gaussPasses; i++) {
          const horizontal = i % 2 === 0;
          gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
          gl.viewport(0, 0, write.w, write.h);
          gl.bindTexture(gl.TEXTURE_2D, read.tex);
          if (horizontal) gl.uniform2f(uDir, 1 / read.w, 0);
          else gl.uniform2f(uDir, 0, 1 / read.h);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          const tmp = read;
          read = write;
          write = tmp;
        }
        bloomTex = read.tex;

        // 7. upsample -> full-res up target
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.up.fbo);
        gl.viewport(0, 0, this.up.w, this.up.h);
        gl.useProgram(this.progUp);
        gl.bindTexture(gl.TEXTURE_2D, bloomTex);
        gl.uniform1i(this.u(this.progUp, 'uTex'), 0);
        gl.uniform2f(this.u(this.progUp, 'uTexel'), 1 / read.w, 1 / read.h);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        bloomTex = this.up.tex;
      }

      // 8. composite to screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.progComp);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.baseTex);
      gl.uniform1i(this.u(this.progComp, 'uBase'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bloomTex);
      gl.uniform1i(this.u(this.progComp, 'uBloom'), 1);
      gl.uniform2f(this.u(this.progComp, 'uRes'), this.canvas.width, this.canvas.height);
      gl.uniform1f(this.u(this.progComp, 'uTime'), time % 100);
      gl.uniform1f(this.u(this.progComp, 'uNight'), night);
      gl.uniform1f(this.u(this.progComp, 'uFlash'), this.flashT / 0.3);
      gl.uniform3f(this.u(this.progComp, 'uFlashCol'), this.flashCol[0], this.flashCol[1], this.flashCol[2]);
      gl.uniform1f(this.u(this.progComp, 'uBloomAmt'), bloomOn ? intensity : 0);
      gl.uniform1f(this.u(this.progComp, 'uCrt'), crtOn ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.activeTexture(gl.TEXTURE0);
    } catch {
      // Never crash the game loop on GL errors; keep last good frame.
    }
  }
}
