/**
 * Codegen animation rig: state machines + pose helpers (no art assets).
 * Pure interpretation of sim timers — sim stays authoritative, renderer polls.
 *
 * Player states (8): idle breathe / walk / attack swing / skill cast /
 * hurt flash+knock / death / interact-talk / potion drink.
 * Enemy states (6): idle / move / windup telegraph / attack+recover / hurt / death.
 */
import { facingAngle } from '../sim/combat';
import { TEMPO } from '../sim/config';
import type { EnemyState, Facing, PlayerState } from '../sim/types';

export type PlayerAnim = 'dead' | 'potion' | 'skill' | 'attack' | 'hurt' | 'talk' | 'walk' | 'idle';
export type EnemyAnim = 'dead' | 'hurt' | 'windup' | 'attack' | 'move' | 'idle';

export const PLAYER_ANIMS: PlayerAnim[] = ['idle', 'walk', 'attack', 'skill', 'hurt', 'dead', 'talk', 'potion'];
export const ENEMY_ANIMS: EnemyAnim[] = ['idle', 'move', 'windup', 'attack', 'hurt', 'dead'];

export interface PlayerPose {
  state: PlayerAnim;
  /** normalized 0..1 progress of the active pose (attack/cast/potion), -1 when n/a */
  t: number;
  /** 1 = just hit, fades to 0 (hurt lean + flash driver) */
  hurtK: number;
  /** talk pose 0..1 (1 = fresh) */
  talkK: number;
  /** knockback lean in px (from velocity) */
  leanX: number;
  leanY: number;
}

