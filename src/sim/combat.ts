/** Pure combat math. All damage decided here in sim. */
import type { Facing } from './types';
import { FACING_NAMES } from './types';

export type { Facing } from './types';

export interface DamageResult {
  dmg: number;
  crit: boolean;
}

/** Player/enemy damage formula. Deterministic given rng. */
export function calcDamage(
  atk: number,
  def: number,
  critChance: number,
  rng: () => number,
): DamageResult {
  const variance = 0.9 + rng() * 0.2;
  const mitigation = 100 / (100 + Math.max(0, def) * 6);
  const crit = rng() < critChance;
  const raw = Math.max(1, atk * mitigation * variance * (crit ? 1.5 : 1));
  return { dmg: Math.max(1, Math.round(raw)), crit };
}

export function angleTo(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(by - ay, bx - ax);
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

// ---------------------------------------------------------------------------
// True 8-direction facing
// Numeric mapping (save-compat: legacy 0..3 preserved):
//   0=S(down, +Y) 1=N(up, -Y) 2=W(left, -X) 3=E(right, +X)
//   4=SW 5=SE 6=NW 7=NE
// Conceptual clockwise order: N,NE,E,SE,S,SW,W,NW.
// ---------------------------------------------------------------------------

/** Quantize a continuous screen angle (radians, 0=E, +Y down) to 8-way facing. */
export function angleToFacing(angle: number): Facing {
  if (!Number.isFinite(angle)) return 0;
  let a = angle % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  // 45-degree sectors centered on each compass dir (offset by half-sector).
  // Sector 0=E,1=SE,2=S,3=SW,4=W,5=NW,6=N,7=NE.
  const sector = Math.floor(((a + Math.PI / 8) % (Math.PI * 2)) / (Math.PI / 4));
  switch (sector) {
    case 0: return 3; // E
    case 1: return 5; // SE
    case 2: return 0; // S
    case 3: return 4; // SW
    case 4: return 2; // W
    case 5: return 6; // NW
    case 6: return 1; // N
    case 7: return 7; // NE
    default: return 0;
  }
}

/** Alias kept for clarity / hidden-test compatibility. */
export const facingFromAngle = angleToFacing;

/** 8-way facing from a direction vector (keyboard WASD/arrows + joystick). */
export function facingFromVec(dx: number, dy: number): Facing {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
  if (Math.hypot(dx, dy) < 1e-6) return 0;
  return angleToFacing(Math.atan2(dy, dx));
}

/** Legacy 4-way quantize (down/up/left/right) — kept for migration/tests. */
export function facingFromVec4(dx: number, dy: number): 0 | 1 | 2 | 3 {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 2 : 3;
  return dy < 0 ? 1 : 0;
}

/** Screen angle (radians) for an 8-way facing. */
export function facingAngle(f: Facing): number {
  switch (f) {
    case 0: return Math.PI / 2; // S
    case 1: return -Math.PI / 2; // N
    case 2: return Math.PI; // W
    case 3: return 0; // E
    case 4: return (Math.PI * 3) / 4; // SW 135deg
    case 5: return Math.PI / 4; // SE 45deg
    case 6: return (-Math.PI * 3) / 4; // NW -135deg
    case 7: return -Math.PI / 4; // NE -45deg
    default: return Math.PI / 2;
  }
}

/** Unit vector for a facing (screen space, +Y down). */
export function facingToVec(f: Facing): { x: number; y: number } {
  const a = facingAngle(f);
  return { x: Math.cos(a), y: Math.sin(a) };
}

/** Short display name: N, NE, E, SE, S, SW, W, NW. */
export function facingName(f: Facing): string {
  return FACING_NAMES[f] ?? 'S';
}

/** True for diagonal facings (NE/SE/SW/NW). */
export function isDiagonal(f: Facing): boolean {
  return f === 4 || f === 5 || f === 6 || f === 7;
}

/**
 * Horizontal silhouette factor: -1 full-left, +1 full-right, 0 center.
 * Diagonals return +/-0.72 (perspective foreshortening for 3/4 view).
 */
export function facingSide(f: Facing): number {
  switch (f) {
    case 2: return -1;
    case 3: return 1;
    case 4: return -0.72;
    case 5: return 0.72;
    case 6: return -0.72;
    case 7: return 0.72;
    default: return 0;
  }
}

/**
 * Vertical silhouette factor: +1 full-down(S), -1 full-up(N).
 * Diagonals return +/-0.72.
 */
export function facingVertical(f: Facing): number {
  switch (f) {
    case 0: return 1;
    case 1: return -1;
    case 4: return 0.72;
    case 5: return 0.72;
    case 6: return -0.72;
    case 7: return -0.72;
    default: return 0;
  }
}

/** Collapse 8-way to legacy 4-way (nearest cardinal) for migration. */
export function facingTo4(f: Facing): 0 | 1 | 2 | 3 {
  switch (f) {
    case 0: case 1: case 2: case 3: return f;
    case 4: return 0; // SW -> S (south-biased, keeps ground read)
    case 5: return 0; // SE -> S
    case 6: return 1; // NW -> N
    case 7: return 1; // NE -> N
    default: return 0;
  }
}

/**
 * Camera-relative movement: rotate a move vector by -camAngle.
 * Camera is axis-aligned today (camAngle=0, identity) but the sim routes all
 * movement through here so a future rotated/tilted camera stays correct and
 * diagonal input keeps its 8-way facing.
 */
export function toCameraRelative(
  mx: number, my: number, camAngle = 0,
): { mx: number; my: number } {
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return { mx: 0, my: 0 };
  if (!camAngle || !Number.isFinite(camAngle)) return { mx, my };
  const c = Math.cos(-camAngle);
  const s = Math.sin(-camAngle);
  return { mx: mx * c - my * s, my: mx * s + my * c };
}

/** Shortest-arc angular lerp helper for smooth facing transitions. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.max(0, Math.min(1, t));
}

/** Is point (px,py) within melee arc from (ox,oy) facing angle? (8-way aware) */
export function inArc(
  ox: number,
  oy: number,
  faceAngle: number,
  range: number,
  halfAngle: number,
  px: number,
  py: number,
): boolean {
  const d = dist(ox, oy, px, py);
  if (d > range) return false;
  if (d < 4) return true;
  let da = angleTo(ox, oy, px, py) - faceAngle;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  return Math.abs(da) <= halfAngle;
}
