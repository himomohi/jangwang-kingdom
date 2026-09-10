import { RGB } from "./palette";

export const CLEAR = 255;

export class PixelBuf {
  readonly w: number;
  readonly h: number;
  readonly idx: Uint8Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.idx = new Uint8Array(w * h);
    this.idx.fill(CLEAR);
  }

  clear(): void {
    this.idx.fill(CLEAR);
  }

  set(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.idx[y * this.w + x] = c;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return CLEAR;
    return this.idx[y * this.w + x]!;
  }

  fill(x: number, y: number, w: number, h: number, c: number): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.w, x + w);
    const y1 = Math.min(this.h, y + h);
    for (let yy = y0; yy < y1; yy++) {
      const row = yy * this.w;
      for (let xx = x0; xx < x1; xx++) this.idx[row + xx] = c;
    }
  }

  circle(cx: number, cy: number, r: number, c: number): void {
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(this.w, Math.ceil(cx + r + 1));
    const y1 = Math.min(this.h, Math.ceil(cy + r + 1));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) this.set(x, y, c);
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: number): void {
    const x0 = Math.max(0, Math.floor(cx - rx));
    const y0 = Math.max(0, Math.floor(cy - ry));
    const x1 = Math.min(this.w, Math.ceil(cx + rx + 1));
    const y1 = Math.min(this.h, Math.ceil(cy + ry + 1));
    const rx2 = rx * rx || 1;
    const ry2 = ry * ry || 1;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dx = (x - cx) * (x - cx) / rx2;
        const dy = (y - cy) * (y - cy) / ry2;
        if (dx + dy <= 1) this.set(x, y, c);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: number): void {
    let dx = Math.abs(x1 - x0);
    let dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (let i = 0; i < 64; i++) {
      this.set(x, y, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** Soft silhouette using a palette shade — never #000. */
  rim(edge: number): void {
    const copy = this.idx.slice();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (copy[i] !== CLEAR) continue;
        const n =
          (x > 0 && copy[i - 1] !== CLEAR) ||
          (x + 1 < this.w && copy[i + 1] !== CLEAR) ||
          (y > 0 && copy[i - this.w] !== CLEAR) ||
          (y + 1 < this.h && copy[i + this.w] !== CLEAR);
        if (n) this.idx[i] = edge;
      }
    }
  }

  toCanvas(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = this.w;
    c.height = this.h;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(this.w, this.h);
    const d = img.data;
    for (let i = 0; i < this.idx.length; i++) {
      const p = this.idx[i]!;
      if (p === CLEAR) continue;
      const rgb = RGB[p] ?? RGB[0]!;
      const o = i * 4;
      d[o] = rgb[0];
      d[o + 1] = rgb[1];
      d[o + 2] = rgb[2];
      d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
}

export function bake(draw: (b: PixelBuf) => void, w: number, h: number): HTMLCanvasElement {
  const buf = new PixelBuf(w, h);
  draw(buf);
  return buf.toCanvas();
}