export interface EnemyPose {
  state: EnemyAnim;
  /** normalized 0..1 progress of the active pose (windup/death), -1 when n/a */
  t: number;
  /** windup telegraph 0..1 */
  windupK: number;
  /** recover follow-through 0..1 */
  recoverK: number;
  /** 1 = just hit, fades to 0 */
  hurtK: number;
  leanX: number;
  leanY: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Knockback velocity -> readable body lean (px). Cheap, no allocation by caller. */
export function knockLean(kx: number, ky: number, max = 3): { x: number; y: number } {
  const k = 0.012;
  return {
    x: Math.max(-max, Math.min(max, kx * k)),
    y: Math.max(-max, Math.min(max, ky * k)),
  };
}

export function playerAnim(p: PlayerState, dashing: boolean): PlayerPose {
  const lean = knockLean(p.kx, p.ky);
  if (!p.alive) {
    return { state: 'dead', t: clamp01(p.deadT / TEMPO.playerDeadFade), hurtK: 0, talkK: 0, leanX: 0, leanY: 0 };
  }
  if (p.potionT >= 0) {
    return { state: 'potion', t: clamp01(p.potionT), hurtK: 0, talkK: 0, leanX: lean.x, leanY: lean.y };
  }
  // Blader triple-slash drives both swing+cast: swing pose wins for the body,
  // cast feeds extra trails via the renderer.
  if (p.castT >= 0 && !(p.job === 'blader' && p.swingT >= 0)) {
    return { state: 'skill', t: clamp01(p.castT), hurtK: 0, talkK: 0, leanX: lean.x, leanY: lean.y };
  }
  if (p.swingT >= 0 || dashing) {
    return {
      state: 'attack',
      t: p.swingT >= 0 ? clamp01(p.swingT) : 0.5,
      hurtK: 0, talkK: 0, leanX: lean.x, leanY: lean.y,
    };
  }
  // Fresh hits only (spawn protection sets hurtCd=2, above the combat max).
  if (p.hurtCd > 0 && p.hurtCd <= TEMPO.playerHurtCd + 0.001) {
    const window = 0.28;
    const k = clamp01((p.hurtCd - (TEMPO.playerHurtCd - window)) / window);
    if (k > 0) {
      return { state: 'hurt', t: k, hurtK: k, talkK: 0, leanX: lean.x, leanY: lean.y };
    }
  }
  if (p.talkT > 0) {
    return { state: 'talk', t: clamp01(p.talkT / TEMPO.talkDur), hurtK: 0, talkK: clamp01(p.talkT / TEMPO.talkDur), leanX: 0, leanY: 0 };
  }
  return { state: 'idle', t: -1, hurtK: 0, talkK: 0, leanX: lean.x, leanY: lean.y };
}

/** Resolve idle vs walk from renderer-tracked movement (phase driver owns `moving`). */
export function playerLocomotion(pose: PlayerPose, moving: boolean): PlayerPose {
  if (pose.state === 'idle' && moving) return { ...pose, state: 'walk' };
  return pose;
}

export function enemyAnim(e: EnemyState, moving: boolean): EnemyPose {
  const lean = knockLean(e.kx, e.ky);
  if (e.dead) {
    const fade = e.elite ? TEMPO.enemyDeadFadeElite : TEMPO.enemyDeadFade;
    return { state: 'dead', t: clamp01(e.deadT / fade), windupK: 0, recoverK: 0, hurtK: 0, leanX: 0, leanY: 0 };
  }
  const hurtWindow = 0.22;
  const hurtK = e.hurtCd > TEMPO.enemyHurtFlash - hurtWindow ? clamp01((e.hurtCd - (TEMPO.enemyHurtFlash - hurtWindow)) / hurtWindow) : 0;
  if (hurtK > 0.45 && e.ai !== 'windup') {
    return { state: 'hurt', t: hurtK, windupK: 0, recoverK: 0, hurtK, leanX: lean.x, leanY: lean.y };
  }
  if (e.ai === 'windup') {
    const w = TEMPO.windup[e.kind];
    const k = clamp01(e.stateT / w);
    return { state: 'windup', t: k, windupK: k, recoverK: 0, hurtK, leanX: 0, leanY: 0 };
  }
  if (e.swingT >= 0 || e.ai === 'recover') {
    const rk = e.ai === 'recover' ? clamp01(e.stateT / TEMPO.enemyRecover) : 0;
    return { state: 'attack', t: e.swingT >= 0 ? clamp01(e.swingT) : rk, windupK: 1, recoverK: rk, hurtK, leanX: lean.x, leanY: lean.y };
  }
  return { state: moving ? 'move' : 'idle', t: -1, windupK: 0, recoverK: 0, hurtK, leanX: lean.x, leanY: lean.y };
}

// ---------------------------------------------------------------------------
// Job silhouettes + swing profiles (the "reads differently" table)
// ---------------------------------------------------------------------------

export interface JobSilhouette {
  /** torso half-width (px @scale 1): knight broad, blader slim */
  torsoHW: number;
  robe: boolean; // arcanist: legs hidden under robe skirt
  shield: number; // 0 none, else shield size scalar
  bladeLen: number; // weapon length px
  bladeW: number; // weapon width px
  staff: boolean; // staff instead of blade
  scarfLen: number; // blader scarf flourish
}

export function jobSilhouette(job: string): JobSilhouette {
  switch (job) {
    case 'knight':
      return { torsoHW: 6, robe: false, shield: 1.25, bladeLen: 11, bladeW: 3, staff: false, scarfLen: 0 };
    case 'blader':
      return { torsoHW: 4, robe: false, shield: 0, bladeLen: 10, bladeW: 2, staff: false, scarfLen: 7 };
    case 'arcanist':
      return { torsoHW: 5, robe: true, shield: 0, bladeLen: 13, bladeW: 2, staff: true, scarfLen: 0 };
    case 'shrine':
      return { torsoHW: 5, robe: false, shield: 0, bladeLen: 12, bladeW: 2, staff: true, scarfLen: 0 };
    case 'watcher':
      return { torsoHW: 6, robe: false, shield: 0, bladeLen: 13, bladeW: 3, staff: false, scarfLen: 0 };
    default:
      return { torsoHW: 5, robe: false, shield: 0, bladeLen: 7, bladeW: 2, staff: false, scarfLen: 0 };
  }
}

export interface SwingProfile {
  /** weapon angle sweep (radians, relative to facing) from swing 0 -> 1 */
  from: number;
  to: number;
  /** ease exponent: >1 = slow raise + fast chop (knight/watcher) */
  ease: number;
  /** second arc for blader double-slash (0 = single) */
  doubleArc: number;
  /** tip radius multiplier */
  tipR: number;
}

export function swingProfile(kind: string): SwingProfile {
  switch (kind) {
    case 'knight':
      return { from: -1.5, to: 0.9, ease: 2.2, doubleArc: 0, tipR: 1.1 };
    case 'watcher':
      return { from: -1.7, to: 0.7, ease: 2.6, doubleArc: 0, tipR: 1.35 };
    case 'blader':
      return { from: -1.2, to: 1.2, ease: 1.0, doubleArc: 1.2, tipR: 1.0 };
    case 'arcanist':
    case 'shrine':
    case 'robe':
      return { from: -0.7, to: 0.7, ease: 1.4, doubleArc: 0, tipR: 0.95 };
    case 'bandit':
      return { from: -1.2, to: 1.0, ease: 1.5, doubleArc: 0, tipR: 0.9 };
    case 'wolf':
      return { from: -0.9, to: 0.9, ease: 1.8, doubleArc: 0, tipR: 0.7 };
    case 'shade':
      return { from: -0.5, to: 0.5, ease: 1.2, doubleArc: 0, tipR: 0.8 };
    default:
      return { from: -1.2, to: 1.0, ease: 1.5, doubleArc: 0, tipR: 1.0 };
  }
}

function easeIn(t: number, exp: number): number {
  return Math.pow(clamp01(t), exp);
}

/** Swing angle (radians, relative to facing) for job-aware weapon arcs. */
export function swingAngle(kind: string, swingT: number): number {
  const pr = swingProfile(kind);
  const t = clamp01(swingT);
  let a = pr.from + (pr.to - pr.from) * easeIn(t, pr.ease);
  if (pr.doubleArc > 0) a += Math.sin(t * Math.PI * 2) * pr.doubleArc * 0.5;
  return a;
}

/**
 * Job-aware weapon tip in world px. Feeds slash-trail sampling (vfx) and
 * matches the drawn weapon arc so trails never detach from the blade.
 */
export function weaponTip(
  x: number, y: number, facing: Facing, swingT: number, scale: number, kind = 'player',
): { x: number; y: number } {
  const cx = x;
  const cy = y - 9 * scale;
  const pr = swingProfile(kind);
  const t = clamp01(Math.max(0, swingT));
  const base = facingAngle(facing);
  const a = base + (pr.from + (pr.to - pr.from) * easeIn(t, pr.ease)) + (pr.doubleArc > 0 ? Math.sin(t * Math.PI * 2) * pr.doubleArc * 0.25 : 0);
  const r = 15 * scale * pr.tipR;
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.9 };
}

