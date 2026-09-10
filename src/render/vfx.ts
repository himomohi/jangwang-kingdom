/** Renderer-only VFX: hit sparks, slash trails, foot dust, level-up flash.
 * Driven by sim state/events; never decides damage, never writes sim.
 * Dust is drawn under lighting; emissive FX (sparks/trails/rings/flashes)
 * is drawn over lighting with additive blending so bloom can catch it.
 */
import { C } from '../art/palette';
import { castFocus, strideFootfall, weaponTip } from '../art/anim';
import { sampleWeaponTip } from '../art/rig';
import { TEMPO } from '../sim/config';
import type { Sim } from '../sim/game';
import type { SimEvent } from '../sim/types';

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

function trailColorFor(kind: string): string {
  if (kind === 'player' || kind === 'knight') return C.FROST;
  if (kind === 'blader') return C.GOLD;
  if (kind === 'arcanist') return C.MIST;
  if (kind === 'shrine') return C.GOLD;
  if (kind === 'watcher') return C.FLAME;
  if (kind === 'bandit') return C.EMBER;
  if (kind === 'wolf') return C.MIST;
  if (kind === 'shade') return C.FROST;
  if (kind === 'slime') return C.LEAF;
  return C.BONE;
}

const DEATH_COLORS: Record<string, string[]> = {
  slime: [C.LEAF, C.MOSS, C.FROST],
  wolf: [C.SLATE, C.MIST, C.BLOOD],
  bandit: [C.BLOOD, C.EMBER, C.SKIN],
  shade: [C.DUSK, C.MIST, C.FROST],
  watcher: [C.FLAME, C.GOLD, C.BONE],
};

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
  private prevEnemyDead = new Map<number, boolean>();
  private prevEnemyAi = new Map<number, string>();
  private prevPlayerHp = -1;
  private prevCastT = -1;
  private prevPotionT = -1;
  private prevSin = new Map<string | number, number>();
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
    this.prevEnemyDead.clear();
    this.prevEnemyAi.clear();
    this.prevPlayerHp = -1;
    this.prevCastT = -1;
    this.prevPotionT = -1;
    this.prevSin.clear();
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
    this.spawnHitDir(x, y, crit, red, 0, 0);
  }

  /** Directional hit sparks: biased along the knockback vector for clear feedback. */
  spawnHitDir(x: number, y: number, crit: boolean, red: boolean, dx: number, dy: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const n = crit ? 12 : 6;
    const mag = Math.hypot(dx, dy);
    const nx = mag > 1 ? dx / mag : 0;
    const ny = mag > 1 ? dy / mag : 0;
    for (let i = 0; i < n; i++) {
      if (this.sparks.length > 300) this.sparks.shift();
      const a = Math.random() * Math.PI * 2;
      const sp = (crit ? 120 : 80) + Math.random() * (crit ? 160 : 120);
      const ttl = 0.2 + Math.random() * 0.25;
      let color: string = C.BONE;
      if (red) color = i % 3 === 0 ? C.BONE : i % 3 === 1 ? C.FLAME : C.BLOOD;
      else if (crit) color = i % 3 === 0 ? C.GOLD : i % 3 === 1 ? C.BONE : C.FLAME;
      else color = i % 3 === 0 ? C.BONE : i % 3 === 1 ? C.FROST : C.EMBER;
      // bias half the sparks along the knock direction
      const bias = i % 2 === 0 ? 90 : 0;
      this.sparks.push({
        x, y,
        vx: Math.cos(a) * sp + nx * bias, vy: Math.sin(a) * sp - 40 + ny * bias,
        ttl, ttlMax: ttl, color, size: 1 + Math.floor(Math.random() * 3),
      });
    }
  }

  /** Kind-specific death burst: short but clear ragdoll-pop accompaniment. */
  spawnDeathBurst(x: number, y: number, kind: string, elite: boolean): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const cols = DEATH_COLORS[kind] ?? [C.BONE, C.SAND, C.MIST];
    const n = elite ? 22 : 10;
    for (let i = 0; i < n; i++) {
      if (this.sparks.length > 300) this.sparks.shift();
      const a = -Math.PI * (0.15 + Math.random() * 0.7); // upward fan
      const sp = (elite ? 90 : 60) + Math.random() * (elite ? 180 : 120);
      const ttl = 0.3 + Math.random() * (elite ? 0.5 : 0.3);
      this.sparks.push({
        x: x + (Math.random() - 0.5) * (elite ? 20 : 10),
        y: y - 4,
        vx: Math.cos(a) * sp * (0.6 + Math.random() * 0.8),
        vy: Math.sin(a) * sp,
        ttl, ttlMax: ttl,
        color: cols[i % cols.length],
        size: 2 + Math.floor(Math.random() * (elite ? 3 : 2)),
      });
    }
    if (elite) this.spawnRing(x, y - 8, 10, 170, 0.55, C.FLAME, 3);
    else this.spawnRing(x, y - 4, 6, 90, 0.3, cols[0], 2);
  }

  /**
   * Stride-synced footfall dust. The renderer calls this every frame with the
   * same walk-cycle phase driving the legs, so puffs land exactly on footfalls.
   */
  noteStride(key: string | number, phase: number, moving: boolean, x: number, y: number, sizeMul = 1): void {
    if (!Number.isFinite(phase) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const cur = Math.sin(phase);
    const prev = this.prevSin.get(key);
    this.prevSin.set(key, cur);
    if (prev === undefined) return;
    if (strideFootfall(prev, cur, moving)) {
      if (this.dust.length > 200) this.dust.shift();
      const ttl = 0.4 + Math.random() * 0.25;
      this.dust.push({
        x: x + (Math.random() - 0.5) * 6,
        y: y - 1 + (Math.random() - 0.5) * 2,
        vx: (Math.random() - 0.5) * 30,
        vy: -8 - Math.random() * 18,
        ttl, ttlMax: ttl,
        size: Math.max(2, Math.round((2 + Math.random()) * sizeMul)),
        color: Math.random() < 0.6 ? C.SAND : C.MIST,
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
        this.spawnHitDir(e.x, e.y - 10 * (e.elite ? 1.5 : 1), crit, false, e.kx, e.ky);
        this.prevEnemyHp.set(e.uid, e.hp);
      } else if (e.hp !== prev) {
        this.prevEnemyHp.set(e.uid, e.hp);
      }
      // death edge -> kind-specific burst (short but clear)
      const wasDead = this.prevEnemyDead.get(e.uid) ?? false;
      if (e.dead && !wasDead) {
        this.spawnDeathBurst(e.x, e.y, e.kind, e.elite);
      }
      this.prevEnemyDead.set(e.uid, e.dead);
      // windup edge -> telegraph tick (elite also gets a warning ring)
      const prevAi = this.prevEnemyAi.get(e.uid);
      if (e.ai === 'windup' && prevAi !== 'windup' && !e.dead) {
        const cols = DEATH_COLORS[e.kind] ?? [C.BONE];
        for (let i = 0; i < 4; i++) {
          if (this.sparks.length > 300) this.sparks.shift();
          const ttl = 0.25;
          this.sparks.push({
            x: e.x + (Math.random() - 0.5) * 14, y: e.y - 14,
            vx: 0, vy: -60,
            ttl, ttlMax: ttl, color: i % 2 === 0 ? cols[0] : C.BONE, size: 2,
          });
        }
        if (e.elite) this.spawnRing(e.x, e.y - 8, 14, 60, 0.4, C.FLAME, 2);
      }
      this.prevEnemyAi.set(e.uid, e.ai);
    }
    if (this.prevEnemyHp.size > 120) {
      const alive = new Set(sim.enemies.map((e) => e.uid));
      for (const k of [...this.prevEnemyHp.keys()]) {
        if (!alive.has(k)) this.prevEnemyHp.delete(k);
      }
      for (const k of [...this.prevEnemyDead.keys()]) {
        if (!alive.has(k)) this.prevEnemyDead.delete(k);
      }
      for (const k of [...this.prevEnemyAi.keys()]) {
        if (!alive.has(k)) this.prevEnemyAi.delete(k);
      }
      for (const k of [...this.prevSin.keys()]) {
        if (typeof k === 'number' && !alive.has(k)) this.prevSin.delete(k);
      }
    }
    const p = sim.player;
    if (this.prevPlayerHp < 0) {
      this.prevPlayerHp = p.hp;
    } else if (p.hp < this.prevPlayerHp) {
      this.spawnHitDir(p.x, p.y - 10, false, true, p.kx, p.ky);
      this.prevPlayerHp = p.hp;
    } else if (p.hp !== this.prevPlayerHp) {
      this.prevPlayerHp = p.hp;
    }

    // skill-cast apex burst at the cast focus (staff gem / holy center)
    if (this.prevCastT < 0.5 && p.castT >= 0.5 && p.alive) {
      const f = castFocus(p.x, p.y, p.facing, 0.5, 1, p.job);
      const col = p.job === 'shrine' ? C.GOLD : p.job === 'arcanist' ? C.MIST : p.job === 'blader' ? C.FLAME : C.BONE;
      for (let i = 0; i < 8; i++) {
        if (this.sparks.length > 300) this.sparks.shift();
        const a = Math.random() * Math.PI * 2;
        const ttl = 0.3 + Math.random() * 0.2;
        this.sparks.push({
          x: f.x, y: f.y,
          vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 30,
          ttl, ttlMax: ttl, color: i % 2 === 0 ? col : C.BONE, size: 2,
        });
      }
      if (p.job === 'shrine' || p.job === 'arcanist') this.spawnRing(f.x, f.y, 6, 110, 0.35, col, 2);
    }
    this.prevCastT = p.castT;
    // potion finish sparkle (rising motes as the drink ends)
    if (this.prevPotionT < 0.72 && p.potionT >= 0.72 && p.alive) {
      for (let i = 0; i < 6; i++) {
        if (this.sparks.length > 300) this.sparks.shift();
        const ttl = 0.4 + Math.random() * 0.3;
        this.sparks.push({
          x: p.x + (Math.random() - 0.5) * 14, y: p.y - 12,
          vx: (Math.random() - 0.5) * 20, vy: -50 - Math.random() * 40,
          ttl, ttlMax: ttl, color: i % 2 === 0 ? C.LEAF : C.BONE, size: 2,
        });
      }
    }
    this.prevPotionT = p.potionT;

    // slash trails from IK shoulder→elbow→wrist tip samples (true 8-way).
    // Primary: rig IK chain (matches drawn blade tip exactly); fallback: anim arc.
    if (p.alive && p.swingT >= 0) {
      let tip: { x: number; y: number };
      try {
        tip = sampleWeaponTip(p.x, p.y, p.facing, p.swingT, 1, p.job);
      } catch {
        tip = weaponTip(p.x, p.y, p.facing, p.swingT, 1, p.job);
      }
      this.pushTrail('player', tip.x, tip.y, p.job);
    }
    // cast trails: blader spin + gem streaks
    if (p.alive && p.castT >= 0) {
      const f = castFocus(p.x, p.y, p.facing, p.castT, 1, p.job);
      this.pushTrail('player-cast', f.x, f.y, p.job);
    }
    for (const e of sim.enemies) {
      if (e.dead || e.swingT < 0) continue;
      let tip: { x: number; y: number };
      try {
        tip = sampleWeaponTip(e.x, e.y, e.facing, e.swingT, e.elite ? 1.7 : 1, e.kind);
      } catch {
        tip = weaponTip(e.x, e.y, e.facing, e.swingT, e.elite ? 1.7 : 1, e.kind);
      }
      this.pushTrail(e.uid, tip.x, tip.y, e.kind);
    }
    // dash afterimages: sample center while dashing
    if (sim.dashT > 0 && p.alive) {
      this.pushTrail('player', p.x, p.y - 8, p.job);
    }

    // speed dust only for fast bursts (dash); normal footfalls come from
    // renderer noteStride() synced to the walk cycle.
    this.trackDust('player', p.x, p.y, dt, p.alive && sim.dashT > 0, 140);
    for (const e of sim.enemies) {
      if (!e.dead) continue;
      this.lastPos.delete(e.uid);
      this.dustCd.delete(e.uid);
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
    arr.push({ x, y, ttl: TEMPO.trailTtl, width: 3 });
    if (arr.length > 24) arr.splice(0, arr.length - 24);
  }

  private trackDust(key: string | number, x: number, y: number, dt: number, active: boolean, minSpeed = 45): void {
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
    if (!Number.isFinite(speed) || speed < minSpeed) {
      this.dustCd.set(key, 0);
      return;
    }
    const cd = (this.dustCd.get(key) ?? 0) - dt;
    if (cd <= 0) {
      this.spawnDust(x, y);
      this.dustCd.set(key, TEMPO.footDustCd);
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
          const alpha = Math.max(0, Math.min(1, Math.min(a.ttl, b.ttl) / TEMPO.trailTtl));
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
        const ta = Math.max(0, Math.min(1, tip.ttl / TEMPO.trailTtl));
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
