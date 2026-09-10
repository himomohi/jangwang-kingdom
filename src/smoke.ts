import { assertLocked16, PALETTE } from "./art/palette";
import { Input } from "./input/keys";
import { Synth } from "./audio/synth";
import { chooseJob, createGame, updateGame, useItem } from "./sim/game";
import { ITEMS } from "./sim/items";
import { TILE } from "./sim/types";
import { walkable } from "./sim/world";

/** Must match docs/palette-v1.md (main d972d54). */
const DOC_HEX = [
  "#0B0C14",
  "#1A1F2E",
  "#2E3A4A",
  "#4A5A6A",
  "#6A7A88",
  "#8A9AAA",
  "#3A4A28",
  "#5A6A38",
  "#7A8A48",
  "#2A3A5A",
  "#4A6A8A",
  "#C8A060",
  "#E09040",
  "#C05060",
  "#E8D8C0",
  "#F0F0E8",
] as const;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`smoke: ${msg}`);
}

assertLocked16(DOC_HEX);
assert(PALETTE.length === 16, "locked 16");
assert(!PALETTE.some((h) => h.toUpperCase() === "#000000"), "no #000");

const audio = new Synth();
const input = new Input();
const g = createGame(0x7a6b);
g.screen = "play";

assert(walkable(g.world, g.player.x, g.player.y), "spawn walkable");
assert(g.mobs.some((m) => m.kind === "slime"), "slime family");
assert(g.mobs.some((m) => m.kind === "ironward" && m.elite), "elite ironward");
assert(g.player.job === "commoner", "starts commoner");

const x0 = g.player.x;
input.down.add("d");
for (let i = 0; i < 45; i++) updateGame(g, input, audio, 1 / 60);
input.down.clear();
assert(g.player.x > x0 + 8, `moved east (${x0} -> ${g.player.x})`);

const wallX = 28 * TILE;
const wallY = 60 * TILE;
assert(!walkable(g.world, wallX, wallY, 4), "town fence solid");
const trainer = g.npcs.find((n) => n.id === "trainer");
assert(!!trainer, "trainer exists");
assert(trainer!.y >= 52 * TILE, "trainer in town");

g.player.x = 48 * TILE + 8;
g.player.y = 46 * TILE + 8;
const lone = g.mobs.find((m) => m.kind === "slime" && !m.dead)!;
for (const m of g.mobs) {
  if (m !== lone) {
    m.x = 8;
    m.y = 8;
    m.sx = 8;
    m.sy = 8;
    m.aggro = 0;
  }
}
lone.x = g.player.x + 14;
lone.y = g.player.y;
lone.sx = lone.x;
lone.sy = lone.y;
const hpStart = g.player.hp;
let swings = 0;
while (!lone.dead && swings < 24) {
  g.player.attackCd = 0;
  input.pressed.add("1");
  updateGame(g, input, audio, 1 / 60);
  for (let i = 0; i < 18; i++) updateGame(g, input, audio, 1 / 60);
  swings++;
}
assert(lone.dead, `solo slime dies after ${swings} swings (hp ${lone.hp})`);
assert(g.player.hp > 0, "player survives one slime");
assert(g.player.hp >= hpStart - 24, "slime does not dumpster player");

assert(g.quest.slimes >= 1, "quest counts slimes");

g.drops.push({ uid: 999, x: g.player.x, y: g.player.y, item: "iron_helm", qty: 1 });
const def0 = g.player.def;
for (let i = 0; i < 3; i++) updateGame(g, input, audio, 1 / 60);
assert(g.player.inv.some((s) => s.id === "iron_helm"), "loot pickup");
useItem(g, audio, "iron_helm");
assert(g.player.equip.helm === "iron_helm", "equip helm");
assert(g.player.def > def0, "equip raises def");
assert(ITEMS.iron_helm.helmLook === "helm", "helm changes look");

g.player.level = 5;
g.quest.slimes = 4;
g.quest.bandits = 2;
chooseJob(g, audio, "knight");
assert(g.player.job === "knight", "job change knight");
assert(g.player.equip.weapon === "ember_blade", "job weapon");

const hp0 = g.player.hp;
g.player.hp = 5;
useItem(g, audio, "slime_gel");
assert(g.player.hp >= hp0 || g.player.hp > 5, "potion heals or consumed");

console.log("smoke ok", {
  job: g.player.job,
  def: g.player.def,
  quest: g.quest,
  mobs: g.mobs.length,
  drops: g.drops.length,
});
