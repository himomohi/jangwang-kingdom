import { C, OUTLINE, JOB_COLORS, ENEMY_COLORS } from './palette';

/** Facing: 0=down, 1=up, 2=left, 3=right */
export type Facing = 0 | 1 | 2 | 3;

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
}

function R(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
}

export function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = 'rgba(16,24,40,0.35)';
  ctx.beginPath();
  ctx.ellipse(Math.round(x), Math.round(y), r, Math.max(2, r * 0.38), 0, 0, Math.PI * 2);
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

/** Parametric top-down-ish humanoid. Feet at (x,y). Height ~17*s. */
export function drawHumanoid(
  ctx: CanvasRenderingContext2D,
  o: BodyOpts,
  col: HumanoidColors,
  extras: 'none' | 'knight' | 'blader' | 'arcanist' | 'shrine' | 'bandit' | 'guard' | 'robe' | 'merchant',
): void {
  const s = o.scale;
  const px = (n: number): number => n * s;
  const cx = o.x;
  const feet = o.y;
  const swing = Math.sin(o.phase) * (o.moving ? 1 : 0);
  const bob = o.moving ? Math.abs(Math.sin(o.phase)) * px(1) : 0;
  const top = feet - px(17) + bob;
  const flash = o.flash ? C.BONE : null;

  const side = o.facing === 2 ? -1 : o.facing === 3 ? 1 : 0;
  const up = o.facing === 1;

  // legs
  const legSwing = Math.round(swing * px(2));
  R(ctx, cx - px(4), feet - px(5) + bob, px(3), px(5) - bob, flash ?? OUTLINE);
  R(ctx, cx + px(1), feet - px(5) + bob, px(3), px(5) - bob, flash ?? OUTLINE);
  R(ctx, cx - px(4) + legSwing * 0.4, feet - px(5) + bob, px(3), px(3), flash ?? col.legs);
  R(ctx, cx + px(1) - legSwing * 0.4, feet - px(5) + bob, px(3), px(3), flash ?? col.legs);
  // boots
  R(ctx, cx - px(4) + legSwing * 0.4, feet - px(2) + bob, px(3), px(2), flash ?? col.boots);
  R(ctx, cx + px(1) - legSwing * 0.4, feet - px(2) + bob, px(3), px(2), flash ?? col.boots);

  // torso outline + armor
  R(ctx, cx - px(5), top + px(7), px(10), px(6), flash ?? OUTLINE);
  R(ctx, cx - px(4), top + px(8), px(8), px(4), flash ?? col.armor);
  // belt trim
  R(ctx, cx - px(4), top + px(11), px(8), px(1), flash ?? col.trim);

  // arms
  const armSwing = Math.round(swing * px(1.5));
  const armY = top + px(8) + (o.moving ? armSwing * 0.3 : 0);
  R(ctx, cx - px(7), armY, px(2), px(4), flash ?? OUTLINE);
  R(ctx, cx + px(5), armY, px(2), px(4), flash ?? OUTLINE);
  R(ctx, cx - px(7), armY, px(2), px(3), flash ?? col.armor);
  R(ctx, cx + px(5), armY, px(2), px(3), flash ?? col.armor);
  // hands
  R(ctx, cx - px(7), armY + px(3), px(2), px(1), flash ?? col.skin);
  R(ctx, cx + px(5), armY + px(3), px(2), px(1), flash ?? col.skin);

  // head outline + face
  R(ctx, cx - px(4) + side * px(1), top + px(1), px(8), px(7), flash ?? OUTLINE);
  if (up) {
    R(ctx, cx - px(3) + side * px(1), top + px(2), px(6), px(5), flash ?? col.hair);
  } else {
    R(ctx, cx - px(3) + side * px(1), top + px(2), px(6), px(5), flash ?? col.skin);
    // eyes
    const ex = side * px(1);
    R(ctx, cx - px(2) + ex, top + px(4), px(1), px(2), flash ?? OUTLINE);
    R(ctx, cx + px(1) + ex, top + px(4), px(1), px(2), flash ?? OUTLINE);
  }
  // hair cap
  R(ctx, cx - px(4) + side * px(1), top, px(8), px(2), flash ?? col.hair);
  if (!up) R(ctx, cx - px(3) + side * px(1), top + px(1), px(6), px(1), flash ?? col.hair);

  // weapon in right hand (or left when facing left)
  const wx = side <= 0 ? cx + px(7) : cx - px(7);
  const wy = armY + px(1);
  const swinging = o.swing >= 0;
  const sw = swinging ? Math.sin(o.swing * Math.PI) : 0;
  if (extras === 'arcanist' || extras === 'robe' || extras === 'shrine' || extras === 'merchant') {
    // staff
    const tilt = swinging ? -sw * px(4) : 0;
    R(ctx, wx - px(1), wy - px(8) + tilt, px(2), px(12), flash ?? OUTLINE);
    R(ctx, wx, wy - px(8) + tilt, px(1), px(12), flash ?? C.EMBER);
    const gemC = extras === 'shrine' ? C.GOLD : extras === 'arcanist' ? C.MIST : C.SAND;
    R(ctx, wx - px(1), wy - px(10) + tilt, px(3), px(3), flash ?? gemC);
  } else if (extras !== 'none') {
    // blade
    const lift = swinging ? -sw * px(8) : 0;
    const spread = swinging ? sw * px(3) * (side <= 0 ? 1 : -1) : 0;
    R(ctx, wx - px(1) + spread, wy - px(9) + lift, px(3), px(9), flash ?? OUTLINE);
    R(ctx, wx + spread, wy - px(8) + lift, px(1), px(7), flash ?? C.FROST);
    R(ctx, wx - px(2) + spread, wy - px(1) + lift * 0.2, px(5), px(1), flash ?? col.trim);
  }

  // job extras
  if (extras === 'knight' || extras === 'guard') {
    // helmet crest + shoulder pads
    R(ctx, cx - px(1) + side * px(1), top - px(2), px(2), px(2), flash ?? C.FLAME);
    R(ctx, cx - px(7), top + px(7), px(3), px(2), flash ?? col.trim);
    R(ctx, cx + px(4), top + px(7), px(3), px(2), flash ?? col.trim);
    // shield on off-hand
    const sx = side <= 0 ? cx - px(9) : cx + px(6);
    R(ctx, sx, armY - px(1), px(3), px(6), flash ?? OUTLINE);
    R(ctx, sx, armY - px(1), px(2), px(5), flash ?? C.SLATE);
    R(ctx, sx, armY + px(1), px(2), px(1), flash ?? C.GOLD);
  } else if (extras === 'blader') {
    // scarf flutter
    const fl = Math.sin(o.phase * 1.7) * px(1);
    R(ctx, cx - px(6) - (side < 0 ? px(2) : 0), top + px(7) + fl * 0.4, px(4), px(2), flash ?? C.FLAME);
  } else if (extras === 'arcanist' || extras === 'robe') {
    // wide-brim hat
    R(ctx, cx - px(6) + side * px(1), top - px(1), px(12), px(2), flash ?? OUTLINE);
    R(ctx, cx - px(5) + side * px(1), top - px(1), px(10), px(1), flash ?? C.DUSK);
    R(ctx, cx - px(2) + side * px(1), top - px(5), px(4), px(4), flash ?? OUTLINE);
    R(ctx, cx - px(1) + side * px(1), top - px(4), px(2), px(3), flash ?? C.DUSK);
  } else if (extras === 'shrine') {
    // circlet + veil
    R(ctx, cx - px(4) + side * px(1), top + px(1), px(8), px(1), flash ?? C.GOLD);
    R(ctx, cx - px(5) + side * px(1), top + px(2), px(1), px(6), flash ?? C.BONE);
    R(ctx, cx + px(4) + side * px(1), top + px(2), px(1), px(6), flash ?? C.BONE);
  } else if (extras === 'bandit') {
    // eye mask + hood
    if (!up) R(ctx, cx - px(3) + side * px(1), top + px(4), px(6), px(2), flash ?? C.VOID);
    R(ctx, cx - px(4) + side * px(1), top - px(1), px(8), px(2), flash ?? C.BLOOD);
  } else if (extras === 'merchant') {
    R(ctx, cx - px(4) + side * px(1), top - px(1), px(8), px(1), flash ?? C.GOLD);
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
    : 'none') as 'none' | 'knight' | 'blader' | 'arcanist' | 'shrine';
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
  drawShadow(ctx, o.x, o.y + 1, (kind === 'watcher' ? 10 : kind === 'wolf' ? 8 : 6) * s);

  if (kind === 'slime') {
    const squash = o.moving ? Math.abs(Math.sin(o.phase)) : 0.15;
    const w = px(11) + squash * px(3);
    const h = px(8) - squash * px(3);
    const x0 = o.x - w / 2;
    const y0 = o.y - h;
    R(ctx, x0 - 1, y0 - 1, w + 2, h + 2, flash ?? OUTLINE);
    R(ctx, x0, y0, w, h, flash ?? pal.body);
    R(ctx, x0 + 1, y0 + 1, w * 0.35, h * 0.3, flash ?? pal.glow);
    // eyes
    const ex = side * px(2);
    const ey = y0 + h * 0.45;
    R(ctx, o.x - px(3) + ex, ey, px(2), px(3), flash ?? OUTLINE);
    R(ctx, o.x + px(1) + ex, ey, px(2), px(3), flash ?? OUTLINE);
    // crown nub
    R(ctx, o.x - px(1), y0 - px(2), px(2), px(2), flash ?? pal.dark);
  } else if (kind === 'wolf') {
    const run = o.moving ? Math.sin(o.phase) * px(1.5) : 0;
    const dir = side === 0 ? 1 : side;
    const x0 = o.x - px(7);
    const y0 = o.y - px(9);
    // tail
    R(ctx, dir > 0 ? x0 - px(3) : x0 + px(14), y0 + px(1) + run * 0.4, px(3), px(2), flash ?? pal.dark);
    // body
    R(ctx, x0 - 1, y0 - 1, px(15), px(7), flash ?? OUTLINE);
    R(ctx, x0, y0, px(14), px(5), flash ?? pal.body);
    R(ctx, x0, y0, px(14), px(1), flash ?? pal.glow);
    // head
    const hx = dir > 0 ? x0 + px(12) : x0 - px(4);
    R(ctx, hx - 1, y0 - px(4) - 1 + run * 0.3, px(7), px(7), flash ?? OUTLINE);
    R(ctx, hx, y0 - px(4) + run * 0.3, px(5), px(5), flash ?? pal.body);
    // ear
    R(ctx, hx + (dir > 0 ? px(1) : px(2)), y0 - px(6) + run * 0.3, px(2), px(2), flash ?? pal.dark);
    // snout + eye
    R(ctx, dir > 0 ? hx + px(5) : hx - px(2), y0 - px(1) + run * 0.3, px(2), px(2), flash ?? pal.dark);
    R(ctx, dir > 0 ? hx + px(3) : hx + px(1), y0 - px(3) + run * 0.3, px(1), px(1), flash ?? C.FLAME);
    // legs
    for (let i = 0; i < 4; i++) {
      const lx = x0 + px(1) + i * px(4) + (i % 2 === 0 ? run : -run) * 0.5;
      R(ctx, lx, o.y - px(4), px(2), px(4), flash ?? pal.dark);
    }
  } else if (kind === 'bandit') {
    drawHumanoid(
      ctx,
      o,
      { skin: C.SKIN, hair: C.VOID, armor: C.BLOOD, trim: C.EMBER, legs: C.DEEP, boots: C.VOID },
      'bandit',
    );
  } else if (kind === 'shade') {
    const hover = Math.sin(o.phase * 1.3) * px(1.5);
    const x0 = o.x;
    const y0 = o.y - px(12) + hover;
    // wispy tail
    R(ctx, x0 - px(4), o.y - px(5) + hover, px(8), px(5), flash ?? pal.dark);
    R(ctx, x0 - px(2), o.y - px(3) + hover, px(4), px(3), flash ?? OUTLINE);
    // cloak body
    R(ctx, x0 - px(6) - 1, y0 - 1, px(12) + 2, px(10) + 2, flash ?? OUTLINE);
    R(ctx, x0 - px(6), y0, px(12), px(10), flash ?? pal.body);
    // hood
    R(ctx, x0 - px(5) + side * px(1), y0 - px(3), px(10), px(5), flash ?? OUTLINE);
    R(ctx, x0 - px(4) + side * px(1), y0 - px(2), px(8), px(4), flash ?? pal.dark);
    // glowing eyes
    const ex = side * px(1);
    R(ctx, x0 - px(2) + ex, y0 + px(1), px(2), px(1), flash ?? pal.glow);
    R(ctx, x0 + px(1) + ex, y0 + px(1), px(2), px(1), flash ?? pal.glow);
  } else {
    // watcher — hulking armored sentinel
    drawHumanoid(
      ctx,
      { ...o, scale: o.scale },
      { skin: C.SLATE, hair: C.VOID, armor: C.SLATE, trim: C.FLAME, legs: C.DEEP, boots: C.VOID },
      'knight',
    );
    // glowing visor slit
    const s2 = o.scale;
    const top = o.y - 17 * s2 + (o.moving ? Math.abs(Math.sin(o.phase)) * s2 : 0);
    const side2 = o.facing === 2 ? -1 : o.facing === 3 ? 1 : 0;
    if (o.facing !== 1) {
      R(ctx, o.x - 3 * s2 + side2 * s2, top + 4 * s2, 6 * s2, 1.6 * s2, o.flash ? C.BONE : C.FLAME);
    }
    // pauldrons
    R(ctx, o.x - 8 * s2, top + 6 * s2, 4 * s2, 3 * s2, o.flash ? C.BONE : C.DEEP);
    R(ctx, o.x + 4 * s2, top + 6 * s2, 4 * s2, 3 * s2, o.flash ? C.BONE : C.DEEP);
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
    // headscarf
    const s = o.scale;
    const side = o.facing === 2 ? -1 : o.facing === 3 ? 1 : 0;
    const top = o.y - 17 * s;
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
  drawShadow(ctx, x, y + 1, 5);
  if (kind === 'gold') {
    R(ctx, x - 4, y - 7 + bob, 8, 6, OUTLINE);
    R(ctx, x - 3, y - 6 + bob, 6, 4, C.GOLD);
    R(ctx, x - 1, y - 5 + bob, 2, 2, C.BONE);
  } else if (kind === 'potion') {
    R(ctx, x - 3, y - 8 + bob, 6, 7, OUTLINE);
    R(ctx, x - 2, y - 6 + bob, 4, 4, C.FLAME);
    R(ctx, x - 2, y - 6 + bob, 4, 1, C.BONE);
    R(ctx, x - 1, y - 10 + bob, 2, 3, C.SAND);
  } else {
    R(ctx, x - 5, y - 7 + bob, 10, 6, OUTLINE);
    R(ctx, x - 4, y - 6 + bob, 8, 4, C.MIST);
    R(ctx, x - 4, y - 6 + bob, 8, 1, C.FROST);
    R(ctx, x - 1, y - 6 + bob, 2, 4, C.GOLD);
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
  const c = holy ? C.GOLD : friendly ? C.EMBER : C.DUSK;
  const r = 3 + Math.sin(t * 18) * 0.8;
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(Math.round(x), Math.round(y), Math.ceil(r + 1.5), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(Math.round(x), Math.round(y), Math.ceil(r), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.BONE;
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
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
  R(ctx, x - 3, y - 21, 7, 5, flick > 0.5 ? C.GOLD : C.EMBER);
  R(ctx, x - 1, y - 21, 3, 5, C.BONE);
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
  // windows (warm lit)
  R(ctx, x + 6, y + roofH + 4, 8, 8, OUTLINE);
  R(ctx, x + 7, y + roofH + 5, 6, 6, C.GOLD);
  R(ctx, x + w - 14, y + roofH + 4, 8, 8, OUTLINE);
  R(ctx, x + w - 13, y + roofH + 5, 6, 6, C.GOLD);
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
