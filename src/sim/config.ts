import type { EnemyKind, ItemDef, JobId, Stats, ZoneId } from './types';

export const TILE = 16;
export const WORLD_W = 96;
export const WORLD_H = 72;

export const SAVE_KEY = 'jangwang-kingdom-save-v1';
export const DAY_LENGTH = 300; // seconds per full day

/**
 * Global game-feel tunables (late-90s MMO pace: "weighty", not sluggish).
 * All tempo numbers live here so the whole game can be retuned in one place.
 * `was X` comments record pre-slowdown values (c78f56a baseline).
 */
export const TEMPO = {
  // --- player locomotion / basic attack ---
  playerBaseSpd: 76, // was 96 (-20.8%)
  playerAttackCd: 0.46, // was 0.38 (+21%)
  bladerAttackCdMul: 0.82, // was 0.8
  playerSwingDur: 0.3, // was 0.22 — swing pose 0..1 duration (s)
  enemySwingDur: 0.34, // was 0.25
  playerLunge: 4, // was 5 — forward step on swing (px)

  // --- skill / potion / talk / death pose durations ---
  skillCastDur: 0.45, // cast pose length (s)
  potionDur: 0.55, // potion drink pose length (s)
  talkDur: 1.4, // interact/talk pose hold (s)
  playerDeadFade: 1.2, // player death pose fade (s)
  enemyDeadFade: 0.9, // was 0.6 — corpse lifetime (s)
  enemyDeadFadeElite: 1.3, // elite lingers longer

  // --- dash skill (commoner/knight) ---
  dashDur: 0.22, // was 0.16 (+37% — less frantic)
  dashDist: 44, // was 46 (dash speed 287 -> 200 px/s)
  dashHitRadius: 30,

  // --- hurt readability (i-frames / flash) ---
  playerHurtCd: 0.9, // was 0.7 (+29%)
  enemyHurtFlash: 0.35, // was 0.25

  // --- enemy cadence ---
  enemySpeedMul: 0.82, // global chase slowdown (-18%)
  enemyAtkCdMul: 1.3, // all enemy attack cooldowns x1.3
  enemyRecover: 0.42, // was 0.3 — post-attack recovery (s)
  /** Per-kind attack telegraph (windup) in seconds. 0.2-0.4s readable; elite heavier. */
  windup: { slime: 0.4, wolf: 0.32, bandit: 0.36, shade: 0.4, watcher: 0.65 } as Record<EnemyKind, number>,

  // --- knockback (power + decay) ---
  knockDecayPlayer: 6.5, // was 8 — slower decay = longer readable slide
  knockDecayEnemy: 6.0, // was 7
  knockPlayerAtk: 135, // was 120
  knockDash: 165, // was 160
  knockBlader: 95, // was 90
  knockHoly: 210, // was 200
  knockToPlayer: 135, // was 130
  knockProjectile: 105, // was 100

  // --- projectiles ---
  projFriendlySpd: 225, // was 260 (-13%)
  projEnemySpd: 145, // was 170 (-15%)

  // --- camera / animation rates (renderer) ---
  cameraFollow: 3.2, // was 6 — lower = smoother, less snappy
  walkPhaseRate: 8.5, // was 11 rad/s — matches slower stride
  idlePhaseRate: 2.0, // was 2.5 — calmer breathe
  trailTtl: 0.32, // was 0.28 — slash trail linger (s)
  footDustCd: 0.18, // was 0.14 fallback; primary dust is stride-synced
  pickupMagnetSpd: 105, // was 120

  // --- floating text / screen fx / spawner / toasts ---
  floatTtl: 1.15, // was 1
  floatRise: 22, // was 26 px/s
  shakeDur: 0.32, // was 0.3
  flashDur: 0.4, // was 0.35
  toastDur: 3200, // was 2600 ms
  spawnTick: 1.4, // was 1.2
};

export const JOB_NAMES: Record<JobId, string> = {
  commoner: '평민',
  knight: '왕국기사',
  blader: '검객',
  arcanist: '비전술사',
  shrine: '성소무녀',
};

