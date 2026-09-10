import type { Synth } from "../audio/synth";
import type { Input } from "../input/keys";
import { ITEMS } from "./items";
import { hashSeed, irand, mulberry32, pick } from "./rng";
import {
  DOWN,
  LEFT,
  MAP_H,
  MAP_W,
  RIGHT,
  TILE,
  UP,
  type Facing,
  type InvStack,
  type ItemId,
  type JobId,
  type Screen,
} from "./types";
import { buildWorld, walkable, type World } from "./world";

export interface ActorLookState {
  job: JobId;
  helm: "none" | "hair" | "helm" | "hood" | "circlet";
  body: "tunic" | "mail" | "coat" | "robe" | "vestment" | "plate";
  cape: "short" | "royal" | "light" | "arcane" | "holy";
  weapon: "dagger" | "sword" | "saber" | "staff" | "rod";
  plated: boolean;
}

export interface Player {
  x: number;
  y: number;
  facing: Facing;
  job: JobId;
  name: string;
  level: number;
  xp: number;
  xpNext: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  atk: number;
  def: number;
  gold: number;
  inv: InvStack[];
  equip: Partial<Record<"weapon" | "helm" | "body" | "cape", ItemId>>;
  attackCd: number;
  skillCd: number;
  anim: number;
  attackT: number;
  invuln: number;
  moving: boolean;
}

export interface Mob {
  uid: number;
  kind: "slime" | "wolf" | "bandit" | "shade" | "ironward";
  name: string;
  x: number;
  y: number;
  sx: number;
  sy: number;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  xp: number;
  speed: number;
  radius: number;
  aggro: number;
  attackCd: number;
  dead: boolean;
  respawn: number;
  elite: boolean;
  facing: Facing;
  anim: number;
}

export interface Npc {
  id: string;
  name: string;
  title: string;
  x: number;
  y: number;
}

export interface Drop {
  uid: number;
  x: number;
  y: number;
  item: ItemId;
  qty: number;
}

export interface Shot {
  uid: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  life: number;
  kind: "orb" | "pulse";
}

export interface FloatTxt {
  x: number;
  y: number;
  text: string;
  life: number;
  color: number;
}

export interface Quest {
  slimes: number;
  slimesNeed: number;
  bandits: number;
  banditsNeed: number;
  talked: boolean;
  done: boolean;
}

export interface Toast {
  text: string;
  life: number;
}

export interface Game {
  world: World;
  player: Player;
  mobs: Mob[];
  npcs: Npc[];
  drops: Drop[];
  shots: Shot[];
  floats: FloatTxt[];
  quest: Quest;
  screen: Screen;
  dialog: string[];
  dialogKind: "none" | "trainer" | "help";
  bagOpen: boolean;
  jobPick: boolean;
  toasts: Toast[];
  camX: number;
  camY: number;
  time: number;
  uid: number;
  log: string[];
  dirtyUi: number;
}

const JOB_NAME: Record<JobId, string> = {
  commoner: "평민",
  knight: "왕국기사",
  blader: "검객",
  arcanist: "비전술사",
  shrine: "성소무녀",
};

const JOB_SKILL: Record<JobId, string> = {
  commoner: "휘두르기",
  knight: "돌격베기",
  blader: "연참",
  arcanist: "잔광탄",
  shrine: "성소파동",
};

function xpNeed(level: number): number {
  return Math.floor(18 * Math.pow(level, 1.35));
}

function recalc(p: Player): void {
  let hp = 42 + p.level * 8;
  let mp = 16 + p.level * 3;
  let atk = 3 + Math.floor(p.level * 0.7);
  let def = 1 + Math.floor(p.level * 0.3);
  if (p.job === "knight") {
    hp += 22;
    def += 4;
    atk += 3;
  } else if (p.job === "blader") {
    hp += 8;
    atk += 5;
    def += 1;
  } else if (p.job === "arcanist") {
    hp += 4;
    mp += 22;
    atk += 4;
  } else if (p.job === "shrine") {
    hp += 12;
    mp += 16;
    atk += 3;
    def += 1;
  }
  for (const id of Object.values(p.equip)) {
    if (!id) continue;
    const it = ITEMS[id];
    atk += it.atk ?? 0;
    def += it.def ?? 0;
    hp += it.hp ?? 0;
    mp += it.mp ?? 0;
  }
  const ratio = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  const mr = p.maxMp > 0 ? p.mp / p.maxMp : 1;
  p.maxHp = hp;
  p.maxMp = mp;
  p.atk = atk;
  p.def = def;
  p.hp = Math.max(1, Math.round(hp * ratio));
  p.mp = Math.round(mp * mr);
}

