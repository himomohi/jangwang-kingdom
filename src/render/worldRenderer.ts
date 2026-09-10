/** World renderer: Canvas2D tiles/entities + lighting + emissive FX.
 * Lighting: NW key light (top-left lift + tile edges), entity height shadows
 * (soft contact + SE-offset drop via drawShadow height), town torch/point
 * lights (lamps/braziers/houses/pickups/elite), night cycle capped so
 * silhouettes read with post OFF. Ground occlusion strengthened via
 * Y-sorted tall occluders (trees/pillars/lamps/buildings) + ySortKey tiebreak.
 */
import { C, PALETTE } from '../art/palette';
import { enemyAnim, enemyStride, playerAnim, playerLocomotion } from '../art/anim';
import { sampleWeaponTip, ySortKey } from '../art/rig';
import {
  drawEnemy, drawFlowers, drawGrassTuft, drawHouse, drawLamp, drawNPC,
  drawPickup, drawPlayer, drawProjectile, drawRock, drawRuin, drawTree,
  type Facing,
} from '../art/sprites';
import { TEMPO, TILE, WORLD_W, WORLD_H, ZONE_NAMES } from '../sim/config';
import { facingAngle } from '../sim/combat';
import { T_FLOWER, T_GRASS, T_PLAZA, T_ROAD, T_RUIN, T_SAND, T_TREE, T_WALL, T_WATER } from '../sim/world';
import type { Sim } from '../sim/game';
import type { SimEvent } from '../sim/types';
import { OverlaySprites } from './overlaySprites';
import { VfxSystem } from './vfx';

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

/** Palette indices treated as emissive (additive + hot core for bloom). */
const EMISSIVE = new Set([3, 4, 7, 9, 10, 11, 15]);

