/** Renderer-only VFX: hit sparks, slash trails, foot dust, level-up flash.
 * Driven by sim state/events; never decides damage, never writes sim.
 * Dust is drawn under lighting; emissive FX (sparks/trails/rings/flashes)
 * is drawn over lighting with additive blending so bloom can catch it.
 */
import { C } from '../art/palette';
import { facingAngle } from '../sim/combat';
import type { Sim } from '../sim/game';
import type { Facing, SimEvent } from '../sim/types';

interface Spark {
  x: number; y: number; vx: number; vy: number;
  ttl: number; ttlMax: number; color: string; size: number;
}

interface Dust {
  x: number; y: number; vx: number; vy: number;
  ttl: number; ttlMax: number; size: number; color: string;
}

interface TrailPoint {
  x: number; y: number; ttl: number; width: number;
}

interface Ring {
  x: number; y: number; r: number; vr: number;
  ttl: number; ttlMax: number; color: string; width: number;
}

function weaponTip(x: number, y: number, facing: Facing, swingT: number, scale: number): { x: number; y: number } {
  const cx = x;
  const cy = y - 9 * scale;
  const base = facingAngle(facing);
  const sweep = (Math.max(0, Math.min(1, swingT)) - 0.5) * 2.4;
  const a = base + sweep;
  const r = 15 * scale;
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.9 };
}

function trailColorFor(kind: string): string {
  if (kind === 'player') return C.FROST;
  if (kind === 'watcher') return C.FLAME;
  if (kind === 'bandit') return C.EMBER;
  if (kind === 'wolf') return C.MIST;
  if (kind === 'shade') return C.FROST;
  return C.BONE;
}

export class VfxSystem {
  private sparks: Spark[] = [];
  private dust: Dust[] = [];
  private trails = new Map<string | number, TrailPoint[]>();
  private trailColors = new Map<string | number, string>();
  private rings: Ring[] = [];
  private levelFlashT = 0;
  private levelFlashMax = 0.6;
  private levelFlashX = 0;
  private levelFlashY = 0;
  private levelFlashColor: string = C.GOLD;
  private prevEnemyHp = new Map<number, number>();
  private prevPlayerHp = -1;
  private lastPos = new Map<string | number, { x: number; y: number }>();
  private dustCd = new Map<string | number, number>();

  reset(): void {
    this.sparks.length = 0;
    this.dust.length = 0;
    this.trails.clear();
    this.trailColors.clear();
    this.rings.length = 0;
    this.levelFlashT = 0;
    this.prevEnemyHp.clear();
    this.prevPlayerHp = -1;
    this.lastPos.clear();
    this.dustCd.clear();
  }

  /** Consume sim events for one-shot FX (levelup/job/flash/died). Positions from sim. */
  onSimEvent(e: SimEvent, sim: Sim): void {
    const p = sim.player;
    if (e.t === 'levelup' || e.t === 'job') {
      this.spawnLevelUp(p.x, p.y, C.GOLD);
    } else if (e.t === 'flash' && e.color === 'gold') {
      this.spawnRing(p.x, p.y - 8, 10, 130, 0.45, C.GOLD, 3);
    } else if (e.t === 'died') {
      this.spawnLevelUp(p.x, p.y, C.FLAME);
      this.spawnHit(p.x, p.y - 8, false, true);
    }
  }