export function playerLook(p: Player): ActorLookState {
  const weapon = ITEMS[p.equip.weapon ?? "rusty_knife"];
  const helm = p.equip.helm ? ITEMS[p.equip.helm] : null;
  const body = p.equip.body ? ITEMS[p.equip.body] : null;
  const cape = p.equip.cape ? ITEMS[p.equip.cape] : null;
  const plated = body?.bodyLook === "plate";
  const jobHelm =
    p.job === "knight" ? "helm" : p.job === "arcanist" ? "hood" : p.job === "shrine" ? "circlet" : "hair";
  const jobBody =
    p.job === "knight" ? "mail" : p.job === "blader" ? "coat" : p.job === "arcanist" ? "robe" : p.job === "shrine" ? "vestment" : "tunic";
  const jobCape =
    p.job === "knight" ? "royal" : p.job === "blader" ? "light" : p.job === "arcanist" ? "arcane" : p.job === "shrine" ? "holy" : "short";
  const jobWep =
    p.job === "knight" ? "sword" : p.job === "blader" ? "saber" : p.job === "arcanist" ? "staff" : p.job === "shrine" ? "rod" : "dagger";
  return {
    job: p.job,
    helm: helm?.helmLook ?? jobHelm,
    body: plated ? "plate" : (body?.bodyLook ?? jobBody),
    cape: cape?.capeLook ?? jobCape,
    weapon: weapon.weaponLook ?? jobWep,
    plated,
  };
}

function makePlayer(): Player {
  const p: Player = {
    x: 48 * TILE + 8,
    y: 66 * TILE + 8,
    facing: DOWN,
    job: "commoner",
    name: "잔광의 여행자",
    level: 1,
    xp: 0,
    xpNext: xpNeed(1),
    hp: 1,
    maxHp: 1,
    mp: 1,
    maxMp: 1,
    atk: 1,
    def: 0,
    gold: 12,
    inv: [
      { id: "slime_gel", qty: 2 },
      { id: "mana_tea", qty: 1 },
    ],
    equip: { weapon: "rusty_knife", cape: "wool_cape" },
    attackCd: 0,
    skillCd: 0,
    anim: 0,
    attackT: 0,
    invuln: 0,
    moving: false,
  };
  recalc(p);
  p.hp = p.maxHp;
  p.mp = p.maxMp;
  return p;
}

let nextUid = 1;
function uid(): number {
  return nextUid++;
}

function mob(
  kind: Mob["kind"],
  name: string,
  x: number,
  y: number,
  stats: { hp: number; atk: number; def: number; xp: number; speed: number; elite?: boolean },
): Mob {
  return {
    uid: uid(),
    kind,
    name,
    x,
    y,
    sx: x,
    sy: y,
    hp: stats.hp,
    maxHp: stats.hp,
    atk: stats.atk,
    def: stats.def,
    xp: stats.xp,
    speed: stats.speed,
    radius: stats.elite ? 10 : 7,
    aggro: 0,
    attackCd: 0,
    dead: false,
    respawn: 0,
    elite: !!stats.elite,
    facing: DOWN,
    anim: 0,
  };
}

function spawnMobs(seed: number): Mob[] {
  const rng = mulberry32(hashSeed(seed ^ 0x51a1));
  const list: Mob[] = [];
  for (let i = 0; i < 7; i++) {
    const x = (18 + irand(rng, 60)) * TILE + 8;
    const y = (22 + irand(rng, 26)) * TILE + 8;
    list.push(mob("slime", "들판 슬라임", x, y, { hp: 18, atk: 4, def: 0, xp: 8, speed: 28 }));
  }
  for (let i = 0; i < 3; i++) {
    const x = (10 + irand(rng, 16)) * TILE + 8;
    const y = (24 + irand(rng, 18)) * TILE + 8;
    list.push(mob("wolf", "들늑대", x, y, { hp: 28, atk: 7, def: 1, xp: 14, speed: 42 }));
  }
  for (let i = 0; i < 3; i++) {
    const x = (44 + irand(rng, 8)) * TILE + 8;
    const y = (20 + irand(rng, 24)) * TILE + 8;
    list.push(mob("bandit", "길목 도적", x, y, { hp: 32, atk: 8, def: 1, xp: 18, speed: 36 }));
  }
  for (let i = 0; i < 3; i++) {
    const x = (42 + irand(rng, 12)) * TILE + 8;
    const y = (4 + irand(rng, 10)) * TILE + 8;
    list.push(mob("shade", "석실 그늘", x, y, { hp: 26, atk: 9, def: 2, xp: 22, speed: 30 }));
  }
  list.push(
    mob("ironward", "철갑감시자", 48 * TILE + 8, 8 * TILE + 8, {
      hp: 140,
      atk: 14,
      def: 5,
      xp: 90,
      speed: 22,
      elite: true,
    }),
  );
  return list;
}

