import {
  ENEMIES, ITEMS, JOB_MODS, JOB_NAMES, JOB_SKILL, SHOP_STOCK,
  TEMPO, TILE, DAY_LENGTH, xpForLevel,
} from './config';
import { calcDamage, dist, facingAngle, facingFromVec, inArc, toCameraRelative } from './combat';
import { rollLoot } from './loot';
import { World, mulberry32 } from './world';
import type {
  EnemyKind, EnemyState, Facing, FloatText, JobId, NpcState, Particle,
  PickupState, PlayerState, ProjectileState, SimEvent, SimInput, Stats, ZoneId,
} from './types';

export interface DialogChoice {
  label: string;
  action: string;
  disabled?: boolean;
}

export interface DialogData {
  name: string;
  lines: string[];
  choices: DialogChoice[];
}

export interface InteractResult {
  kind: 'npc' | 'none';
  npc?: NpcState;
}

function baseStats(level: number): Stats {
  return {
    maxHp: 60 + (level - 1) * 9,
    maxMp: 30 + (level - 1) * 4,
    atk: 8 + (level - 1) * 2,
    def: 2 + Math.floor((level - 1) * 0.8),
    spd: TEMPO.playerBaseSpd,
    crit: 0.05,
  };
}

export class Sim {
  world = new World();
  player!: PlayerState;
  enemies: EnemyState[] = [];
  npcs: NpcState[] = [];
  pickups: PickupState[] = [];
  projectiles: ProjectileState[] = [];
  particles: Particle[] = [];
  texts: FloatText[] = [];
  events: SimEvent[] = [];
  time = 0.3; // 0..1 day cycle, start morning
  playTime = 0;
  zone: ZoneId = 'town';
  uid = 1;
  rngState = 123456789;
  rng: () => number = mulberry32(123456789);
  spawnT = 0;
  watcherT = 20; // first elite spawn delay
  watcherAlive = false;
  dashT = 0;
  dashDx = 0;
  dashDy = 0;
  dashHit = new Set<number>();
  dashDmg = 0;
  over = false;

  constructor() {
    this.newGame();
  }

  // ---------- lifecycle ----------

  newGame(): void {
    this.rngState = (Math.random() * 0xffffffff) >>> 0 || 1;
    this.rng = mulberry32(this.rngState);
    this.world = new World(20260910);
    this.enemies = [];
    this.pickups = [];
    this.projectiles = [];
    this.particles = [];
    this.texts = [];
    this.events = [];
    this.time = 0.28;
    this.playTime = 0;
    this.uid = 1;
    this.spawnT = 0;
    this.watcherT = 25;
    this.watcherAlive = false;
    this.over = false;
    this.dashT = 0;

    this.player = {
      x: 47.5 * TILE, y: 60 * TILE, facing: 1 as Facing,
      job: 'commoner', level: 1, xp: 0, xpNext: xpForLevel(1),
      hp: 60, mp: 30, gold: 20,
      stats: baseStats(1),
      inv: [], equip: { weapon: null, armor: null, charm: null },
      potions: 2,
      atkCd: 0, skillCd: 0, skillCdMax: 1, hurtCd: 0, swingT: -1,
      castT: -1, potionT: -1, talkT: 0, deadT: 0,
      shieldT: 0, kx: 0, ky: 0, alive: true, kills: 0,
    };
    this.recompute(false);

    this.npcs = [
      { id: 'guard', kind: 'guard', name: '경비대장 수아', x: 46 * TILE, y: 60.6 * TILE, facing: 0 },
      { id: 'jobmaster', kind: 'jobmaster', name: '전직관 헤론', x: 47.5 * TILE, y: 50.7 * TILE, facing: 0 },
      { id: 'merchant', kind: 'merchant', name: '상인 마르코', x: 41 * TILE, y: 56.7 * TILE, facing: 0 },
      { id: 'innkeeper', kind: 'innkeeper', name: '여관주인 미렐', x: 54 * TILE, y: 56.7 * TILE, facing: 0 },
    ];
    this.zone = this.world.zoneAtPx(this.player.x, this.player.y);

    // starting gear: rusty dagger equipped so early game feels fair
    this.player.inv.push({ id: 'w0', qty: 1 });
    this.equipItem('w0');

    // opening spawns so the field is alive immediately
    for (let i = 0; i < 14; i++) this.spawnAmbient(true);
    this.events.push({ t: 'toast', text: '엠버게이트에 오신 것을 환영합니다!' });
  }

  recompute(healToFull = false): void {
    const p = this.player;
    const base = baseStats(p.level);
    const mod = JOB_MODS[p.job];
    const s: Stats = {
      maxHp: base.maxHp + (mod.maxHp ?? 0),
      maxMp: base.maxMp + (mod.maxMp ?? 0),
      atk: base.atk + (mod.atk ?? 0),
      def: base.def + (mod.def ?? 0),
      spd: Math.max(60, base.spd + (mod.spd ?? 0)),
      crit: base.crit + (mod.crit ?? 0),
    };
    for (const slot of ['weapon', 'armor', 'charm'] as const) {
      const id = p.equip[slot];
      if (!id) continue;
      const def = ITEMS[id];
      if (!def?.bonus) continue;
      const b = def.bonus;
      s.maxHp += b.maxHp ?? 0;
      s.maxMp += b.maxMp ?? 0;
      s.atk += b.atk ?? 0;
      s.def += b.def ?? 0;
      s.spd += b.spd ?? 0;
      s.crit += b.crit ?? 0;
    }
    const hpRatio = p.hp / Math.max(1, p.stats.maxHp);
    const mpRatio = p.mp / Math.max(1, p.stats.maxMp);
    p.stats = s;
    if (healToFull) {
      p.hp = s.maxHp;
      p.mp = s.maxMp;
    } else {
      p.hp = Math.min(s.maxHp, Math.max(1, Math.round(s.maxHp * hpRatio)));
      p.mp = Math.min(s.maxMp, Math.max(0, Math.round(s.maxMp * mpRatio)));
    }
  }