  spawnHit(x: number, y: number, crit: boolean, red = false): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const n = crit ? 12 : 6;
    for (let i = 0; i < n; i++) {
      if (this.sparks.length > 300) this.sparks.shift();
      const a = Math.random() * Math.PI * 2;
      const sp = (crit ? 120 : 80) + Math.random() * (crit ? 160 : 120);
      const ttl = 0.2 + Math.random() * 0.25;
      let color: string = C.BONE;
      if (red) color = i % 3 === 0 ? C.BONE : i % 3 === 1 ? C.FLAME : C.BLOOD;
      else if (crit) color = i % 3 === 0 ? C.GOLD : i % 3 === 1 ? C.BONE : C.FLAME;
      else color = i % 3 === 0 ? C.BONE : i % 3 === 1 ? C.FROST : C.EMBER;
      this.sparks.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        ttl, ttlMax: ttl, color, size: 1 + Math.floor(Math.random() * 3),
      });
    }
  }

  spawnDust(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (this.dust.length > 200) this.dust.shift();
    const ttl = 0.4 + Math.random() * 0.25;
    this.dust.push({
      x: x + (Math.random() - 0.5) * 6,
      y: y - 1 + (Math.random() - 0.5) * 2,
      vx: (Math.random() - 0.5) * 30,
      vy: -8 - Math.random() * 18,
      ttl, ttlMax: ttl,
      size: 2 + Math.floor(Math.random() * 2),
      color: Math.random() < 0.6 ? C.SAND : C.MIST,
    });
  }

  spawnRing(x: number, y: number, r0: number, vr: number, ttl: number, color: string, width: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(r0) || !Number.isFinite(vr)) return;
    if (this.rings.length > 24) this.rings.shift();
    this.rings.push({ x, y, r: r0, vr, ttl, ttlMax: ttl, color, width });
  }

  spawnLevelUp(x: number, y: number, color: string): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.levelFlashT = this.levelFlashMax;
    this.levelFlashX = x;
    this.levelFlashY = y;
    this.levelFlashColor = color;
    this.spawnRing(x, y - 8, 8, 150, 0.5, color, 3);
    this.spawnRing(x, y - 8, 4, 100, 0.4, C.BONE, 2);
    for (let i = 0; i < 14; i++) {
      if (this.sparks.length > 300) this.sparks.shift();
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
      const sp = 60 + Math.random() * 140;
      const ttl = 0.4 + Math.random() * 0.35;
      this.sparks.push({
        x: x + (Math.random() - 0.5) * 16, y: y - 4,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        ttl, ttlMax: ttl,
        color: i % 2 === 0 ? color : C.BONE,
        size: 2,
      });
    }
  }

  /** Poll sim state for hits/swings/movement; advance all particles. Read-only on sim. */
  update(sim: Sim, dt: number, _t: number): void {
    void _t;
    // advance sparks
    for (const s of this.sparks) {
      s.ttl -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 320 * dt;
      s.vx *= 1 - dt * 2;
    }
    this.sparks = this.sparks.filter((s) => s.ttl > 0);
    // advance dust
    for (const d of this.dust) {
      d.ttl -= dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vy += 30 * dt;
      d.vx *= 1 - dt * 1.5;
    }
    this.dust = this.dust.filter((d) => d.ttl > 0);
    // advance trails
    for (const [k, arr] of this.trails) {
      for (const pt of arr) pt.ttl -= dt;
      const kept = arr.filter((pt) => pt.ttl > 0);
      if (kept.length === 0) {
        this.trails.delete(k);
        this.trailColors.delete(k);
      } else {
        this.trails.set(k, kept);
      }
    }
    // advance rings + flash
    for (const r of this.rings) {
      r.ttl -= dt;
      r.r += r.vr * dt;
    }
    this.rings = this.rings.filter((r) => r.ttl > 0);
    if (this.levelFlashT > 0) this.levelFlashT = Math.max(0, this.levelFlashT - dt);

    // hit detection via hp drops (renderer-only, never damages)
    for (const e of sim.enemies) {
      const prev = this.prevEnemyHp.get(e.uid);
      if (prev === undefined) {
        this.prevEnemyHp.set(e.uid, e.hp);
      } else if (e.hp < prev) {
        const dmg = prev - e.hp;
        const crit = dmg > e.maxHp * 0.16;
        this.spawnHit(e.x, e.y - 10 * (e.elite ? 1.5 : 1), crit);
        this.prevEnemyHp.set(e.uid, e.hp);
      } else if (e.hp !== prev) {
        this.prevEnemyHp.set(e.uid, e.hp);
      }
    }
    if (this.prevEnemyHp.size > 120) {
      const alive = new Set(sim.enemies.map((e) => e.uid));
      for (const k of [...this.prevEnemyHp.keys()]) {
        if (!alive.has(k)) this.prevEnemyHp.delete(k);
      }
    }
    const p = sim.player;
    if (this.prevPlayerHp < 0) {
      this.prevPlayerHp = p.hp;
    } else if (p.hp < this.prevPlayerHp) {
      this.spawnHit(p.x, p.y - 10, false, true);
      this.prevPlayerHp = p.hp;
    } else if (p.hp !== this.prevPlayerHp) {
      this.prevPlayerHp = p.hp;
    }

    // slash trails from weapon tip samples while swinging
    if (p.alive && p.swingT >= 0) {
      const tip = weaponTip(p.x, p.y, p.facing, p.swingT, 1);
      this.pushTrail('player', tip.x, tip.y, 'player');
    }
    for (const e of sim.enemies) {
      if (e.dead || e.swingT < 0) continue;
      const tip = weaponTip(e.x, e.y, e.facing, e.swingT, e.elite ? 1.7 : 1);
      this.pushTrail(e.uid, tip.x, tip.y, e.kind);
    }
    // dash afterimages: sample center while dashing
    if (sim.dashT > 0 && p.alive) {
      this.pushTrail('player', p.x, p.y - 8, 'player');
    }

    // foot dust from movement speed
    this.trackDust('player', p.x, p.y, dt, p.alive);
    for (const e of sim.enemies) {
      if (e.dead) {
        this.lastPos.delete(e.uid);
        this.dustCd.delete(e.uid);
        continue;
      }
      this.trackDust(e.uid, e.x, e.y, dt, true);
    }
  }

  private pushTrail(key: string | number, x: number, y: number, kind: string): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    let arr = this.trails.get(key);
    if (!arr) {
      arr = [];
      this.trails.set(key, arr);
    }
    this.trailColors.set(key, trailColorFor(kind));
    arr.push({ x, y, ttl: 0.28, width: 3 });
    if (arr.length > 24) arr.splice(0, arr.length - 24);
  }

  private trackDust(key: string | number, x: number, y: number, dt: number, active: boolean): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(dt)) return;
    const last = this.lastPos.get(key);
    this.lastPos.set(key, { x, y });
    if (!active || !last) {
      this.dustCd.set(key, 0);
      return;
    }
    if (!Number.isFinite(last.x) || !Number.isFinite(last.y)) {
      this.dustCd.set(key, 0);
      return;
    }
    const speed = Math.hypot(x - last.x, y - last.y) / Math.max(0.001, dt);
    if (!Number.isFinite(speed) || speed < 45) {
      this.dustCd.set(key, 0);
      return;
    }
    const cd = (this.dustCd.get(key) ?? 0) - dt;
    if (cd <= 0) {
      this.spawnDust(x, y);
      this.dustCd.set(key, 0.14);
    } else {
      this.dustCd.set(key, cd);
    }
  }

  /** Non-emissive dust, drawn before lighting so night darkens it. */
  drawUnder(ctx: CanvasRenderingContext2D): void {
    if (this.dust.length === 0) return;
    ctx.save();
    for (const d of this.dust) {
      const a = Math.max(0, Math.min(1, d.ttl / d.ttlMax)) * 0.45;
      ctx.globalAlpha = a;
      ctx.fillStyle = d.color;
      ctx.fillRect(d.x - d.size / 2, d.y - d.size / 2, d.size, d.size);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** Emissive FX drawn after lighting with additive blending for bloom. */
  drawOver(ctx: CanvasRenderingContext2D, sim: Sim): void {
    // projectile tails (renderer-only, no sim writes)
    if (sim.projectiles.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (const pr of sim.projectiles) {
        const tx = pr.x - pr.vx * 0.035;
        const ty = pr.y - pr.vy * 0.035;
        const col = pr.holy ? C.GOLD : pr.friendly ? C.EMBER : C.MIST;
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = col;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(pr.x, pr.y);
        ctx.stroke();
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = C.BONE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo((tx + pr.x) / 2, (ty + pr.y) / 2);
        ctx.lineTo(pr.x, pr.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // slash trails
    if (this.trails.size > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const [key, arr] of this.trails) {
        if (arr.length < 2) continue;
        const col = this.trailColors.get(key) ?? C.BONE;
        for (let i = 1; i < arr.length; i++) {
          const a = arr[i - 1];
          const b = arr[i];
          const alpha = Math.max(0, Math.min(1, Math.min(a.ttl, b.ttl) / 0.28));
          if (alpha <= 0) continue;
          ctx.globalAlpha = alpha * 0.85;
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(0.5, b.width * alpha);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        // hot tip dot for bloom
        const tip = arr[arr.length - 1];
        const ta = Math.max(0, Math.min(1, tip.ttl / 0.28));
        if (ta > 0.3) {
          ctx.globalAlpha = ta;
          ctx.fillStyle = C.BONE;
          ctx.fillRect(tip.x - 1, tip.y - 1, 3, 3);
        }
      }
      ctx.restore();
    }

    // hit sparks
    if (this.sparks.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const s of this.sparks) {
        const a = Math.max(0, Math.min(1, s.ttl / s.ttlMax));
        ctx.globalAlpha = a;
        ctx.fillStyle = s.color;
        ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
        if (a > 0.5) {
          ctx.globalAlpha = a * 0.9;
          ctx.fillStyle = C.BONE;
          ctx.fillRect(s.x - 0.75, s.y - 0.75, 1.5, 1.5);
        }
      }
      ctx.restore();
    }

    // rings
    if (this.rings.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const r of this.rings) {
        const a = Math.max(0, Math.min(1, r.ttl / r.ttlMax));
        ctx.globalAlpha = a * 0.9;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = r.width;
        ctx.beginPath();
        ctx.arc(r.x, r.y, Math.max(1, r.r), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // level-up flash beam + halo
    if (this.levelFlashT > 0) {
      const k = this.levelFlashT / this.levelFlashMax;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const bx = this.levelFlashX;
      const by = this.levelFlashY;
      ctx.globalAlpha = k * 0.55;
      ctx.fillStyle = this.levelFlashColor;
      ctx.fillRect(bx - 6, by - 52, 12, 52);
      ctx.globalAlpha = k * 0.85;
      ctx.fillStyle = C.BONE;
      ctx.fillRect(bx - 2, by - 48, 4, 44);
      ctx.globalAlpha = k * 0.5;
      ctx.strokeStyle = C.BONE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx, by - 10, 14 + (1 - k) * 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
