/** Pure sim types — no DOM, no canvas. All combat/loot/XP/equip rules live in sim. */

export type JobId = 'commoner' | 'knight' | 'blader' | 'arcanist' | 'shrine';
export type EnemyKind = 'slime' | 'wolf' | 'bandit' | 'shade' | 'watcher';
export type ZoneId = 'town' | 'field' | 'forest' | 'road' | 'ruin' | 'arena';
export type Facing = 0 | 1 | 2 | 3; // down up left right
export type Slot = 'weapon' | 'armor' | 'charm';

export interface Stats {
  maxHp: number;
  maxMp: number;
  atk: number;
  def: number;
  spd: number; // px per second
  crit: number; // 0..1
}

export interface ItemDef {
  id: string;
  name: string;
  kind: 'potion' | 'weapon' | 'armor' | 'charm';
  desc: string;
  price: number;
  tier: number; // 0 common .. 3 rare
  slot?: Slot;
  bonus?: Partial<Stats>;
  heal?: number;
}

export interface InvEntry {
  id: string;
  qty: number;
}

export interface PlayerState {
  x: number;
  y: number;
  facing: Facing;
  job: JobId;
  level: number;
  xp: number;
  xpNext: number;
  hp: number;
  mp: number;
  gold: number;
  stats: Stats;
  inv: InvEntry[];
  equip: Record<Slot, string | null>; // item id
  potions: number;
  atkCd: number;
  skillCd: number;
  skillCdMax: number;
  hurtCd: number;
  swingT: number; // -1 none else 0..1 progress
  castT: number; // skill-cast pose: -1 none else 0..1 progress
  potionT: number; // potion-drink pose: -1 none else 0..1 progress
  talkT: number; // interact/talk pose hold (seconds remaining)
  deadT: number; // seconds since death (death pose driver)
  shieldT: number; // knight damage reduction timer
  kx: number; // knockback velocity
  ky: number;
  alive: boolean;
  kills: number;
}

export type EnemyAI = 'idle' | 'chase' | 'windup' | 'recover' | 'return';

export interface EnemyState {
  uid: number;
  kind: EnemyKind;
  x: number;
  y: number;
  facing: Facing;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
  xp: number;
  ai: EnemyAI;
  stateT: number;
  hurtCd: number;
  atkCd: number;
  kx: number;
  ky: number;
  spawnX: number;
  spawnY: number;
  zone: ZoneId;
  elite: boolean;
  swingT: number;
  dead: boolean;
  deadT: number;
}

export interface NpcState {
  id: string;
  kind: 'guard' | 'jobmaster' | 'merchant' | 'innkeeper';
  name: string;
  x: number;
  y: number;
  facing: Facing;
}

export interface PickupState {
  uid: number;
  kind: 'gold' | 'potion' | 'equip';
  itemId: string | null;
  gold: number;
  x: number;
  y: number;
  ttl: number;
}

export interface ProjectileState {
  uid: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  friendly: boolean;
  holy: boolean;
  dmg: number;
  radius: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: 'dmg' | 'crit' | 'hurt' | 'heal' | 'gold' | 'info';
  ttl: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  ttlMax: number;
  color: number; // palette index
  size: number;
}

/** Events emitted by sim each tick for renderer/audio/UI. */
export type SimEvent =
  | { t: 'sfx'; id: string }
  | { t: 'toast'; text: string }
  | { t: 'shake'; power: number }
  | { t: 'flash'; color: string }
  | { t: 'levelup' }
  | { t: 'died' }
  | { t: 'job'; job: JobId }
  | { t: 'zone'; zone: ZoneId };

/** Input snapshot consumed by sim.update. Built by input layer (keyboard+touch). */
export interface SimInput {
  mx: number; // move vector -1..1
  my: number;
  attack: boolean; // edge-triggered
  skill: boolean; // edge-triggered
  interact: boolean; // edge-triggered
  potion: boolean; // edge-triggered
}
