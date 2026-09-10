export const TILE = 16;
export const INTERNAL_W = 384;
export const INTERNAL_H = 216;
export const STEP = 1 / 60;
export const MAP_W = 96;
export const MAP_H = 80;

export const DOWN = 0;
export const LEFT = 1;
export const RIGHT = 2;
export const UP = 3;
export type Facing = 0 | 1 | 2 | 3;

export type JobId = "commoner" | "knight" | "blader" | "arcanist" | "shrine";

export type EnemyKind = "slime" | "wolf" | "bandit" | "shade" | "ironward";

export type EquipSlot = "weapon" | "helm" | "body" | "cape";

export type ItemId =
  | "rusty_knife"
  | "ember_blade"
  | "twin_edge"
  | "glow_staff"
  | "shrine_rod"
  | "wool_cape"
  | "dusk_cape"
  | "iron_helm"
  | "hide_coat"
  | "ironward_plate"
  | "slime_gel"
  | "ember_flask"
  | "mana_tea"
  | "wolf_fang"
  | "shade_dust"
  | "bandit_coin";

export type WeaponLook = "dagger" | "sword" | "saber" | "staff" | "rod";
export type HelmLook = "none" | "hair" | "helm" | "hood" | "circlet";
export type BodyLook = "tunic" | "mail" | "coat" | "robe" | "vestment" | "plate";
export type CapeLook = "short" | "royal" | "light" | "arcane" | "holy";

export interface ItemDef {
  id: ItemId;
  name: string;
  desc: string;
  slot: EquipSlot | "use" | "misc" | "gold";
  atk?: number;
  def?: number;
  hp?: number;
  mp?: number;
  heal?: number;
  restoreMp?: number;
  gold?: number;
  weaponLook?: WeaponLook;
  helmLook?: HelmLook;
  bodyLook?: BodyLook;
  capeLook?: CapeLook;
}

export interface InvStack {
  id: ItemId;
  qty: number;
}

export type Screen = "title" | "play" | "dead";
