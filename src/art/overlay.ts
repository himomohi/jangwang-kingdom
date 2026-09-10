/** Optional PNG hints. Codegen silhouettes stay primary. α must stay ≤ 0.35. */
export const HINT_ALPHA = 0.32;

type Sheet = {
  img: HTMLImageElement;
  cell: number;
  frames: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`overlay: ${src}`));
    img.src = src;
  });
}

async function loadSheet(src: string, cell: number, frames: number): Promise<Sheet | null> {
  try {
    const img = await loadImage(src);
    return { img, cell, frames };
  } catch {
    return null;
  }
}

export class OverlayHints {
  knight: Sheet | null = null;
  slime: Sheet | null = null;
  ready = false;

  async load(): Promise<void> {
    const base = import.meta.env.BASE_URL;
    const [knight, slime] = await Promise.all([
      loadSheet(`${base}sprites/knight/sprite-sheet-alpha.png`, 256, 4),
      loadSheet(`${base}sprites/enemies/sprite-sheet-alpha.png`, 256, 4),
    ]);
    this.knight = knight;
    this.slime = slime;
    this.ready = true;
  }

  drawKnightHint(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
    blit(ctx, this.knight, x, y, time);
  }

  drawSlimeHint(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
    blit(ctx, this.slime, x, y, time);
  }
}

function blit(ctx: CanvasRenderingContext2D, sheet: Sheet | null, x: number, y: number, time: number): void {
  if (!sheet) return;
  const frame = Math.floor(time * 4) % sheet.frames;
  ctx.save();
  ctx.globalAlpha = HINT_ALPHA;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet.img, frame * sheet.cell, 0, sheet.cell, sheet.cell, x - 2, y - 4, 36, 36);
  ctx.restore();
}

export const overlays = new OverlayHints();
