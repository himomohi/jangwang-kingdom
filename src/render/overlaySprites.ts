/**
 * Optional sprite overlays under public/sprites/.
 * Codegen bodies remain primary; these images (when present) are drawn
 * underneath at low alpha as a homage hint. Missing files are silently ignored.
 *
 * Known-good assets (preserved from main):
 * - sprites/knight/sprite-sheet-alpha.png : 4x 256px cells, original knight
 * - sprites/knight/knight_base.png         : single full-body fallback
 * - sprites/enemies/sprite-sheet-alpha.png : 4x 256px cells, original slime
 * NOTE: sprites/enemies/slime_base.png is a corrupted pipeline output
 * (black mass) and is intentionally NOT used.
 */

interface Sheet {
  img: HTMLImageElement;
  cells: number;
  cell: number;
}

export class OverlaySprites {
  private knightSheet: Sheet | null = null;
  private knightBase: HTMLImageElement | null = null;
  private slimeSheet: Sheet | null = null;
  loaded = false;

  load(baseUrl: string): void {
    if (this.loaded) return;
    this.loaded = true;
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const get = (
      rel: string,
      onOk: (img: HTMLImageElement) => void,
    ): void => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (img.naturalWidth > 0) onOk(img);
      };
      img.onerror = () => {
        /* optional asset missing — codegen body is primary */
      };
      img.src = base + rel;
    };
    get('sprites/knight/sprite-sheet-alpha.png', (img) => {
      const cells = Math.max(1, Math.round(img.naturalWidth / Math.max(1, img.naturalHeight)));
      this.knightSheet = { img, cells, cell: img.naturalHeight };
    });
    get('sprites/knight/knight_base.png', (img) => {
      this.knightBase = img;
    });
    get('sprites/enemies/sprite-sheet-alpha.png', (img) => {
      const cells = Math.max(1, Math.round(img.naturalWidth / Math.max(1, img.naturalHeight)));
      this.slimeSheet = { img, cells, cell: img.naturalHeight };
    });
  }

  /**
   * Knight overlay hint for knight-job players. Returns true if drawn.
   * Codegen body is always drawn on top by the renderer.
   */
  drawPlayer(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    job: string,
    phase: number,
    moving: boolean,
  ): boolean {
    if (job !== 'knight') return false;
    const w = 20 * scale;
    const h = 24 * scale;
    if (this.knightSheet) {
      const frame = moving ? Math.abs(Math.floor(phase)) % this.knightSheet.cells : 0;
      return this.blitCell(this.knightSheet, frame, ctx, x, y, w, h);
    }
    if (this.knightBase) return this.blit(this.knightBase, ctx, x, y, w, h);
    return false;
  }

  /** Slime overlay hint. Returns true if drawn. */
  drawEnemy(
    ctx: CanvasRenderingContext2D,
    kind: string,
    x: number,
    y: number,
    scale: number,
    phase: number,
    moving: boolean,
  ): boolean {
    if (kind !== 'slime' || !this.slimeSheet) return false;
    // frames 2-3 are the squash/blink variants — use while hopping
    const frame = moving ? 2 + (Math.abs(Math.floor(phase * 0.7)) % 2) : 0;
    return this.blitCell(this.slimeSheet, frame, ctx, x, y, 18 * scale, 14 * scale);
  }

  private blitCell(
    sheet: Sheet,
    frame: number,
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): boolean {
    const { img, cell, cells } = sheet;
    if (!img.complete || img.naturalWidth === 0) return false;
    const f = Math.min(cells - 1, Math.max(0, frame));
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.drawImage(img, f * cell, 0, cell, cell, x - w / 2, y - h, w, h);
    ctx.restore();
    return true;
  }

  private blit(
    img: HTMLImageElement,
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): boolean {
    if (!img.complete || img.naturalWidth === 0) return false;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.drawImage(img, x - w / 2, y - h, w, h);
    ctx.restore();
    return true;
  }
}