export function createGame(seed = 0x7a6b): Game {
  nextUid = 1;
  const world = buildWorld(seed);
  const player = makePlayer();
  return {
    world,
    player,
    mobs: spawnMobs(seed),
    npcs: [
      { id: "trainer", name: "하렌", title: "성문 교관", x: 53 * TILE + 8, y: 57 * TILE + 8 },
      { id: "inn", name: "밀라", title: "여관지기", x: 34 * TILE + 8, y: 65 * TILE + 8 },
    ],
    drops: [],
    shots: [],
    floats: [],
    quest: { slimes: 0, slimesNeed: 4, bandits: 0, banditsNeed: 2, talked: false, done: false },
    screen: "title",
    dialog: [],
    dialogKind: "none",
    bagOpen: false,
    jobPick: false,
    toasts: [],
    camX: player.x,
    camY: player.y,
    time: 0,
    uid: 1,
    log: ["잔광성 외곽 마을에 도착했다."],
    dirtyUi: 1,
  };
}

export function jobLabel(id: JobId): string {
  return JOB_NAME[id];
}

export function skillLabel(id: JobId): string {
  return JOB_SKILL[id];
}

export function questText(q: Quest): string {
  if (q.done) return "성문 교관에게 전직을 물을 수 있다.";
  if (q.slimes >= q.slimesNeed && q.bandits >= q.banditsNeed) {
    return "들판 임무를 마쳤다. 성문 교관 하렌을 찾아가라.";
  }
  return `왕국 외곽 들판에서 슬라임·도적 처치 후 성문 교관 찾기\n슬라임 ${q.slimes}/${q.slimesNeed} · 도적 ${q.bandits}/${q.banditsNeed}`;
}

function toast(g: Game, text: string): void {
  g.toasts.push({ text, life: 2.4 });
  g.log.unshift(text);
  if (g.log.length > 8) g.log.pop();
  g.dirtyUi++;
}

function float(g: Game, x: number, y: number, text: string, color = 15): void {
  g.floats.push({ x, y, text, life: 0.7, color });
}

function gainXp(g: Game, audio: Synth, amount: number): void {
  const p = g.player;
  p.xp += amount;
  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level += 1;
    p.xpNext = xpNeed(p.level);
    recalc(p);
    p.hp = p.maxHp;
    p.mp = Math.min(p.maxMp, p.mp + 8);
    toast(g, `레벨 ${p.level} — 잔광이 짙어진다.`);
    audio.level();
  }
}

function addItem(g: Game, id: ItemId, qty = 1): void {
  if (ITEMS[id].slot === "gold") {
    g.player.gold += (ITEMS[id].gold ?? 0) * qty;
    return;
  }
  const stack = g.player.inv.find((s) => s.id === id);
  if (stack && ITEMS[id].slot !== "weapon" && ITEMS[id].slot !== "helm" && ITEMS[id].slot !== "body" && ITEMS[id].slot !== "cape") {
    stack.qty += qty;
  } else {
    g.player.inv.push({ id, qty });
  }
  g.dirtyUi++;
}

function rollLoot(kind: Mob["kind"], elite: boolean): ItemId[] {
  const rng = mulberry32((Math.random() * 1e9) | 0);
  const out: ItemId[] = [];
  if (kind === "slime") {
    if (rng() < 0.7) out.push("slime_gel");
    if (rng() < 0.15) out.push("wool_cape");
  } else if (kind === "wolf") {
    if (rng() < 0.7) out.push("wolf_fang");
    if (rng() < 0.25) out.push("hide_coat");
    if (rng() < 0.2) out.push("ember_flask");
  } else if (kind === "bandit") {
    out.push("bandit_coin");
    if (rng() < 0.35) out.push(pick(rng, ["ember_blade", "twin_edge", "iron_helm"]));
    if (rng() < 0.3) out.push("ember_flask");
  } else if (kind === "shade") {
    if (rng() < 0.6) out.push("shade_dust");
    if (rng() < 0.3) out.push(pick(rng, ["glow_staff", "shrine_rod", "mana_tea"]));
    if (rng() < 0.2) out.push("dusk_cape");
  }
  if (elite) out.push("ironward_plate");
  return out;
}

