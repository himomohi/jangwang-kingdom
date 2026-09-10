/**
 * Optional sprite overlays under public/sprites/.
 * Codegen bodies remain primary; these images (if present) are drawn
 * underneath at low alpha as a homage hint. Missing files are silently ignored.
 */

export class OverlaySprites {
  private playerImgs: HTMLImageElement[] = [];
  private enemyImgs = new Map<string, HTMLImageElement[]>();
  loaded = false;

  load(baseUrl: string): void {
    if (this.loaded) return;
    this.loaded = true;
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const candidates: Record<string, string[]> = {
      knight: ['sprites/knight/idle.png', 'sprites/knight/walk.png', 'sprites/knight/player.png'],
      slime: ['sprites/enemies/slime.png'],
      wolf: ['sprites/enemies/wolf.png'],
      bandit: ['sprites/enemies/bandit.png'],
      shade: ['sprites/enemies/shade.png'],
      watcher: ['sprites/enemies/watcher.png'],
    };
    for (const [key, paths] of Object.entries(candidates)) {
      for (const rel of paths) {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          if (key === 'knight') this.playerImgs.push(img);
          else {
            const arr = this.enemyImgs.get(key) ?? [];
            arr.push(img);
            this.enemyImgs.set(key, arr);
          }
        };
        img.onerror = () => {
          /* optional asset missing — codegen body is primary */
        };
        img.src = base + rel;
      }
    }
  }

  /** Draw player overlay hint. Returns true if something was drawn. */
  drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): boolean {
    if (this.playerImgs.length === 0) return false;
    const img = this.playerImgs[0];
    return this.blit(img, ctx, x, y, 16 * scale, 20 * scale);
  }

  drawEnemy(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, scale: number): boolean {
    const arr = this.enemyImgs.get(kind);
    if (!arr || arr.length === 0) return false;
    return this.blit(arr[0], ctx, x, y, 16 * scale, 18 * scale);
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
    ctx.globalAlpha = 0.28;
    ctx.drawImage(img, x - w / 2, y - h, w, h);
    ctx.restore();
    return true;
  }
}
