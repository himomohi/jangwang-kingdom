/**
 * WebGL post pipeline (world canvas ONLY — DOM UI is unaffected).
 * Single-pass: bloom-ish glow + CRT scanlines + chromatic aberration + vignette.
 * Falls back to direct 2D display when WebGL is unavailable.
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

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTime;
uniform float uNight;   // 0 day .. 1 night
uniform float uFlash;   // event flash 0..1
uniform vec3 uFlashCol;

vec2 barrel(vec2 uv) {
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  return uv + cc * r2 * 0.12;
}

void main() {
  vec2 uv = barrel(vUv);
  vec2 px = 1.0 / uRes;
  // chromatic aberration (stronger at edges)
  vec2 cc = vUv - 0.5;
  float ab = dot(cc, cc) * 3.0 + 0.4;
  vec3 col;
  col.r = texture2D(uTex, uv + vec2(px.x * ab, 0.0)).r;
  col.g = texture2D(uTex, uv).g;
  col.b = texture2D(uTex, uv - vec2(px.x * ab, 0.0)).b;

  // cheap bloom: threshold + 4-tap blur
  vec3 blur = vec3(0.0);
  blur += texture2D(uTex, uv + vec2(px.x * 2.0, 0.0)).rgb;
  blur += texture2D(uTex, uv - vec2(px.x * 2.0, 0.0)).rgb;
  blur += texture2D(uTex, uv + vec2(0.0, px.y * 2.0)).rgb;
  blur += texture2D(uTex, uv - vec2(0.0, px.y * 2.0)).rgb;
  blur *= 0.25;
  float lum = dot(blur, vec3(0.299, 0.587, 0.114));
  float glow = smoothstep(0.35, 0.9, lum);
  col += blur * glow * (0.35 + uNight * 0.35);

  // night grade: cool shadows, deeper blues
  vec3 nightTint = vec3(0.82, 0.92, 1.12);
  vec3 dayTint = vec3(1.02, 1.0, 0.96);
  col *= mix(dayTint, nightTint, uNight);

  // scanlines + aperture grille hint
  float scan = sin(vUv.y * uRes.y * 3.14159) * 0.5 + 0.5;
  col *= 0.94 + scan * 0.06;
  float grille = sin(vUv.x * uRes.x * 3.14159 * 0.5) * 0.5 + 0.5;
  col *= 0.97 + grille * 0.03;

  // vignette
  float vig = smoothstep(0.95, 0.35, length(cc) * 1.6);
  col *= mix(0.62, 1.0, vig);

  // animated grain
  float g = fract(sin(dot(vUv * (uTime + 13.0), vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * 0.045;

  // event flash
  col = mix(col, uFlashCol, uFlash * 0.45);

  gl_FragColor = vec4(col, 1.0);
}
`;

export class PostFX {
  canvas: HTMLCanvasElement;
  ok = false;
  private gl: WebGLRenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private tex: WebGLTexture | null = null;
  private uRes: WebGLUniformLocation | null = null;
  private uTime: WebGLUniformLocation | null = null;
  private uNight: WebGLUniformLocation | null = null;
  private uFlash: WebGLUniformLocation | null = null;
  private uFlashCol: WebGLUniformLocation | null = null;
  flashT = 0;
  flashCol: [number, number, number] = [1, 0.3, 0.2];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
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
      const vs = this.shader(gl.VERTEX_SHADER, VERT);
      const fs = this.shader(gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return;
      const prog = gl.createProgram();
      if (!prog) return;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
      this.prog = prog;
      gl.useProgram(prog);

      // fullscreen triangle strip
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );
      const aPos = gl.getAttribLocation(prog, 'aPos');
      const aUv = gl.getAttribLocation(prog, 'aUv');
      gl.enableVertexAttribArray(aPos);
      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      this.tex = tex;

      this.uRes = gl.getUniformLocation(prog, 'uRes');
      this.uTime = gl.getUniformLocation(prog, 'uTime');
      this.uNight = gl.getUniformLocation(prog, 'uNight');
      this.uFlash = gl.getUniformLocation(prog, 'uFlash');
      this.uFlashCol = gl.getUniformLocation(prog, 'uFlashCol');
      this.ok = true;
    } catch {
      this.ok = false;
    }
  }

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

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(2, Math.floor(w));
    this.canvas.height = Math.max(2, Math.floor(h));
    if (this.gl) this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  addFlash(kind: string): void {
    this.flashT = 0.3;
    this.flashCol = kind === 'gold' ? [1, 0.76, 0.3] : [1, 0.3, 0.2];
  }

  render(src: HTMLCanvasElement, time: number, night: number, dt: number): void {
    const gl = this.gl;
    if (!gl || !this.ok || !this.prog) return;
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    } catch {
      return;
    }
    gl.uniform2f(this.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uTime, time % 100);
    gl.uniform1f(this.uNight, night);
    gl.uniform1f(this.uFlash, this.flashT / 0.3);
    gl.uniform3f(this.uFlashCol, this.flashCol[0], this.flashCol[1], this.flashCol[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