export class WorldRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  overlay = new OverlaySprites();
  vfx = new VfxSystem();
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
    this.shakeT = TEMPO.shakeDur;
  }

  addFlash(color: string): void {
    this.flashColor = color;
    this.flashT = TEMPO.flashDur;
  }

  /** Forward sim events to renderer-only VFX (never decides damage). */
  handleSimEvent(e: SimEvent, sim: Sim): void {
    this.vfx.onSimEvent(e, sim);
  }

  resetFx(): void {
    this.vfx.reset();
    this.anim.clear();
    this.shakeT = 0;
    this.shakePower = 0;
    this.flashT = 0;
  }

  private animFor(key: number | string, x: number, y: number, dt: number, rateMul = 1): AnimEntry {
    let e = this.anim.get(key);
    if (!e) {
      e = { phase: Math.random() * 6, lx: x, ly: y, moving: false };
      this.anim.set(key, e);
      return e;
    }
    const moved = Math.hypot(x - e.lx, y - e.ly);
    e.moving = moved > dt * 8;
    if (e.moving) e.phase += dt * TEMPO.walkPhaseRate * rateMul;
    else e.phase += dt * TEMPO.idlePhaseRate * rateMul;
    e.lx = x;
    e.ly = y;
    return e;
  }

  render(sim: Sim, t: number, dt: number): void {
    const { ctx } = this;
    const p = sim.player;
    const world = sim.world;
    const dark = sim.darkness();

    // renderer-only VFX polling (read-only on sim)
    this.vfx.update(sim, dt, t);

    // camera follow + clamp
    const vw = this.viewW / this.zoom;
    const vh = this.viewH / this.zoom;
    const tx = Math.max(vw / 2, Math.min(WORLD_W * TILE - vw / 2, p.x));
    const ty = Math.max(vh / 2, Math.min(WORLD_H * TILE - vh / 2, p.y - 10));
    const k = Math.min(1, dt * TEMPO.cameraFollow);
    this.camX += (tx - this.camX) * (this.camX === 0 ? 1 : k);
    this.camY += (ty - this.camY) * (this.camY === 0 ? 1 : k);

    // shake decay
    let shx = 0;
    let shy = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const m = this.shakePower * (this.shakeT / TEMPO.shakeDur);
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

    // y-sorted draw list: tall occluders (trees/pillars/lamps/buildings)
    // + npcs + enemies + player. Ground occlusion strengthened: tall
    // decor participates in Y-sort (behind/in-front correctly), sorted by
    // ySortKey (feet Y + X tiebreak) so overlaps never flicker.
    interface Item {
      x: number;
      y: number;
      draw: () => void;
    }
    const items: Item[] = [];
    for (const b of world.buildings) {
      const bx = (b.tx + b.tw / 2) * TILE;
      const by = (b.ty + b.th) * TILE;
      if (!this.onScreen(bx, by, 120)) continue;
      items.push({
        x: bx, y: by,
        draw: () => {
          drawHouse(ctx, b.tx * TILE, b.ty * TILE, b.tw, b.th, b.roof, b.wall, b.sign);
          this.drawLabel((b.tx + b.tw / 2) * TILE, b.ty * TILE - 8, b.label, C.SAND);
        },
      });
    }
    // tall trees as Y-sorted occluders (canopy hides entities behind)
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (sim.world.tileAt(tx, ty) !== T_TREE) continue;
        const dx = tx * TILE + 8;
        const dy = ty * TILE + 15;
        if (!this.onScreen(dx, dy, 30)) continue;
        const variant = Math.floor(hash2(tx, ty) * 99);
        items.push({
          x: dx, y: dy,
          draw: () => drawTree(ctx, dx, dy, variant),
        });
      }
    }
    // tall decor (pillars/lamps) as Y-sorted occluders
    for (const d of sim.world.decor) {
      if (d.kind !== 'pillar' && d.kind !== 'lamp') continue;
      if (!this.onScreen(d.x, d.y, 40)) continue;
      const dx = d.x;
      const dy = d.y;
      const variant = d.variant;
      const kind = d.kind;
      items.push({
        x: dx, y: dy,
        draw: () => {
          if (kind === 'pillar') drawRuin(ctx, dx, dy, variant);
          else drawLamp(ctx, dx, dy, t);
        },
      });
    }
    for (const n of sim.npcs) {
      if (!this.onScreen(n.x, n.y, 60)) continue;
      const a = this.animFor(`n${n.id}`, n.x, n.y, dt);
      items.push({
        x: n.x, y: n.y,
        draw: () => {
          drawNPC(ctx, n.kind, {
            x: n.x, y: n.y, facing: n.facing as Facing, phase: a.phase,
            moving: false, swing: -1, flash: false, scale: 1, dim: dark,
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
      const stride = enemyStride(e.kind, e.elite);
      const a = this.animFor(e.uid, e.x, e.y, dt, stride.rateMul);
      const moving = a.moving || e.ai === 'chase' || e.ai === 'return';
      this.vfx.noteStride(e.uid, a.phase, moving && !e.dead, e.x, e.y, e.elite ? 1.7 : 1);
      const pose = enemyAnim(e, moving);
      items.push({
        x: e.x, y: e.y,
        draw: () => {
          ctx.save();
          if (e.dead) {
            const fade = e.elite ? TEMPO.enemyDeadFadeElite : TEMPO.enemyDeadFade;
            ctx.globalAlpha = Math.max(0, 1 - e.deadT / fade);
          }
          this.overlay.drawEnemy(ctx, e.kind, e.x, e.y, e.elite ? 1.7 : 1, a.phase, moving);
          drawEnemy(ctx, e.kind, {
            x: e.x, y: e.y, facing: e.facing as Facing, phase: a.phase,
            moving, swing: e.swingT,
            flash: e.hurtCd > 0, scale: e.elite ? 1.7 : 1, dim: dark,
            anim: pose.state, stateT: pose.t, hurtK: pose.hurtK,
            windupK: pose.windupK, recoverK: pose.recoverK,
            deadT: e.deadT, leanX: pose.leanX, leanY: pose.leanY,
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
    // player: always drawn (death pose persists behind the over-screen; no blink)
    {
      const a = this.animFor('player', p.x, p.y, dt);
      this.vfx.noteStride('player', a.phase, a.moving && p.alive, p.x, p.y, 1);
      const dashing = sim.dashT > 0;
      const pose = playerLocomotion(playerAnim(p, dashing), a.moving);
      // fresh hits flash solid, then slow-blink through remaining i-frames
      const freshHit = p.hurtCd > 0 && p.hurtCd <= TEMPO.playerHurtCd && p.hurtCd > TEMPO.playerHurtCd - 0.28;
      const flash = p.alive && (freshHit || (p.hurtCd > 0 && Math.floor(t * 10) % 2 === 0));
      const dashK = dashing ? Math.min(1, sim.dashT / TEMPO.dashDur) : 0;
      items.push({
        x: p.x, y: p.y,
        draw: () => {
          ctx.save();
          if (!p.alive) ctx.globalAlpha = Math.max(0.55, 1 - (p.deadT / TEMPO.playerDeadFade) * 0.45);
          this.overlay.drawPlayer(ctx, p.x, p.y, 1, p.job, a.phase, a.moving);
          drawPlayer(ctx, {
            x: p.x, y: p.y, facing: p.facing as Facing, phase: a.phase,
            moving: a.moving, swing: p.swingT,
            flash, scale: 1, dim: dark,
            anim: pose.state, stateT: pose.t, cast: p.castT, potion: p.potionT,
            talkK: pose.talkK, deadT: p.deadT, hurtK: pose.hurtK,
            leanX: pose.leanX, leanY: pose.leanY, dashK,
          }, p.job);
          if (p.shieldT > 0 && p.alive) {
            ctx.strokeStyle = C.MIST;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y - 9, 14 + Math.sin(t * 8), 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();
        },
      });
    }
    items.sort((m, n) => ySortKey(m.x, m.y) - ySortKey(n.x, n.y));
    for (const it of items) it.draw();

    // projectiles
    for (const pr of sim.projectiles) {
      if (!this.onScreen(pr.x, pr.y, 30)) continue;
      drawProjectile(ctx, pr.friendly, pr.holy, pr.x, pr.y, t);
    }

    // sim particles: emissive ones drawn additive with hot cores for bloom
    this.drawSimParticles(sim);

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

    // renderer dust under lighting (darkens at night)
    this.vfx.drawUnder(ctx);

    this.drawLighting(sim, t, dark);

    // emissive renderer VFX over lighting (additive, feeds bloom)
    // Re-apply world transform: drawLighting resets to identity.
    ctx.setTransform(
      z, 0, 0, z,
      this.canvas.width / 2 - (this.camX + shx) * z,
      this.canvas.height / 2 - (this.camY + shy) * z,
    );
    this.vfx.drawOver(ctx, sim);

    // damage/event flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      const a = Math.max(0, this.flashT / TEMPO.flashDur) * 0.35;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = this.flashColor === 'gold' ? `rgba(242,193,78,${a})` : `rgba(225,78,43,${a})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  private drawSimParticles(sim: Sim): void {
    const { ctx } = this;
    // pass 1: non-emissive normal
    for (const pt of sim.particles) {
      if (EMISSIVE.has(pt.color)) continue;
      if (!this.onScreen(pt.x, pt.y, 20)) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, pt.ttl / pt.ttlMax));
      ctx.fillStyle = PALETTE[pt.color] ?? C.BONE;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
    // pass 2: emissive additive + hot bone core so bloom catches skill FX
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const pt of sim.particles) {
      if (!EMISSIVE.has(pt.color)) continue;
      if (!this.onScreen(pt.x, pt.y, 20)) continue;
      const a = Math.max(0, Math.min(1, pt.ttl / pt.ttlMax));
      const col = PALETTE[pt.color] ?? C.BONE;
      ctx.globalAlpha = a * 0.45;
      ctx.fillStyle = col;
      const halo = pt.size + 4;
      ctx.fillRect(pt.x - halo / 2, pt.y - halo / 2, halo, halo);
      ctx.globalAlpha = a;
      ctx.fillStyle = col;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
      if (a > 0.4) {
        ctx.globalAlpha = a * 0.9;
        ctx.fillStyle = C.BONE;
        ctx.fillRect(pt.x - 0.75, pt.y - 0.75, 1.5, 1.5);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
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
            // NW key: faint top-left lift on grass
            ctx.fillStyle = 'rgba(201,216,232,0.05)';
            ctx.fillRect(px, py, TILE, 1);
            ctx.fillRect(px, py, 1, TILE);
            if (tile === T_FLOWER) drawFlowers(ctx, px + 8, py + 10, Math.floor(h * 99));
            break;
          }
          case T_TREE: {
            // ground only here; canopy drawn as Y-sorted occluder in items
            ctx.fillStyle = C.PINE;
            ctx.fillRect(px, py, TILE, TILE);
            ctx.fillStyle = 'rgba(201,216,232,0.05)';
            ctx.fillRect(px, py, TILE, 1);
            ctx.fillRect(px, py, 1, TILE);
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
            // NW key edges
            ctx.fillStyle = 'rgba(244,241,228,0.10)';
            ctx.fillRect(px, py, TILE, 1);
            ctx.fillRect(px, py, 1, TILE);
            ctx.fillStyle = 'rgba(16,24,40,0.14)';
            ctx.fillRect(px, py + TILE - 1, TILE, 1);
            ctx.fillRect(px + TILE - 1, py, 1, TILE);
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
            // NW key highlight
            ctx.fillStyle = 'rgba(201,216,232,0.12)';
            ctx.fillRect(px, py, TILE, 1);
            ctx.fillRect(px, py, 1, TILE);
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
            // NW key: bright top-left, dark bottom-right
            ctx.fillStyle = 'rgba(244,241,228,0.14)';
            ctx.fillRect(px, py, TILE, 1);
            ctx.fillRect(px, py, 1, 10);
            ctx.fillStyle = 'rgba(16,24,40,0.22)';
            ctx.fillRect(px, py + TILE - 2, TILE, 2);
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
            ctx.fillStyle = 'rgba(201,216,232,0.06)';
            ctx.fillRect(px, py, TILE, 1);
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
            ctx.fillStyle = 'rgba(244,241,228,0.08)';
            ctx.fillRect(px, py, TILE, 1);
            ctx.fillRect(px, py, 1, TILE);
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
    void t;
    const { ctx } = this;
    // ground-level only (always below entities); tall pillar/lamp are
    // Y-sorted occluders in items for correct ground occlusion.
    for (const d of sim.world.decor) {
      if (!this.onScreen(d.x, d.y, 40)) continue;
      if (d.kind === 'tuft') drawGrassTuft(ctx, d.x, d.y, d.variant);
      else if (d.kind === 'flowers') drawFlowers(ctx, d.x, d.y, d.variant);
      else if (d.kind === 'rock') drawRock(ctx, d.x, d.y, d.variant);
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

  private drawLighting(sim: Sim, t: number, dark: number): void {
    // Capped darkness so night silhouettes still read with post OFF (max 0.60).
    const baseAlpha = 0.1 + dark * 0.5;
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
    hole(p.x, p.y - 8, 130 + (1 - dark) * 70, 0.95);
    // weapon-tip light while swinging (IK tip, true 8-way, emissive for bloom)
    if (p.swingT >= 0 && p.alive) {
      try {
        const tip = sampleWeaponTip(p.x, p.y, p.facing, p.swingT, 1, p.job);
        hole(tip.x, tip.y, 58, 0.7);
      } catch {
        const fa = facingAngle(p.facing);
        hole(p.x + Math.cos(fa) * 18, p.y - 8 + Math.sin(fa) * 18, 58, 0.7);
      }
    }
    if (p.shieldT > 0) hole(p.x, p.y - 8, 90, 0.6);
    for (const l of sim.world.lamps) {
      const flick = 0.82 + Math.sin(t * 9 + l.x * 0.3) * 0.08 + Math.sin(t * 23 + l.y * 0.7) * 0.04;
      hole(l.x, l.y - 18, 100, flick);
    }
    for (const pr of sim.projectiles) hole(pr.x, pr.y, 65, 0.85);
    // town braziers + house door glow (point lights)
    hole(47.5 * TILE, 54 * TILE, 135, 0.55);
    for (const b of sim.world.buildings) {
      const bx = (b.tx + b.tw / 2) * TILE;
      const by = (b.ty + b.th) * TILE - 14;
      if (!this.onScreen(bx, by, 90)) continue;
      hole(bx, by, 72, 0.5 + Math.sin(t * 7 + bx * 0.2) * 0.05);
    }
    // pickups glint
    for (const k of sim.pickups) {
      if (!this.onScreen(k.x, k.y, 40)) continue;
      const pulse = 0.55 + Math.sin(t * 5 + k.x * 0.5) * 0.1;
      hole(k.x, k.y - 4, k.kind === 'potion' ? 30 : 40, pulse);
    }
    // elite + slime emissive lights
    for (const e of sim.enemies) {
      if (e.dead || !this.onScreen(e.x, e.y, 90)) continue;
      if (e.elite) hole(e.x, e.y - 12, 88, 0.7);
      else if (e.kind === 'slime') hole(e.x, e.y - 6, 30, 0.32);
      else if (e.kind === 'shade') hole(e.x, e.y - 8, 44, 0.45);
    }

    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.light, 0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;

    // warm/cool additive accents around lights (ember feel + magic)
    ctx.globalCompositeOperation = 'lighter';
    const glow = (x: number, y: number, r: number, a: number, rgb: string) => {
      const z = this.zoom * this.dpr;
      const sx = this.canvas.width / 2 + (x - this.camX) * z;
      const sy = this.canvas.height / 2 + (y - this.camY) * z;
      const sr = r * z;
      if (sx < -sr || sx > this.canvas.width + sr || sy < -sr || sy > this.canvas.height + sr) return;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    };
    const glowA = 0.06 + dark * 0.12;
    for (const l of sim.world.lamps) glow(l.x, l.y - 18, 62, glowA, '232,147,60');
    glow(p.x, p.y - 8, 48, 0.05, '232,147,60');
    glow(47.5 * TILE, 54 * TILE, 92, 0.08 + dark * 0.08, '232,147,60');
    for (const b of sim.world.buildings) {
      const bx = (b.tx + b.tw / 2) * TILE;
      const by = (b.ty + b.th) * TILE - 14;
      glow(bx, by, 46, 0.05 + dark * 0.06, '242,193,78');
    }
    for (const pr of sim.projectiles) {
      if (pr.friendly || pr.holy) glow(pr.x, pr.y, 32, 0.14, pr.holy ? '242,193,78' : '232,147,60');
      else glow(pr.x, pr.y, 30, 0.12, '125,155,191');
    }
    for (const k of sim.pickups) {
      if (k.kind === 'potion') continue;
      glow(k.x, k.y - 4, 24, 0.08 + dark * 0.06, '242,193,78');
    }
    for (const e of sim.enemies) {
      if (e.dead) continue;
      if (e.elite) glow(e.x, e.y - 12, 60, 0.1 + dark * 0.08, '225,78,43');
      else if (e.kind === 'slime') glow(e.x, e.y - 6, 22, 0.05 + dark * 0.04, '143,192,122');
      else if (e.kind === 'shade') glow(e.x, e.y - 8, 34, 0.07 + dark * 0.05, '125,155,191');
    }
    // NW key light: warm lift from top-left, cool shade to bottom-right
    const wpx = this.canvas.width;
    const hpx = this.canvas.height;
    const lift = ctx.createLinearGradient(0, 0, wpx, hpx);
    lift.addColorStop(0, `rgba(244,241,228,${(0.055 * (1 - dark * 0.45)).toFixed(3)})`);
    lift.addColorStop(0.5, 'rgba(244,241,228,0)');
    lift.addColorStop(1, 'rgba(244,241,228,0)');
    ctx.fillStyle = lift;
    ctx.fillRect(0, 0, wpx, hpx);
    ctx.globalCompositeOperation = 'source-over';
    const shade = ctx.createLinearGradient(0, 0, wpx, hpx);
    shade.addColorStop(0, 'rgba(16,24,40,0)');
    shade.addColorStop(0.55, 'rgba(16,24,40,0)');
    shade.addColorStop(1, 'rgba(16,24,40,0.10)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, wpx, hpx);
    // faint cool grade so night reads even with post OFF (very subtle when post ON)
    if (dark > 0.01) {
      ctx.fillStyle = `rgba(58,74,107,${(dark * 0.06).toFixed(3)})`;
      ctx.fillRect(0, 0, wpx, hpx);
    }
  }
}