/** Skill-cast focus point (staff gem / holy center) for cast FX anchoring. */
export function castFocus(
  x: number, y: number, facing: Facing, castT: number, scale: number, job: string,
): { x: number; y: number; apex: number } {
  const t = clamp01(Math.max(0, castT));
  const lift = Math.sin(t * Math.PI); // 0 -> 1 -> 0
  const base = facingAngle(facing);
  if (job === 'shrine') {
    return { x, y: y - (14 + lift * 5) * scale, apex: lift };
  }
  const r = (10 + lift * 6) * scale;
  return { x: x + Math.cos(base) * r, y: y - 9 * scale + Math.sin(base) * r * 0.7 - lift * 3, apex: lift };
}

// ---------------------------------------------------------------------------
// Stride / footfall sync (walk-cycle-driven dust + squash)
// ---------------------------------------------------------------------------

/** True when the stride sine crossed a footfall boundary this frame. */
export function strideFootfall(prevSin: number, newSin: number, moving: boolean): boolean {
  if (!moving) return false;
  // footfalls at sin = 0 crossings (each half-stride plants a foot)
  return (prevSin <= 0 && newSin > 0) || (prevSin >= 0 && newSin < 0);
}

/** Squash-stretch factor from stride phase: + = stretch, - = squash. */
export function strideSquash(phase: number, moving: boolean): number {
  if (!moving) return 0;
  return Math.cos(phase * 2) * 0.5;
}

/** Per-kind locomotion flavor. Elite is bigger + heavier (slower stride). */
export function enemyStride(kind: string, elite: boolean): { rateMul: number; bobAmp: number; squashAmp: number } {
  if (elite) return { rateMul: 0.7, bobAmp: 2.2, squashAmp: 1.4 };
  switch (kind) {
    case 'slime':
      return { rateMul: 1.15, bobAmp: 1.6, squashAmp: 1.6 };
    case 'wolf':
      return { rateMul: 1.3, bobAmp: 1.4, squashAmp: 0.7 };
    case 'bandit':
      return { rateMul: 1.0, bobAmp: 1.0, squashAmp: 0.8 };
    case 'shade':
      return { rateMul: 0.8, bobAmp: 1.8, squashAmp: 0.4 };
    default:
      return { rateMul: 1.0, bobAmp: 1.0, squashAmp: 1.0 };
  }
}
