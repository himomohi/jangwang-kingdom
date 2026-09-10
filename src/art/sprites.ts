import { facingAngle } from '../sim/combat';
import type { Facing as SimFacing } from '../sim/types';
import { C, OUTLINE, JOB_COLORS, ENEMY_COLORS } from './palette';
import { jobSilhouette, strideSquash, swingAngle } from './anim';
import { computeHumanoidPose, facingProjection } from './rig';

/**
 * True 8-direction facing (numeric preserves legacy 0..3 for save compat):
 * 0=S(down) 1=N(up) 2=W(left) 3=E(right) 4=SW 5=SE 6=NW 7=NE.
 * Conceptual clockwise order: N, NE, E, SE, S, SW, W, NW.
 * Diagonals render as 3/4 view with perspective foreshortening.
 */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

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
  // Soft contact shadow (tight, directly under feet — grounds the character)
  // + height drop shadow (SE offset, NW key light, fades with height).
  ctx.fillStyle = 'rgba(16,24,40,0.30)';
  ctx.beginPath();
  ctx.ellipse(Math.round(x + 1), Math.round(y + 1), r * 0.62, Math.max(1.5, r * 0.62 * 0.34), 0, 0, Math.PI * 2);
  ctx.fill();
  // NW key light => shadows fall to SE. Higher objects offset further + fade.
  const dx = 2 + height * 0.45;
  const dy = 1 + height * 0.22;
  const alpha = Math.max(0.10, 0.30 - height * 0.022);
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
  const s = Number.isFinite(o.scale) && o.scale > 0 ? Math.max(0.4, Math.min(3, o.scale)) : 1;
  const px = (n: number): number => n * s;
  const sil = jobSilhouette(extrasJob(extras));
  const profile = o.profile ?? extrasJob(extras);
  const anim = o.anim ?? (o.swing >= 0 ? 'attack' : o.moving ? 'walk' : 'idle');
  const dead = anim === 'dead';
  const _deadT = Number.isFinite(o.deadT) ? (o.deadT as number) : 0.3;
  const fallK = dead ? Math.min(1, _deadT / 0.35) : 0;

  // True 8-way projection + per-joint IK pose (computed every frame;
  // static meshes/materials cached in rig.ts, no per-frame mesh regen).
  const proj = facingProjection(o.facing as SimFacing);
  const rigPose = computeHumanoidPose({
    x: o.x, y: o.y, facing: o.facing as SimFacing,
    phase: o.phase, moving: o.moving,
    swing: o.swing, cast: o.cast ?? -1, potion: o.potion ?? -1,
    hurtK: o.hurtK ?? 0, talkK: o.talkK ?? 0,
    windupK: o.windupK ?? 0, dashK: o.dashK ?? 0,
    deadT: o.deadT ?? 0, leanX: o.leanX ?? 0, leanY: o.leanY ?? 0,
    scale: s, job: extrasJob(extras), anim,
  });
  const side = proj.side;
  const vert = proj.vert;
  const diagonal = proj.diagonal;
  const faceMode = proj.faceMode;
  // back view = N + back 3/4 (NW/NE); front 3/4 (SW/SE) shows eyes.
  const up = faceMode === 'back' || (diagonal && vert < -0.3);
  const isSideView = faceMode === 'sideL' || faceMode === 'sideR';
  const fa8 = facingAngle(o.facing as SimFacing);
  const fx = Math.cos(fa8);
  const fy = Math.sin(fa8);

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

  // ---- root + stride (8-way: side/diagonal stride reads the facing) ----
  const stride = Math.sin(o.phase);
  const strideAmp = isSideView ? 1 : diagonal ? 0.82 : 0.64;
  const legAmp = (isSideView ? 2.2 : diagonal ? 1.9 : 1.4) * (dead ? 0 : 1);
  const armAmp = (isSideView ? 1.8 : diagonal ? 1.5 : 1.2) * (dead ? 0 : 1);
  void strideAmp;
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

  // ================= legs / robe (8-way foreshortened, far leg behind) =================
  const squashX = proj.squashX;
  const lswX = Math.round(legSwing * (Math.abs(fx) * 0.7 + 0.3) * s);
  const lswY = Math.round(legSwing * fy * 0.45 * s);
  const farLegLift = proj.farLeg ? 1 * s : 0;
  if (sil.robe && !dead) {
    // arcanist robe skirt (legs hidden): sway reads the stride instead
    const sway = o.moving ? Math.round(stride * px(1) * (Math.abs(fx) * 0.6 + 0.4)) : 0;
    const swayY = o.moving ? Math.round(stride * fy * 0.8 * s) : 0;
    const skirtH = px(7);
    const skirtW = px(10) * squashX;
    const skirtX = cx - skirtW / 2 + sway * 0.3;
    R(ctx, skirtX, feet - skirtH + px(bob) + swayY * 0.2, skirtW, skirtH, flash ?? OUTLINE);
    R(ctx, skirtX + 1, feet - skirtH + px(bob) + swayY * 0.2, skirtW - 2, skirtH - 1, flash ?? col.armor);
    R(ctx, skirtX + 1 + sway, feet - px(2), px(3), px(2), flash ?? col.armor);
    R(ctx, skirtX + skirtW - px(4) - sway, feet - px(2), px(3), px(2), flash ?? col.armor);
    R(ctx, skirtX + 2, feet - skirtH + px(bob), 1, skirtH - 1, flash ?? col.trim);
    // NW light: skirt top-left lift
    if (!flash) R(ctx, skirtX + 1, feet - skirtH + px(bob) + swayY * 0.2, skirtW - 2, 1, C.MIST);
  } else {
    const spread = dead ? Math.round(fallK * px(2)) : 0;
    const legH = Math.max(1, px(5) - px(bob) - px(fallK * 2.5));
    const legTop = feet - px(5) + px(bob) + px(fallK * 2.5);
    // foreshortened leg bases (side/diagonal legs closer = depth)
    const baseLX = cx - px(4) * squashX - spread;
    const baseRX = cx + px(1) * squashX + spread + (1 - squashX) * px(1.5);
    const drawLeg = (which: 'L' | 'R', behind: boolean): void => {
      const isL = which === 'L';
      const sx = isL ? lswX * 0.4 : -lswX * 0.4;
      const sy = isL ? lswY * 0.4 : -lswY * 0.4;
      const lift = behind ? -farLegLift : 0;
      const lx0 = (isL ? baseLX : baseRX) + sx;
      const ly0 = legTop + sy + lift;
      const bootY = feet - px(2) + sy + lift;
      R(ctx, lx0, ly0, px(3), legH, flash ?? OUTLINE);
      R(ctx, lx0, ly0, px(3), Math.max(1, legH - px(2)), flash ?? col.legs);
      R(ctx, lx0, bootY, px(3), px(2), flash ?? col.boots);
      // NW key: top-edge lift (near leg brighter = volume)
      if (!flash) {
        ctx.save();
        ctx.globalAlpha = behind ? 0.22 : 0.5;
        R(ctx, lx0, ly0, px(3), 1, C.MIST);
        ctx.restore();
      }
    };
    // depth-sorted: far leg behind (drawn first), near leg front
    if (proj.farLeg === 'L') { drawLeg('L', true); drawLeg('R', false); }
    else if (proj.farLeg === 'R') { drawLeg('R', true); drawLeg('L', false); }
    else { drawLeg('L', false); drawLeg('R', false); }
  }

  // ================= torso + arms (depth-sorted: far arm behind torso) =================
  // perspective squash: N/S vs E/W + diagonal 3/4 foreshorten
  const hw = sil.torsoHW * squashX + wide * 0.4 * squashX;
  const torsoY = top + px(7) + ly * 0.4;
  const torsoH = Math.max(2, (px(6) - px(fallK * 2.5) + sqPx * s * 0.5) * proj.squashY + (1 - proj.squashY) * px(0.5));
  // arm anchors (8-way: weapon arm = near/visible hand, off-hand guards)
  const weaponArm = proj.weaponArm;
  const armBaseY = torsoY + 1;
  const lArmYBase = armBaseY + (o.moving ? armSwing * 0.5 * s : 0) + (casting && extras === 'shrine' ? -px(3) * castK : 0);
  const rArmYBase = armBaseY - (o.moving ? armSwing * 0.5 * s : 0) + (casting && extras === 'shrine' ? -px(3) * castK : 0);
  // weapon-arm raises: swing strike / cast / talk gesture / potion lift
  const raise = strikeK * px(2) + castK * px(3) + talkK * px(2) + (drinking ? px(2) : 0);
  const lArmY = weaponArm === 'L' ? lArmYBase - raise : lArmYBase;
  const rArmY = weaponArm === 'R' ? rArmYBase - raise : rArmYBase;
  const armOut = dead ? Math.round(px(2) * fallK) : Math.round(hurtK * px(1));
  const armH = Math.max(2, px(4) - px(fallK));
  const armSwingX = o.moving && !dead ? armSwing * fx * 0.25 * s : 0;
  const lArmX = cx - px(hw) - px(2) - armOut + lx * 0.3 + armSwingX;
  const rArmX = cx + px(hw) + armOut + lx * 0.6 - armSwingX;
  const drawArm = (which: 'L' | 'R', behind: boolean): void => {
    const isL = which === 'L';
    const ax = isL ? lArmX : rArmX;
    const ay = isL ? lArmY : rArmY;
    const isWeapon = (which === weaponArm);
    const h = isWeapon ? armH + raise * 0.4 : armH;
    R(ctx, ax, ay, px(2), h, flash ?? OUTLINE);
    R(ctx, ax, ay, px(2), Math.max(1, h - 1), flash ?? col.armor);
    R(ctx, ax, ay + h - 1, px(2), 1, flash ?? col.skin);
    // NW key: arm top lift (near brighter); far limbs slightly dimmed = depth
    if (!flash) {
      ctx.save();
      ctx.globalAlpha = behind ? 0.2 : 0.45;
      R(ctx, ax, ay, px(2), 1, C.MIST);
      ctx.restore();
      if (behind) {
        ctx.save();
        ctx.globalAlpha = 0.18;
        R(ctx, ax, ay, px(2), h, C.DEEP);
        ctx.restore();
      }
    }
  };
  // far arm behind torso (occluded at shoulder = volume)
  if (proj.farArm === 'L') drawArm('L', true);
  else if (proj.farArm === 'R') drawArm('R', true);
  // torso
  R(ctx, cx - px(hw) - 1 + lx * 0.5, torsoY, px(hw * 2) + 2, torsoH, flash ?? OUTLINE);
  R(ctx, cx - px(hw) + lx * 0.5, torsoY + 1, px(hw * 2), Math.max(1, torsoH - 2), flash ?? col.armor);
  // belt trim
  R(ctx, cx - px(hw) + lx * 0.5, torsoY + torsoH - 2, px(hw * 2), 1, flash ?? col.trim);
  // NW key light: top-left lift + bottom-right shade + armor/metal specular
  if (!flash) {
    R(ctx, cx - px(hw) + lx * 0.5, torsoY + 1, px(hw * 2), 1, C.MIST);
    ctx.save();
    ctx.globalAlpha = 0.28;
    R(ctx, cx + px(hw) - 1 + lx * 0.5, torsoY + 1, 1, Math.max(1, torsoH - 2), C.DEEP);
    R(ctx, cx - px(hw) + lx * 0.5, torsoY + torsoH - 3, px(hw * 2), 1, C.DEEP);
    ctx.restore();
    if (extras === 'knight' || extras === 'guard' || extras === 'watcher') {
      R(ctx, cx - px(hw) + lx * 0.5 + 1, torsoY + 2, 1.5, 1.5, C.BONE);
      R(ctx, cx - px(hw) + lx * 0.5 + 1, torsoY + 4, 1, 1, C.FROST);
    } else if (extras === 'shrine' || extras === 'arcanist' || extras === 'robe') {
      R(ctx, cx - px(hw) + lx * 0.5 + 1, torsoY + 2, 1, 2, C.GOLD);
    }
  }
  // near arm(s) front
  if (proj.farArm === 'L') drawArm('R', false);
  else if (proj.farArm === 'R') drawArm('L', false);
  else { drawArm('L', false); drawArm('R', false); }

  // ================= head (8-way: front/back/side/3-4 + NW light) =================
  const nod = talkK > 0 ? Math.sin(talkK * 12) * talkK * px(1) : 0;
  const drinkTilt = drinking && potionT > 0.3 && potionT < 0.75 ? -px(1) : 0;
  const slumpX = dead ? fallK * px(3) : 0;
  const slumpY = dead ? fallK * px(2) : nod;
  const headX = cx + side * px(1.2) + lx * 0.7 + slumpX;
  const headY = top + px(1) + ly * 0.5 + slumpY + drinkTilt;
  const headW = px(8) * (isSideView ? 0.86 : diagonal ? 0.93 : 1);
  const headH = Math.max(3, px(7) - px(fallK * 2));
  R(ctx, headX - headW / 2, headY, headW, headH, flash ?? OUTLINE);
  // NW key: head top-left lift (volume even with post OFF)
  if (!flash) {
    R(ctx, headX - headW / 2, headY, headW, 1, C.FROST);
    R(ctx, headX - headW / 2, headY, 1, headH, C.MIST);
  }
  if (up) {
    // back view (N + back 3/4 NW/NE): hair-dominant
    R(ctx, headX - px(3), headY + 1, px(6), Math.max(1, headH - 2), flash ?? col.hair);
    if (diagonal && !dead) {
      // back 3/4: sliver of near cheek for depth (no eyes = facing away reads)
      const cheekX = side < 0 ? headX - headW / 2 : headX + headW / 2 - 2 * s;
      R(ctx, cheekX, headY + px(3), 2 * s, px(2), flash ?? col.skin);
    }
    if (dead) {
      R(ctx, headX - px(2), headY + px(3), px(1), px(1), flash ?? C.BLOOD);
      R(ctx, headX + px(1), headY + px(3), px(1), px(1), flash ?? C.BLOOD);
    }
  } else if (isSideView) {
    // profile (W/E): face + single front eye + nose + hair back
    R(ctx, headX - px(3), headY + 1, px(6), Math.max(1, headH - 2), flash ?? col.skin);
    const frontDir = faceMode === 'sideL' ? -1 : 1;
    // hair back half
    if (frontDir < 0) R(ctx, headX + px(1), headY + 1, px(2), Math.max(1, headH - 2), flash ?? col.hair);
    else R(ctx, headX - px(3), headY + 1, px(2), Math.max(1, headH - 2), flash ?? col.hair);
    // front eye (squeezed when hurt, blood when dead)
    const eyeX = headX + frontDir * px(1.2) - 0.5 * s;
    if (dead) R(ctx, eyeX, headY + px(3), px(1), px(1), flash ?? C.BLOOD);
    else if (hurtK > 0.5) R(ctx, eyeX, headY + px(4), px(1), 1, flash ?? OUTLINE);
    else R(ctx, eyeX, headY + px(3), px(1), px(2), flash ?? OUTLINE);
    // nose bump on front edge
    if (!dead) R(ctx, headX + frontDir * (headW / 2) - (frontDir > 0 ? 0 : 1 * s), headY + px(4), 1 * s, 1.5 * s, flash ?? col.skin);
  } else {
    // front + front 3/4 (S, SW/SE): two eyes offset, far eye narrower for 3/4
    R(ctx, headX - px(3), headY + 1, px(6), Math.max(1, headH - 2), flash ?? col.skin);
    const ex = side * px(1.2);
    const farNarrow = diagonal ? 0.75 : 1;
    // far eye = opposite side (SW far=right/east, SE far=left/west)
    const leftW = side < -0.3 ? px(1) : side > 0.3 ? px(1) * farNarrow : px(1);
    const rightW = side > 0.3 ? px(1) : side < -0.3 ? px(1) * farNarrow : px(1);
    if (dead) {
      R(ctx, headX - px(2) + ex, headY + px(3), leftW, px(1), flash ?? C.BLOOD);
      R(ctx, headX + px(1) + ex, headY + px(3), rightW, px(1), flash ?? C.BLOOD);
    } else if (hurtK > 0.5) {
      R(ctx, headX - px(2) + ex, headY + px(4), leftW, 1, flash ?? OUTLINE);
      R(ctx, headX + px(1) + ex, headY + px(4), rightW, 1, flash ?? OUTLINE);
    } else {
      R(ctx, headX - px(2) + ex, headY + px(3), leftW, px(2), flash ?? OUTLINE);
      R(ctx, headX + px(1) + ex, headY + px(3), rightW, px(2), flash ?? OUTLINE);
      // catchlight for 3/4 near eye (bloom-friendly micro-specular)
      if (diagonal) R(ctx, headX + (side < 0 ? -px(2) : px(1)) + ex, headY + px(3), 1, 1, C.BONE);
    }
  }
  // hair cap (foreshortened + NW highlight)
  R(ctx, headX - headW / 2, headY - px(1), headW, px(2), flash ?? col.hair);
  if (!up && !dead) R(ctx, headX - px(3), headY, px(6), 1, flash ?? col.hair);
  if (!flash && !dead) R(ctx, headX - headW / 2, headY - px(1), headW * 0.5, 1, C.FROST);

  // ================= weapon (IK tip-matched for VFX trails + bloom) =================
  // hand anchor: drawn weapon-arm hand (8-way near/visible side)
  const wArmX = weaponArm === 'L' ? lArmX : rArmX;
  const wArmY = weaponArm === 'L' ? lArmY : rArmY;
  const hx = wArmX + px(1) + lx * 0.2;
  const hy = wArmY + armH * 0.5 + raise * 0.2;
  const bladeLen = px(sil.bladeLen);
  const bladeW = Math.max(1.5, px(sil.bladeW) * 0.7);
  const showCudgel = extras === 'none' && (swinging || casting);
  const hideWeapon = dead && fallK >= 0.5;
  // IK tip (rig-computed shoulder→elbow→wrist chain, VFX trail anchor, emissive)
  const tipRig = rigPose.weaponTip;
  const shaftTo = (tx: number, ty: number, w: number, outline: string, fill: string): { tx: number; ty: number } => {
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return { tx: hx, ty: hy };
    const ang = Math.atan2(ty - hy, tx - hx);
    const len = Math.max(2, Math.hypot(tx - hx, ty - hy));
    return shaft(ctx, hx, hy, ang, len, w, outline, fill);
  };
  if (!hideWeapon && sil.staff) {
    // ---- staff (hand→IK tip + flaring gem for bloom) ----
    if (swinging || casting || windupK > 0.05) {
      shaftTo(tipRig.x, tipRig.y, bladeW, flash ?? OUTLINE, flash ?? C.EMBER);
      const gemC = extras === 'shrine' ? C.GOLD : C.MIST;
      const flare = casting ? castK : strikeK;
      const gs = (3 + flare * 2) * s;
      R(ctx, tipRig.x - gs / 2, tipRig.y - gs / 2, gs, gs, flash ?? gemC);
      R(ctx, tipRig.x - s, tipRig.y - s, 2 * s, 2 * s, flash ?? C.BONE);
      if (flare > 0.6) R(ctx, tipRig.x - 0.5 * s, tipRig.y - 0.5 * s, 1.5 * s, 1.5 * s, C.BONE);
    } else {
      // rest: hand→IK tip (blade up) + gem
      shaftTo(tipRig.x, tipRig.y, bladeW, flash ?? OUTLINE, flash ?? C.EMBER);
      const gemC = extras === 'shrine' ? C.GOLD : C.MIST;
      R(ctx, tipRig.x - px(1), tipRig.y - px(1), px(3), px(3), flash ?? gemC);
      R(ctx, tipRig.x, tipRig.y - 0.5 * s, 1, 1, flash ?? C.BONE);
    }
  } else if (!hideWeapon && (extras !== 'none' || showCudgel)) {
    // ---- blade / cudgel (hand→IK tip, hot core for bloom) ----
    const cudgel = extras === 'none';
    if (swinging) {
      // blader skill echo: ghost second arc (legacy angle, no trail)
      if (profile === 'blader' && casting) {
        const base = facingAngle(o.facing as SimFacing);
        const ang = base + swingAngle(profile, swingT);
        const echo = shaft(ctx, hx - 3 * s, hy, ang - 0.6, cudgel ? px(6) : bladeLen, bladeW, C.MIST, C.MIST);
        R(ctx, echo.tx - 1, echo.ty - 1, 2, 2, C.FROST);
      }
      const hot = swingT > 0.2 && swingT < 0.8;
      shaftTo(tipRig.x, tipRig.y, bladeW, flash ?? OUTLINE, flash ?? (hot || casting ? C.BONE : C.FROST));
      if (hot || casting) {
        R(ctx, tipRig.x - 1, tipRig.y - 1, 2.5, 2.5, flash ?? C.BONE);
        R(ctx, tipRig.x - 0.5, tipRig.y - 0.5, 1.5, 1.5, C.BONE);
      } else {
        R(ctx, tipRig.x - 0.75, tipRig.y - 0.75, 1.5, 1.5, flash ?? C.BONE);
      }
      // guard at hand + NW specular on edge
      R(ctx, hx - px(2), hy - 1, px(4), 2, flash ?? (cudgel ? C.EMBER : col.trim));
      if (!flash && !cudgel) R(ctx, hx - px(1), hy - 1, 2, 1, C.FROST);
    } else if (windupK > 0.05) {
      // telegraph: hand→IK tip (raised high) + hot core when charged
      shaftTo(tipRig.x, tipRig.y, bladeW, flash ?? OUTLINE, flash ?? C.FROST);
      if (windupK > 0.6) R(ctx, tipRig.x - 1, tipRig.y - 1, 2, 3, flash ?? C.BONE);
      else R(ctx, tipRig.x - 0.75, tipRig.y - 0.75, 1.5, 1.5, flash ?? C.BONE);
    } else if (dashK > 0.05) {
      // dash: hand→IK tip (swept back) + speed lines
      shaftTo(tipRig.x, tipRig.y, bladeW, flash ?? OUTLINE, flash ?? C.FROST);
      R(ctx, tipRig.x - 0.75, tipRig.y - 0.75, 1.5, 1.5, flash ?? C.BONE);
      R(ctx, hx - fx * 10 * s - 4, hy - 3, 6, 1.5, C.MIST);
      R(ctx, hx - fx * 12 * s - 4, hy + 1, 8, 1.5, C.FROST);
    } else if (casting) {
      // blade cast (blader triple): hand→IK tip (up) + flashing edge
      shaftTo(tipRig.x, tipRig.y, bladeW, flash ?? OUTLINE, flash ?? C.BONE);
      R(ctx, tipRig.x - 1, tipRig.y - 1, 2.5, 2.5, flash ?? C.BONE);
    } else if (!dead) {
      // rest: hand→IK tip (blade up) + trim guard + micro-specular
      shaftTo(tipRig.x, tipRig.y, bladeW, flash ?? OUTLINE, flash ?? (cudgel ? C.EMBER : C.FROST));
      R(ctx, tipRig.x - 0.75, tipRig.y - 0.75, 1.5, 1.5, flash ?? C.BONE);
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

  // ================= job extras (8-way) =================
  if (extras === 'knight' || extras === 'guard') {
    R(ctx, headX - px(1), headY - px(3), px(2), px(2), flash ?? C.FLAME);
    const padW = px(3) + (extras === 'knight' ? s : 0);
    R(ctx, cx - px(hw) - padW + lx * 0.5, torsoY - 1, padW, px(2), flash ?? col.trim);
    R(ctx, cx + px(hw) - s + lx * 0.5, torsoY - 1, padW, px(2), flash ?? col.trim);
    // NW specular on pads (armor/metal)
    if (!flash) {
      R(ctx, cx - px(hw) - padW + lx * 0.5, torsoY - 1, padW, 1, C.FROST);
      R(ctx, cx + px(hw) - s + lx * 0.5, torsoY - 1, padW, 1, C.FROST);
    }
    // shield on off-hand (opposite weaponArm = anatomically correct, drawn front)
    const sh = sil.shield || 1;
    const shieldLeft = weaponArm === 'R';
    const sx = shieldLeft ? cx - px(hw) - px(4) : cx + px(hw) + px(1);
    R(ctx, sx, armBaseY - px(1), px(3) * sh, px(6) * sh, flash ?? OUTLINE);
    R(ctx, sx, armBaseY - px(1), px(2) * sh, px(5) * sh, flash ?? C.SLATE);
    R(ctx, sx, armBaseY + px(1), px(2) * sh, 1, flash ?? C.GOLD);
    if (!flash) R(ctx, sx, armBaseY - px(1), px(2) * sh, 1, C.FROST);
  } else if (extras === 'watcher') {
    // pauldrons (drop as it dies) + visor slit handled below with pose
    const drop = fallK * px(3);
    R(ctx, cx - px(hw) - px(4) + lx * 0.5, torsoY - 1 + drop, px(4), px(3), flash ?? C.DEEP);
    R(ctx, cx + px(hw) + lx * 0.5, torsoY - 1 + drop, px(4), px(3), flash ?? C.DEEP);
    if (!flash) {
      R(ctx, cx - px(hw) - px(4) + lx * 0.5, torsoY - 1 + drop, px(4), 1, C.MIST);
      R(ctx, cx + px(hw) + lx * 0.5, torsoY - 1 + drop, px(4), 1, C.MIST);
    }
    R(ctx, headX - px(1), headY - px(3), px(2), px(2), flash ?? C.FLAME);
    if (!up) {
      const shake = windupK > 0.5 ? ((Math.floor(o.phase * 9) % 2 === 0 ? 1 : -1) * windupK * s) : 0;
      const visor = dead ? (fallK < 0.5 ? C.BLOOD : C.VOID) : windupK > 0.7 ? C.BONE : windupK > 0.05 ? C.GOLD : C.FLAME;
      // 8-way visor: side profile narrow + front offset, 3/4 foreshortened
      const visW = isSideView ? px(3) : diagonal ? px(5) : px(6);
      const visX = isSideView
        ? headX + (faceMode === 'sideL' ? -px(2.5) : px(0.5)) + shake
        : headX - visW / 2 + side * px(0.8) + shake;
      R(ctx, visX, headY + px(3), visW, Math.max(1, px(1.4)), flash ?? visor);
      if (!dead) {
        const coreW = isSideView ? px(2) : px(4) * (diagonal ? 0.85 : 1);
        const coreX = isSideView
          ? headX + (faceMode === 'sideL' ? -px(2) : px(0)) + shake
          : headX - coreW / 2 + side * px(0.8) + shake;
        R(ctx, coreX, headY + px(3), coreW, Math.max(1, px(1.4)), flash ?? C.GOLD);
        R(ctx, coreX + coreW / 2 - px(1), headY + px(3), px(2), 1, C.BONE);
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
  const pal = ENEMY_COLORS[kind] ?? { body: C.SLATE, dark: C.DEEP, glow: C.MIST };
  const s = Number.isFinite(o.scale) && o.scale > 0 ? Math.max(0.4, Math.min(3, o.scale)) : 1;
  const px = (n: number): number => n * s;
  const flash = o.flash ? C.BONE : null;
  // True 8-way projection (diagonals = 3/4 view, foreshortened).
  const proj = facingProjection(o.facing as SimFacing);
  const side = proj.side;
  const vert = proj.vert;
  const diagonal = proj.diagonal;
  const faceMode = proj.faceMode;
  const fa8 = facingAngle(o.facing as SimFacing);
  const fx = Math.cos(fa8);
  const fy = Math.sin(fa8);
  const anim = o.anim ?? (o.moving ? 'move' : 'idle');
  const dead = anim === 'dead';
  const _deadTE = Number.isFinite(o.deadT) ? (o.deadT as number) : 0.4;
  const fallK = dead ? Math.min(1, _deadTE / (kind === 'watcher' ? 0.6 : 0.3)) : 0;
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
    // ---- hop locomotion: stretch rising, squash on landing (8-way) ----
    const hopping = o.moving && !dead;
    const hopPh = hopping ? Math.abs(Math.sin(o.phase)) : 0;
    const rising = hopping && Math.cos(o.phase) > 0;
    const yOff = -hopPh * px(4);
    const shake = windupK > 0.05 && !dead ? ((Math.floor(o.phase * 14) % 2 === 0 ? 1 : -1) * windupK * px(1)) : 0;
    // 8-way lunge along facing (diagonals = 3/4, N/S = vertical)
    const lungeX = !dead ? strikeK * fx * px(4) : 0;
    const lungeY = !dead ? strikeK * fy * px(2) : 0;
    let sq = 0.15 + (!o.moving && !dead ? (Math.sin(o.phase * 1.5) * 0.5 + 0.5) * 0.2 : 0);
    if (hopping) sq += hopPh < 0.3 ? 0.4 : rising ? -0.18 : 0.12;
    sq += windupK * 0.3 + hurtK * 0.3 + fallK * 0.9;
    const w = px(11) + sq * px(7);
    const h = Math.max(2, px(8) - sq * px(6));
    drawShadow(ctx, o.x, o.y + 1, 6 * s, hopPh * 4);
    const x0 = o.x - w / 2 + lx + lungeX + shake;
    const y0 = o.y - h + yOff + lungeY * 0.5;
    R(ctx, x0 - 1, y0 - 1, w + 2, h + 2, flash ?? OUTLINE);
    R(ctx, x0, y0, w, h, flash ?? pal.body);
    R(ctx, x0 + 1, y0 + 1, w * 0.35, Math.max(1, h * 0.3), flash ?? pal.glow);
    if (!dead || fallK < 0.5) R(ctx, x0 + 2, y0 + 1, 3, 2, flash ?? C.BONE);
    // NW specular (bloom micro-catch) + top lift
    if (!flash && (!dead || fallK < 0.5)) R(ctx, x0 + w * 0.6, y0 + 1, 1.5, 1, C.FROST);
    // eyes (8-way offset: X by side, Y by vert = facing reads)
    const ex = side * px(2);
    const ey = y0 + h * 0.45 + vert * px(1);
    if (!dead) {
      const eyeH = hurtK > 0.4 ? 1 : px(3);
      R(ctx, o.x - px(3) + ex + lungeX, ey, px(2), eyeH, flash ?? OUTLINE);
      R(ctx, o.x + px(1) + ex + lungeX, ey, px(2), eyeH, flash ?? OUTLINE);
    }
    // attack maw (front edge toward facing) + landing splat droplets
    if (strikeK > 0.4 && !dead) {
      R(ctx, o.x - px(2) + ex + lungeX + fx * px(1), y0 + h - 3 + fy * px(1), px(4), 2, flash ?? C.VOID);
    }
    if (dead && fallK > 0.3) {
      R(ctx, x0 - 4, o.y - 2, 3, 2, pal.body);
      R(ctx, x0 + w + 1, o.y - 2, 3, 2, pal.body);
    }
    // crown nub (sinks as it pops, 8-way offset)
    if (!dead || fallK < 0.6) R(ctx, o.x - px(1) + lungeX * 0.5 + side * px(0.5), y0 - px(2), px(2), px(2), flash ?? pal.dark);
    if (o.dim > 0.25 && !o.flash) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.5, (o.dim - 0.25) * 0.8);
      R(ctx, x0, y0, w, 1, C.FROST);
      ctx.restore();
    }
  } else if (kind === 'wolf') {
    // ---- quadruped gallop: side/front/back + 3/4 (true 8-way, IK legs) ----
    const gallop = o.moving && !dead ? Math.sin(o.phase) : 0;
    const crouch = windupK * px(2);
    const pounce = strikeK;
    const pitch = gallop * px(1.2);
    const bodyDrop = dead ? px(3) * fallK : 0;
    const isSideWolf = faceMode === 'sideL' || faceMode === 'sideR';
    const isFrontWolf = vert > 0.3; // S + front 3/4 (SE/SW)
    if (isSideWolf) {
      // ---- side view (E/W): body horizontal, head leads, diagonal leg pairs ----
      const dir: number = side > 0 ? 1 : -1;
      const lungeX = dir * pounce * px(6) + lx;
      drawShadow(ctx, o.x, o.y + 1, 8 * s, pounce * 3);
      const x0 = o.x - px(7) + lungeX;
      const y0 = o.y - px(9) + pitch * 0.3 + crouch * 0.6 + bodyDrop - pounce * px(2);
      const wag = !o.moving && !dead ? Math.sin(o.phase * 2) * px(1.5) : 0;
      const tailY = y0 + px(1) + (o.moving ? -px(1) : 0) + windupK * px(2) + wag;
      const tailX = dir > 0 ? x0 - px(3) : x0 + px(14);
      R(ctx, tailX, tailY, px(3), px(2), flash ?? pal.dark);
      if (dead) {
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
      R(ctx, x0 - 1, y0 - 1, px(15), px(7), flash ?? OUTLINE);
      R(ctx, x0, y0, px(14), px(5), flash ?? pal.body);
      R(ctx, x0, y0, px(14), 1, flash ?? pal.glow);
      if (!flash) R(ctx, x0, y0, 3, 1, C.FROST);
      const hx = (dir > 0 ? x0 + px(12) : x0 - px(4)) + dir * pounce * px(2);
      const hy = y0 - px(4) - pitch * 0.5 - pounce * px(1);
      R(ctx, hx - 1, hy - 1, px(7), px(7), flash ?? OUTLINE);
      R(ctx, hx, hy, px(5), px(5), flash ?? pal.body);
      R(ctx, hx + (dir > 0 ? px(1) : px(2)), hy - px(2), px(2), px(2), flash ?? pal.dark);
      const snX = dir > 0 ? hx + px(5) : hx - px(2);
      R(ctx, snX, hy + px(3), px(2), px(2), flash ?? pal.dark);
      if (pounce > 0.45) {
        R(ctx, snX, hy + px(5), px(2), 1, flash ?? C.BONE);
        R(ctx, dir > 0 ? hx + px(4) : hx, hy + px(4), px(2), 1, flash ?? C.VOID);
      }
      const eyeW = windupK > 0.05 ? 2 : 1;
      R(ctx, dir > 0 ? hx + px(3) : hx + px(1), hy + px(1), eyeW, windupK > 0.05 ? 2 : 1, flash ?? C.GOLD);
      for (let i = 0; i < 4; i++) {
        const diag = i % 2 === 0 ? gallop : -gallop;
        const reach = i < 2 ? pounce * px(3) * dir : -pounce * px(2) * dir;
        const legX = x0 + px(1) + i * px(4) + diag * px(1.2) + reach;
        R(ctx, legX, o.y - px(4) + crouch * 0.5, px(2), px(4) - crouch * 0.5, flash ?? pal.dark);
      }
      void recoverK;
    } else if (isFrontWolf) {
      // ---- front view (S + front 3/4 SE/SW): head front, body foreshortened ----
      const off = side * px(3); // 3/4 offset (S=0, SE/SW=±)
      const lungeY = pounce * px(2.5);
      const lungeX = side * pounce * px(3) + lx;
      drawShadow(ctx, o.x, o.y + 1, 8 * s, pounce * 3);
      const bw = diagonal ? px(10) : px(8);
      const x0 = o.x - bw / 2 + off * 0.4 + lungeX * 0.5;
      const y0 = o.y - px(10) + pitch * 0.3 + crouch * 0.6 + bodyDrop + lungeY * 0.4 - pounce * px(1);
      // tail behind (up, north) wagging sideways
      const wag = Math.sin(o.phase * 2) * px(1.2);
      R(ctx, x0 + bw / 2 - px(1) + wag * 0.5, y0 - px(3), px(2), px(3), flash ?? pal.dark);
      if (dead) {
        R(ctx, x0 - 1, y0 + px(2), bw + 2, px(5), flash ?? OUTLINE);
        R(ctx, x0, y0 + px(2), bw, px(4), flash ?? pal.body);
        R(ctx, x0 + 1, y0 - px(1) * fallK, px(2), px(3) * fallK + 1, flash ?? pal.dark);
        R(ctx, x0 + bw - px(3), y0 - px(1) * fallK, px(2), px(3) * fallK + 1, flash ?? pal.dark);
        R(ctx, x0 + bw / 2 - px(2), y0 + px(4), px(4), px(2), flash ?? C.BLOOD);
        return;
      }
      // back legs behind (up, darker, drawn first = depth)
      const backY = o.y - px(5) + crouch * 0.5 - px(1);
      R(ctx, x0 + 1 - gallop * px(0.8), backY, px(2), px(3), flash ?? pal.dark);
      R(ctx, x0 + bw - px(3) + gallop * px(0.8), backY, px(2), px(3), flash ?? pal.dark);
      // body foreshortened (short = facing viewer)
      R(ctx, x0 - 1, y0 - 1, bw + 2, px(7), flash ?? OUTLINE);
      R(ctx, x0, y0, bw, px(5), flash ?? pal.body);
      R(ctx, x0, y0, bw, 1, flash ?? pal.glow);
      if (!flash) R(ctx, x0, y0, 2, 1, C.FROST);
      // head front (large, toward viewer) with 3/4 offset
      const hx = o.x - px(3.5) + off + lungeX * 0.6;
      const hy = y0 + px(1) - pitch * 0.4 + lungeY * 0.3;
      R(ctx, hx - 1, hy - 1, px(7), px(7), flash ?? OUTLINE);
      R(ctx, hx, hy, px(5) + 2 * s, px(5), flash ?? pal.body);
      // ears top
      R(ctx, hx + px(0.5), hy - px(2), px(2), px(2), flash ?? pal.dark);
      R(ctx, hx + px(3.5), hy - px(2), px(2), px(2), flash ?? pal.dark);
      // snout center-down (toward viewer) + jaw when pouncing
      const snX = hx + px(2.5) + off * 0.3;
      R(ctx, snX - px(1), hy + px(4), px(3), px(2), flash ?? pal.dark);
      if (pounce > 0.45) {
        R(ctx, snX - px(1), hy + px(6), px(3), 1, flash ?? C.BONE);
        R(ctx, snX - px(1), hy + px(5), px(3), 1, flash ?? C.VOID);
      }
      // two front eyes (far narrower for 3/4, gold for bloom)
      const eyeY = hy + px(1.5);
      const lw = side < -0.3 ? 1.5 * s : side > 0.3 ? 1 * s : 1.5 * s;
      const rw = side > 0.3 ? 1.5 * s : side < -0.3 ? 1 * s : 1.5 * s;
      const eh = windupK > 0.05 ? 2 : 1.5 * s;
      R(ctx, hx + px(1) + off * 0.2, eyeY, lw, eh, flash ?? C.GOLD);
      R(ctx, hx + px(4) + off * 0.2, eyeY, rw, eh, flash ?? C.GOLD);
      // front legs (near, front) alternating with gallop
      const fY = o.y - px(4) + crouch * 0.5;
      R(ctx, x0 + 1 + gallop * px(1), fY, px(2), px(4) - crouch * 0.5, flash ?? pal.dark);
      R(ctx, x0 + bw - px(3) - gallop * px(1), fY, px(2), px(4) - crouch * 0.5, flash ?? pal.dark);
      void recoverK;
    } else {
      // ---- back view (N + back 3/4 NE/NW): tail front, head back/small ----
      const off = side * px(3);
      const lungeY = -pounce * px(2.5);
      const lungeX = side * pounce * px(3) + lx;
      drawShadow(ctx, o.x, o.y + 1, 8 * s, pounce * 3);
      const bw = diagonal ? px(10) : px(8);
      const x0 = o.x - bw / 2 + off * 0.4 + lungeX * 0.5;
      const y0 = o.y - px(10) + pitch * 0.3 + crouch * 0.6 + bodyDrop + lungeY * 0.3 - pounce * px(1);
      // front legs far (up, behind, drawn first)
      const farY = o.y - px(5) + crouch * 0.5 - px(1);
      R(ctx, x0 + 1 + gallop * px(0.8), farY, px(2), px(3), flash ?? pal.dark);
      R(ctx, x0 + bw - px(3) - gallop * px(0.8), farY, px(2), px(3), flash ?? pal.dark);
      if (dead) {
        R(ctx, x0 - 1, y0 + px(2), bw + 2, px(5), flash ?? OUTLINE);
        R(ctx, x0, y0 + px(2), bw, px(4), flash ?? pal.body);
        R(ctx, x0 + bw / 2 - px(2), y0 - px(1), px(4), px(2), flash ?? C.BLOOD);
        return;
      }
      // body foreshortened (rear view)
      R(ctx, x0 - 1, y0 - 1, bw + 2, px(7), flash ?? OUTLINE);
      R(ctx, x0, y0, bw, px(5), flash ?? pal.body);
      R(ctx, x0, y0, bw, 1, flash ?? pal.glow);
      // head back (small, up, facing away) + ears; 3/4 peeks one eye
      const hx = o.x - px(2.5) + off + lungeX * 0.6;
      const hy = y0 - px(4) - pitch * 0.4 + lungeY * 0.3;
      R(ctx, hx - 1, hy - 1, px(5), px(5), flash ?? OUTLINE);
      R(ctx, hx, hy, px(5) - 1, px(4), flash ?? pal.body);
      R(ctx, hx + 0.5 * s, hy - px(1.5), px(1.5), px(1.5), flash ?? pal.dark);
      R(ctx, hx + px(3), hy - px(1.5), px(1.5), px(1.5), flash ?? pal.dark);
      if (diagonal && !dead) {
        // back 3/4: near cheek + peeking eye
        const peekX = side < 0 ? hx - px(1) : hx + px(4);
        R(ctx, peekX, hy + px(2), 1.5 * s, 1.5 * s, flash ?? C.GOLD);
      }
      // tail front (large, toward viewer, wagging) + hind legs near
      const wag = Math.sin(o.phase * 2) * px(1.5);
      const tailX = o.x - px(1.5) + off * 0.5 + wag * 0.6 + lungeX * 0.3;
      R(ctx, tailX - 1, o.y - px(7) + crouch * 0.4, px(3) + 2, px(5), flash ?? OUTLINE);
      R(ctx, tailX, o.y - px(7) + crouch * 0.4, px(3), px(4), flash ?? pal.dark);
      if (!flash) R(ctx, tailX, o.y - px(7) + crouch * 0.4, px(3), 1, C.MIST);
      const hY = o.y - px(4) + crouch * 0.5;
      R(ctx, x0 + 1 - gallop * px(1), hY, px(2), px(4) - crouch * 0.5, flash ?? pal.dark);
      R(ctx, x0 + bw - px(3) + gallop * px(1), hY, px(2), px(4) - crouch * 0.5, flash ?? pal.dark);
      void recoverK;
    }
  } else if (kind === 'shade') {
    // ---- hover glider: cloak wave, charge orb, dissolve (8-way) ----
    const glide = o.moving && !dead ? Math.sin(o.phase * 2) : 0;
    const hover = (dead ? 0 : Math.sin(o.phase * 1.3) * px(1.5) + glide * px(0.8)) - fallK * px(8);
    const leanX = o.moving && !dead ? fx * px(2) : 0;
    const leanY = o.moving && !dead ? fy * px(1) : 0;
    const jitter = hurtK > 0.05 && !dead ? ((Math.floor(o.phase * 20) % 2 === 0 ? 1 : -1) * hurtK * px(1)) : 0;
    const shrink = 1 - fallK * 0.45;
    const x0 = o.x + leanX + lx * 0.5 + jitter;
    const y0 = o.y - px(12) + hover + leanY * 0.5;
    // cloak flares on strike, settles through recover, compresses on charge
    const flarePx = swingT >= 0 ? strikeK * px(2) : anim === 'attack' ? Math.max(0.2, 1 - recoverK) * px(1.5) : 0;
    const cw = Math.max(4, px(12) * shrink + flarePx - windupK * px(1));
    drawShadow(ctx, o.x, o.y + 1, 6 * s, 3 + hover * -0.3);
    if (dead && fallK > 0.85) return; // fully dissolved (renderer fade covers the rest)
    // wispy tail (waves while gliding)
    const wave = dead ? 0 : Math.sin(o.phase * 3) * px(1);
    R(ctx, x0 - px(4) * shrink + wave * 0.4, o.y - px(5) + hover, px(8) * shrink, px(5) * shrink, flash ?? pal.dark);
    R(ctx, x0 - px(2) * shrink, o.y - px(3) + hover, px(4) * shrink, Math.max(1, px(3) * shrink), flash ?? OUTLINE);
    // cloak body (compresses while charging) + NW top lift
    R(ctx, x0 - cw / 2 - 1, y0 - 1, cw + 2, px(10) * shrink + 2, flash ?? OUTLINE);
    R(ctx, x0 - cw / 2, y0, cw, px(10) * shrink, flash ?? pal.body);
    if (!flash) R(ctx, x0 - cw / 2, y0, cw, 1, C.MIST);
    // hood (8-way offset)
    R(ctx, x0 - px(5) * shrink + side * px(1), y0 - px(3), px(10) * shrink, px(5), flash ?? OUTLINE);
    R(ctx, x0 - px(4) * shrink + side * px(1), y0 - px(2), px(8) * shrink, px(4), flash ?? pal.dark);
    // eyes (8-way: X by side, Y by vert; swell while charging)
    if (!dead || fallK < 0.4) {
      const ex = side * px(1);
      const eyOff = vert * px(0.6);
      const ew = (windupK > 0.05 ? 3 : 2) * s;
      R(ctx, x0 - px(2) + ex, y0 + px(1) + eyOff, ew, s, flash ?? C.BONE);
      R(ctx, x0 + px(1) + ex, y0 + px(1) + eyOff, ew, s, flash ?? C.BONE);
      if (windupK > 0.4) {
        R(ctx, x0 - px(3) + ex, y0 + eyOff, px(3), px(3), C.FROST);
        R(ctx, x0 + px(1) + ex, y0 + eyOff, px(3), px(3), C.FROST);
      }
    }
    // charge orb grows in front during telegraph (8-way: front = facing dir)
    if (windupK > 0.05 && !dead) {
      const orbR = (1.5 + windupK * 2.5) * s;
      const ox = x0 + fx * (px(8) + windupK * px(3));
      const oy = y0 + px(5) + fy * px(2);
      R(ctx, ox - orbR - 1, oy - orbR - 1, orbR * 2 + 2, orbR * 2 + 2, flash ?? OUTLINE);
      R(ctx, ox - orbR, oy - orbR, orbR * 2, orbR * 2, flash ?? C.MIST);
      R(ctx, ox - 1, oy - 1, 2.5, 2.5, flash ?? C.BONE);
    }
    // recoil flare right after the bolt leaves (behind = opposite facing)
    if (swingT >= 0 && !dead) {
      R(ctx, x0 - cw / 2 - 2 - fx * px(2), y0 + px(2) - fy * px(1), 2, px(6), flash ?? C.MIST);
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
    // headscarf (8-way offset, rides the breathe lift so it never floats)
    const s = o.scale;
    const projN = facingProjection(o.facing as SimFacing);
    const side = projN.side;
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
