/** Pure combat math. All damage decided here in sim. */

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

/** Facing from a direction vector. */
export function facingFromVec(dx: number, dy: number): 0 | 1 | 2 | 3 {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 2 : 3;
  return dy < 0 ? 1 : 0;
}

/** Is point (px,py) within melee arc from (ox,oy) facing angle? */
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

export function facingAngle(f: 0 | 1 | 2 | 3): number {
  return f === 0 ? Math.PI / 2 : f === 1 ? -Math.PI / 2 : f === 2 ? Math.PI : 0;
}