export const JOB_DESC: Record<JobId, string> = {
  commoner: '아직 길을 정하지 못한 모험가.',
  knight: '단단한 방패와 돌진. 생존의 전문가.',
  blader: '빠른 연격으로 적을 베는 검사.',
  arcanist: '화염구를 쏘는 원거리 술사.',
  shrine: '치유와 신성의 빛을 다루는 무녀.',
};

export const JOB_SKILL: Record<JobId, { name: string; desc: string; mp: number; cd: number }> = {
  commoner: { name: '몸통박치기', desc: '앞으로 돌진하며 부딪힌 적에게 피해', mp: 5, cd: 5 },
  knight: { name: '방패 돌진', desc: '돌진 + 피해 + 4초 받는 피해 절반', mp: 8, cd: 8 },
  blader: { name: '삼연격', desc: '전방 3연속 베기 (치명타율 상승)', mp: 10, cd: 6 },
  arcanist: { name: '화염구', desc: '3연발 화염 투사체', mp: 10, cd: 4 },
  shrine: { name: '치유의 빛', desc: 'HP 회복 + 주변 적에게 신성 피해', mp: 12, cd: 9 },
};

/** Additive stat modifiers per job (applied on top of base+level). */
export const JOB_MODS: Record<JobId, Partial<Stats>> = {
  commoner: {},
  knight: { maxHp: 40, def: 4, atk: 2, spd: -6 },
  blader: { atk: 5, spd: 14, crit: 0.1, maxHp: 10 },
  arcanist: { maxMp: 25, atk: 3, def: -1 },
  shrine: { maxMp: 15, maxHp: 20, def: 1 },
};

export function xpForLevel(level: number): number {
  return Math.floor(18 * Math.pow(level, 1.55)) + level * 6;
}

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  xp: number;
  goldMin: number;
  goldMax: number;
  aggro: number;
  leash: number;
  atkRange: number;
  atkCd: number;
  ranged: boolean;
  scale: number;
  zones: ZoneId[];
  weight: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  slime: {
    kind: 'slime', name: '슬라임', hp: 20, atk: 5, def: 0, spd: 42, xp: 7,
    goldMin: 2, goldMax: 6, aggro: 90, leash: 220, atkRange: 18, atkCd: 1.2,
    ranged: false, scale: 1, zones: ['field', 'forest', 'road'], weight: 40,
  },
  wolf: {
    kind: 'wolf', name: '들늑대', hp: 34, atk: 8, def: 1, spd: 105, xp: 14,
    goldMin: 3, goldMax: 8, aggro: 150, leash: 320, atkRange: 20, atkCd: 1.0,
    ranged: false, scale: 1, zones: ['forest', 'field'], weight: 26,
  },
  bandit: {
    kind: 'bandit', name: '노상강도', hp: 52, atk: 11, def: 2, spd: 78, xp: 24,
    goldMin: 8, goldMax: 16, aggro: 170, leash: 340, atkRange: 24, atkCd: 1.1,
    ranged: false, scale: 1, zones: ['road', 'field', 'ruin'], weight: 22,
  },
  shade: {
    kind: 'shade', name: '잔영', hp: 60, atk: 13, def: 2, spd: 66, xp: 34,
    goldMin: 6, goldMax: 14, aggro: 200, leash: 360, atkRange: 150, atkCd: 1.8,
    ranged: true, scale: 1, zones: ['ruin', 'arena', 'road'], weight: 16,
  },
  watcher: {
    kind: 'watcher', name: '철갑감시자', hp: 520, atk: 20, def: 6, spd: 58, xp: 220,
    goldMin: 80, goldMax: 140, aggro: 320, leash: 420, atkRange: 34, atkCd: 1.4,
    ranged: false, scale: 1.7, zones: ['arena'], weight: 0,
  },
};

export const ZONE_NAMES: Record<ZoneId, string> = {
  town: '엠버게이트 (잔광성 외곽)',
  field: '잔광 들판',
  forest: '서쪽 숲',
  road: '동쪽 가도',
  ruin: '북쪽 폐허',
  arena: '감시자의 제단',
};