function killMob(g: Game, audio: Synth, m: Mob): void {
  m.dead = true;
  m.respawn = m.elite ? 40 : 14;
  m.hp = 0;
  gainXp(g, audio, m.xp);
  if (m.kind === "slime" && g.quest.slimes < g.quest.slimesNeed) g.quest.slimes++;
  if (m.kind === "bandit" && g.quest.bandits < g.quest.banditsNeed) g.quest.bandits++;
  g.dirtyUi++;
  for (const id of rollLoot(m.kind, m.elite)) {
    g.drops.push({ uid: uid(), x: m.x + (Math.random() * 10 - 5), y: m.y + (Math.random() * 8 - 2), item: id, qty: 1 });
  }
  audio.kill();
  float(g, m.x, m.y - 10, "쓰러짐", 12);
}

function hurt(g: Game, audio: Synth, m: Mob, dmg: number): void {
  const dealt = Math.max(1, dmg - m.def);
  m.hp -= dealt;
  float(g, m.x, m.y - 8, `${dealt}`, 13);
  audio.hit();
  if (m.hp <= 0) killMob(g, audio, m);
}

function hurtPlayer(g: Game, audio: Synth, dmg: number): void {
  const p = g.player;
  if (p.invuln > 0) return;
  const dealt = Math.max(1, dmg - p.def);
  p.hp -= dealt;
  p.invuln = 0.45;
  float(g, p.x, p.y - 10, `${dealt}`, 13);
  audio.hurt();
  if (p.hp <= 0) {
    p.hp = 0;
    g.screen = "dead";
    g.dirtyUi++;
  }
}

function tryMove(g: Game, x: number, y: number, nx: number, ny: number, rad: number): { x: number; y: number } {
  let rx = x;
  let ry = y;
  if (walkable(g.world, nx, y, rad)) rx = nx;
  if (walkable(g.world, rx, ny, rad)) ry = ny;
  rx = Math.max(12, Math.min(MAP_W * TILE - 12, rx));
  ry = Math.max(12, Math.min(MAP_H * TILE - 12, ry));
  return { x: rx, y: ry };
}

function facingOf(dx: number, dy: number, fallback: Facing): Facing {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return fallback;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? LEFT : RIGHT;
  return dy < 0 ? UP : DOWN;
}