  // ---------- time / zone ----------

  darkness(): number {
    // 0 = full day, 1 = deep night. Clock maps time 0 -> 00:00.
    // Day 06:00-16:48, dusk ->19:12, night 19:12-04:48, dawn ->06:00.
    const t = this.time % 1;
    if (t < 0.2) return 1;
    if (t < 0.25) return 1 - (t - 0.2) / 0.05;
    if (t < 0.7) return 0;
    if (t < 0.8) return (t - 0.7) / 0.1;
    return 1;
  }

  isNight(): boolean {
    return this.darkness() > 0.5;
  }

  clockText(): string {
    const h = Math.floor((this.time % 1) * 24);
    const m = Math.floor(((this.time % 1) * 24 - h) * 60);
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    return this.isNight() ? `🌙 ${hh}:${mm}` : `☀️ ${hh}:${mm}`;
  }

  // ---------- main update ----------

  update(rawDt: number, input: SimInput): void {
    const safeDt = Number.isFinite(rawDt) ? rawDt : 1 / 60;
    const dt = Math.min(0.05, Math.max(0.0001, safeDt));
    if (this.over) {
      this.updateFx(dt);
      return;
    }
    this.playTime += dt;
    this.time = (this.time + dt / DAY_LENGTH) % 1;

    const p = this.player;
    if (p.alive) {
      this.updatePlayer(dt, input);
    } else {
      // death drift: still tick cooldowns so respawn is clean
      p.hurtCd = Math.max(0, p.hurtCd - dt);
      p.deadT += dt;
    }
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updatePickups(dt);
    this.updateSpawner(dt);
    this.updateFx(dt);

    // zone tracking
    const z = this.world.zoneAtPx(p.x, p.y);
    if (z !== this.zone) {
      this.zone = z;
      this.events.push({ t: 'zone', zone: z });
    }

    // regen
    if (p.alive) {
      const inTown = this.zone === 'town';
      p.hp = Math.min(p.stats.maxHp, p.hp + dt * (inTown ? 5 : 0.6));
      p.mp = Math.min(p.stats.maxMp, p.mp + dt * (inTown ? 7 : 1.8));
    }
  }

  private updatePlayer(dt: number, input: SimInput): void {
    const p = this.player;
    p.atkCd = Math.max(0, p.atkCd - dt);
    p.skillCd = Math.max(0, p.skillCd - dt);
    p.hurtCd = Math.max(0, p.hurtCd - dt);
    p.shieldT = Math.max(0, p.shieldT - dt);
    p.talkT = Math.max(0, p.talkT - dt);
    if (p.swingT >= 0) {
      p.swingT += dt / TEMPO.playerSwingDur;
      if (p.swingT > 1) p.swingT = -1;
    }
    if (p.castT >= 0) {
      p.castT += dt / TEMPO.skillCastDur;
      if (p.castT > 1) p.castT = -1;
    }
    if (p.potionT >= 0) {
      p.potionT += dt / TEMPO.potionDur;
      if (p.potionT > 1) p.potionT = -1;
    }

    // dash (commoner/knight skill)
    if (this.dashT > 0) {
      this.dashT -= dt;
      const step = dt / Math.max(0.001, TEMPO.dashDur);
      this.world.moveCircle(p, this.dashDx * step * TEMPO.dashDist, this.dashDy * step * TEMPO.dashDist, 5);
      // damage enemies on contact path
      for (const e of this.enemies) {
        if (e.dead || this.dashHit.has(e.uid)) continue;
        if (dist(p.x, p.y, e.x, e.y) < TEMPO.dashHitRadius) {
          this.dashHit.add(e.uid);
          const { dmg, crit } = calcDamage(this.dashDmg, e.def, p.stats.crit, this.rng);
          this.damageEnemy(e, dmg, crit, facingAngle(p.facing), TEMPO.knockDash);
        }
      }
      if (this.dashT <= 0) this.dashHit.clear();
    }

    // movement (camera-relative; camera is axis-aligned today so this is
    // identity, but diagonal input still maps to true 8-way facing).
    let mx = Number.isFinite(input.mx) ? input.mx : 0;
    let my = Number.isFinite(input.my) ? input.my : 0;
    const mag = Math.hypot(mx, my);
    if (mag > 1) {
      mx /= mag;
      my /= mag;
    }
    if (mag > 0.12 && this.dashT <= 0) {
      const cam = toCameraRelative(mx, my, 0);
      mx = Number.isFinite(cam.mx) ? cam.mx : 0;
      my = Number.isFinite(cam.my) ? cam.my : 0;
      p.facing = facingFromVec(mx, my);
      const spd = p.stats.spd;
      this.world.moveCircle(p, mx * spd * dt, my * spd * dt, 5);
    }
    // knockback decay
    if (p.kx !== 0 || p.ky !== 0) {
      this.world.moveCircle(p, p.kx * dt, p.ky * dt, 5);
      const decay = Math.max(0, 1 - dt * TEMPO.knockDecayPlayer);
      p.kx *= decay;
      p.ky *= decay;
      if (Math.hypot(p.kx, p.ky) < 4) {
        p.kx = 0;
        p.ky = 0;
      }
    }

    // edge actions
    if (input.attack) this.tryAttack();
    if (input.skill) this.trySkill();
    if (input.potion) this.tryPotion();
    // interact is handled by orchestrator (needs UI), but auto-face happens here
    if (input.interact) {
      const npc = this.nearestNpc(34);
      if (npc) {
        p.facing = facingFromVec(npc.x - p.x, npc.y - p.y);
        npc.facing = facingFromVec(p.x - npc.x, p.y - npc.y);
        p.talkT = TEMPO.talkDur;
      }
    }
  }

