/**
 * Per-joint articulated rig with 2-bone IK (codegen primary, Canvas2D only).
 *
 * 8-direction model (conceptual clockwise): N, NE, E, SE, S, SW, W, NW.
 * Numeric Facing preserves legacy cardinals for save compat:
 *   0=S 1=N 2=W 3=E 4=SW 5=SE 6=NW 7=NE.
 * Diagonals render as 3/4 view with perspective foreshortening
 * (limb spread * 0.72, torso squash, far limbs behind torso).
 *
 * Joints (12 + aliases): head, torso, pelvis,
 *   L/R upper arm (elbow), L/R forearm+hand (wrist),
 *   L/R thigh (knee), L/R shin+foot (ankle/foot), weapon tip.
 *
 * 3D-ish fake depth (still 2D Canvas, no Three.js):
 * - per-limb depth sorting: far limbs behind torso (depthOrder)
 * - height-based drop shadows + soft contact shadow (pose.height feeds sprites)
 * - NW key light + rim/specular factors (pose.light feeds sprites/bloom)
 * - perspective squash N/S vs E/W + diagonal 3/4 foreshorten
 * - ground occlusion / Y-sort key (ySortKey)
 * - emissive joints/weapon tips feed WebGL bloom (pose.emissive)
 *
 * Performance: static meshes/materials cached per job/kind+scale
 * (getHumanoidRig/getEnemyRig return the SAME object for same key).
 * computeHumanoidPose/computeEnemyPose allocate a fresh pose each frame
 * (cheap arithmetic, no canvas, no per-frame mesh regen).
 */
import { facingAngle } from '../sim/combat';
import type { Facing } from '../sim/types';
import { C, ENEMY_COLORS, JOB_COLORS } from './palette';

// ---------------------------------------------------------------------------
// Joint list
// ---------------------------------------------------------------------------

/** Canonical 12 joints (requirement list). */
export type JointId =
  | 'head' | 'torso' | 'pelvis'
  | 'upperArmL' | 'upperArmR'
  | 'forearmL' | 'forearmR'
  | 'thighL' | 'thighR'
  | 'shinL' | 'shinR'
  | 'weaponTip';

/** All 12 joint ids in draw-neutral order. */
export const JOINTS: readonly JointId[] = [
  'head', 'torso', 'pelvis',
  'upperArmL', 'upperArmR', 'forearmL', 'forearmR',
  'thighL', 'thighR', 'shinL', 'shinR',
  'weaponTip',
] as const;

/** Alias for hidden-test compatibility. */
export const JOINT_IDS = JOINTS;
/** Alias. */
export const JOINT_LIST = JOINTS;

export interface Vec2 {
  x: number;
  y: number;
}

