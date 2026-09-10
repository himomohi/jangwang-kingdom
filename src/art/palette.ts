/**
 * LOCKED 16-color palette.
 * Source of truth: docs/palette-v1.md on main (d972d54).
 * Do not add colors. Never use #000 outlines.
 */
export const LOCKED_16 = [
  "#0B0C14", // 0 심야
  "#1A1F2E", // 1 돌그림자
  "#2E3A4A", // 2 성벽돌
  "#4A5A6A", // 3 석재
  "#6A7A88", // 4 안개돌
  "#8A9AAA", // 5 하이라이트돌
  "#3A4A28", // 6 들판흙
  "#5A6A38", // 7 풀
  "#7A8A48", // 8 밝은풀
  "#2A3A5A", // 9 깊은물
  "#4A6A8A", // 10 물빛
  "#C8A060", // 11 횃불/금속
  "#E09040", // 12 횃불핵
  "#C05060", // 13 생명/피악센트
  "#E8D8C0", // 14 피부/천
  "#F0F0E8", // 15 하이라이트
] as const;

export const PALETTE = LOCKED_16;

export type PaletteIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

export const C = {
  night: 0,
  shade: 1,
  brick: 2,
  stone: 3,
  mist: 4,
  highlightStone: 5,
  soil: 6,
  grass: 7,
  grassLite: 8,
  deepWater: 9,
  water: 10,
  metal: 11,
  ember: 12,
  life: 13,
  cloth: 14,
  shine: 15,
} as const;

export const RGB: readonly [number, number, number][] = PALETTE.map((hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
});

export function hexOf(i: number): string {
  return PALETTE[Math.max(0, Math.min(15, i | 0))] ?? PALETTE[0];
}

export function assertLocked16(docHex: readonly string[]): void {
  if (PALETTE.length !== 16) throw new Error("palette: must be 16 colors");
  if (docHex.length !== 16) throw new Error("palette: docs/palette-v1.md must list 16 hex");
  for (let i = 0; i < 16; i++) {
    const code = PALETTE[i]!.toUpperCase();
    const doc = docHex[i]!.toUpperCase();
    if (code !== doc) throw new Error(`palette: index ${i} ${code} != doc ${doc}`);
    if (code === "#000000" || code === "#000") throw new Error("palette: #000 forbidden");
  }
}