  // ---------- player actions (all combat math in sim) ----------

  nearestEnemy(maxD: number, x = this.player.x, y = this.player.y): EnemyState | null {
    let best: EnemyState | null = null;
    let bd = maxD;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = dist(x, y, e.x, e.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  nearestNpc(maxD: number): NpcState | null {
    let best: NpcState | null = null;
    let bd = maxD;
    for (const n of this.npcs) {
      const d = dist(this.player.x, this.player.y, n.x, n.y);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  autoFace(): void {
    const p = this.player;
    const e = this.nearestEnemy(110);
    if (e) p.facing = facingFromVec(e.x - p.x, e.y - p.y);
  }

  tryAttack(): boolean {
    const p = this.player;
    if (!p.alive || p.atkCd > 0 || this.dashT > 0) return false;
    p.atkCd = TEMPO.playerAttackCd * (p.job === 'blader' ? TEMPO.bladerAttackCdMul : 1);
    p.swingT = 0;
    this.autoFace();
    const range = p.job === 'knight' ? 36 : 30;
    const fa = facingAngle(p.facing);
    let hitAny = false;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (!inArc(p.x, p.y, fa, range + (e.elite ? 8 : 0), 1.25, e.x, e.y)) continue;
      const { dmg, crit } = calcDamage(p.stats.atk, e.def, p.stats.crit, this.rng);
      this.damageEnemy(e, dmg, crit, fa, TEMPO.knockPlayerAtk);
      hitAny = true;
    }
    // small forward lunge
    this.world.moveCircle(p, Math.cos(fa) * TEMPO.playerLunge, Math.sin(fa) * TEMPO.playerLunge, 5);
    this.events.push({ t: 'sfx', id: hitAny ? 'swing_hit' : 'swing' });
    this.burst(p.x + Math.cos(fa) * 18, p.y + Math.sin(fa) * 18, 4, hitAny ? 11 : 8, 60);
    return true;
  }

  trySkill(): boolean {
    const p = this.player;
    if (!p.alive || p.skillCd > 0 || this.dashT > 0) return false;
    const sk = JOB_SKILL[p.job];
    if (p.mp < sk.mp) {
      this.events.push({ t: 'sfx', id: 'deny' });
      this.addText(p.x, p.y - 24, 'MP 부족!', 'info');
      return false;
    }
    p.mp -= sk.mp;
    p.skillCd = sk.cd;
    p.skillCdMax = sk.cd;
    this.autoFace();
    const fa = facingAngle(p.facing);

    if (p.job === 'commoner' || p.job === 'knight') {
      const power = p.job === 'knight' ? 1.8 : 1.3;
      this.dashT = TEMPO.dashDur;
      this.dashDx = Math.cos(fa);
      this.dashDy = Math.sin(fa);
      this.dashHit.clear();
      this.dashDmg = Math.round(p.stats.atk * power);
      if (p.job === 'knight') p.shieldT = 4;
      p.swingT = 0;
      this.events.push({ t: 'sfx', id: p.job === 'knight' ? 'shield_charge' : 'bash' });
      this.events.push({ t: 'shake', power: 2 });
      this.burst(p.x, p.y - 8, 10, p.job === 'knight' ? 3 : 8, 120);
    } else if (p.job === 'blader') {
      p.swingT = 0;
      p.castT = 0;
      let hits = 0;
      for (let i = 0; i < 3; i++) {
        for (const e of this.enemies) {
          if (e.dead) continue;
          if (!inArc(p.x, p.y, fa, 34, 1.3, e.x, e.y)) continue;
          const { dmg, crit } = calcDamage(Math.round(p.stats.atk * 0.85), e.def, Math.min(0.6, p.stats.crit + 0.15), this.rng);
          this.damageEnemy(e, dmg, crit, fa, TEMPO.knockBlader);
          hits++;
        }
      }
      this.events.push({ t: 'sfx', id: 'triple' });
      this.events.push({ t: 'shake', power: hits > 0 ? 3 : 1 });
      this.burst(p.x + Math.cos(fa) * 22, p.y + Math.sin(fa) * 22, 12, 10, 150);
    } else if (p.job === 'arcanist') {
      p.castT = 0;
      const baseA = fa;
      for (let i = -1; i <= 1; i++) {
        const a = baseA + i * 0.18;
        this.projectiles.push({
          uid: this.uid++, x: p.x + Math.cos(a) * 12, y: p.y - 8 + Math.sin(a) * 12,
          vx: Math.cos(a) * TEMPO.projFriendlySpd, vy: Math.sin(a) * TEMPO.projFriendlySpd,
          life: 1.25, friendly: true, holy: false,
          dmg: Math.round(p.stats.atk * 1.25), radius: 6,
        });
      }
      this.events.push({ t: 'sfx', id: 'fireball' });
      this.burst(p.x + Math.cos(fa) * 14, p.y - 8, 8, 9, 100);
    } else if (p.job === 'shrine') {
      p.castT = 0;
      const heal = Math.round(p.stats.maxHp * 0.35);
      p.hp = Math.min(p.stats.maxHp, p.hp + heal);
      this.addText(p.x, p.y - 26, `+${heal}`, 'heal');
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (dist(p.x, p.y, e.x, e.y) < 95) {
          const { dmg, crit } = calcDamage(p.stats.atk, e.def, p.stats.crit, this.rng);
          this.damageEnemy(e, dmg, crit, Math.atan2(e.y - p.y, e.x - p.x), TEMPO.knockHoly);
        }
      }
      this.events.push({ t: 'sfx', id: 'holy' });
      this.events.push({ t: 'flash', color: 'gold' });
      this.ring(p.x, p.y - 8, 95, 11);
    }
    return true;
  }

  tryPotion(): boolean {
    const p = this.player;
    if (!p.alive || p.potions <= 0) {
      this.events.push({ t: 'sfx', id: 'deny' });
      return false;
    }
    if (p.hp >= p.stats.maxHp) return false;
    p.potions--;
    p.potionT = 0;
    const heal = 40 + Math.round(p.stats.maxHp * 0.15);
    p.hp = Math.min(p.stats.maxHp, p.hp + heal);
    this.addText(p.x, p.y - 26, `+${heal}`, 'heal');
    this.events.push({ t: 'sfx', id: 'potion' });
    this.burst(p.x, p.y - 10, 8, 10, 70);
    return true;
  }

  tryInteract(): InteractResult {
    const npc = this.nearestNpc(36);
    if (!npc) return { kind: 'none' };
    this.player.talkT = TEMPO.talkDur;
    this.events.push({ t: 'sfx', id: 'talk' });
    return { kind: 'npc', npc };
  }

  // ---------- damage ----------

  damageEnemy(e: EnemyState, dmg: number, crit: boolean, fromAngle: number, knock: number): void {
    if (e.dead) return;
    e.hp -= dmg;
    e.hurtCd = TEMPO.enemyHurtFlash;
    e.kx += Math.cos(fromAngle) * knock * (e.elite ? 0.25 : 1);
    e.ky += Math.sin(fromAngle) * knock * (e.elite ? 0.25 : 1);
    if (e.ai === 'idle') e.ai = 'chase';
    this.addText(e.x, e.y - 22 * (e.elite ? 1.6 : 1), String(dmg), crit ? 'crit' : 'dmg');
    this.burst(e.x, e.y - 8, crit ? 8 : 4, crit ? 11 : 10, 110);
    if (e.hp <= 0) this.killEnemy(e);
    else this.events.push({ t: 'sfx', id: 'hit' });
  }

  private killEnemy(e: EnemyState): void {
    e.dead = true;
    e.deadT = 0;
    e.hp = 0;
    const p = this.player;
    p.kills++;
    this.gainXp(e.xp);
    const loot = rollLoot(e.kind, this.rng);
    // drop gold pickup(s)
    this.pickups.push({
      uid: this.uid++, kind: 'gold', itemId: null, gold: loot.gold,
      x: e.x + (this.rng() - 0.5) * 14, y: e.y + (this.rng() - 0.5) * 10, ttl: 60,
    });
    if (loot.potion) {
      this.pickups.push({
        uid: this.uid++, kind: 'potion', itemId: 'potion', gold: 0,
        x: e.x + (this.rng() - 0.5) * 22, y: e.y + (this.rng() - 0.5) * 14, ttl: 60,
      });
    }
    if (loot.equipId) {
      this.pickups.push({
        uid: this.uid++, kind: 'equip', itemId: loot.equipId, gold: 0,
        x: e.x + (this.rng() - 0.5) * 26, y: e.y + (this.rng() - 0.5) * 16, ttl: 90,
      });
    }
    this.burst(e.x, e.y - 8, e.elite ? 26 : 10, e.elite ? 10 : 7, 160);
    this.events.push({ t: 'sfx', id: e.elite ? 'elite_die' : 'die' });
    if (e.elite) {
      this.events.push({ t: 'shake', power: 6 });
      this.events.push({ t: 'flash', color: 'red' });
      this.events.push({ t: 'toast', text: `⚔️ ${ENEMIES[e.kind].name} 처치! (+${e.xp} XP)` });
      this.watcherAlive = false;
      this.watcherT = 150;
    }
  }

  damagePlayer(dmg: number, fromX: number, fromY: number): void {
    const p = this.player;
    if (!p.alive || p.hurtCd > 0) return;
    let final = dmg;
    if (p.shieldT > 0) final = Math.max(1, Math.round(final * 0.5));
    p.hp -= final;
    p.hurtCd = TEMPO.playerHurtCd;
    const a = Math.atan2(p.y - fromY, p.x - fromX);
    p.kx += Math.cos(a) * TEMPO.knockToPlayer;
    p.ky += Math.sin(a) * TEMPO.knockToPlayer;
    this.addText(p.x, p.y - 26, String(final), 'hurt');
    this.events.push({ t: 'sfx', id: 'hurt' });
    this.events.push({ t: 'shake', power: 3 });
    this.events.push({ t: 'flash', color: 'red' });
    this.burst(p.x, p.y - 8, 6, 12, 120);
    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      p.deadT = 0;
      this.events.push({ t: 'died' });
      this.events.push({ t: 'sfx', id: 'player_die' });
    }
  }

  gainXp(amount: number): void {
    const p = this.player;
    p.xp += amount;
    while (p.xp >= p.xpNext) {
      p.xp -= p.xpNext;
      p.level++;
      p.xpNext = xpForLevel(p.level);
      const hpRatio = 0.35;
      this.recompute(false);
      p.hp = Math.min(p.stats.maxHp, p.hp + Math.round(p.stats.maxHp * hpRatio));
      p.mp = p.stats.maxMp;
      this.addText(p.x, p.y - 34, `Lv.${p.level}!`, 'gold');
      this.events.push({ t: 'levelup' });
      this.events.push({ t: 'sfx', id: 'levelup' });
      this.events.push({ t: 'toast', text: `🎉 레벨 ${p.level} 달성! (HP 회복)` });
      this.ring(p.x, p.y - 8, 60, 11);
      if (p.level === 5) {
        this.events.push({ t: 'toast', text: '✨ 전직 가능! 엠버게이트 전직관에게 가세요.' });
      }
    }
  }

  // ---------- enemies ----------

  private spawnEnemy(kind: EnemyKind, x: number, y: number, zone: ZoneId): EnemyState {
    const def = ENEMIES[kind];
    // slight per-spawn variance (±10% hp)
    const hpMul = 0.9 + this.rng() * 0.2;
    const e: EnemyState = {
      uid: this.uid++, kind, x, y,
      facing: 0, hp: Math.round(def.hp * hpMul), maxHp: Math.round(def.hp * hpMul),
      atk: def.atk, def: def.def, spd: def.spd * (0.92 + this.rng() * 0.16),
      xp: def.xp, ai: 'idle', stateT: this.rng() * 2, hurtCd: 0, atkCd: this.rng() * 0.5,
      kx: 0, ky: 0, spawnX: x, spawnY: y, zone,
      elite: kind === 'watcher', swingT: -1, dead: false, deadT: 0,
    };
    this.enemies.push(e);
    return e;
  }

  private updateEnemies(dt: number): void {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.dead) {
        e.deadT += dt;
        continue;
      }
      const def = ENEMIES[e.kind];
      e.hurtCd = Math.max(0, e.hurtCd - dt);
      e.atkCd = Math.max(0, e.atkCd - dt);
      if (e.swingT >= 0) {
        e.swingT += dt / TEMPO.enemySwingDur;
        if (e.swingT > 1) e.swingT = -1;
      }
      e.stateT += dt;

      const dPlayer = dist(e.x, e.y, p.x, p.y);
      const dHome = dist(e.x, e.y, e.spawnX, e.spawnY);

      // knockback
      if (e.kx !== 0 || e.ky !== 0) {
        this.world.moveCircle(e, e.kx * dt, e.ky * dt, 5);
        const decay = Math.max(0, 1 - dt * TEMPO.knockDecayEnemy);
        e.kx *= decay;
        e.ky *= decay;
        if (Math.hypot(e.kx, e.ky) < 5) {
          e.kx = 0;
          e.ky = 0;
        }
      }

      switch (e.ai) {
        case 'idle': {
          // wander slowly (true 8-way so idlers read diagonally too)
          if (e.stateT > 2.5) {
            e.stateT = 0;
            e.facing = (Math.floor(this.rng() * 8) % 8) as Facing;
          }
          if (this.rng() < dt * 0.9) {
            const a = facingAngle(e.facing);
            const wob = e.spd * TEMPO.enemySpeedMul * 0.25;
            this.world.moveCircle(e, Math.cos(a) * wob * dt, Math.sin(a) * wob * dt, 5);
          }
          if (p.alive && dPlayer < def.aggro && this.zone !== 'town') {
            e.ai = 'chase';
            e.stateT = 0;
          }
          break;
        }
        case 'chase': {
          if (!p.alive || dPlayer > def.aggro * 1.6 || dHome > def.leash) {
            e.ai = 'return';
            e.stateT = 0;
            break;
          }
          e.facing = facingFromVec(p.x - e.x, p.y - e.y);
          if (dPlayer > def.atkRange) {
            const a = Math.atan2(p.y - e.y, p.x - e.x);
            const sp = e.spd * TEMPO.enemySpeedMul * (def.ranged && dPlayer < 90 ? -0.6 : 1);
            this.world.moveCircle(e, Math.cos(a) * sp * dt, Math.sin(a) * sp * dt, 5);
          } else if (e.atkCd <= 0) {
            e.ai = 'windup';
            e.stateT = 0;
            e.swingT = 0;
          }
          break;
        }
        case 'windup': {
          e.facing = facingFromVec(p.x - e.x, p.y - e.y);
          const windupTime = TEMPO.windup[e.kind];
          if (e.stateT >= windupTime) {
            e.ai = 'recover';
            e.stateT = 0;
            e.atkCd = def.atkCd * TEMPO.enemyAtkCdMul;
            if (def.ranged) {
              // fire bolt
              const a = Math.atan2(p.y - (e.y - 8), p.x - e.x);
              const rp = calcDamage(e.atk, 0, 0, this.rng);
              this.projectiles.push({
                uid: this.uid++, x: e.x, y: e.y - 8,
                vx: Math.cos(a) * TEMPO.projEnemySpd, vy: Math.sin(a) * TEMPO.projEnemySpd,
                life: 1.85, friendly: false, holy: false, dmg: rp.dmg, radius: 5,
              });
              this.events.push({ t: 'sfx', id: 'bolt' });
            } else if (e.elite && this.rng() < 0.35) {
              // slam AoE
              this.events.push({ t: 'shake', power: 5 });
              this.events.push({ t: 'sfx', id: 'slam' });
              this.ring(e.x, e.y - 4, 78, 10);
              if (dPlayer < 78) {
                const rp = calcDamage(Math.round(e.atk * 1.3), p.stats.def, 0, this.rng);
                this.damagePlayer(rp.dmg, e.x, e.y);
              }
            } else if (dPlayer < def.atkRange + 10) {
              const rp = calcDamage(e.atk, p.stats.def, 0, this.rng);
              this.damagePlayer(rp.dmg, e.x, e.y);
            }
          }
          break;
        }
        case 'recover': {
          if (e.stateT > TEMPO.enemyRecover) {
            e.ai = 'chase';
            e.stateT = 0;
          }
          break;
        }
        case 'return': {
          if (p.alive && dPlayer < def.aggro * 0.7 && this.zone !== 'town') {
            e.ai = 'chase';
            e.stateT = 0;
            break;
          }
          if (dHome < 12) {
            e.ai = 'idle';
            e.stateT = 0;
            e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.2);
          } else {
            const a = Math.atan2(e.spawnY - e.y, e.spawnX - e.x);
            e.facing = facingFromVec(e.spawnX - e.x, e.spawnY - e.y);
            const rsp = e.spd * TEMPO.enemySpeedMul * 0.8;
            this.world.moveCircle(e, Math.cos(a) * rsp * dt, Math.sin(a) * rsp * dt, 5);
          }
          break;
        }
      }
    }

    // separation (cheap O(n^2), n is small)
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      if (a.dead) continue;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (b.dead) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = a.elite || b.elite ? 26 : 16;
        if (d > 0.01 && d < min) {
          const push = ((min - d) / min) * 40 * dt;
          const nx = dx / d;
          const ny = dy / d;
          this.world.moveCircle(a, -nx * push, -ny * push, 4);
          this.world.moveCircle(b, nx * push, ny * push, 4);
        }
      }
    }

    // remove long-dead (elite corpses linger for a heavier death read)
    this.enemies = this.enemies.filter((e) => !e.dead || e.deadT < (e.elite ? TEMPO.enemyDeadFadeElite : TEMPO.enemyDeadFade));
  }

  private updateProjectiles(dt: number): void {
    const p = this.player;
    for (const pr of this.projectiles) {
      pr.life -= dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      if (pr.life <= 0) continue;
      // wall hit
      if (this.world.isBlockedPx(pr.x, pr.y, 2)) {
        pr.life = 0;
        this.burst(pr.x, pr.y, 4, pr.friendly ? 9 : 13, 80);
        continue;
      }
      if (pr.friendly) {
        for (const e of this.enemies) {
          if (e.dead) continue;
          const rr = pr.radius + (e.elite ? 12 : 8);
          if (dist(pr.x, pr.y, e.x, e.y - 6) < rr) {
            pr.life = 0;
            const { dmg, crit } = calcDamage(pr.dmg, e.def, p.stats.crit, this.rng);
            this.damageEnemy(e, dmg, crit, Math.atan2(pr.vy, pr.vx), TEMPO.knockProjectile);
            break;
          }
        }
      } else if (p.alive && p.hurtCd <= 0) {
        if (dist(pr.x, pr.y, p.x, p.y - 8) < pr.radius + 7) {
          pr.life = 0;
          const rp = calcDamage(pr.dmg, p.stats.def, 0, this.rng);
          this.damagePlayer(rp.dmg, pr.x - pr.vx * 0.01, pr.y - pr.vy * 0.01);
        }
      }
    }
    this.projectiles = this.projectiles.filter((pr) => pr.life > 0);
  }

  private updatePickups(dt: number): void {
    const p = this.player;
    for (const k of this.pickups) {
      k.ttl -= dt;
      if (!p.alive) continue;
      const d = dist(p.x, p.y, k.x, k.y);
      if (d < 30) {
        // magnet
        const a = Math.atan2(p.y - k.y, p.x - k.x);
        k.x += Math.cos(a) * TEMPO.pickupMagnetSpd * dt;
        k.y += Math.sin(a) * TEMPO.pickupMagnetSpd * dt;
      }
      if (d < 14) {
        k.ttl = 0;
        this.collectPickup(k);
      }
    }
    this.pickups = this.pickups.filter((k) => k.ttl > 0);
  }

  private collectPickup(k: PickupState): void {
    const p = this.player;
    if (k.kind === 'gold') {
      p.gold += k.gold;
      this.addText(p.x, p.y - 22, `+${k.gold}G`, 'gold');
      this.events.push({ t: 'sfx', id: 'coin' });
    } else if (k.kind === 'potion') {
      if (p.potions >= 9) {
        p.gold += 5;
        this.addText(p.x, p.y - 22, '+5G', 'gold');
      } else {
        p.potions++;
        this.addText(p.x, p.y - 22, '물약 +1', 'heal');
      }
      this.events.push({ t: 'sfx', id: 'pickup' });
    } else if (k.kind === 'equip' && k.itemId) {
      this.addItem(k.itemId, 1);
      const def = ITEMS[k.itemId];
      this.addText(p.x, p.y - 22, def ? def.name : k.itemId, 'gold');
      this.events.push({ t: 'sfx', id: 'equip_drop' });
      this.events.push({ t: 'toast', text: `🎁 ${def?.name ?? k.itemId} 획득! (가방에서 장착)` });
    }
  }

  // ---------- spawner ----------

  private updateSpawner(dt: number): void {
    this.spawnT -= dt;
    // elite
    if (!this.watcherAlive) {
      this.watcherT -= dt;
      if (this.watcherT <= 0) {
        const wx = 48 * TILE;
        const wy = 10.5 * TILE;
        this.spawnEnemy('watcher', wx, wy, 'arena');
        this.watcherAlive = true;
        this.events.push({ t: 'toast', text: '⚠️ 북쪽 제단에 철갑감시자가 나타났다!' });
      }
    }
    if (this.spawnT > 0) return;
    this.spawnT = TEMPO.spawnTick;
    const aliveCount = this.enemies.filter((e) => !e.dead && !e.elite).length;
    if (aliveCount >= 34) return;
    // spawn 1-2 ambient mobs per tick
    const n = 1 + (this.rng() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) this.spawnAmbient(false);
  }

  private spawnAmbient(initial: boolean): void {
    // pick zone weighted, away from player unless initial
    const zones: ZoneId[] = ['field', 'forest', 'road', 'ruin', 'field', 'forest', 'road'];
    if (this.isNight()) zones.push('ruin', 'road');
    const zone = zones[Math.floor(this.rng() * zones.length)];
    const spot = this.world.randomSpot(zone, this.rng);
    if (!spot) return;
    if (!initial && dist(spot.x, spot.y, this.player.x, this.player.y) < 260) return;
    // pick kind valid for zone
    const cands: EnemyKind[] = (['slime', 'wolf', 'bandit', 'shade'] as EnemyKind[]).filter((k) =>
      ENEMIES[k].zones.includes(zone),
    );
    if (cands.length === 0) return;
    let total = 0;
    for (const k of cands) total += ENEMIES[k].weight;
    let r = this.rng() * total;
    let kind: EnemyKind = cands[0];
    for (const k of cands) {
      r -= ENEMIES[k].weight;
      if (r <= 0) {
        kind = k;
        break;
      }
    }
    this.spawnEnemy(kind, spot.x, spot.y, zone);
  }

  // ---------- fx state (driven by sim, drawn by renderer) ----------

  addText(x: number, y: number, text: string, color: FloatText['color']): void {
    if (this.texts.length > 60) this.texts.shift();
    this.texts.push({ x: x + (this.rng() - 0.5) * 8, y, text, color, ttl: TEMPO.floatTtl });
  }

  burst(x: number, y: number, n: number, color: number, spd: number): void {
    for (let i = 0; i < n; i++) {
      if (this.particles.length > 400) this.particles.shift();
      const a = this.rng() * Math.PI * 2;
      const v = spd * (0.3 + this.rng() * 0.7);
      const ttl = 0.3 + this.rng() * 0.4;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30,
        ttl, ttlMax: ttl, color, size: 1 + Math.floor(this.rng() * 3),
      });
    }
  }

  ring(x: number, y: number, radius: number, color: number): void {
    const n = 26;
    for (let i = 0; i < n; i++) {
      if (this.particles.length > 400) this.particles.shift();
      const a = (i / n) * Math.PI * 2;
      const ttl = 0.45;
      this.particles.push({
        x: x + Math.cos(a) * 10, y: y + Math.sin(a) * 6,
        vx: Math.cos(a) * radius * 2.4, vy: Math.sin(a) * radius * 1.6,
        ttl, ttlMax: ttl, color, size: 2,
      });
    }
  }

  private updateFx(dt: number): void {
    for (const pt of this.particles) {
      pt.ttl -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 160 * dt;
      pt.vx *= 1 - dt * 2;
    }
    this.particles = this.particles.filter((p) => p.ttl > 0);
    for (const t of this.texts) {
      t.ttl -= dt;
      t.y -= TEMPO.floatRise * dt;
    }
    this.texts = this.texts.filter((t) => t.ttl > 0);
  }

  // ---------- inventory / equip / shop / jobs ----------

  addItem(id: string, qty: number): void {
    if (id === 'potion') {
      this.player.potions = Math.min(9, this.player.potions + qty);
      return;
    }
    const ex = this.player.inv.find((e) => e.id === id);
    if (ex) ex.qty += qty;
    else this.player.inv.push({ id, qty });
  }

  equipItem(id: string): boolean {
    const p = this.player;
    const def = ITEMS[id];
    if (!def || !def.slot) return false;
    const invIdx = p.inv.findIndex((e) => e.id === id);
    if (invIdx < 0) return false;
    // unequip current
    const cur = p.equip[def.slot];
    if (cur) this.addItem(cur, 1);
    p.equip[def.slot] = id;
    const entry = p.inv[invIdx];
    entry.qty--;
    if (entry.qty <= 0) p.inv.splice(invIdx, 1);
    this.recompute(false);
    this.events.push({ t: 'sfx', id: 'equip' });
    return true;
  }

  unequipItem(slot: 'weapon' | 'armor' | 'charm'): boolean {
    const p = this.player;
    const cur = p.equip[slot];
    if (!cur) return false;
    p.equip[slot] = null;
    this.addItem(cur, 1);
    this.recompute(false);
    this.events.push({ t: 'sfx', id: 'equip' });
    return true;
  }

  buyItem(id: string): { ok: boolean; msg: string } {
    const p = this.player;
    if (!SHOP_STOCK.includes(id)) return { ok: false, msg: '취급하지 않는 물건입니다.' };
    const def = ITEMS[id];
    if (!def) return { ok: false, msg: '없는 물건입니다.' };
    if (id === 'potion' && p.potions >= 9) return { ok: false, msg: '물약 주머니가 가득 찼습니다.' };
    if (p.gold < def.price) return { ok: false, msg: '골드가 부족합니다.' };
    p.gold -= def.price;
    this.addItem(id, 1);
    this.events.push({ t: 'sfx', id: 'buy' });
    return { ok: true, msg: `${def.name} 구매!` };
  }

  innRest(): { ok: boolean; msg: string } {
    const p = this.player;
    const cost = 5;
    if (p.gold < cost) return { ok: false, msg: '골드가 부족합니다. (5G 필요)' };
    if (p.hp >= p.stats.maxHp && p.mp >= p.stats.maxMp) return { ok: false, msg: '이미 최상의 컨디션입니다!' };
    p.gold -= cost;
    p.hp = p.stats.maxHp;
    p.mp = p.stats.maxMp;
    this.events.push({ t: 'sfx', id: 'heal' });
    this.burst(p.x, p.y - 10, 14, 15, 80);
    return { ok: true, msg: '푹 쉬었습니다! HP/MP 전부 회복!' };
  }

  canJobChange(): boolean {
    return this.player.level >= 5;
  }

  jobChange(job: JobId): { ok: boolean; msg: string } {
    const p = this.player;
    if (job === p.job) return { ok: false, msg: '이미 그 직업입니다.' };
    if (job !== 'commoner' && p.level < 5) return { ok: false, msg: 'Lv.5부터 전직할 수 있습니다.' };
    p.job = job;
    this.recompute(true);
    this.events.push({ t: 'job', job });
    this.events.push({ t: 'sfx', id: 'jobchange' });
    this.events.push({ t: 'flash', color: 'gold' });
    this.ring(p.x, p.y - 8, 90, 11);
    this.events.push({ t: 'toast', text: `✨ ${JOB_NAMES[job]}(으)로 전직!` });
    return { ok: true, msg: `${JOB_NAMES[job]}(으)로 전직했습니다!` };
  }

  respawn(): void {
    const p = this.player;
    p.alive = true;
    p.hp = p.stats.maxHp;
    p.mp = p.stats.maxMp;
    p.x = 47.5 * TILE;
    p.y = 60 * TILE;
    p.facing = 1;
    p.kx = 0;
    p.ky = 0;
    p.hurtCd = 2;
    p.swingT = -1;
    p.castT = -1;
    p.potionT = -1;
    p.talkT = 0;
    p.deadT = 0;
    const lost = Math.floor(p.gold * 0.1);
    p.gold -= lost;
    this.zone = this.world.zoneAtPx(p.x, p.y);
    this.events.push({ t: 'toast', text: lost > 0 ? `엠버게이트에서 부활… (골드 ${lost}G 분실)` : '엠버게이트에서 부활!' });
  }

  // ---------- dialogue content (sim-owned data) ----------

  getDialog(npcId: string): DialogData {
    const p = this.player;
    if (npcId === 'guard') {
      return {
        name: '경비대장 수아',
        lines: [
          '어서 오게, 모험가! 여기는 엠버게이트, 잔광성 외곽 마을이라네.',
          p.level < 5
            ? '남쪽 들판의 슬라임부터 처치하며 몸을 풀게. Lv.5가 되면 전직관 헤론 님을 찾아가게나.'
            : '실력이 늘었군! 전직관 헤론 님께 전직을 받았는가? 북쪽 폐허의 철갑감시자를 조심하게.',
        ],
        choices: [{ label: '고맙습니다. (닫기)', action: 'bye' }],
      };
    }
    if (npcId === 'jobmaster') {
      const lines = p.level < 5
        ? [`아직 때가 아니다. Lv.5가 되면 다시 오거라. (현재 Lv.${p.level})`]
        : ['잔광이 그대를 부른다. 어떤 길을 걷겠는가?'];
      const choices: DialogChoice[] = [];
      const jobs: JobId[] = ['knight', 'blader', 'arcanist', 'shrine'];
      for (const j of jobs) {
        const sk = JOB_SKILL[j];
        choices.push({
          label: `${JOB_NAMES[j]} — ${sk.name} (MP${sk.mp})${p.job === j ? ' [현재]' : ''}`,
          action: `job:${j}`,
          disabled: p.level < 5 || p.job === j,
        });
      }
      choices.push({ label: '돌아가기', action: 'bye' });
      return { name: '전직관 헤론', lines, choices };
    }
    if (npcId === 'merchant') {
      const lines = ['어서 오십시오! 엠버게이트 최고의 상점입니다.', `보유 골드: ${p.gold}G / 물약: ${p.potions}/9`];
      const choices: DialogChoice[] = SHOP_STOCK.map((id) => {
        const d = ITEMS[id];
        return { label: `${d.name} — ${d.price}G (${d.desc})`, action: `buy:${id}`, disabled: p.gold < d.price };
      });
      choices.push({ label: '돌아가기', action: 'bye' });
      return { name: '상인 마르코', lines, choices };
    }
    if (npcId === 'innkeeper') {
      return {
        name: '여관주인 미렐',
        lines: [`따뜻한 침대와 스튜가 준비되어 있어요. 5G에 푹 쉬어가세요. (HP ${Math.floor(p.hp)}/${p.stats.maxHp})`],
        choices: [
          { label: '휴식하기 — 5G', action: 'inn', disabled: p.gold < 5 },
          { label: '돌아가기', action: 'bye' },
        ],
      };
    }
    return { name: '???', lines: ['...'], choices: [{ label: '닫기', action: 'bye' }] };
  }

  /** Execute a dialog choice. Returns follow-up lines (empty = close). */
  dialogChoice(npcId: string, action: string): { lines: string[]; close: boolean; refresh: boolean } {
    if (action === 'bye') return { lines: [], close: true, refresh: false };
    if (action.startsWith('job:')) {
      const job = action.slice(4) as JobId;
      const r = this.jobChange(job);
      return { lines: [r.msg], close: r.ok, refresh: !r.ok };
    }
    if (action.startsWith('buy:')) {
      const id = action.slice(4);
      const r = this.buyItem(id);
      return { lines: [r.msg], close: false, refresh: true };
    }
    if (action === 'inn') {
      const r = this.innRest();
      return { lines: [r.msg], close: r.ok, refresh: !r.ok };
    }
    return { lines: [], close: true, refresh: false };
  }
}