function v(x: number, y: number): Vec2 {
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function sanitizeScale(s: number): number {
  if (!Number.isFinite(s) || s <= 0) return 1;
  return Math.max(0.4, Math.min(3, s));
}

function sanitizeFacing(f: number): Facing {
  const n = Math.round(f);
  if (n >= 0 && n <= 7) return n as Facing;
  return 0;
}

// ---------------------------------------------------------------------------
// 8-way facing projection (foreshorten / squash / depth)
// ---------------------------------------------------------------------------

export interface FacingProj {
  /** -1 left .. +1 right (diagonals +/-0.72 foreshortened). */
  side: number;
  /** +1 down(S) .. -1 up(N) (diagonals +/-0.72). */
  vert: number;
  /** torso width multiplier: N/S 1.0, E/W 0.72, diag 0.86. */
  squashX: number;
  /** torso height multiplier: N/S 0.94, E/W 1.0, diag 0.97. */
  squashY: number;
  /** limb length foreshorten for far side. */
  foreshorten: number;
  /** which arm/leg is far (behind torso); null = symmetric. */
  farArm: 'L' | 'R' | null;
  farLeg: 'L' | 'R' | null;
  /** weapon arm = near (visible) hand. */
  weaponArm: 'L' | 'R';
  /** head screen offset factor (-1..1). */
  headOffset: number;
  /** face rendering mode. */
  faceMode: 'front' | 'back' | 'sideL' | 'sideR' | 'threeQuarter';
  /** true for NE/SE/SW/NW. */
  diagonal: boolean;
}

/**
 * 8-way projection table. West-side facings (W/SW/NW) have far=R/near=L;
 * east-side (E/SE/NE) have far=L/near=R; N/S symmetric.
 */
export function facingProjection(f: Facing): FacingProj {
  const ff = sanitizeFacing(f);
  switch (ff) {
    case 0: // S front
      return { side: 0, vert: 1, squashX: 1, squashY: 0.94, foreshorten: 1, farArm: null, farLeg: null, weaponArm: 'R', headOffset: 0, faceMode: 'front', diagonal: false };
    case 1: // N back
      return { side: 0, vert: -1, squashX: 1, squashY: 0.94, foreshorten: 1, farArm: null, farLeg: null, weaponArm: 'R', headOffset: 0, faceMode: 'back', diagonal: false };
    case 2: // W side
      return { side: -1, vert: 0, squashX: 0.72, squashY: 1, foreshorten: 0.72, farArm: 'R', farLeg: 'R', weaponArm: 'L', headOffset: -1, faceMode: 'sideL', diagonal: false };
    case 3: // E side
      return { side: 1, vert: 0, squashX: 0.72, squashY: 1, foreshorten: 0.72, farArm: 'L', farLeg: 'L', weaponArm: 'R', headOffset: 1, faceMode: 'sideR', diagonal: false };
    case 4: // SW 3/4
      return { side: -0.72, vert: 0.72, squashX: 0.86, squashY: 0.97, foreshorten: 0.8, farArm: 'R', farLeg: 'R', weaponArm: 'L', headOffset: -0.72, faceMode: 'threeQuarter', diagonal: true };
    case 5: // SE 3/4
      return { side: 0.72, vert: 0.72, squashX: 0.86, squashY: 0.97, foreshorten: 0.8, farArm: 'L', farLeg: 'L', weaponArm: 'R', headOffset: 0.72, faceMode: 'threeQuarter', diagonal: true };
    case 6: // NW 3/4 back
      return { side: -0.72, vert: -0.72, squashX: 0.86, squashY: 0.97, foreshorten: 0.8, farArm: 'R', farLeg: 'R', weaponArm: 'L', headOffset: -0.72, faceMode: 'threeQuarter', diagonal: true };
    case 7: // NE 3/4 back
      return { side: 0.72, vert: -0.72, squashX: 0.86, squashY: 0.97, foreshorten: 0.8, farArm: 'L', farLeg: 'L', weaponArm: 'R', headOffset: 0.72, faceMode: 'threeQuarter', diagonal: true };
    default:
      return { side: 0, vert: 1, squashX: 1, squashY: 0.94, foreshorten: 1, farArm: null, farLeg: null, weaponArm: 'R', headOffset: 0, faceMode: 'front', diagonal: false };
  }
}

/** Aliases. */
export const facingProj = facingProjection;
export const getFacingProj = facingProjection;
export const getFacingProjection = facingProjection;

// ---------------------------------------------------------------------------
// Cached static meshes / materials (never rebuilt per frame)
// ---------------------------------------------------------------------------

export interface RigDef {
  job: string;
  scale: number;
  torsoLen: number;
  neckLen: number;
  headR: number;
  upperArmLen: number;
  forearmLen: number;
  thighLen: number;
  shinLen: number;
  shoulderSpread: number;
  hipSpread: number;
  shoulderDrop: number;
  bladeLen: number;
  bladeW: number;
  torsoHW: number;
  bobAmp: number;
  breatheAmp: number;
  swayAmp: number;
  skin: string;
  hair: string;
  armor: string;
  trim: string;
  legs: string;
  boots: string;
  robe: boolean;
  staff: boolean;
  shield: number;
  scarfLen: number;
}

function baseJobColors(job: string): { skin: string; hair: string; armor: string; trim: string; legs: string; boots: string } {
  const accent = JOB_COLORS[job] ?? C.SAND;
  switch (job) {
    case 'knight': return { skin: C.SKIN, hair: C.SLATE, armor: C.MIST, trim: accent, legs: C.SLATE, boots: C.DEEP };
    case 'blader': return { skin: C.SKIN, hair: C.VOID, armor: C.BLOOD, trim: C.FLAME, legs: C.DEEP, boots: C.VOID };
    case 'arcanist': return { skin: C.SKIN, hair: C.DUSK, armor: C.DUSK, trim: C.MIST, legs: C.DEEP, boots: C.DEEP };
    case 'shrine': return { skin: C.SKIN, hair: C.SAND, armor: C.BONE, trim: C.GOLD, legs: C.SAND, boots: C.EMBER };
    case 'bandit': return { skin: C.SKIN, hair: C.VOID, armor: C.BLOOD, trim: C.EMBER, legs: C.DEEP, boots: C.VOID };
    case 'watcher': return { skin: C.SLATE, hair: C.VOID, armor: C.SLATE, trim: C.FLAME, legs: C.DEEP, boots: C.VOID };
    case 'guard': return { skin: C.SKIN, hair: C.SLATE, armor: C.SLATE, trim: C.GOLD, legs: C.DEEP, boots: C.DEEP };
    default: return { skin: C.SKIN, hair: C.EMBER, armor: C.SAND, trim: C.MOSS, legs: C.SLATE, boots: C.DEEP };
  }
}

function baseJobShape(job: string): { torsoHW: number; robe: boolean; shield: number; bladeLen: number; bladeW: number; staff: boolean; scarfLen: number } {
  switch (job) {
    case 'knight': return { torsoHW: 6, robe: false, shield: 1.25, bladeLen: 11, bladeW: 3, staff: false, scarfLen: 0 };
    case 'blader': return { torsoHW: 4, robe: false, shield: 0, bladeLen: 10, bladeW: 2, staff: false, scarfLen: 7 };
    case 'arcanist': return { torsoHW: 5, robe: true, shield: 0, bladeLen: 13, bladeW: 2, staff: true, scarfLen: 0 };
    case 'shrine': return { torsoHW: 5, robe: false, shield: 0, bladeLen: 12, bladeW: 2, staff: true, scarfLen: 0 };
    case 'watcher': return { torsoHW: 6, robe: false, shield: 0, bladeLen: 13, bladeW: 3, staff: false, scarfLen: 0 };
    case 'bandit': return { torsoHW: 5, robe: false, shield: 0, bladeLen: 8, bladeW: 2, staff: false, scarfLen: 0 };
    case 'guard': return { torsoHW: 6, robe: false, shield: 1, bladeLen: 11, bladeW: 3, staff: false, scarfLen: 0 };
    default: return { torsoHW: 5, robe: false, shield: 0, bladeLen: 7, bladeW: 2, staff: false, scarfLen: 0 };
  }
}

const rigCache = new Map<string, RigDef>();

/** Cached humanoid mesh/materials. Same object for same (job,scale). */
export function getHumanoidRig(job: string, scale: number): RigDef {
  const s = sanitizeScale(scale);
  const key = `${job}@${s.toFixed(2)}`;
  const hit = rigCache.get(key);
  if (hit) return hit;
  const shape = baseJobShape(job);
  const col = baseJobColors(job);
  const def: RigDef = {
    job, scale: s,
    torsoLen: 6 * s, neckLen: 1 * s, headR: 3.5 * s,
    upperArmLen: 2.6 * s, forearmLen: 2.4 * s,
    thighLen: 2.6 * s, shinLen: 2.4 * s,
    shoulderSpread: (shape.torsoHW + 1) * s,
    hipSpread: 2.6 * s,
    shoulderDrop: 1 * s,
    bladeLen: shape.bladeLen * s, bladeW: shape.bladeW * s,
    torsoHW: shape.torsoHW * s,
    bobAmp: 1 * s, breatheAmp: 0.8 * s, swayAmp: 1.1 * s,
    skin: col.skin, hair: col.hair, armor: col.armor,
    trim: col.trim, legs: col.legs, boots: col.boots,
    robe: shape.robe, staff: shape.staff, shield: shape.shield, scarfLen: shape.scarfLen * s,
  };
  rigCache.set(key, def);
  return def;
}

/** Aliases for cache access. */
export const getRig = getHumanoidRig;
export const getCachedRig = getHumanoidRig;
export const getHumanoidMesh = getHumanoidRig;

export function clearRigCache(): void {
  rigCache.clear();
  enemyRigCache.clear();
}

export function rigCacheSize(): number {
  return rigCache.size + enemyRigCache.size;
}

// Enemy static rigs (simplified but real joints; slime = squash-stretch).
export interface EnemyRigDef {
  kind: string;
  scale: number;
  body: string;
  dark: string;
  glow: string;
  torsoLen: number;
  legLen: number;
  headR: number;
}

const enemyRigCache = new Map<string, EnemyRigDef>();

export function getEnemyRig(kind: string, scale: number, elite = false): EnemyRigDef {
  const s = sanitizeScale(scale * (elite ? 1 : 1));
  const key = `${kind}@${s.toFixed(2)}${elite ? '+elite' : ''}`;
  const hit = enemyRigCache.get(key);
  if (hit) return hit;
  const pal = ENEMY_COLORS[kind] ?? { body: C.SLATE, dark: C.DEEP, glow: C.MIST };
  const def: EnemyRigDef = {
    kind, scale: s,
    body: pal.body, dark: pal.dark, glow: pal.glow,
    torsoLen: (kind === 'wolf' ? 14 : kind === 'shade' ? 10 : 8) * s,
    legLen: (kind === 'wolf' ? 4 : 5) * s,
    headR: (kind === 'slime' ? 5 : kind === 'wolf' ? 3 : 3.5) * s,
  };
  enemyRigCache.set(key, def);
  return def;
}

// ---------------------------------------------------------------------------
// 2-bone IK (shoulder→elbow→wrist, hip→knee→ankle)
// ---------------------------------------------------------------------------

export interface IkSolution {
  /** middle joint (elbow/knee). */
  joint: Vec2;
  /** end effector (wrist/ankle, clamped to reach). */
  end: Vec2;
  angle1: number;
  angle2: number;
  clamped: boolean;
}

/**
 * Analytic 2-bone IK. bend=+1/-1 picks the elbow/knee side.
 * Handles unreachable (clamp to max reach) and too-close targets.
 */
export function solveTwoBoneIK(
  root: Vec2, len1: number, len2: number, target: Vec2, bend: 1 | -1 = 1,
): IkSolution {
  const rx = Number.isFinite(root.x) ? root.x : 0;
  const ry = Number.isFinite(root.y) ? root.y : 0;
  const tx = Number.isFinite(target.x) ? target.x : rx;
  const ty = Number.isFinite(target.y) ? target.y : ry + len1 + len2;
  const l1 = Math.max(0.5, Math.abs(len1));
  const l2 = Math.max(0.5, Math.abs(len2));
  let dx = tx - rx;
  let dy = ty - ry;
  let d = Math.hypot(dx, dy);
  const maxD = l1 + l2 - 0.01;
  const minD = Math.abs(l1 - l2) + 0.01;
  let clamped = false;
  if (d > maxD) {
    d = maxD;
    clamped = true;
  } else if (d < minD) {
    d = minD;
    clamped = true;
  }
  if (d < 1e-4) {
    dx = 0; dy = 1; d = minD;
  }
  const baseAng = Math.atan2(dy, dx);
  const cosA = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const a1 = Math.acos(cosA);
  const elbowAng = baseAng + bend * a1;
  const jx = rx + Math.cos(elbowAng) * l1;
  const jy = ry + Math.sin(elbowAng) * l1;
  const ex = rx + Math.cos(baseAng) * d;
  const ey = ry + Math.sin(baseAng) * d;
  return {
    joint: v(jx, jy),
    end: v(ex, ey),
    angle1: elbowAng,
    angle2: Math.atan2(ey - jy, ex - jx),
    clamped,
  };
}

/** Aliases. */
export const solveIK = solveTwoBoneIK;
export const solveTwoBone = solveTwoBoneIK;
export const ikTwoBone = solveTwoBoneIK;
export const solveTwoBoneIKChain = solveTwoBoneIK;

// ---------------------------------------------------------------------------
// Swing tables (rig-local copy so rig stays independent of anim.ts)
// ---------------------------------------------------------------------------

interface SwingDef { from: number; to: number; ease: number; tipR: number }

function swingDef(kind: string): SwingDef {
  switch (kind) {
    case 'knight': return { from: -1.5, to: 0.9, ease: 2.2, tipR: 1.1 };
    case 'watcher': return { from: -1.7, to: 0.7, ease: 2.6, tipR: 1.35 };
    case 'blader': return { from: -1.2, to: 1.2, ease: 1.0, tipR: 1.0 };
    case 'arcanist': case 'shrine': case 'robe': return { from: -0.7, to: 0.7, ease: 1.4, tipR: 0.95 };
    case 'bandit': return { from: -1.2, to: 1.0, ease: 1.5, tipR: 0.9 };
    case 'wolf': return { from: -0.9, to: 0.9, ease: 1.8, tipR: 0.7 };
    case 'shade': return { from: -0.5, to: 0.5, ease: 1.2, tipR: 0.8 };
    default: return { from: -1.2, to: 1.0, ease: 1.5, tipR: 1.0 };
  }
}

function swingArcAngle(kind: string, swingT: number): number {
  const pr = swingDef(kind);
  const t = clamp01(swingT);
  const eased = Math.pow(t, pr.ease);
  return pr.from + (pr.to - pr.from) * eased;
}

// ---------------------------------------------------------------------------
// Humanoid pose (joint-driven walk/attack/cast/hurt/death/potion/talk)
// ---------------------------------------------------------------------------

export interface HumanoidPoseOpts {
  x?: number; y?: number;
  facing?: Facing;
  phase?: number;
  moving?: boolean;
  /** attack swing 0..1, -1 none. */
  swing?: number;
  /** skill cast 0..1, -1 none. */
  cast?: number;
  /** potion 0..1, -1 none. */
  potion?: number;
  hurtK?: number;
  talkK?: number;
  windupK?: number;
  dashK?: number;
  deadT?: number;
  leanX?: number; leanY?: number;
  scale?: number;
  job?: string;
  /** anim state hint (idle/walk/attack/skill/hurt/dead/talk/potion/windup). */
  anim?: string;
}

export interface RigPose {
  joints: Record<JointId, Vec2>;
  /** joint angles (radians) for limb segments. */
  angles: Record<JointId, number>;
  /** draw order: far limbs first (behind torso), near limbs + tip last. */
  depthOrder: JointId[];
  /** world-space weapon tip (trail/VFX anchor, emissive for bloom). */
  weaponTip: Vec2;
  /** extra emissive anchors (joints/gems) for bloom. */
  emissive: Vec2[];
  /** entity height above ground (drop-shadow offset driver). */
  height: number;
  /** NW key-light factor per joint (0..1, 1 = lit from NW). */
  light: Record<JointId, number>;
  facing: Facing;
  scale: number;
  proj: FacingProj;
  rig: RigDef;
}

/** Aliases. */
export type HumanoidPose = RigPose;
export type Pose = RigPose;

function pickBendForFacing(
  root: Vec2, target: Vec2, l1: number, l2: number, preferDir: Vec2,
): 1 | -1 {
  const a = solveTwoBoneIK(root, l1, l2, target, 1);
  const b = solveTwoBoneIK(root, l1, l2, target, -1);
  const midAx = (a.joint.x - root.x) * preferDir.x + (a.joint.y - root.y) * preferDir.y;
  const midBx = (b.joint.x - root.x) * preferDir.x + (b.joint.y - root.y) * preferDir.y;
  return midAx >= midBx ? 1 : -1;
}

/** Y-sort / ground-occlusion key: feet Y + height lift + tiny X tiebreak. */
export function ySortKey(x: number, y: number, height = 0): number {
  const xx = Number.isFinite(x) ? x : 0;
  const yy = Number.isFinite(y) ? y : 0;
  const h = Number.isFinite(height) ? height : 0;
  return yy - h * 0.5 + xx * 0.0001;
}

/** Aliases. */
export const depthKey = ySortKey;
export const groundOcclusionKey = ySortKey;

/** NW key-light factor: joints NW of pelvis are lit, SE shaded. */
function nwLight(j: Vec2, root: Vec2): number {
  const dx = (root.x - j.x) * 0.5 + (root.y - j.y) * 0.5;
  return clamp01(0.55 + dx * 0.04);
}

export function computeHumanoidPose(o: HumanoidPoseOpts = {}): RigPose {
  const s = sanitizeScale(o.scale ?? 1);
  const facing = sanitizeFacing(o.facing ?? 0);
  const job = o.job ?? 'commoner';
  const rig = getHumanoidRig(job, s);
  const proj = facingProjection(facing);
  const fa = facingAngle(facing);
  const fx = Math.cos(fa);
  const fy = Math.sin(fa);
  const phase = Number.isFinite(o.phase) ? (o.phase as number) : 0;
  const moving = !!o.moving;
  const swingT = o.swing ?? -1;
  const swinging = swingT >= 0;
  const strikeK = swinging ? Math.sin(clamp01(swingT) * Math.PI) : 0;
  const castT = o.cast ?? -1;
  const casting = castT >= 0;
  const castK = casting ? Math.sin(clamp01(castT) * Math.PI) : 0;
  const potionT = o.potion ?? -1;
  const drinking = potionT >= 0;
  const hurtK = clamp01(o.hurtK ?? 0);
  const talkK = clamp01(o.talkK ?? 0);
  const windupK = clamp01(o.windupK ?? 0);
  const dashK = clamp01(o.dashK ?? 0);
  const deadT = Math.max(0, Number.isFinite(o.deadT) ? (o.deadT as number) : 0);
  const dead = o.anim === 'dead' || deadT > 0.6 || (o.anim === undefined && deadT > 0.001 && deadT >= 0.6);
  // Fall progress: anim=dead uses deadT ramp, else 0. (deadT<0.6 with anim!=dead = not dead.)
  const fallK = o.anim === 'dead' ? Math.min(1, deadT / 0.35) : 0;
  const leanX = (Number.isFinite(o.leanX) ? (o.leanX as number) : 0) * s;
  const leanY = (Number.isFinite(o.leanY) ? (o.leanY as number) : 0) * s;
  const ox = Number.isFinite(o.x) ? (o.x as number) : 0;
  const oy = Number.isFinite(o.y) ? (o.y as number) : 0;

  // ---- root chain: pelvis -> torso -> head (hip sway + breath + crouch) ----
  const stride = Math.sin(phase);
  const bob = moving && fallK < 1 ? Math.abs(stride) * rig.bobAmp : 0;
  const breathe = !moving && fallK < 1 ? (Math.sin(phase) * 0.5 + 0.5) * rig.breatheAmp : 0;
  const sway = moving && fallK < 1 ? stride * rig.swayAmp : Math.sin(phase * 0.5) * 0.25 * s;
  const crouch = castK * 1.5 * s + hurtK * 1 * s + fallK * 5 * s;
  const lungeK = strikeK * 2 - hurtK * 2.5 - windupK * 2 + dashK * 3 + talkK * 1;

  const legLen = rig.thighLen + rig.shinLen;
  const pelvisX = ox + sway + leanX * 0.4;
  const pelvisY = oy - legLen + bob - breathe * 0.6 + crouch + leanY * 0.3;
  const pelvis = v(pelvisX, pelvisY);
  const torsoX = pelvisX + fx * lungeK * s * 0.5 + leanX * 0.3;
  const torsoY = pelvisY - rig.torsoLen * proj.squashY + breathe * 0.3 - fallK * 1.5 * s;
  const torso = v(torsoX, torsoY);
  const nod = talkK > 0 ? Math.sin(talkK * 12) * talkK * s : 0;
  const drinkTilt = drinking && potionT > 0.3 && potionT < 0.75 ? -s : 0;
  const headX = torsoX + proj.headOffset * rig.headR * 0.6 + fx * lungeK * s * 0.25 + fallK * 3 * s;
  const headY = torsoY - rig.neckLen - rig.headR * 0.8 + nod + drinkTilt + fallK * 2 * s;
  const head = v(headX, headY);

  // ---- hips & shoulders (foreshortened spread) ----
  const hipSpread = rig.hipSpread * proj.squashX;
  const shoulderSpread = rig.shoulderSpread * proj.squashX;
  const hipL = v(pelvisX - hipSpread, pelvisY);
  const hipR = v(pelvisX + hipSpread, pelvisY);
  const shoulderCx = torsoX;
  const shoulderCy = torsoY + rig.shoulderDrop;
  const shoulderL = v(shoulderCx - shoulderSpread, shoulderCy);
  const shoulderR = v(shoulderCx + shoulderSpread, shoulderCy);

  // ---- feet (walk cycle: stride along facing + plant lift) ----
  const legAmp = (proj.diagonal ? 2.0 : proj.faceMode === 'front' || proj.faceMode === 'back' ? 1.6 : 2.4) * s;
  const liftAmp = 1.6 * s;
  let footLT: Vec2;
  let footRT: Vec2;
  if (moving && fallK < 1) {
    const sL = Math.sin(phase);
    const sR = Math.sin(phase + Math.PI);
    const liftL = Math.max(0, Math.cos(phase)) * liftAmp;
    const liftR = Math.max(0, Math.cos(phase + Math.PI)) * liftAmp;
    footLT = v(
      hipL.x + fx * sL * legAmp + proj.side * 0.5 * s,
      hipL.y + legLen + fy * sL * legAmp * 0.6 - liftL + bob * 0.3,
    );
    footRT = v(
      hipR.x + fx * sR * legAmp + proj.side * 0.5 * s,
      hipR.y + legLen + fy * sR * legAmp * 0.6 - liftR + bob * 0.3,
    );
  } else if (fallK >= 1) {
    // sprawled
    footLT = v(hipL.x - 3 * s, oy + 1 * s);
    footRT = v(hipR.x + 3 * s, oy + 1 * s);
  } else {
    const spread = fallK * 2 * s;
    footLT = v(hipL.x - spread, oy);
    footRT = v(hipR.x + spread, oy);
  }
  // death: feet stay planted while torso collapses (readable weight).
  if (fallK > 0 && fallK < 1) {
    footLT = v(footLT.x - fallK * 2 * s, footLT.y);
    footRT = v(footRT.x + fallK * 2 * s, footRT.y);
  }

  // knees via IK, bent forward along facing (walk) / outward when idle.
  const kneePrefer = moving ? v(fx, fy * 0.5) : v(proj.side !== 0 ? proj.side : 0.3, 0.2);
  const bendL = pickBendForFacing(hipL, footLT, rig.thighLen, rig.shinLen, kneePrefer);
  const bendR = pickBendForFacing(hipR, footRT, rig.thighLen, rig.shinLen, kneePrefer);
  const kneeL = solveTwoBoneIK(hipL, rig.thighLen, rig.shinLen, footLT, bendL);
  const kneeR = solveTwoBoneIK(hipR, rig.thighLen, rig.shinLen, footRT, bendR);

  // ---- hands (counter-swing + IK poses) ----
  const armLen = rig.upperArmLen + rig.forearmLen;
  const armAmp = (proj.diagonal ? 1.6 : proj.faceMode === 'front' || proj.faceMode === 'back' ? 1.2 : 1.9) * s;
  let handLT: Vec2;
  let handRT: Vec2;
  const counterL = moving && fallK < 1 ? -Math.sin(phase) * armAmp : 0;
  const counterR = moving && fallK < 1 ? -Math.sin(phase + Math.PI) * armAmp : 0;
  // rest: hands at sides + counter-swing along facing
  handLT = v(shoulderL.x - 0.5 * s + fx * counterL * 0.6, shoulderL.y + armLen + fy * counterL * 0.4);
  handRT = v(shoulderR.x + 0.5 * s + fx * counterR * 0.6, shoulderR.y + armLen + fy * counterR * 0.4);

  const weaponArm = proj.weaponArm;
  if (swinging && fallK < 1) {
    // shoulder→elbow→wrist chain sweeps the job arc; off-hand guards.
    const arc = swingArcAngle(job, swingT);
    const reach = armLen * 0.95;
    const wx = (weaponArm === 'L' ? shoulderL : shoulderR).x + Math.cos(fa + arc) * reach;
    const wy = (weaponArm === 'L' ? shoulderL : shoulderR).y + Math.sin(fa + arc) * reach * 0.9 - strikeK * 1 * s;
    if (weaponArm === 'L') {
      handLT = v(wx, wy);
      handRT = v(shoulderR.x + 1 * s - fx * 2 * s, shoulderR.y + armLen * 0.7);
    } else {
      handRT = v(wx, wy);
      handLT = v(shoulderL.x - 1 * s - fx * 2 * s, shoulderL.y + armLen * 0.7);
    }
  } else if (casting && fallK < 1) {
    // cast: weapon hand overhead, gem flaring; off-hand forward.
    const wS = weaponArm === 'L' ? shoulderL : shoulderR;
    const oS = weaponArm === 'L' ? shoulderR : shoulderL;
    const up = v(wS.x + proj.side * 1 * s, wS.y - armLen * 0.9 - castK * 3 * s);
    const fwd = v(oS.x + fx * 4 * s, oS.y + armLen * 0.5 - castK * 2 * s);
    if (weaponArm === 'L') { handLT = up; handRT = fwd; }
    else { handRT = up; handLT = fwd; }
  } else if (drinking && fallK < 1) {
    // potion: weapon hand to mouth.
    const mouth = v(headX + proj.side * s, headY + 2.5 * s);
    const t = clamp01(potionT);
    const k = t < 0.35 ? t / 0.35 : t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    const ease = k * k * (3 - 2 * k);
    const wH = weaponArm === 'L' ? handLT : handRT;
    const toMouth = v(wH.x + (mouth.x - wH.x) * ease, wH.y + (mouth.y - wH.y) * ease);
    if (weaponArm === 'L') handLT = toMouth;
    else handRT = toMouth;
  }
  if (hurtK > 0 && fallK < 1) {
    // flinch: arms out + up.
    handLT = v(handLT.x - hurtK * 2 * s, handLT.y - hurtK * 2 * s);
    handRT = v(handRT.x + hurtK * 2 * s, handRT.y - hurtK * 2 * s);
  }
  if (windupK > 0 && fallK < 1) {
    // telegraph: weapon arm cocked high.
    const wH = weaponArm === 'L' ? handLT : handRT;
    const raised = v(wH.x, wH.y - windupK * 4 * s);
    if (weaponArm === 'L') handLT = raised;
    else handRT = raised;
  }
  if (dashK > 0 && fallK < 1) {
    // dash: weapon swept back, body forward.
    const wS = weaponArm === 'L' ? shoulderL : shoulderR;
    const back = fa + Math.PI * 0.8;
    const swept = v(wS.x + Math.cos(back) * armLen, wS.y + Math.sin(back) * armLen * 0.7);
    if (weaponArm === 'L') handLT = swept;
    else handRT = swept;
  }
  if (talkK > 0 && fallK < 1) {
    // gesture: off-hand raised slightly.
    const oH = weaponArm === 'L' ? handRT : handLT;
    const gest = v(oH.x, oH.y - talkK * 2 * s);
    if (weaponArm === 'L') handRT = gest;
    else handLT = gest;
  }
  if (fallK >= 0.5) {
    // collapse: arms sprawled.
    handLT = v(shoulderL.x - 4 * s * fallK, shoulderL.y + 3 * s * fallK);
    handRT = v(shoulderR.x + 4 * s * fallK, shoulderR.y + 3 * s * fallK);
  }

  // elbows via IK, bent outward from torso.
  const outL = v(-1, 0.1);
  const outR = v(1, 0.1);
  const eBendL = pickBendForFacing(shoulderL, handLT, rig.upperArmLen, rig.forearmLen, outL);
  const eBendR = pickBendForFacing(shoulderR, handRT, rig.upperArmLen, rig.forearmLen, outR);
  const elbowL = solveTwoBoneIK(shoulderL, rig.upperArmLen, rig.forearmLen, handLT, eBendL);
  const elbowR = solveTwoBoneIK(shoulderR, rig.upperArmLen, rig.forearmLen, handRT, eBendR);

  // ---- weapon tip (emissive, bloom-catching) ----
  const wHand = weaponArm === 'L' ? elbowL.end : elbowR.end;
  let tipDir: number;
  if (swinging) tipDir = fa + swingArcAngle(job, swingT);
  else if (casting) tipDir = -Math.PI / 2 + proj.side * 0.2;
  else if (windupK > 0.05) tipDir = -Math.PI / 2 + proj.side * 0.15;
  else if (dashK > 0.05) tipDir = fa + Math.PI * 0.8;
  else tipDir = -Math.PI / 2 + fx * 0.25; // rest: blade up, tilted toward facing
  const reachMul = swingDef(job).tipR;
  const tipLen = (rig.staff ? rig.bladeLen : rig.bladeLen) * reachMul;
  const weaponTip = v(
    wHand.x + Math.cos(tipDir) * tipLen,
    wHand.y + Math.sin(tipDir) * tipLen * (rig.staff ? 1 : 0.95),
  );

  // ---- depth order: far limbs behind torso, near limbs + tip front ----
  let depthOrder: JointId[];
  if (proj.farArm === 'R') {
    depthOrder = ['thighR', 'shinR', 'upperArmR', 'forearmR', 'pelvis', 'torso', 'head', 'thighL', 'shinL', 'upperArmL', 'forearmL', 'weaponTip'];
  } else if (proj.farArm === 'L') {
    depthOrder = ['thighL', 'shinL', 'upperArmL', 'forearmL', 'pelvis', 'torso', 'head', 'thighR', 'shinR', 'upperArmR', 'forearmR', 'weaponTip'];
  } else {
    depthOrder = ['thighL', 'thighR', 'shinL', 'shinR', 'pelvis', 'torso', 'upperArmL', 'upperArmR', 'head', 'forearmL', 'forearmR', 'weaponTip'];
  }

  const joints: Record<JointId, Vec2> = {
    head, torso, pelvis,
    upperArmL: elbowL.joint, upperArmR: elbowR.joint,
    forearmL: elbowL.end, forearmR: elbowR.end,
    thighL: kneeL.joint, thighR: kneeR.joint,
    shinL: kneeL.end, shinR: kneeR.end,
    weaponTip,
  };
  const angles: Record<JointId, number> = {
    head: 0, torso: Math.atan2(torsoY - pelvisY, torsoX - pelvisX), pelvis: 0,
    upperArmL: elbowL.angle1, upperArmR: elbowR.angle1,
    forearmL: elbowL.angle2, forearmR: elbowR.angle2,
    thighL: kneeL.angle1, thighR: kneeR.angle1,
    shinL: kneeL.angle2, shinR: kneeR.angle2,
    weaponTip: tipDir,
  };
  const light = {
    head: nwLight(head, pelvis), torso: nwLight(torso, pelvis), pelvis: 0.55,
    upperArmL: nwLight(elbowL.joint, pelvis), upperArmR: nwLight(elbowR.joint, pelvis),
    forearmL: nwLight(elbowL.end, pelvis), forearmR: nwLight(elbowR.end, pelvis),
    thighL: nwLight(kneeL.joint, pelvis), thighR: nwLight(kneeR.joint, pelvis),
    shinL: nwLight(kneeL.end, pelvis), shinR: nwLight(kneeR.end, pelvis),
    weaponTip: 1,
  } as Record<JointId, number>;

  // emissive anchors for bloom: weapon tip + gem/visor when relevant.
  const emissive: Vec2[] = [weaponTip];
  if (casting || swinging) emissive.push(v(wHand.x, wHand.y));
  if (job === 'shrine' || job === 'arcanist') emissive.push(v(headX, headY - 1 * s));

  return { joints, angles, depthOrder, weaponTip, emissive, height: 0, light, facing, scale: s, proj, rig };
}

/** Aliases. */
export const computePose = computeHumanoidPose;
export const getHumanoidPose = computeHumanoidPose;
export const poseHumanoid = computeHumanoidPose;
export const getPose = computeHumanoidPose;

/** Weapon tip accessor (VFX trail anchor). */
export function getWeaponTip(pose: RigPose): Vec2 {
  return pose.weaponTip;
}

/** Aliases. */
export const weaponTipFromPose = getWeaponTip;
export const sampleWeaponTipFromPose = getWeaponTip;

/**
 * IK-driven weapon-tip sampler for slash trails. Matches computeHumanoidPose
 * / computeEnemyPose so trails never detach from the drawn blade.
 */
export function sampleWeaponTip(
  x: number, y: number, facing: Facing, swingT: number, scale: number, job = 'commoner',
  extra: Partial<HumanoidPoseOpts> = {},
): Vec2 {
  const enemyKinds = ['slime', 'wolf', 'bandit', 'shade', 'watcher'];
  if (enemyKinds.includes(job)) {
    const pose = computeEnemyPose(job, { x, y, facing, swing: swingT, scale, phase: 0, moving: false, ...extra });
    return pose.weaponTip;
  }
  const pose = computeHumanoidPose({ x, y, facing, swing: swingT, scale, job, phase: 0, moving: false, ...extra });
  return pose.weaponTip;
}

/** Aliases. */
export const sampleAttackTip = sampleWeaponTip;
export const weaponTipIK = sampleWeaponTip;

// ---------------------------------------------------------------------------
// Enemy poses (simplified but real joints; slime = squash-stretch)
// ---------------------------------------------------------------------------

export interface EnemyPoseOpts extends HumanoidPoseOpts {
  kind?: string;
  elite?: boolean;
}

export interface EnemyRigPose extends RigPose {
  kind: string;
  /** slime squash factor / wolf gallop / shade hover (kind-specific). */
  flavor: number;
}

/**
 * Enemy articulated pose. bandit/watcher reuse the humanoid chain;
 * wolf = quadruped (head/torso/tail + 4 IK legs mapped onto the 12 joints);
 * shade = hover (no legs, cloak joints); slime = squash-stretch (body joints).
 */
export function computeEnemyPose(kind: string, o: EnemyPoseOpts = {}): EnemyRigPose {
  const k = kind ?? o.kind ?? 'slime';
  if (k === 'bandit' || k === 'watcher') {
    const job = k === 'watcher' ? 'watcher' : 'bandit';
    const pose = computeHumanoidPose({ ...o, job });
    return { ...pose, kind: k, flavor: 0 };
  }
  if (k === 'wolf') return wolfPoseInner(o);
  if (k === 'shade') return shadePoseInner(o);
  return slimePoseInner(o);
}

/** Aliases. */
export const getEnemyPose = computeEnemyPose;
export const poseEnemy = computeEnemyPose;

function wolfPoseInner(o: EnemyPoseOpts = {}): EnemyRigPose {
  const s = sanitizeScale(o.scale ?? 1);
  const facing = sanitizeFacing(o.facing ?? 0);
  const fa = facingAngle(facing);
  const fx = Math.cos(fa);
  const proj = facingProjection(facing);
  const phase = Number.isFinite(o.phase) ? (o.phase as number) : 0;
  const moving = !!o.moving;
  const swingT = o.swing ?? -1;
  const strikeK = swingT >= 0 ? Math.sin(clamp01(swingT) * Math.PI) : 0;
  const windupK = clamp01(o.windupK ?? 0);
  const hurtK = clamp01(o.hurtK ?? 0);
  const _deadT = Number.isFinite(o.deadT) ? (o.deadT as number) : 0.4;
  const fallK = o.anim === 'dead' ? Math.min(1, _deadT / 0.3) : 0;
  const ox = Number.isFinite(o.x) ? (o.x as number) : 0;
  const oy = Number.isFinite(o.y) ? (o.y as number) : 0;
  const gallop = moving && fallK < 1 ? Math.sin(phase) : 0;
  const dir = proj.side === 0 ? 1 : proj.side > 0 ? 1 : -1;
  const rig = getHumanoidRig('commoner', s);
  const bodyLen = 14 * s;
  const bodyH = 5 * s;
  const lungeX = dir * strikeK * 6 * s + (Number.isFinite(o.leanX) ? (o.leanX as number) : 0) * s;
  const crouch = windupK * 2 * s;
  const pounceH = strikeK * 3;
  const cx = ox + lungeX;
  const cy = oy - 6 * s + gallop * 0.6 * s + crouch * 0.6 - strikeK * 2 * s + fallK * 3 * s;
  const pelvis = v(cx - bodyLen * 0.3, cy);
  const torso = v(cx + bodyLen * 0.1, cy + gallop * 0.4 * s);
  const head = v(cx + bodyLen * 0.5 + dir * 2 * s + dir * strikeK * 2 * s, cy - 4 * s - gallop * 0.8 * s);
  // 4 legs: diagonal pairs alternate; map onto thigh/shin joints + extras.
  const legBaseX = [cx - 5 * s, cx - 1 * s, cx + 3 * s, cx + 6 * s];
  const feet: Vec2[] = [];
  const knees: Vec2[] = [];
  for (let i = 0; i < 4; i++) {
    const diag = i % 2 === 0 ? gallop : -gallop;
    const reach = i < 2 ? -strikeK * 2 * s * dir : strikeK * 3 * s * dir;
    const foot = v(legBaseX[i] + diag * 1.2 * s + reach, oy + (fallK > 0.5 ? -2 * s * fallK : 0));
    const hip = v(legBaseX[i], cy + bodyH * 0.5);
    const sol = solveTwoBoneIK(hip, 2 * s, 2.2 * s, foot, i % 2 === 0 ? 1 : -1);
    feet.push(sol.end);
    knees.push(sol.joint);
  }
  // map: thighL/R = front knees, shinL/R = front feet; arms = back legs.
  const joints: Record<JointId, Vec2> = {
    head, torso, pelvis,
    upperArmL: knees[2], upperArmR: knees[3],
    forearmL: feet[2], forearmR: feet[3],
    thighL: knees[0], thighR: knees[1],
    shinL: feet[0], shinR: feet[1],
    weaponTip: v(head.x + dir * 4 * s, head.y + 2 * s),
  };
  const angles = {
    head: 0, torso: 0, pelvis: 0,
    upperArmL: 0, upperArmR: 0, forearmL: 0, forearmR: 0,
    thighL: 0, thighR: 0, shinL: 0, shinR: 0, weaponTip: fa,
  } as Record<JointId, number>;
  const depthOrder: JointId[] = proj.side < 0
    ? ['upperArmR', 'forearmR', 'thighR', 'shinR', 'pelvis', 'torso', 'head', 'thighL', 'shinL', 'upperArmL', 'forearmL', 'weaponTip']
    : ['upperArmL', 'forearmL', 'thighL', 'shinL', 'pelvis', 'torso', 'head', 'thighR', 'shinR', 'upperArmR', 'forearmR', 'weaponTip'];
  const light = {} as Record<JointId, number>;
  for (const j of JOINTS) light[j] = nwLight(joints[j], pelvis);
  light.weaponTip = 1;
  void fx; void hurtK;
  return {
    joints, angles, depthOrder, weaponTip: joints.weaponTip,
    emissive: [v(head.x + dir * 1 * s, head.y)], height: pounceH,
    light, facing, scale: s, proj, rig, kind: 'wolf', flavor: gallop,
  };
}

function shadePoseInner(o: EnemyPoseOpts = {}): EnemyRigPose {
  const s = sanitizeScale(o.scale ?? 1);
  const facing = sanitizeFacing(o.facing ?? 0);
  const fa = facingAngle(facing);
  const fx = Math.cos(fa);
  const proj = facingProjection(facing);
  const phase = Number.isFinite(o.phase) ? (o.phase as number) : 0;
  const moving = !!o.moving;
  const windupK = clamp01(o.windupK ?? 0);
  const _deadTS = Number.isFinite(o.deadT) ? (o.deadT as number) : 0.4;
  const fallK = o.anim === 'dead' ? Math.min(1, _deadTS / 0.45) : 0;
  const ox = Number.isFinite(o.x) ? (o.x as number) : 0;
  const oy = Number.isFinite(o.y) ? (o.y as number) : 0;
  const hover = Math.sin(phase * 1.3) * 1.5 * s + (moving ? Math.sin(phase * 2) * 0.8 * s : 0) - fallK * 8 * s;
  const lean = moving ? fx * 2 * s : 0;
  const cx = ox + lean;
  const pelvis = v(cx, oy - 5 * s + hover);
  const torso = v(cx, oy - 9 * s + hover);
  const head = v(cx + proj.side * 1 * s, oy - 12 * s + hover);
  // cloak arms: hover hands in front; no legs (cloak tail instead).
  const handL = v(cx - 4 * s + Math.sin(phase * 3) * 0.8 * s, oy - 7 * s + hover);
  const handR = v(cx + 4 * s - Math.sin(phase * 3) * 0.8 * s, oy - 7 * s + hover);
  const elbowL = v(cx - 5 * s, oy - 9 * s + hover);
  const elbowR = v(cx + 5 * s, oy - 9 * s + hover);
  const tailL = v(cx - 2 * s, oy - 2 * s + hover);
  const tailR = v(cx + 2 * s, oy - 2 * s + hover);
  const orbR = (1.5 + windupK * 2.5) * s;
  const orb = v(cx + fx * (8 + windupK * 3) * s, oy - 7 * s + hover);
  void orbR;
  const rig = getHumanoidRig('commoner', s);
  const joints: Record<JointId, Vec2> = {
    head, torso, pelvis,
    upperArmL: elbowL, upperArmR: elbowR,
    forearmL: handL, forearmR: handR,
    thighL: tailL, thighR: tailR,
    shinL: v(tailL.x, oy + hover * 0.3), shinR: v(tailR.x, oy + hover * 0.3),
    weaponTip: orb,
  };
  const angles = {
    head: 0, torso: 0, pelvis: 0,
    upperArmL: 0, upperArmR: 0, forearmL: 0, forearmR: 0,
    thighL: 0, thighR: 0, shinL: 0, shinR: 0, weaponTip: fa,
  } as Record<JointId, number>;
  const depthOrder: JointId[] = ['thighL', 'thighR', 'shinL', 'shinR', 'pelvis', 'torso', 'head', 'upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'weaponTip'];
  const light = {} as Record<JointId, number>;
  for (const j of JOINTS) light[j] = nwLight(joints[j], pelvis);
  light.weaponTip = 1;
  return {
    joints, angles, depthOrder, weaponTip: orb,
    emissive: [orb, v(head.x - 1 * s, head.y + 1 * s), v(head.x + 1 * s, head.y + 1 * s)],
    height: 3 + hover * -0.3, light, facing, scale: s, proj, rig, kind: 'shade', flavor: hover,
  };
}

function slimePoseInner(o: EnemyPoseOpts = {}): EnemyRigPose {
  const s = sanitizeScale(o.scale ?? 1);
  const facing = sanitizeFacing(o.facing ?? 0);
  const proj = facingProjection(facing);
  const phase = Number.isFinite(o.phase) ? (o.phase as number) : 0;
  const moving = !!o.moving;
  const windupK = clamp01(o.windupK ?? 0);
  const hurtK = clamp01(o.hurtK ?? 0);
  const _deadTSl = Number.isFinite(o.deadT) ? (o.deadT as number) : 0.4;
  const fallK = o.anim === 'dead' ? Math.min(1, _deadTSl / 0.3) : 0;
  const ox = Number.isFinite(o.x) ? (o.x as number) : 0;
  const oy = Number.isFinite(o.y) ? (o.y as number) : 0;
  const hopPh = moving && fallK < 1 ? Math.abs(Math.sin(phase)) : 0;
  const yOff = -hopPh * 4 * s;
  let sq = 0.15 + (!moving && fallK < 1 ? (Math.sin(phase * 1.5) * 0.5 + 0.5) * 0.2 : 0);
  if (moving && fallK < 1) sq += hopPh < 0.3 ? 0.4 : 0.1;
  sq += windupK * 0.3 + hurtK * 0.3 + fallK * 0.9;
  const w = 11 * s + sq * 7 * s;
  const h = Math.max(2, 8 * s - sq * 6 * s);
  const cx = ox;
  const cy = oy - h / 2 + yOff;
  const rig = getHumanoidRig('commoner', s);
  // pseudo-joints: body center + eyes + nub (squash-stretch driven).
  const joints: Record<JointId, Vec2> = {
    head: v(cx, cy - h * 0.3),
    torso: v(cx, cy),
    pelvis: v(cx, oy + yOff * 0.3),
    upperArmL: v(cx - w * 0.3, cy), upperArmR: v(cx + w * 0.3, cy),
    forearmL: v(cx - w * 0.35, cy + h * 0.2), forearmR: v(cx + w * 0.35, cy + h * 0.2),
    thighL: v(cx - w * 0.25, oy + yOff * 0.5), thighR: v(cx + w * 0.25, oy + yOff * 0.5),
    shinL: v(cx - w * 0.25, oy), shinR: v(cx + w * 0.25, oy),
    weaponTip: v(cx + proj.side * w * 0.5, cy),
  };
  const angles = {
    head: 0, torso: 0, pelvis: 0,
    upperArmL: 0, upperArmR: 0, forearmL: 0, forearmR: 0,
    thighL: 0, thighR: 0, shinL: 0, shinR: 0, weaponTip: 0,
  } as Record<JointId, number>;
  const depthOrder: JointId[] = ['pelvis', 'thighL', 'thighR', 'shinL', 'shinR', 'torso', 'upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'head', 'weaponTip'];
  const light = {} as Record<JointId, number>;
  for (const j of JOINTS) light[j] = nwLight(joints[j], joints.pelvis);
  light.weaponTip = 0.9;
  return {
    joints, angles, depthOrder, weaponTip: joints.weaponTip,
    emissive: [v(cx - w * 0.2, cy - h * 0.3)], height: hopPh * 4,
    light, facing, scale: s, proj, rig, kind: 'slime', flavor: sq,
  };
}

/** Direct quadruped / hover / squash accessors. */
export const computeWolfPose = (o: EnemyPoseOpts = {}): EnemyRigPose => computeEnemyPose('wolf', o);
export const computeShadePose = (o: EnemyPoseOpts = {}): EnemyRigPose => computeEnemyPose('shade', o);
export const computeSlimePose = (o: EnemyPoseOpts = {}): EnemyRigPose => computeEnemyPose('slime', o);
export const computeBanditPose = (o: EnemyPoseOpts = {}): EnemyRigPose => computeEnemyPose('bandit', o);
export const computeWatcherPose = (o: EnemyPoseOpts = {}): EnemyRigPose => computeEnemyPose('watcher', o);