function dirVec(f: Facing): { x: number; y: number } {
  if (f === LEFT) return { x: -1, y: 0 };
  if (f === RIGHT) return { x: 1, y: 0 };
  if (f === UP) return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function nearestMob(g: Game, x: number, y: number, range: number): Mob | null {
  let best: Mob | null = null;
  let bd = range;
  for (const m of g.mobs) {
    if (m.dead) continue;
    const d = dist(x, y, m.x, m.y);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

function playerAttack(g: Game, audio: Synth, skill: boolean): void {
  const p = g.player;
  const caster = p.job === "arcanist" || p.job === "shrine";
  const cost = skill ? (p.job === "commoner" ? 0 : 8) : 0;
  if (skill && p.job === "commoner") return;
  if (skill && p.mp < cost) {
    toast(g, "마나가 부족하다.");
    return;
  }
  if (skill) p.mp -= cost;
  p.attackT = skill ? 0.28 : 0.18;
  audio.swing();
  if (skill) audio.skill();

  const d = dirVec(p.facing);
  if (caster || (skill && p.job === "arcanist")) {
    const kind = p.job === "shrine" ? "pulse" : "orb";
    const spd = 110;
    g.shots.push({
      uid: uid(),
      x: p.x + d.x * 10,
      y: p.y + d.y * 8,
      vx: d.x * spd,
      vy: d.y * spd,
      dmg: p.atk + (skill ? 6 : 2),
      life: 0.7,
      kind,
    });
    if (p.job === "shrine" && skill) {
      p.hp = Math.min(p.maxHp, p.hp + 14);
      float(g, p.x, p.y - 12, "+14", 8);
    }
    return;
  }

  const reach = skill && p.job === "knight" ? 34 : 22;
  const hits = skill && p.job === "blader" ? 3 : 1;
  for (let i = 0; i < hits; i++) {
    const range = reach + i * 4;
    const px = p.x + d.x * (12 + i * 6);
    const py = p.y + d.y * (10 + i * 5);
    for (const m of g.mobs) {
      if (m.dead) continue;
      if (dist(px, py, m.x, m.y) < range) {
        hurt(g, audio, m, p.atk + (skill ? 4 : 0) + i);
        if (skill && p.job === "knight") {
          const n = tryMove(g, m.x, m.y, m.x + d.x * 10, m.y + d.y * 10, m.radius);
          m.x = n.x;
          m.y = n.y;
        }
      }
    }
  }
  if (skill && p.job === "knight") {
    const n = tryMove(g, p.x, p.y, p.x + d.x * 18, p.y + d.y * 18, 5);
    p.x = n.x;
    p.y = n.y;
  }
}

function useHot(g: Game, audio: Synth, slot: number): void {
  const p = g.player;
  if (slot === 1) {
    if (p.attackCd <= 0) {
      p.attackCd = p.job === "blader" ? 0.28 : p.job === "knight" ? 0.48 : 0.36;
      playerAttack(g, audio, false);
    }
    return;
  }
  if (slot === 2) {
    if (p.skillCd <= 0) {
      p.skillCd = 2.4;
      playerAttack(g, audio, true);
    }
    return;
  }
  const uses = p.inv.filter((s) => ITEMS[s.id].slot === "use");
  const item = uses[slot - 3];
  if (!item) return;
  useItem(g, audio, item.id);
}

export function useItem(g: Game, audio: Synth, id: ItemId): void {
  const it = ITEMS[id];
  const stack = g.player.inv.find((s) => s.id === id);
  if (!stack) return;
  if (it.slot === "use") {
    if (it.heal) {
      g.player.hp = Math.min(g.player.maxHp, g.player.hp + it.heal);
      float(g, g.player.x, g.player.y - 12, `+${it.heal}`, 8);
    }
    if (it.restoreMp) {
      g.player.mp = Math.min(g.player.maxMp, g.player.mp + it.restoreMp);
      float(g, g.player.x, g.player.y - 16, `MP+${it.restoreMp}`, 10);
    }
    stack.qty--;
    if (stack.qty <= 0) g.player.inv = g.player.inv.filter((s) => s !== stack);
    audio.rest();
    g.dirtyUi++;
    return;
  }
  if (it.slot === "weapon" || it.slot === "helm" || it.slot === "body" || it.slot === "cape") {
    const prev = g.player.equip[it.slot];
    g.player.equip[it.slot] = id;
    g.player.inv = g.player.inv.filter((s) => s !== stack);
    if (prev) addItem(g, prev, 1);
    recalc(g.player);
    toast(g, `${it.name} 장착`);
    audio.ui();
  }
}

export function chooseJob(g: Game, audio: Synth, job: JobId): void {
  if (g.player.level < 5 || g.player.job !== "commoner") return;
  g.player.job = job;
  if (job === "knight") g.player.equip.weapon = "ember_blade";
  if (job === "blader") g.player.equip.weapon = "twin_edge";
  if (job === "arcanist") g.player.equip.weapon = "glow_staff";
  if (job === "shrine") g.player.equip.weapon = "shrine_rod";
  recalc(g.player);
  g.player.hp = g.player.maxHp;
  g.player.mp = g.player.maxMp;
  g.jobPick = false;
  g.dialogKind = "none";
  toast(g, `${JOB_NAME[job]}(으)로 전직했다.`);
  audio.level();
  g.dirtyUi++;
}

function interact(g: Game, audio: Synth): void {
  const p = g.player;
  for (let i = g.drops.length - 1; i >= 0; i--) {
    const d = g.drops[i]!;
    if (dist(p.x, p.y, d.x, d.y) < 16) {
      addItem(g, d.item, d.qty);
      toast(g, `${ITEMS[d.item].name} 획득`);
      audio.loot();
      g.drops.splice(i, 1);
      return;
    }
  }
  for (const n of g.npcs) {
    if (dist(p.x, p.y, n.x, n.y) > 22) continue;
    if (n.id === "trainer") {
      g.dialogKind = "trainer";
      const ready = g.quest.slimes >= g.quest.slimesNeed && g.quest.bandits >= g.quest.banditsNeed;
      if (ready && !g.quest.done) {
        g.quest.done = true;
        g.quest.talked = true;
        addItem(g, "ember_flask", 1);
        gainXp(g, audio, 40);
        g.dialog = [
          "성문 교관 하렌",
          "들판을 지나왔군. 잔광성은 아직 문을 굳게 닫고 있지만, 네 칼날은 이미 성문 밖 이야기를 담고 있다.",
          "이 물약을 받아라. 다섯 번째 숨이 차면 길을 고를 수 있다.",
        ];
      } else if (g.player.level >= 5 && g.player.job === "commoner") {
        g.jobPick = true;
        g.dialog = ["성문 교관 하렌", "숨이 다섯에 닿았다. 왕국기사, 검객, 비전술사, 성소무녀 — 하나를 고르라."];
      } else {
        g.dialog = [
          "성문 교관 하렌",
          "나는 성문 교관 하렌이다. 외곽 들판의 슬라임과 길목 도적을 처치하고 돌아오라.",
          g.player.level < 5 ? "전직은 레벨 5 이후." : "이미 길을 골랐다면, 들판이 너를 기다린다.",
        ];
      }
      audio.ui();
      g.dirtyUi++;
      return;
    }
    if (n.id === "inn") {
      g.dialogKind = "help";
      g.dialog = ["여관지기 밀라", "온기를 빌려주마. 분수와 이 집에서 숨을 고를 수 있다."];
      g.player.hp = g.player.maxHp;
      g.player.mp = g.player.maxMp;
      audio.rest();
      toast(g, "여관에서 숨을 고쳤다.");
      g.dirtyUi++;
      return;
    }
  }
  // Fountain rest
  if (dist(p.x, p.y, 48 * TILE + 8, 65 * TILE + 8) < 20) {
    g.player.hp = g.player.maxHp;
    g.player.mp = Math.min(g.player.maxMp, g.player.mp + 10);
    audio.rest();
    toast(g, "광장 우물에서 잔광을 들이켰다.");
  }
}

function updateMobs(g: Game, audio: Synth, dt: number): void {
  const p = g.player;
  for (const m of g.mobs) {
    m.anim += dt * 4;
    if (m.dead) {
      m.respawn -= dt;
      if (m.respawn <= 0) {
        m.dead = false;
        m.hp = m.maxHp;
        m.x = m.sx;
        m.y = m.sy;
        m.aggro = 0;
      }
      continue;
    }
    m.attackCd = Math.max(0, m.attackCd - dt);
    const d = dist(m.x, m.y, p.x, p.y);
    const leash = dist(m.x, m.y, m.sx, m.sy);
    if (d < (m.elite ? 90 : 70)) m.aggro = 2.5;
    else m.aggro -= dt;
    let tx = m.sx;
    let ty = m.sy;
    if (m.aggro > 0 && leash < 170) {
      tx = p.x;
      ty = p.y;
    }
    const dx = tx - m.x;
    const dy = ty - m.y;
    const len = Math.hypot(dx, dy) || 1;
    if (len > 10) {
      const sp = m.speed * dt;
      const n = tryMove(g, m.x, m.y, m.x + (dx / len) * sp, m.y + (dy / len) * sp, m.radius);
      m.x = n.x;
      m.y = n.y;
      m.facing = facingOf(dx, dy, m.facing);
    }
    if (d < 14 + (m.elite ? 4 : 0) && m.attackCd <= 0 && g.screen === "play") {
      m.attackCd = m.elite ? 1.3 : 0.9;
      hurtPlayer(g, audio, m.atk);
    }
  }
}

export function respawn(g: Game): void {
  const p = g.player;
  p.x = 48 * TILE + 8;
  p.y = 66 * TILE + 8;
  p.hp = p.maxHp;
  p.mp = p.maxMp;
  p.invuln = 1;
  g.screen = "play";
  toast(g, "광장에서 다시 눈을 떴다.");
  g.dirtyUi++;
}

export function updateGame(g: Game, input: Input, audio: Synth, dt: number): void {
  g.time += dt;
  for (const t of g.toasts) t.life -= dt;
  g.toasts = g.toasts.filter((t) => t.life > 0);
  for (const f of g.floats) {
    f.life -= dt;
    f.y -= 18 * dt;
  }
  g.floats = g.floats.filter((f) => f.life > 0);

  if (g.screen === "title") {
    if (input.consume("Enter") || input.consume(" ") || input.click) {
      input.click = false;
      g.screen = "play";
      audio.unlock();
      audio.ui();
      g.dirtyUi++;
    }
    input.endFrame();
    return;
  }
  if (g.screen === "dead") {
    if (input.consume("Enter") || input.consume(" ") || input.consume("e") || input.click) {
      input.click = false;
      respawn(g);
      audio.unlock();
    }
    input.endFrame();
    return;
  }

  if (input.consume("i") || input.consume("I")) {
    g.bagOpen = !g.bagOpen;
    audio.ui();
    g.dirtyUi++;
  }
  if (input.consume("Escape") || input.consume("h")) {
    if (g.dialogKind !== "none" || g.jobPick) {
      g.dialogKind = "none";
      g.jobPick = false;
      g.dialog = [];
    } else {
      g.dialogKind = "help";
      g.dialog = [
        "조작",
        "WASD / 방향키 이동 · 스페이스/클릭 공격 · E 상호작용",
        "1 기본공격 · 2 전직기 · 3~5 소모품 · I 가방 · H 도움말",
      ];
    }
    audio.ui();
    g.dirtyUi++;
  }

  if (g.jobPick) {
    if (input.consume("1")) chooseJob(g, audio, "knight");
    if (input.consume("2")) chooseJob(g, audio, "blader");
    if (input.consume("3")) chooseJob(g, audio, "arcanist");
    if (input.consume("4")) chooseJob(g, audio, "shrine");
  } else if (g.dialogKind !== "none") {
    if (input.consume("e") || input.consume("Enter") || input.consume(" ")) {
      g.dialogKind = "none";
      g.dialog = [];
      g.dirtyUi++;
    }
  } else {
    if (input.consume("e")) interact(g, audio);
    if (input.consumeAttack() || input.consume("1")) useHot(g, audio, 1);
    if (input.consume("2")) useHot(g, audio, 2);
    if (input.consume("3")) useHot(g, audio, 3);
    if (input.consume("4")) useHot(g, audio, 4);
    if (input.consume("5")) useHot(g, audio, 5);
  }

  const p = g.player;
  p.attackCd = Math.max(0, p.attackCd - dt);
  p.skillCd = Math.max(0, p.skillCd - dt);
  p.attackT = Math.max(0, p.attackT - dt);
  p.invuln = Math.max(0, p.invuln - dt);

  const axis = input.axis();
  const blocked = g.dialogKind !== "none" || g.jobPick;
  const speed = 76 * (input.down.has("Shift") ? 1.25 : 1);
  p.moving = !blocked && (axis.x !== 0 || axis.y !== 0);
  if (p.moving) {
    const n = tryMove(g, p.x, p.y, p.x + axis.x * speed * dt, p.y + axis.y * speed * dt, 5);
    p.x = n.x;
    p.y = n.y;
    p.facing = facingOf(axis.x, axis.y, p.facing);
    p.anim += dt * 8;
    if (Math.floor(g.time * 7) !== Math.floor((g.time - dt) * 7)) audio.step();
  }

  // auto pickup
  for (let i = g.drops.length - 1; i >= 0; i--) {
    const d = g.drops[i]!;
    if (dist(p.x, p.y, d.x, d.y) < 12) {
      addItem(g, d.item, d.qty);
      toast(g, `${ITEMS[d.item].name} 획득`);
      audio.loot();
      g.drops.splice(i, 1);
    }
  }

  updateMobs(g, audio, dt);

  for (let i = g.shots.length - 1; i >= 0; i--) {
    const s = g.shots[i]!;
    s.life -= dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    const hit = nearestMob(g, s.x, s.y, 12);
    if (hit) {
      hurt(g, audio, hit, s.dmg);
      if (s.kind === "pulse") {
        for (const m of g.mobs) {
          if (!m.dead && m !== hit && dist(s.x, s.y, m.x, m.y) < 28) hurt(g, audio, m, Math.ceil(s.dmg * 0.6));
        }
      }
      g.shots.splice(i, 1);
      continue;
    }
    if (s.life <= 0 || !walkable(g.world, s.x, s.y, 2)) g.shots.splice(i, 1);
  }

  const lerp = 1 - Math.pow(0.001, dt);
  g.camX += (p.x - g.camX) * lerp;
  g.camY += (p.y - 8 - g.camY) * lerp;
  input.endFrame();
}

export { JOB_NAME, JOB_SKILL };
