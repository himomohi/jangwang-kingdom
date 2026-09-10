/**
 * LOCKED 16-color palette for 잔광왕국 (Jangwang Kingdom).
 *
 * Rules (do not change without a full art pass):
 * - Exactly 16 entries. All world/UI codegen art must use ONLY these colors.
 * - Cold environment range (blues/teals/greens) + warm accent range (ember/gold/blood).
 * - NO pure-black outlines. Darkest tone is VOID (#101828); use it for outlines.
 * - DOM UI chrome may reuse these same tokens (no extra hues except alpha blends).
 */
export const PALETTE = [
  '#101828', // 0 VOID   — darkest blue-ink, outlines & night
  '#1d2b45', // 1 DEEP   — deep shadow blue
  '#3a4a6b', // 2 SLATE  — cold mid blue
  '#7d9bbf', // 3 MIST   — pale cold blue
  '#c9d8e8', // 4 FROST  — near-white cold
  '#2e4a3e', // 5 PINE   — dark cold green
  '#4f7d5a', // 6 MOSS   — mid cold green
  '#8fc07a', // 7 LEAF   — bright cold green
  '#d8cfae', // 8 SAND   — neutral warm parchment
  '#e8933c', // 9 EMBER  — warm orange accent
  '#e14e2b', // 10 FLAME — warm red-orange accent
  '#f2c14e', // 11 GOLD  — warm gold accent
  '#8e2f3c', // 12 BLOOD — dark warm red
  '#5c4a7a', // 13 DUSK  — cold violet shade
  '#e8b98a', // 14 SKIN  — warm skin tone
  '#f4f1e4', // 15 BONE  — lightest warm white
] as const;

export type PaletteIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

export const C = {
  VOID: PALETTE[0],
  DEEP: PALETTE[1],
  SLATE: PALETTE[2],
  MIST: PALETTE[3],
  FROST: PALETTE[4],
  PINE: PALETTE[5],
  MOSS: PALETTE[6],
  LEAF: PALETTE[7],
  SAND: PALETTE[8],
  EMBER: PALETTE[9],
  FLAME: PALETTE[10],
  GOLD: PALETTE[11],
  BLOOD: PALETTE[12],
  DUSK: PALETTE[13],
  SKIN: PALETTE[14],
  BONE: PALETTE[15],
} as const;

/** Outline color — never pure black. */
export const OUTLINE = C.VOID;

/** Job accent colors (all from palette). */
export const JOB_COLORS: Record<string, string> = {
  commoner: C.SAND,
  knight: C.MIST,
  blader: C.FLAME,
  arcanist: C.DUSK,
  shrine: C.GOLD,
};

/** Enemy body colors (all from palette). */
export const ENEMY_COLORS: Record<string, { body: string; dark: string; glow: string }> = {
  slime: { body: C.LEAF, dark: C.MOSS, glow: C.FROST },
  wolf: { body: C.SLATE, dark: C.DEEP, glow: C.MIST },
  bandit: { body: C.BLOOD, dark: C.VOID, glow: C.EMBER },
  shade: { body: C.DUSK, dark: C.VOID, glow: C.MIST },
  watcher: { body: C.SLATE, dark: C.VOID, glow: C.FLAME },
};
