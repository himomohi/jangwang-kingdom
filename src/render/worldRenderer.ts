import { C, PALETTE } from '../art/palette';
import {
  drawEnemy, drawFlowers, drawGrassTuft, drawHouse, drawLamp, drawNPC,
  drawPickup, drawPlayer, drawProjectile, drawRock, drawRuin, drawTree,
  type Facing,
} from '../art/sprites';
import { TILE, WORLD_W, WORLD_H, ZONE_NAMES } from '../sim/config';
import { T_FLOWER, T_GRASS, T_PLAZA, T_ROAD, T_RUIN, T_SAND, T_TREE, T_WALL, T_WATER } from '../sim/world';
import type { Sim } from '../sim/game';
import { OverlaySprites } from './overlaySprites';

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface AnimEntry {
  phase: number;
  lx: number;
  ly: number;
  moving: boolean;
}

const TEXT_COLORS: Record<string, string> = {
  dmg: C.BONE,
  crit: C.GOLD,
  hurt: C.FLAME,
  heal: C.LEAF,
  gold: C.GOLD,
  info: C.MIST,
};

export class WorldRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  overlay = new OverlaySprites();
  camX = 0;
  camY = 0;
  zoom = 3;
  viewW = 0;
  viewH = 0;
  dpr = 1;
  shakeT = 0;
  shakePower = 0;
  flashT = 0;
  flashColor = 'red';
  private anim = new Map<number | string, AnimEntry>();
  private light: HTMLCanvasElement;
  private lightCtx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas2D unavailable');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;
    this.light = document.createElement('canvas');
    const lctx = this.light.getContext('2d');
    if (!lctx) throw new Error('Canvas2D unavailable');
    this.lightCtx = lctx;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.viewW = Math.max(1, Math.floor(cssW));
    this.viewH = Math.max(1, Math.floor(cssH));
    this.dpr = Math.min(2, Math.max(1, dpr));
    this.canvas.width = Math.floor(this.viewW * this.dpr);
    this.canvas.height = Math.floor(this.viewH * this.dpr);
    this.light.width = Math.max(2, Math.floor(this.viewW / 2));
    this.light.height = Math.max(2, Math.floor(this.viewH / 2));
    // Zoom: keep ~13-20 tiles visible on the short axis for readability.
    const short = Math.min(this.viewW, this.viewH);
    this.zoom = Math.max(1.75, Math.min(3.5, short / 240));
    this.ctx.imageSmoothingEnabled = false;
  }

  addShake(power: number): void {
    this.shakePower = Math.max(this.shakePower, power);
    this.shakeT = 0.3;
  }

  addFlash(color: string): void {
    this.flashColor = color;
    this.flashT = 0.35;
  }

  private animFor(key: number | string, x: number, y: number, dt: number): AnimEntry {
    let e = this.anim.get(key);
    if (!e) {
      e = { phase: Math.random() * 6, lx: x, ly: y, moving: false };
      this.anim.set(key, e);
      return e;
    }
    const moved = Math.hypot(x - e.lx, y - e.ly);
    e.moving = moved > dt * 8;
    if (e.moving) e.phase += dt * 11;
    else e.phase += dt * 2.5;
    e.lx = x;
    e.ly = y;
    return e;
  }

  render(sim: Sim, t: number, dt: number): void {
    const { ctx } = this;
    const p = sim.player;
    const world = sim.world;

    // camera follow + clamp
    const vw = this.viewW / this.zoom;
    const vh = this.viewH / this.zoom;
    const tx = Math.max(vw / 2, Math.min(WORLD_W * TILE - vw / 2, p.x));
    const ty = Math.max(vh / 2, Math.min(WORLD_H * TILE - vh / 2, p.y - 10));
    const k = Math.min(1, dt * 6);
    this.camX += (tx - this.camX) * (this.camX === 0 ? 1 : k);
    this.camY += (ty - this.camY) * (this.camY === 0 ? 1 : k);

    // shake decay
    let shx = 0;
    let shy = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const m = this.shakePower * (this.shakeT / 0.3);
      shx = (Math.random() - 0.5) * 2 * m;
      shy = (Math.random() - 0.5) * 2 * m;
      if (this.shakeT <= 0) this.shakePower = 0;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.VOID;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const z = this.zoom * this.dpr;
    ctx.setTransform(
      z, 0, 0, z,
      this.canvas.width / 2 - (this.camX + shx) * z,
      this.canvas.height / 2 - (this.camY + shy) * z,
    );
    ctx.imageSmoothingEnabled = false;

    // visible tile range
    const x0 = Math.max(0, Math.floor((this.camX - vw / 2) / TILE) - 1);
    const x1 = Math.min(WORLD_W - 1, Math.ceil((this.camX + vw / 2) / TILE) + 1);
    const y0 = Math.max(0, Math.floor((this.camY - vh / 2) / TILE) - 1);
    const y1 = Math.min(WORLD_H - 1, Math.ceil((this.camY + vh / 2) / TILE) + 1);

    this.drawTiles(sim, x0, x1, y0, y1, t);
    this.drawDecorBelow(sim, t);
    this.drawPickups(sim, t);

    // y-sorted draw list: buildings + npcs + enemies + player
    interface Item {
      y: number;
      draw: () => void;
    }
    const items: Item[] = [];
    for (const b of world.buildings) {
      const by = (b.ty + b.th) * TILE;
      if (!this.onScreen((b.tx + b.tw / 2) * TILE, by, 120)) continue;
      items.push({
        y: by,
        draw: () => {
          drawHouse(ctx, b.tx * TILE, b.ty * TILE, b.tw, b.th, b.roof, b.wall, b.sign);
          this.drawLabel((b.tx + b.tw / 2) * TILE, b.ty * TILE - 8, b.label, C.SAND);
        },
      });
    }
    for (const n of sim.npcs) {
      if (!this.onScreen(n.x, n.y, 60)) continue;
      const a = this.animFor(`n${n.id}`, n.x, n.y, dt);
      items.push({
        y: n.y,
        draw: () => {
          drawNPC(ctx, n.kind, {
            x: n.x, y: n.y, facing: n.facing as Facing, phase: a.phase,
            moving: false, swing: -1, flash: false, scale: 1, dim: 0,
          });
          this.drawLabel(n.x, n.y - 26, n.name, C.GOLD);
          // interact hint marker
          const d = Math.hypot(n.x - p.x, n.y - p.y);
          if (d < 40 && p.alive) {
            const bob = Math.sin(t * 5) * 2;
            ctx.fillStyle = C.GOLD;
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('▼', n.x, n.y - 32 + bob);
          }
        },
      });
    }
    for (const e of sim.enemies) {
      if (!this.onScreen(e.x, e.y, 80)) continue;
      const a = this.animFor(e.uid, e.x, e.y, dt);
      items.push({
        y: e.y,
        draw: () => {
          ctx.save();
          if (e.dead) ctx.globalAlpha = Math.max(0, 1 - e.deadT * 2);
          this.overlay.drawEnemy(ctx, e.kind, e.x, e.y, e.elite ? 1.7 : 1);
          drawEnemy(ctx, e.kind, {
            x: e.x, y: e.y, facing: e.facing as Facing, phase: a.phase,
            moving: a.moving || e.ai === 'chase', swing: e.swingT,
            flash: e.hurtCd > 0, scale: e.elite ? 1.7 : 1, dim: 0,
          });
          ctx.restore();
          if (!e.dead && e.hp < e.maxHp) {
            const w = e.elite ? 34 : 20;
            const r = Math.max(0, e.hp / e.maxHp);
            ctx.fillStyle = C.VOID;
            ctx.fillRect(e.x - w / 2 - 1, e.y - 30 * (e.elite ? 1.7 : 1) - 1, w + 2, 5);
            ctx.fillStyle = e.elite ? C.FLAME : C.BLOOD;
            ctx.fillRect(e.x - w / 2, e.y - 30 * (e.elite ? 1.7 : 1), w, 3);
            ctx.fillStyle = e.elite ? C.GOLD : C.FLAME;
            ctx.fillRect(e.x - w / 2, e.y - 30 * (e.elite ? 1.7 : 1), w * r, 3);
          }
        },
      });
    }
    if (p.alive || Math.floor(t * 4) % 2 === 0) {
      const a = this.animFor('player', p.x, p.y, dt);
      items.push({
        y: p.y,
        draw: () => {
          if (!p.alive) ctx.globalAlpha = 0.5;
          this.overlay.drawPlayer(ctx, p.x, p.y, 1);
          drawPlayer(ctx, {
            x: p.x, y: p.y, facing: p.facing as Facing, phase: a.phase,
            moving: a.moving, swing: p.swingT,
            flash: p.hurtCd > 0 && Math.floor(t * 20) % 2 === 0, scale: 1, dim: 0,
          }, p.job);
          if (p.shieldT > 0) {
            ctx.strokeStyle = C.MIST;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y - 9, 14 + Math.sin(t * 8), 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        },
      });
    }
    items.sort((m, n) => m.y - n.y);
    for (const it of items) it.draw();

    // projectiles
    for (const pr of sim.projectiles) {
      if (!this.onScreen(pr.x, pr.y, 30)) continue;
      drawProjectile(ctx, pr.friendly, pr.holy, pr.x, pr.y, t);
    }

    // particles
    for (const pt of sim.particles) {
      if (!this.onScreen(pt.x, pt.y, 20)) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, pt.ttl / pt.ttlMax));
      ctx.fillStyle = PALETTE[pt.color] ?? C.BONE;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    // floating texts
    ctx.textAlign = 'center';
    for (const ft of sim.texts) {
      if (!this.onScreen(ft.x, ft.y, 20)) continue;
      const big = ft.color === 'crit' || ft.color === 'gold';
      ctx.font = `${big ? 'bold 10px' : 'bold 8px'} monospace`;
      ctx.globalAlpha = Math.max(0, Math.min(1, ft.ttl * 1.6));
      ctx.fillStyle = C.VOID;
      ctx.fillText(ft.text, ft.x + 1, ft.y + 1);
      ctx.fillStyle = TEXT_COLORS[ft.color] ?? C.BONE;
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1;

    this.drawLighting(sim, t);

    // damage/event flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      const a = Math.max(0, this.flashT / 0.35) * 0.35;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = this.flashColor === 'gold' ? `rgba(242,193,78,${a})` : `rgba(225,78,43,${a})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  zoneName(sim: Sim): string {
    return ZONE_NAMES[sim.zone];
  }

  private onScreen(x: number, y: number, pad: number): boolean {
    const vw = this.viewW / this.zoom;
    const vh = this.viewH / this.zoom;
    return (
      x > this.camX - vw / 2 - pad && x < this.camX + vw / 2 + pad &&
      y > this.camY - vh / 2 - pad && y < this.camY + vh / 2 + pad
    );
  }

  private drawLabel(x: number, y: number, text: string, color: string): void {
    const { ctx } = this;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    const w = ctx.measureText(text).width + 6;
    ctx.fillStyle = 'rgba(16,24,40,0.72)';
    ctx.fillRect(x - w / 2, y - 8, w, 11);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  private drawTiles(sim: Sim, x0: number, x1: number, y0: number, y1: number, t: number): void {
    const { ctx } = this;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const tile = sim.world.tileAt(tx, ty);
        const px = tx * TILE;
        const py = ty * TILE;
        const h = hash2(tx, ty);
        switch (tile) {
          case T_GRASS:
          case T_FLOWER: {
            ctx.fillStyle = C.PINE;
            ctx.fillRect(px, py, TILE, TILE);
            if (h < 0.5) {
              ctx.fillStyle = C.MOSS;
              ctx.globalAlpha = 0.45;
              ctx.fillRect(px, py, TILE, TILE);
              ctx.globalAlpha = 1;
            }
            if (h < 0.3) {
              ctx.fillStyle = C.MOSS;
              ctx.fillRect(px + (h * 97) % 12, py + (h * 57) % 12, 3, 2);
            }
            if (tile === T_FLOWER) drawFlowers(ctx, px + 8, py + 10, Math.floor(h * 99));
            break;
          }
          case T_TREE: {
            ctx.fillStyle = C.PINE;
            ctx.fillRect(px, py, TILE, TILE);
            drawTree(ctx, px + 8, py + 15, Math.floor(h * 99));
            break;
          }
          case T_ROAD: {
            ctx.fillStyle = C.SAND;
            ctx.fillRect(px, py, TILE, TILE);
            ctx.fillStyle = 'rgba(16,24,40,0.28)';
            ctx.fillRect(px, py, TILE, TILE);
            if ((tx + ty) % 2 === 0) {
              ctx.fillStyle = 'rgba(16,24,40,0.12)';
              ctx.fillRect(px, py, TILE, TILE);
            }
            if (h < 0.4) {
              ctx.fillStyle = C.BONE;
              ctx.fillRect(px + (h * 89) % 13, py + (h * 61) % 13, 2, 2);
            }
            break;
          }
          case T_PLAZA: {
            ctx.fillStyle = C.SLATE;
            ctx.fillRect(px, py, TILE, TILE);
            if ((tx + ty) % 2 === 0) {
              ctx.fillStyle = 'rgba(16,24,40,0.18)';
              ctx.fillRect(px, py, TILE, TILE);
            }
            ctx.fillStyle = C.DEEP;
            ctx.fillRect(px, py + TILE - 1, TILE, 1);
            ctx.fillRect(px + TILE - 1, py, 1, TILE);
            break;
          }
          case T_WATER: {
            ctx.fillStyle = C.DEEP;
            ctx.fillRect(px, py, TILE, TILE);
            const wv = Math.sin(t * 2.4 + tx * 0.7 + ty * 0.4) * 0.5 + 0.5;
            if (wv > 0.72) {
              ctx.fillStyle = C.SLATE;
              ctx.fillRect(px, py + 6, TILE, 2);
            }
            if (h < 0.35) {
              ctx.fillStyle = C.MIST;
              const ox = (h * 113 + t * 6) % 14;
              ctx.fillRect(px + ox, py + (h * 71) % 14, 3, 1);
            }
            break;
          }
          case T_WALL: {
            ctx.fillStyle = C.SLATE;
            ctx.fillRect(px, py, TILE, TILE);
            ctx.fillStyle = C.DEEP;
            ctx.fillRect(px, py + 10, TILE, 6);
            ctx.fillStyle = C.MIST;
            ctx.fillRect(px, py, TILE, 3);
            if ((tx + ty) % 2 === 0) {
              ctx.fillStyle = C.DEEP;
              ctx.fillRect(px + 7, py + 3, 2, 7);
            }
            break;
          }
          case T_RUIN: {
            ctx.fillStyle = C.DEEP;
            ctx.fillRect(px, py, TILE, TILE);
            if (h < 0.5) {
              ctx.fillStyle = C.SLATE;
              ctx.globalAlpha = 0.5;
              ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
              ctx.globalAlpha = 1;
            }
            if (h < 0.3) {
              ctx.fillStyle = C.DUSK;
              ctx.fillRect(px + (h * 83) % 12, py + (h * 47) % 12, 4, 1);
            }
            if (h > 0.8) {
              ctx.fillStyle = C.MOSS;
              ctx.fillRect(px + (h * 59) % 13, py + (h * 37) % 13, 2, 3);
            }
            break;
          }
          case T_SAND: {
            ctx.fillStyle = C.SAND;
            ctx.fillRect(px, py, TILE, TILE);
            if ((tx + ty) % 2 === 0) {
              ctx.fillStyle = 'rgba(16,24,40,0.08)';
              ctx.fillRect(px, py, TILE, TILE);
            }
            if (h < 0.35) {
              ctx.fillStyle = C.BONE;
              ctx.fillRect(px + (h * 101) % 13, py + (h * 67) % 13, 2, 1);
            }
            break;
          }
          default: {
            ctx.fillStyle = C.VOID;
            ctx.fillRect(px, py, TILE, TILE);
          }
        }
      }
    }
  }

  private drawDecorBelow(sim: Sim, t: number): void {
    const { ctx } = this;
    for (const d of sim.world.decor) {
      if (!this.onScreen(d.x, d.y, 40)) continue;
      if (d.kind === 'tuft') drawGrassTuft(ctx, d.x, d.y, d.variant);
      else if (d.kind === 'flowers') drawFlowers(ctx, d.x, d.y, d.variant);
      else if (d.kind === 'rock') drawRock(ctx, d.x, d.y, d.variant);
      else if (d.kind === 'pillar') drawRuin(ctx, d.x, d.y, d.variant);
      else if (d.kind === 'lamp') drawLamp(ctx, d.x, d.y, t);
    }
  }

  private drawPickups(sim: Sim, t: number): void {
    for (const k of sim.pickups) {
      if (!this.onScreen(k.x, k.y, 30)) continue;
      const blink = k.ttl < 8 && Math.floor(t * 6) % 2 === 0;
      if (blink) continue;
      drawPickup(this.ctx, k.kind, k.x, k.y, t);
    }
  }

  private drawLighting(sim: Sim, t: number): void {
    const dark = sim.darkness();
    // Always apply a base grade so day still has mood; night gets heavy.
    const baseAlpha = 0.12 + dark * 0.62;
    const lc = this.lightCtx;
    const lw = this.light.width;
    const lh = this.light.height;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, lw, lh);
    lc.fillStyle = `rgba(16,24,40,${baseAlpha.toFixed(3)})`;
    lc.fillRect(0, 0, lw, lh);

    // world->light transform
    const vw = this.viewW / this.zoom;
    const vh = this.viewH / this.zoom;
    const toLight = (x: number, y: number): [number, number] => {
      const sx = (x - (this.camX - vw / 2)) / vw;
      const sy = (y - (this.camY - vh / 2)) / vh;
      return [sx * lw, sy * lh];
    };

    lc.globalCompositeOperation = 'destination-out';
    const hole = (x: number, y: number, r: number, strength: number) => {
      const [lx, ly] = toLight(x, y);
      const lr = (r / vw) * lw;
      if (lx < -lr || lx > lw + lr || ly < -lr || ly > lh + lr) return;
      const g = lc.createRadialGradient(lx, ly, 0, lx, ly, lr);
      g.addColorStop(0, `rgba(255,255,255,${strength})`);
      g.addColorStop(0.55, `rgba(255,255,255,${strength * 0.6})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      lc.fillStyle = g;
      lc.beginPath();
      lc.arc(lx, ly, lr, 0, Math.PI * 2);
      lc.fill();
    };

    const p = sim.player;
    hole(p.x, p.y - 8, 120 + (1 - dark) * 60, 0.95);
    for (const l of sim.world.lamps) {
      const flick = 0.82 + Math.sin(t * 9 + l.x * 0.3) * 0.08;
      hole(l.x, l.y - 18, 95, flick);
    }
    for (const pr of sim.projectiles) hole(pr.x, pr.y, 60, 0.8);
    // town braziers glow
    hole(47.5 * TILE, 54 * TILE, 130, 0.5);

    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.light, 0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;

    // warm additive accents around lights (ember feel)
    ctx.globalCompositeOperation = 'lighter';
    const warm = (x: number, y: number, r: number, a: number) => {
      const z = this.zoom * this.dpr;
      const sx = this.canvas.width / 2 + (x - this.camX) * z;
      const sy = this.canvas.height / 2 + (y - this.camY) * z;
      const sr = r * z;
      if (sx < -sr || sx > this.canvas.width + sr || sy < -sr || sy > this.canvas.height + sr) return;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      g.addColorStop(0, `rgba(232,147,60,${a})`);
      g.addColorStop(1, 'rgba(232,147,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    };
    const glowA = 0.05 + dark * 0.1;
    for (const l of sim.world.lamps) warm(l.x, l.y - 18, 60, glowA);
    warm(p.x, p.y - 8, 46, 0.045);
    ctx.globalCompositeOperation = 'source-over';
  }
}
