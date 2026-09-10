import { facingAngle } from '../sim/combat';
import { C, OUTLINE, JOB_COLORS, ENEMY_COLORS } from './palette';
import { jobSilhouette, strideSquash, swingAngle } from './anim';

/** Facing: 0=down, 1=up, 2=left, 3=right */
export type Facing = 0 | 1 | 2 | 3;

/** Animation state hint (interpreted from sim timers by art/anim.ts). */
export type AnimState =
  | 'idle' | 'walk' | 'move' | 'attack' | 'skill' | 'hurt'
  | 'dead' | 'talk' | 'potion' | 'windup';

export interface BodyOpts {
  x: number; // center-bottom (feet) in world px
  y: number;
  facing: Facing;
  /** walk cycle phase in radians */
  phase: number;
  /** moving? (drives leg swing) */
  moving: boolean;
  /** attack swing 0..1 progress, -1 = none */
  swing: number;
  /** hurt flash */
  flash: boolean;
  /** render scale (elite = 1.6) */
  scale: number;
  /** night dim 0..1 */
  dim: number;
  // ---- extended rig pose (all optional; defaults = legacy behavior) ----
  /** animation state from art/anim.ts */
  anim?: AnimState | string;
  /** normalized pose progress 0..1 (-1 when n/a) */
  stateT?: number;
  /** skill cast 0..1 progress, -1 = none */
  cast?: number;
  /** potion drink 0..1 progress, -1 = none */
  potion?: number;
  /** talk pose 0..1 (1 = fresh) */
  talkK?: number;
  /** seconds since death (death-pose driver) */
  deadT?: number;
  /** 1 = just hit, fades to 0 (hurt lean driver) */
  hurtK?: number;
  /** knockback lean in px */
  leanX?: number;
  leanY?: number;
  /** enemy telegraph 0..1 */
  windupK?: number;
  /** enemy recover follow-through 0..1 */
  recoverK?: number;
  /** dash lean 0..1 (commoner/knight skill) */
  dashK?: number;
  /** swing-profile override (e.g. watcher uses knight body + watcher arc) */
  profile?: string;
}

function R(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
}