export const ITEMS: Record<string, ItemDef> = {
  potion: { id: 'potion', name: '빨간 물약', kind: 'potion', desc: 'HP 40 회복', price: 10, tier: 0, heal: 40 },
  w0: { id: 'w0', name: '낡은 단검', kind: 'weapon', slot: 'weapon', desc: '공격력 +2', price: 15, tier: 0, bonus: { atk: 2 } },
  w1: { id: 'w1', name: '강철검', kind: 'weapon', slot: 'weapon', desc: '공격력 +5', price: 60, tier: 1, bonus: { atk: 5 } },
  w2: { id: 'w2', name: '기사단장검', kind: 'weapon', slot: 'weapon', desc: '공격력 +8, 방어 +2', price: 160, tier: 2, bonus: { atk: 8, def: 2 } },
  w3: { id: 'w3', name: '쾌도 월영', kind: 'weapon', slot: 'weapon', desc: '공격력 +7, 치명 +12%', price: 200, tier: 2, bonus: { atk: 7, crit: 0.12 } },
  w4: { id: 'w4', name: '비전 수정검', kind: 'weapon', slot: 'weapon', desc: '공격력 +6, 마나 +20', price: 190, tier: 2, bonus: { atk: 6, maxMp: 20 } },
  w5: { id: 'w5', name: '잔광의 성검', kind: 'weapon', slot: 'weapon', desc: '공격력 +12, 치명 +8%', price: 480, tier: 3, bonus: { atk: 12, crit: 0.08 } },
  a0: { id: 'a0', name: '천 갑옷', kind: 'armor', slot: 'armor', desc: '방어 +2, HP +10', price: 20, tier: 0, bonus: { def: 2, maxHp: 10 } },
  a1: { id: 'a1', name: '가죽 갑옷', kind: 'armor', slot: 'armor', desc: '방어 +4, HP +20', price: 70, tier: 1, bonus: { def: 4, maxHp: 20 } },
  a2: { id: 'a2', name: '기사단 갑주', kind: 'armor', slot: 'armor', desc: '방어 +7, HP +40', price: 180, tier: 2, bonus: { def: 7, maxHp: 40 } },
  a3: { id: 'a3', name: '성소 법의', kind: 'armor', slot: 'armor', desc: '방어 +5, 마나 +25, HP +20', price: 220, tier: 2, bonus: { def: 5, maxMp: 25, maxHp: 20 } },
  c0: { id: 'c0', name: '들꽃 반지', kind: 'charm', slot: 'charm', desc: 'HP +15, 이동 +6', price: 30, tier: 0, bonus: { maxHp: 15, spd: 6 } },
  c1: { id: 'c1', name: '늑대 이빨', kind: 'charm', slot: 'charm', desc: '공격 +3, 치명 +5%', price: 90, tier: 1, bonus: { atk: 3, crit: 0.05 } },
  c2: { id: 'c2', name: '잔광 부적', kind: 'charm', slot: 'charm', desc: '전 능력 상승', price: 300, tier: 3, bonus: { atk: 4, def: 3, maxHp: 30, maxMp: 15 } },
};

/** Shop stock (merchant). */
export const SHOP_STOCK = ['potion', 'w0', 'w1', 'a0', 'a1', 'c0', 'c1'];

/** Drop tables: enemy kind -> item ids with weights. */
export const DROPS: Record<string, { id: string; w: number }[]> = {
  slime: [
    { id: 'w0', w: 4 },
    { id: 'a0', w: 4 },
    { id: 'c0', w: 3 },
  ],
  wolf: [
    { id: 'w1', w: 4 },
    { id: 'a1', w: 3 },
    { id: 'c1', w: 5 },
  ],
  bandit: [
    { id: 'w1', w: 4 },
    { id: 'w3', w: 2 },
    { id: 'a1', w: 4 },
    { id: 'c1', w: 4 },
  ],
  shade: [
    { id: 'w4', w: 4 },
    { id: 'a3', w: 3 },
    { id: 'w2', w: 2 },
  ],
  watcher: [
    { id: 'w5', w: 5 },
    { id: 'c2', w: 5 },
    { id: 'w2', w: 4 },
    { id: 'a2', w: 4 },
  ],
};

export const POTION_DROP_CHANCE: Record<string, number> = {
  slime: 0.1,
  wolf: 0.12,
  bandit: 0.16,
  shade: 0.16,
  watcher: 1,
};

export const EQUIP_DROP_CHANCE: Record<string, number> = {
  slime: 0.06,
  wolf: 0.09,
  bandit: 0.14,
  shade: 0.16,
  watcher: 1,
};