export function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, height = 0): void {
  // NW key light => shadows fall to SE. Higher objects offset further + fade.
  const dx = 2 + height * 0.45;
  const dy = 1 + height * 0.22;
  const alpha = Math.max(0.12, 0.35 - height * 0.022);
  const rr = Math.max(1.5, r * (1 - height * 0.015));
  ctx.fillStyle = `rgba(16,24,40,${alpha.toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(Math.round(x + dx), Math.round(y + dy), rr, Math.max(2, rr * 0.38), 0, 0, Math.PI * 2);
  ctx.fill();
}

interface HumanoidColors {
  skin: string;
  hair: string;
  armor: string;
  trim: string;
  legs: string;
  boots: string;
}

function jobColors(job: string): HumanoidColors {
  const accent = JOB_COLORS[job] ?? C.SAND;
  switch (job) {
    case 'knight':
      return { skin: C.SKIN, hair: C.SLATE, armor: C.MIST, trim: accent, legs: C.SLATE, boots: C.DEEP };
    case 'blader':
      return { skin: C.SKIN, hair: C.VOID, armor: C.BLOOD, trim: C.FLAME, legs: C.DEEP, boots: C.VOID };
    case 'arcanist':
      return { skin: C.SKIN, hair: C.DUSK, armor: C.DUSK, trim: C.MIST, legs: C.DEEP, boots: C.DEEP };
    case 'shrine':
      return { skin: C.SKIN, hair: C.SAND, armor: C.BONE, trim: C.GOLD, legs: C.SAND, boots: C.EMBER };
    default:
      return { skin: C.SKIN, hair: C.EMBER, armor: C.SAND, trim: C.MOSS, legs: C.SLATE, boots: C.DEEP };
  }
}

type Extras = 'none' | 'knight' | 'blader' | 'arcanist' | 'shrine' | 'bandit' | 'guard' | 'robe' | 'merchant' | 'watcher';

function extrasJob(e: Extras): string {
  if (e === 'guard') return 'knight';
  if (e === 'robe') return 'arcanist';
  if (e === 'merchant') return 'commoner';
  return e;
}

/**
 * Angled weapon shaft drawn as stepped pixel rects (keeps the crisp pixel
 * look — no canvas rotation). Hand at (hx,hy), angle in screen radians.
 */
function shaft(
  ctx: CanvasRenderingContext2D,
  hx: number, hy: number, angle: number, len: number, w: number,
  outline: string, fill: string,
): { tx: number; ty: number } {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const steps = Math.max(2, Math.round(len / 2));
  for (let i = 1; i <= steps; i++) {
    const d = (i / steps) * len;
    const x = hx + dx * d;
    const y = hy + dy * d;
    R(ctx, x - w / 2 - 0.5, y - 1.2, w + 1, 2.4, outline);
    R(ctx, x - w / 2, y - 0.8, w, 1.6, fill);
  }
  return { tx: hx + dx * len, ty: hy + dy * len };
}

/** Parametric top-down-ish humanoid. Feet at (x,y). Height ~17*s.
 * Rigged: idle breathe, facing-aware stride, squash-stretch, job swing arcs,
 * cast/potion/talk poses, hurt lean, death crumple. All offsets are cheap
 * arithmetic on the same rect budget as the legacy body (no per-frame
 * canvases; static palette rects stay inline for the JIT to fold).
 */
export function drawHumanoid(
  ctx: CanvasRenderingContext2D,
  o: BodyOpts,
  col: HumanoidColors,
  extras: Extras,
): void {
  const s = o.scale;
  const px = (n: number): number => n * s;
  const sil = jobSilhouette(extrasJob(extras));
  const profile = o.profile ?? extrasJob(extras);
  const anim = o.anim ?? (o.swing >= 0 ? 'attack' : o.moving ? 'walk' : 'idle');
  const dead = anim === 'dead';
  const fallK = dead ? Math.min(1, (o.deadT ?? 0.3) / 0.35) : 0;

  const side = o.facing === 2 ? -1 : o.facing === 3 ? 1 : 0;
  const up = o.facing === 1;
  const fx = o.facing === 2 ? -1 : o.facing === 3 ? 1 : 0;
  const fy = o.facing === 0 ? 1 : o.facing === 1 ? -1 : 0;

  // ---- pose drivers (all 0..1) ----
  const swingT = o.swing >= 0 ? Math.min(1, o.swing) : -1;
  const swinging = swingT >= 0;
  const strikeK = swinging ? Math.sin(swingT * Math.PI) : 0; // 0->1->0
  const castT = o.cast ?? -1;
  const castK = castT >= 0 ? Math.sin(Math.min(1, castT) * Math.PI) : 0;
  const casting = castT >= 0;
  const potionT = o.potion ?? -1;
  const drinking = potionT >= 0;
  const talkK = o.talkK ?? 0;
  const hurtK = o.hurtK ?? 0;
  const windupK = o.windupK ?? 0;
  const dashK = o.dashK ?? 0;

  // ---- root + stride ----
  const stride = Math.sin(o.phase);
  const sideView = o.facing === 2 || o.facing === 3;
  const legAmp = (sideView ? 2.2 : 1.4) * (dead ? 0 : 1);
  const armAmp = (sideView ? 1.8 : 1.2) * (dead ? 0 : 1);
  const legSwing = o.moving && !dead ? stride * legAmp : 0;
  const armSwing = o.moving && !dead ? -stride * armAmp : 0;
  const bob = o.moving && !dead ? Math.abs(stride) * 1 : 0;
  const breathe = !o.moving && !dead ? (Math.sin(o.phase) * 0.5 + 0.5) : 0; // 0..1 chest lift
  const sq = !dead ? strideSquash(o.phase, o.moving) : 0; // +stretch / -squash
  const sqPx = Math.round(sq * 1.2);
  const crouch = castK * 1.5 + hurtK * 1 + fallK * 5;

  const leanX = (o.leanX ?? 0) * s;
  const leanY = (o.leanY ?? 0) * s;
  // upper-body tactical offsets (feet stay planted => readable weight shifts)
  const lungeK = strikeK * 2 - hurtK * 2.5 - windupK * 2 + dashK * 3 + talkK * 1;
  const lx = fx * lungeK * s + leanX;
  const ly = fy * (strikeK * 1.5 - hurtK * 2 + dashK * 1) * s + leanY * 0.5;

  const cx = o.x + leanX * 0.4;
  const feet = o.y + leanY * 0.3;
  const top = feet - px(17) + px(bob) - px(breathe) * 0.8 + px(crouch) - sqPx * s;
  const flash = o.flash ? C.BONE : null;
  const wide = Math.round((-sqPx + hurtK * 1 + castK * 0.5 + fallK * 2) * s);

  // ================= legs / robe =================
  if (sil.robe && !dead) {
    // arcanist robe skirt (legs hidden): sway reads the stride instead
    const sway = o.moving ? Math.round(stride * px(1)) : 0;
    const skirtH = px(7);
    R(ctx, cx - px(5) + sway * 0.3, feet - skirtH + px(bob), px(10), skirtH, flash ?? OUTLINE);
    R(ctx, cx - px(4) + sway * 0.3, feet - skirtH + px(bob), px(8), skirtH - 1, flash ?? col.armor);
    R(ctx, cx - px(4) + sway, feet - px(2), px(3), px(2), flash ?? col.armor);
    R(ctx, cx + px(1) - sway, feet - px(2), px(3), px(2), flash ?? col.armor);
    R(ctx, cx - px(3), feet - skirtH + px(bob), px(1), skirtH - 1, flash ?? col.trim);
  } else {
    const spread = dead ? Math.round(fallK * px(2)) : 0;
    const legH = Math.max(1, px(5) - px(bob) - px(fallK * 2.5));
    const legTop = feet - px(5) + px(bob) + px(fallK * 2.5);
    const lsw = Math.round(legSwing * s);
    R(ctx, cx - px(4) - spread, legTop, px(3), legH, flash ?? OUTLINE);
    R(ctx, cx + px(1) + spread, legTop, px(3), legH, flash ?? OUTLINE);
    R(ctx, cx - px(4) - spread + lsw * 0.4, legTop, px(3), Math.max(1, legH - px(2)), flash ?? col.legs);
    R(ctx, cx + px(1) + spread - lsw * 0.4, legTop, px(3), Math.max(1, legH - px(2)), flash ?? col.legs);
    // boots
    R(ctx, cx - px(4) - spread + lsw * 0.4, feet - px(2), px(3), px(2), flash ?? col.boots);
    R(ctx, cx + px(1) + spread - lsw * 0.4, feet - px(2), px(3), px(2), flash ?? col.boots);
  }

  // ================= torso =================
  const hw = sil.torsoHW + wide * 0.4;
  const torsoY = top + px(7) + ly * 0.4;
  const torsoH = Math.max(2, px(6) - px(fallK * 2.5) + sqPx * s * 0.5);
  R(ctx, cx - px(hw) - 1 + lx * 0.5, torsoY, px(hw * 2) + 2, torsoH, flash ?? OUTLINE);
  R(ctx, cx - px(hw) + lx * 0.5, torsoY + 1, px(hw * 2), Math.max(1, torsoH - 2), flash ?? col.armor);
  // belt trim
  R(ctx, cx - px(hw) + lx * 0.5, torsoY + torsoH - 2, px(hw * 2), 1, flash ?? col.trim);

  // ================= arms =================
  const armBaseY = torsoY + 1;
  const lArmY = armBaseY + (o.moving ? armSwing * 0.5 * s : 0) + (casting && extras === 'shrine' ? -px(3) * castK : 0);
  let rArmY = armBaseY - (o.moving ? armSwing * 0.5 * s : 0) + (casting && extras === 'shrine' ? -px(3) * castK : 0);
  // weapon-arm raises: swing strike / cast / talk gesture / potion lift
  const raise = strikeK * px(2) + castK * px(3) + talkK * px(2) + (drinking ? px(2) : 0);
  rArmY -= raise;
  const armOut = dead ? Math.round(px(2) * fallK) : Math.round(hurtK * px(1));
  const armH = Math.max(2, px(4) - px(fallK));
  // left arm
  R(ctx, cx - px(hw) - px(2) - armOut + lx * 0.3, lArmY, px(2), armH, flash ?? OUTLINE);
  R(ctx, cx - px(hw) - px(2) - armOut + lx * 0.3, lArmY, px(2), Math.max(1, armH - 1), flash ?? col.armor);
  R(ctx, cx - px(hw) - px(2) - armOut + lx * 0.3, lArmY + armH - 1, px(2), 1, flash ?? col.skin);
  // right (weapon) arm
  const rArmX = cx + px(hw) + armOut + lx * 0.6;
  R(ctx, rArmX, rArmY, px(2), armH + raise * 0.4, flash ?? OUTLINE);
  R(ctx, rArmX, rArmY, px(2), Math.max(1, armH - 1 + raise * 0.4), flash ?? col.armor);
  R(ctx, rArmX, rArmY + armH - 1 + raise * 0.4, px(2), 1, flash ?? col.skin);

  // ================= head =================
  const nod = talkK > 0 ? Math.sin(talkK * 12) * talkK * px(1) : 0;
  const drinkTilt = drinking && potionT > 0.3 && potionT < 0.75 ? -px(1) : 0;
  const slumpX = dead ? fallK * px(3) : 0;
  const slumpY = dead ? fallK * px(2) : nod;
  const headX = cx + side * px(1) + lx * 0.7 + slumpX;
  const headY = top + px(1) + ly * 0.5 + slumpY + drinkTilt;
  const headW = px(8);
  const headH = Math.max(3, px(7) - px(fallK * 2));
  R(ctx, headX - headW / 2, headY, headW, headH, flash ?? OUTLINE);
  if (up) {
    R(ctx, headX - px(3), headY + 1, px(6), Math.max(1, headH - 2), flash ?? col.hair);
  } else {
    R(ctx, headX - px(3), headY + 1, px(6), Math.max(1, headH - 2), flash ?? col.skin);
    // eyes: squeezed when hurt, dead (blood) when fallen
    const ex = side * px(1);
    if (dead) {
      R(ctx, headX - px(2) + ex, headY + px(3), px(1), px(1), flash ?? C.BLOOD);
      R(ctx, headX + px(1) + ex, headY + px(3), px(1), px(1), flash ?? C.BLOOD);
    } else if (hurtK > 0.5) {
      R(ctx, headX - px(2) + ex, headY + px(4), px(1), 1, flash ?? OUTLINE);
      R(ctx, headX + px(1) + ex, headY + px(4), px(1), 1, flash ?? OUTLINE);
    } else {
      R(ctx, headX - px(2) + ex, headY + px(3), px(1), px(2), flash ?? OUTLINE);
      R(ctx, headX + px(1) + ex, headY + px(3), px(1), px(2), flash ?? OUTLINE);
    }
  }
  // hair cap
  R(ctx, headX - headW / 2, headY - px(1), headW, px(2), flash ?? col.hair);
  if (!up && !dead) R(ctx, headX - px(3), headY, px(6), 1, flash ?? col.hair);

  // ================= weapon =================
  // hand anchor follows the raised weapon arm
  const handSide = side <= 0 ? 1 : -1;
  const hx = cx + handSide * px(hw + 2) + lx * 0.8;
  const hy = rArmY + armH * 0.5;
  const bladeLen = px(sil.bladeLen);
  const bladeW = Math.max(1.5, px(sil.bladeW) * 0.7);
  const showCudgel = extras === 'none' && (swinging || casting);
  if (sil.staff) {
    // ---- staff ----
    if (swinging || casting || windupK > 0.05) {
      const base = facingAngle(o.facing);
      let ang: number;
      let lift = 0;
      if (casting) {
        // raised overhead, gem flaring at apex
        ang = -Math.PI / 2 + side * 0.2;
        lift = (4 + castK * 3) * s;
      } else if (windupK > 0.05) {
        ang = -Math.PI / 2 + side * 0.15;
        lift = windupK * 5 * s;
      } else {
        ang = base + swingAngle(profile, swingT);
      }
      const tip = shaft(ctx, hx, hy - lift, ang, bladeLen, bladeW, flash ?? OUTLINE, flash ?? C.EMBER);
      const gemC = extras === 'shrine' ? C.GOLD : C.MIST;
      const flare = casting ? castK : strikeK;
      const gs = (3 + flare * 2) * s;
      R(ctx, tip.tx - gs / 2, tip.ty - gs / 2, gs, gs, flash ?? gemC);
      R(ctx, tip.tx - s, tip.ty - s, 2 * s, 2 * s, flash ?? C.BONE);
    } else {
      // rest: vertical staff + gem
      R(ctx, hx - px(1), hy - px(8), px(2), px(12), flash ?? OUTLINE);
      R(ctx, hx, hy - px(8), 1, px(12), flash ?? C.EMBER);
      const gemC = extras === 'shrine' ? C.GOLD : C.MIST;
      R(ctx, hx - px(1), hy - px(10), px(3), px(3), flash ?? gemC);
      R(ctx, hx, hy - px(9), 1, 1, flash ?? C.BONE);
    }
  } else if (extras !== 'none' || showCudgel) {
    // ---- blade / cudgel ----
    const cudgel = extras === 'none';
    const len = cudgel ? px(6) : bladeLen;
    if (swinging) {
      const base = facingAngle(o.facing);
      const ang = base + swingAngle(profile, swingT);
      // blader skill echo: ghost second arc
      if (profile === 'blader' && casting) {
        const echo = shaft(ctx, hx - 3 * s, hy, ang - 0.6, len, bladeW, C.MIST, C.MIST);
        R(ctx, echo.tx - 1, echo.ty - 1, 2, 2, C.FROST);
      }
      const hot = swingT > 0.2 && swingT < 0.8;
      const tip = shaft(ctx, hx, hy, ang, len, bladeW, flash ?? OUTLINE, flash ?? (hot || casting ? C.BONE : C.FROST));
      if (hot || casting) R(ctx, tip.tx - 1, tip.ty - 1, 2.5, 2.5, flash ?? C.BONE);
      // guard at hand
      R(ctx, hx - px(2), hy - 1, px(4), 2, flash ?? (cudgel ? C.EMBER : col.trim));
    } else if (windupK > 0.05) {
      // telegraph: blade raised high, still vertical (reads the windup)
      const lift = windupK * (profile === 'watcher' ? 7 : 4) * s;
      R(ctx, hx - bladeW / 2 - 0.5, hy - len - lift, bladeW + 1, len, flash ?? OUTLINE);
      R(ctx, hx - bladeW / 2, hy - len - lift, bladeW, len, flash ?? C.FROST);
      if (windupK > 0.6) R(ctx, hx - 1, hy - len - lift, 2, 3, flash ?? C.BONE);
    } else if (dashK > 0.05) {
      // dash: blade swept back + speed lines
      const back = facingAngle(o.facing) + Math.PI * 0.8;
      shaft(ctx, hx, hy, back, len, bladeW, flash ?? OUTLINE, flash ?? C.FROST);
      R(ctx, hx - fx * 10 * s - 4, hy - 3, 6, 1.5, C.MIST);
      R(ctx, hx - fx * 12 * s - 4, hy + 1, 8, 1.5, C.FROST);
    } else if (casting) {
      // blade cast (blader triple): blade up, edge flashing
      R(ctx, hx - bladeW / 2 - 0.5, hy - len - castK * 3 * s, bladeW + 1, len, flash ?? OUTLINE);
      R(ctx, hx - bladeW / 2, hy - len - castK * 3 * s, bladeW, len, flash ?? C.BONE);
    } else if (!dead) {
      // rest: blade up
      R(ctx, hx - bladeW / 2 - 0.5, hy - len, bladeW + 1, len, flash ?? OUTLINE);
      R(ctx, hx - bladeW / 2, hy - len + 1, bladeW, len - 1, flash ?? (cudgel ? C.EMBER : C.FROST));
      R(ctx, hx - px(2), hy - 1, px(4), 1.5, flash ?? (cudgel ? C.SAND : col.trim));
    }
  }

  // ================= potion bottle =================
  if (drinking) {
    const t = Math.min(1, potionT);
    // raise (0-.35) -> drink (.35-.7) -> lower (.7-1)
    const mouthX = headX + (up ? 0 : side * px(1));
    const mouthY = headY + px(5);
    let k: number;
    if (t < 0.35) k = t / 0.35;
    else if (t < 0.7) k = 1;
    else k = 1 - (t - 0.7) / 0.3;
    const ease = k * k * (3 - 2 * k);
    const bx = hx + (mouthX - hx) * ease;
    const by = hy + (mouthY - hy) * ease - 2 * s;
    R(ctx, bx - 1.5 * s, by - 2 * s, 3 * s, 4 * s, flash ?? OUTLINE);
    R(ctx, bx - s, by - s, 2 * s, 2.5 * s, flash ?? C.FLAME);
    R(ctx, bx - 0.5 * s, by - 3 * s, 1.5 * s, 1.5 * s, flash ?? C.SAND);
    if (t > 0.7) {
      // healing sparkles
      const a = (t - 0.7) / 0.3;
      if (a > 0.15) R(ctx, headX - px(5), headY - px(1), 2, 2, C.LEAF);
      if (a > 0.4) R(ctx, headX + px(4), headY + px(1), 2, 2, C.BONE);
      if (a > 0.65) R(ctx, headX - px(1), headY - px(4), 2, 2, C.LEAF);
    }
  }

  // ================= job extras =================
  if (extras === 'knight' || extras === 'guard') {
    R(ctx, headX - px(1), headY - px(3), px(2), px(2), flash ?? C.FLAME);
    const padW = px(3) + (extras === 'knight' ? s : 0);
    R(ctx, cx - px(hw) - padW + lx * 0.5, torsoY - 1, padW, px(2), flash ?? col.trim);
    R(ctx, cx + px(hw) - s + lx * 0.5, torsoY - 1, padW, px(2), flash ?? col.trim);
    // shield on off-hand (knight's reads bigger)
    const sh = sil.shield || 1;
    const sx = side <= 0 ? cx - px(hw) - px(4) : cx + px(hw) + px(1);
    R(ctx, sx, armBaseY - px(1), px(3) * sh, px(6) * sh, flash ?? OUTLINE);
    R(ctx, sx, armBaseY - px(1), px(2) * sh, px(5) * sh, flash ?? C.SLATE);
    R(ctx, sx, armBaseY + px(1), px(2) * sh, 1, flash ?? C.GOLD);
  } else if (extras === 'watcher') {
    // pauldrons (drop as it dies) + visor slit handled below with pose
    const drop = fallK * px(3);
    R(ctx, cx - px(hw) - px(4) + lx * 0.5, torsoY - 1 + drop, px(4), px(3), flash ?? C.DEEP);
    R(ctx, cx + px(hw) + lx * 0.5, torsoY - 1 + drop, px(4), px(3), flash ?? C.DEEP);
    R(ctx, headX - px(1), headY - px(3), px(2), px(2), flash ?? C.FLAME);
    if (!up) {
      const shake = windupK > 0.5 ? ((Math.floor(o.phase * 9) % 2 === 0 ? 1 : -1) * windupK * s) : 0;
      const visor = dead ? (fallK < 0.5 ? C.BLOOD : C.VOID) : windupK > 0.7 ? C.BONE : windupK > 0.05 ? C.GOLD : C.FLAME;
      R(ctx, headX - px(3) + shake, headY + px(3), px(6), Math.max(1, px(1.4)), flash ?? visor);
      if (!dead) {
        R(ctx, headX - px(2) + shake, headY + px(3), px(4), Math.max(1, px(1.4)), flash ?? C.GOLD);
        R(ctx, headX - px(1) + shake, headY + px(3), px(2), 1, C.BONE);
      }
    }
  } else if (extras === 'blader') {
    // long scarf, double flutter (flares in dash/skill)
    const flare = 1 + dashK * 1.5 + castK * 0.8 + strikeK * 0.5;
    const fl1 = Math.sin(o.phase * 1.7) * px(1);
    const fl2 = Math.sin(o.phase * 2.3 + 1) * px(1);
    const scarfX = side < 0 ? headX + px(2) : headX - px(2) - px(sil.scarfLen) * flare;
    R(ctx, scarfX, torsoY + fl1 * 0.4, px(sil.scarfLen) * flare, px(2), flash ?? C.FLAME);
    R(ctx, scarfX + (side < 0 ? px(2) : px(sil.scarfLen) * flare - px(4)), torsoY + px(2) + fl2 * 0.5, px(3), 1.5, flash ?? C.BLOOD);
  } else if (extras === 'arcanist' || extras === 'robe') {
    // wide-brim hat
    R(ctx, headX - px(6), headY - px(2), px(12), px(2), flash ?? OUTLINE);
    R(ctx, headX - px(5), headY - px(2), px(10), 1, flash ?? C.DUSK);
    R(ctx, headX - px(2), headY - px(6), px(4), px(4), flash ?? OUTLINE);
    R(ctx, headX - px(1), headY - px(5), px(2), px(3), flash ?? C.DUSK);
  } else if (extras === 'shrine') {
    // circlet + long veil
    R(ctx, headX - px(4), headY, px(8), 1, flash ?? C.GOLD);
    const sway = o.moving ? Math.round(stride * s) : 0;
    R(ctx, headX - px(5) + sway * 0.3, headY + 1, 1.5, px(8), flash ?? C.BONE);
    R(ctx, headX + px(4) - sway * 0.3, headY + 1, 1.5, px(8), flash ?? C.BONE);
  } else if (extras === 'bandit') {
    // eye mask + hood
    if (!up && !dead) R(ctx, headX - px(3), headY + px(3), px(6), px(2), flash ?? C.VOID);
    R(ctx, headX - px(4), headY - px(2), px(8), px(2), flash ?? C.BLOOD);
  } else if (extras === 'merchant') {
    R(ctx, headX - px(4), headY - px(2), px(8), 1, flash ?? C.GOLD);
  }

  // night rim: NW key light keeps silhouettes readable with post OFF
  if (o.dim > 0.25 && !o.flash) {
    const rimA = Math.min(0.55, (o.dim - 0.25) * 0.9);
    ctx.save();
    ctx.globalAlpha = rimA;
    R(ctx, headX - headW / 2, headY - px(1), headW, 1, C.FROST);
    R(ctx, cx - px(hw) - 1 + lx * 0.5, torsoY, 1, torsoH, C.MIST);
    ctx.restore();
  }
}

export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  o: BodyOpts,
  job: string,
): void {
  drawShadow(ctx, o.x, o.y + 1, 7 * o.scale);
  const extras = (job === 'knight' || job === 'blader' || job === 'arcanist' || job === 'shrine'
    ? job
    : 'none') as Extras;
  drawHumanoid(ctx, o, jobColors(job), extras);
}

export type EnemyKind = 'slime' | 'wolf' | 'bandit' | 'shade' | 'watcher';

export function drawEnemy(
  ctx: CanvasRenderingContext2D,
  kind: EnemyKind,
  o: BodyOpts,
): void {
  const pal = ENEMY_COLORS[kind];
  const s = o.scale;
  const px = (n: number): number => n * s;
  const flash = o.flash ? C.BONE : null;
  const side = o.facing === 2 ? -1 : o.facing === 3 ? 1 : 0;
  const anim = o.anim ?? (o.moving ? 'move' : 'idle');
  const dead = anim === 'dead';
  const fallK = dead ? Math.min(1, (o.deadT ?? 0.4) / (kind === 'watcher' ? 0.6 : 0.3)) : 0;
  const hurtK = o.hurtK ?? 0;
  const windupK = o.windupK ?? 0;
  const recoverK = o.recoverK ?? 0;
  const swingT = o.swing >= 0 ? Math.min(1, o.swing) : -1;
  const strikeK = swingT >= 0 ? Math.sin(swingT * Math.PI) : 0;
  const lx = (o.leanX ?? 0) * s;

  if (kind === 'bandit') {
    drawShadow(ctx, o.x, o.y + 1, 6 * s);
    drawHumanoid(
      ctx,
      { ...o, profile: 'bandit' },
      { skin: C.SKIN, hair: C.VOID, armor: C.BLOOD, trim: C.EMBER, legs: C.DEEP, boots: C.VOID },
      'bandit',
    );
    return;
  }
  if (kind === 'watcher') {
    drawShadow(ctx, o.x, o.y + 1, 10 * s);
    drawHumanoid(
      ctx,
      { ...o, profile: 'watcher' },
      { skin: C.SLATE, hair: C.VOID, armor: C.SLATE, trim: C.FLAME, legs: C.DEEP, boots: C.VOID },
      'watcher',
    );
    return;
  }

  if (kind === 'slime') {
    // ---- hop locomotion: stretch rising, squash on landing ----
    const hopping = o.moving && !dead;
    const hopPh = hopping ? Math.abs(Math.sin(o.phase)) : 0;
    const rising = hopping && Math.cos(o.phase) > 0;
    const yOff = -hopPh * px(4);
    const shake = windupK > 0.05 && !dead ? ((Math.floor(o.phase * 14) % 2 === 0 ? 1 : -1) * windupK * px(1)) : 0;
    const lunge = !dead && o.facing !== 1 && o.facing !== 0 ? strikeK * side * px(4) : 0;
    let sq = 0.15 + (!o.moving && !dead ? (Math.sin(o.phase * 1.5) * 0.5 + 0.5) * 0.2 : 0);
    if (hopping) sq += hopPh < 0.3 ? 0.4 : rising ? -0.18 : 0.12;
    sq += windupK * 0.3 + hurtK * 0.3 + fallK * 0.9;
    const w = px(11) + sq * px(7);
    const h = Math.max(2, px(8) - sq * px(6));
    drawShadow(ctx, o.x, o.y + 1, 6 * s, hopPh * 4);
    const x0 = o.x - w / 2 + lx + lunge + shake;
    const y0 = o.y - h + yOff;
    R(ctx, x0 - 1, y0 - 1, w + 2, h + 2, flash ?? OUTLINE);
    R(ctx, x0, y0, w, h, flash ?? pal.body);
    R(ctx, x0 + 1, y0 + 1, w * 0.35, Math.max(1, h * 0.3), flash ?? pal.glow);
    if (!dead || fallK < 0.5) R(ctx, x0 + 2, y0 + 1, 3, 2, flash ?? C.BONE);
    // eyes (squeezed when hurt, gone when popped)
    const ex = side * px(2);
    const ey = y0 + h * 0.45;
    if (!dead) {
      const eyeH = hurtK > 0.4 ? 1 : px(3);
      R(ctx, o.x - px(3) + ex + lunge, ey, px(2), eyeH, flash ?? OUTLINE);
      R(ctx, o.x + px(1) + ex + lunge, ey, px(2), eyeH, flash ?? OUTLINE);
    }
    // attack maw + landing splat droplets
    if (strikeK > 0.4 && !dead) {
      R(ctx, o.x - px(2) + ex + lunge, y0 + h - 3, px(4), 2, flash ?? C.VOID);
    }
    if (dead && fallK > 0.3) {
      R(ctx, x0 - 4, o.y - 2, 3, 2, pal.body);
      R(ctx, x0 + w + 1, o.y - 2, 3, 2, pal.body);
    }
    // crown nub (sinks as it pops)
    if (!dead || fallK < 0.6) R(ctx, o.x - px(1) + lunge, y0 - px(2), px(2), px(2), flash ?? pal.dark);
    if (o.dim > 0.25 && !o.flash) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.5, (o.dim - 0.25) * 0.8);
      R(ctx, x0, y0, w, 1, C.FROST);
      ctx.restore();
    }
  } else if (kind === 'wolf') {
    // ---- gallop: diagonal leg pairs, body pitch, pounce ----
    const dir = side === 0 ? 1 : side;
    const gallop = o.moving && !dead ? Math.sin(o.phase) : 0;
    const crouch = windupK * px(2);
    const pounce = strikeK;
    const lungeX = dir * pounce * px(6) + lx;
    const pitch = gallop * px(1.2);
    const bodyDrop = dead ? px(3) * fallK : 0;
    drawShadow(ctx, o.x, o.y + 1, 8 * s, pounce * 3);
    const x0 = o.x - px(7) + lungeX;
    const y0 = o.y - px(9) + pitch * 0.3 + crouch * 0.6 + bodyDrop - pounce * px(2);
    // tail: wag idle, stream when running, tucked in windup
    const wag = !o.moving && !dead ? Math.sin(o.phase * 2) * px(1.5) : 0;
    const tailY = y0 + px(1) + (o.moving ? -px(1) : 0) + windupK * px(2) + wag;
    const tailX = dir > 0 ? x0 - px(3) : x0 + px(14);
    R(ctx, tailX, tailY, px(3), px(2), flash ?? pal.dark);
    if (dead) {
      // sprawled: flattened body, legs in the air, head down
      const bw = px(15);
      const bh = Math.max(2, px(7) - px(3) * fallK);
      R(ctx, x0 - 1, y0 + px(2), bw, bh, flash ?? OUTLINE);
      R(ctx, x0, y0 + px(2), bw - 1, Math.max(1, bh - 1), flash ?? pal.body);
      for (let i = 0; i < 4; i++) {
        const legX = x0 + px(2) + i * px(3.5);
        R(ctx, legX, y0 - px(1) * fallK, px(2), px(3) * fallK + 1, flash ?? pal.dark);
      }
      R(ctx, x0 + (dir > 0 ? bw - 2 : -3), y0 + px(3), px(4), px(3), flash ?? pal.body);
      R(ctx, x0 + (dir > 0 ? bw - 1 : -2), y0 + px(4), 1.5, 1.5, flash ?? C.BLOOD);
      return;
    }
    // body
    R(ctx, x0 - 1, y0 - 1, px(15), px(7), flash ?? OUTLINE);
    R(ctx, x0, y0, px(14), px(5), flash ?? pal.body);
    R(ctx, x0, y0, px(14), 1, flash ?? pal.glow);
    // head (bobs opposite the body, leads the pounce)
    const hx = (dir > 0 ? x0 + px(12) : x0 - px(4)) + dir * pounce * px(2);
    const hy = y0 - px(4) - pitch * 0.5 - pounce * px(1);
    R(ctx, hx - 1, hy - 1, px(7), px(7), flash ?? OUTLINE);
    R(ctx, hx, hy, px(5), px(5), flash ?? pal.body);
    R(ctx, hx + (dir > 0 ? px(1) : px(2)), hy - px(2), px(2), px(2), flash ?? pal.dark);
    // snout + jaw (teeth bared on pounce) + eye (wide in windup)
    const snX = dir > 0 ? hx + px(5) : hx - px(2);
    R(ctx, snX, hy + px(3), px(2), px(2), flash ?? pal.dark);
    if (pounce > 0.45) {
      R(ctx, snX, hy + px(5), px(2), 1, flash ?? C.BONE);
      R(ctx, dir > 0 ? hx + px(4) : hx, hy + px(4), px(2), 1, flash ?? C.VOID);
    }
    const eyeW = windupK > 0.05 ? 2 : 1;
    R(ctx, dir > 0 ? hx + px(3) : hx + px(1), hy + px(1), eyeW, windupK > 0.05 ? 2 : 1, flash ?? C.GOLD);
    // legs: diagonal pairs alternate; pounce reaches forward
    for (let i = 0; i < 4; i++) {
      const diag = i % 2 === 0 ? gallop : -gallop;
      const reach = i < 2 ? pounce * px(3) * dir : -pounce * px(2) * dir;
      const legX = x0 + px(1) + i * px(4) + diag * px(1.2) + reach;
      R(ctx, legX, o.y - px(4) + crouch * 0.5, px(2), px(4) - crouch * 0.5, flash ?? pal.dark);
    }
    void recoverK;
  } else if (kind === 'shade') {
    // ---- hover glider: cloak wave, charge orb, dissolve ----
    const glide = o.moving && !dead ? Math.sin(o.phase * 2) : 0;
    const hover = (dead ? 0 : Math.sin(o.phase * 1.3) * px(1.5) + glide * px(0.8)) - fallK * px(8);
    const fx = o.facing === 2 ? -1 : o.facing === 3 ? 1 : 0;
    const lean = o.moving && !dead ? fx * px(2) : 0;
    const jitter = hurtK > 0.05 && !dead ? ((Math.floor(o.phase * 20) % 2 === 0 ? 1 : -1) * hurtK * px(1)) : 0;
    const shrink = 1 - fallK * 0.45;
    const x0 = o.x + lean + lx * 0.5 + jitter;
    const y0 = o.y - px(12) + hover;
    // cloak flares on strike, settles through recover, compresses on charge
    const flarePx = swingT >= 0 ? strikeK * px(2) : anim === 'attack' ? Math.max(0.2, 1 - recoverK) * px(1.5) : 0;
    const cw = Math.max(4, px(12) * shrink + flarePx - windupK * px(1));
    drawShadow(ctx, o.x, o.y + 1, 6 * s, 3 + hover * -0.3);
    if (dead && fallK > 0.85) return; // fully dissolved (renderer fade covers the rest)
    // wispy tail (waves while gliding)
    const wave = dead ? 0 : Math.sin(o.phase * 3) * px(1);
    R(ctx, x0 - px(4) * shrink + wave * 0.4, o.y - px(5) + hover, px(8) * shrink, px(5) * shrink, flash ?? pal.dark);
    R(ctx, x0 - px(2) * shrink, o.y - px(3) + hover, px(4) * shrink, Math.max(1, px(3) * shrink), flash ?? OUTLINE);
    // cloak body (compresses while charging)
    R(ctx, x0 - cw / 2 - 1, y0 - 1, cw + 2, px(10) * shrink + 2, flash ?? OUTLINE);
    R(ctx, x0 - cw / 2, y0, cw, px(10) * shrink, flash ?? pal.body);
    // hood
    R(ctx, x0 - px(5) * shrink + side * px(1), y0 - px(3), px(10) * shrink, px(5), flash ?? OUTLINE);
    R(ctx, x0 - px(4) * shrink + side * px(1), y0 - px(2), px(8) * shrink, px(4), flash ?? pal.dark);
    // eyes (swell while charging, fade while dissolving)
    if (!dead || fallK < 0.4) {
      const ex = side * px(1);
      const ew = (windupK > 0.05 ? 3 : 2) * s;
      R(ctx, x0 - px(2) + ex, y0 + px(1), ew, s, flash ?? C.BONE);
      R(ctx, x0 + px(1) + ex, y0 + px(1), ew, s, flash ?? C.BONE);
      if (windupK > 0.4) {
        R(ctx, x0 - px(3) + ex, y0, px(3), px(3), C.FROST);
        R(ctx, x0 + px(1) + ex, y0, px(3), px(3), C.FROST);
      }
    }
    // charge orb grows in front during telegraph
    if (windupK > 0.05 && !dead) {
      const orbR = (1.5 + windupK * 2.5) * s;
      const ox = x0 + fx * (px(8) + windupK * px(3));
      const oy = y0 + px(5);
      R(ctx, ox - orbR - 1, oy - orbR - 1, orbR * 2 + 2, orbR * 2 + 2, flash ?? OUTLINE);
      R(ctx, ox - orbR, oy - orbR, orbR * 2, orbR * 2, flash ?? C.MIST);
      R(ctx, ox - 1, oy - 1, 2.5, 2.5, flash ?? C.BONE);
    }
    // recoil flare right after the bolt leaves
    if (swingT >= 0 && !dead) {
      R(ctx, x0 - cw / 2 - 2 - fx * px(2), y0 + px(2), 2, px(6), flash ?? C.MIST);
    }
    // dissolving wisps rise
    if (dead) {
      R(ctx, x0 - px(2), y0 - px(5), 2, 4, pal.body);
      R(ctx, x0 + px(2), y0 - px(8), 2, 3, pal.dark);
    }
    if (o.dim > 0.2 && !o.flash && !dead) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      const ex = side * px(1);
      R(ctx, x0 - px(3) + ex, y0, px(3), px(3), C.FROST);
      R(ctx, x0 + px(1) + ex, y0, px(3), px(3), C.FROST);
      ctx.restore();
    }
  }
}

export type NpcKind = 'guard' | 'jobmaster' | 'merchant' | 'innkeeper';

export function drawNPC(
  ctx: CanvasRenderingContext2D,
  kind: NpcKind,
  o: BodyOpts,
): void {
  drawShadow(ctx, o.x, o.y + 1, 7 * o.scale);
  if (kind === 'guard') {
    drawHumanoid(ctx, o, { skin: C.SKIN, hair: C.SLATE, armor: C.SLATE, trim: C.GOLD, legs: C.DEEP, boots: C.DEEP }, 'guard');
  } else if (kind === 'jobmaster') {
    drawHumanoid(ctx, o, { skin: C.SKIN, hair: C.BONE, armor: C.DUSK, trim: C.GOLD, legs: C.DEEP, boots: C.DEEP }, 'robe');
  } else if (kind === 'merchant') {
    drawHumanoid(ctx, o, { skin: C.SKIN, hair: C.EMBER, armor: C.EMBER, trim: C.GOLD, legs: C.SAND, boots: C.DEEP }, 'merchant');
  } else {
    drawHumanoid(ctx, o, { skin: C.SKIN, hair: C.BLOOD, armor: C.LEAF, trim: C.BONE, legs: C.MOSS, boots: C.DEEP }, 'none');
    // headscarf (rides the breathe lift so it never floats)
    const s = o.scale;
    const side = o.facing === 2 ? -1 : o.facing === 3 ? 1 : 0;
    const breathe = !o.moving ? (Math.sin(o.phase) * 0.5 + 0.5) * 0.8 * s : 0;
    const top = o.y - 17 * s - breathe;
    R(ctx, o.x - 4 * s + side * s, top - 1 * s, 8 * s, 2 * s, C.BONE);
  }
}

export type PickupKind = 'gold' | 'potion' | 'equip';

export function drawPickup(
  ctx: CanvasRenderingContext2D,
  kind: PickupKind,
  x: number,
  y: number,
  t: number,
): void {
  const bob = Math.sin(t * 4 + x) * 1.5;
  drawShadow(ctx, x, y + 1, 5, 2);
  if (kind === 'gold') {
    R(ctx, x - 4, y - 7 + bob, 8, 6, OUTLINE);
    R(ctx, x - 3, y - 6 + bob, 6, 4, C.GOLD);
    R(ctx, x - 2, y - 5 + bob, 3, 2, C.BONE);
  } else if (kind === 'potion') {
    R(ctx, x - 3, y - 8 + bob, 6, 7, OUTLINE);
    R(ctx, x - 2, y - 6 + bob, 4, 4, C.FLAME);
    R(ctx, x - 2, y - 6 + bob, 4, 2, C.BONE);
    R(ctx, x - 1, y - 10 + bob, 2, 3, C.SAND);
  } else {
    R(ctx, x - 5, y - 7 + bob, 10, 6, OUTLINE);
    R(ctx, x - 4, y - 6 + bob, 8, 4, C.MIST);
    R(ctx, x - 4, y - 6 + bob, 8, 2, C.FROST);
    R(ctx, x - 1, y - 6 + bob, 2, 4, C.GOLD);
    R(ctx, x - 1, y - 6 + bob, 2, 2, C.BONE);
  }
}

export function drawProjectile(
  ctx: CanvasRenderingContext2D,
  friendly: boolean,
  holy: boolean,
  x: number,
  y: number,
  t: number,
): void {
  // height shadow on ground below (projectiles fly high)
  drawShadow(ctx, x, y + 9, 3, 7);
  const c = holy ? C.GOLD : friendly ? C.EMBER : C.DUSK;
  const halo = holy ? C.GOLD : friendly ? C.GOLD : C.MIST;
  const r = 3 + Math.sin(t * 18) * 0.8;
  // additive halo so bloom catches magic even before post threshold
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(Math.round(x), Math.round(y), Math.ceil(r + 3), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(Math.round(x), Math.round(y), Math.ceil(r + 1.5), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(Math.round(x), Math.round(y), Math.ceil(r), 0, Math.PI * 2);
  ctx.fill();
  // hot white core for bloom
  ctx.fillStyle = C.BONE;
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
}

/** Tree: cold pine. Base at (x,y), ~tile sized. */
export function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, variant: number): void {
  const h = 22 + (variant % 3) * 3;
  R(ctx, x - 2, y - 8, 4, 8, OUTLINE);
  R(ctx, x - 1, y - 8, 2, 8, C.PINE);
  for (let i = 0; i < 3; i++) {
    const w = 16 - i * 4 + (variant % 2);
    const yy = y - 8 - (i + 1) * (h / 4);
    R(ctx, x - w / 2 - 1, yy - 1, w + 2, h / 4 + 2, OUTLINE);
    R(ctx, x - w / 2, yy, w, h / 4, i === 0 ? C.MOSS : C.PINE);
    R(ctx, x - w / 2, yy, 2, h / 4, C.MOSS);
  }
  R(ctx, x - 1, y - 8 - h + 2, 2, 3, C.LEAF);
}

export function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, variant: number): void {
  const w = 10 + (variant % 3) * 2;
  R(ctx, x - w / 2 - 1, y - 7, w + 2, 8, OUTLINE);
  R(ctx, x - w / 2, y - 6, w, 6, C.SLATE);
  R(ctx, x - w / 2, y - 6, w, 2, C.MIST);
}

export function drawFlowers(ctx: CanvasRenderingContext2D, x: number, y: number, variant: number): void {
  const cols = [C.GOLD, C.FLAME, C.FROST, C.EMBER];
  for (let i = 0; i < 3; i++) {
    const ox = ((variant * 5 + i * 7) % 11) - 5;
    const oy = ((variant * 3 + i * 5) % 9) - 4;
    R(ctx, x + ox, y + oy - 3, 1, 3, C.MOSS);
    R(ctx, x + ox - 1, y + oy - 5, 3, 3, cols[(variant + i) % cols.length]);
  }
}

export function drawGrassTuft(ctx: CanvasRenderingContext2D, x: number, y: number, variant: number): void {
  R(ctx, x - 3, y - 4, 2, 4, C.MOSS);
  R(ctx, x, y - 6, 2, 6, C.LEAF);
  R(ctx, x + 2, y - 3, 2, 3, C.PINE);
  void variant;
}

/** Ember lamp post — warm light source. Base at (x,y). */
export function drawLamp(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  R(ctx, x - 1, y - 16, 3, 16, OUTLINE);
  R(ctx, x, y - 16, 1, 16, C.SLATE);
  R(ctx, x - 4, y - 22, 9, 7, OUTLINE);
  const flick = Math.sin(t * 9 + x * 0.3) * 0.5 + 0.5;
  // warm glass + hot bone core for bloom
  R(ctx, x - 3, y - 21, 7, 5, flick > 0.4 ? C.GOLD : C.EMBER);
  R(ctx, x - 2, y - 20, 5, 4, C.BONE);
  R(ctx, x - 5, y - 24, 11, 2, OUTLINE);
}

/** Town house. (x,y) = top-left in world px, w/h in tiles. */
export function drawHouse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  wTiles: number,
  hTiles: number,
  roof: string,
  wall: string,
  sign: string | null,
): void {
  const T = 16;
  const w = wTiles * T;
  const h = hTiles * T;
  const roofH = Math.round(h * 0.45);
  // wall
  R(ctx, x, y + roofH - 4, w, h - roofH + 4, OUTLINE);
  R(ctx, x + 2, y + roofH - 2, w - 4, h - roofH, wall);
  // timber frame
  for (let bx = x + 6; bx < x + w - 4; bx += 14) {
    R(ctx, bx, y + roofH, 2, h - roofH - 2, C.PINE);
  }
  // roof
  R(ctx, x - 4, y, w + 8, roofH, OUTLINE);
  R(ctx, x - 2, y + 2, w + 4, roofH - 4, roof);
  for (let rx = x; rx < x + w; rx += 10) {
    R(ctx, rx, y + 4, 2, roofH - 8, OUTLINE);
  }
  R(ctx, x - 2, y + 2, w + 4, 3, C.FLAME);
  // door
  const dw = 12;
  R(ctx, x + w / 2 - dw / 2, y + h - 20, dw, 20, OUTLINE);
  R(ctx, x + w / 2 - dw / 2 + 2, y + h - 18, dw - 4, 18, C.DEEP);
  R(ctx, x + w / 2 + 1, y + h - 10, 2, 2, C.GOLD);
  // windows (warm lit + hot glint for bloom)
  R(ctx, x + 6, y + roofH + 4, 8, 8, OUTLINE);
  R(ctx, x + 7, y + roofH + 5, 6, 6, C.GOLD);
  R(ctx, x + 7, y + roofH + 5, 2, 2, C.BONE);
  R(ctx, x + w - 14, y + roofH + 4, 8, 8, OUTLINE);
  R(ctx, x + w - 13, y + roofH + 5, 6, 6, C.GOLD);
  R(ctx, x + w - 13, y + roofH + 5, 2, 2, C.BONE);
  if (sign) {
    R(ctx, x + w / 2 - 10, y + roofH - 14, 20, 10, OUTLINE);
    R(ctx, x + w / 2 - 9, y + roofH - 13, 18, 8, C.DEEP);
    ctx.fillStyle = sign;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('◆', x + w / 2, y + roofH - 8);
  }
}

/** Ruin pillar fragment. */
export function drawRuin(ctx: CanvasRenderingContext2D, x: number, y: number, variant: number): void {
  const h = 14 + (variant % 4) * 6;
  R(ctx, x - 6, y - h, 12, h, OUTLINE);
  R(ctx, x - 5, y - h + 1, 10, h - 1, C.SLATE);
  R(ctx, x - 5, y - h + 1, 3, h - 1, C.MIST);
  R(ctx, x - 7, y - h - 3, 14, 4, OUTLINE);
  R(ctx, x - 6, y - h - 2, 12, 2, C.DEEP);
  if (variant % 2 === 0) {
    R(ctx, x - 4, y - h + 6, 3, 3, C.DUSK);
    R(ctx, x + 1, y - h + 10, 3, 3, C.DUSK);
  }
}
