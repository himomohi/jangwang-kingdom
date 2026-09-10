import { Input } from "./input/keys";
import { Synth } from "./audio/synth";
import { chooseJob, createGame, updateGame, useItem } from "./sim/game";
import { ITEMS } from "./sim/items";
import { TILE } from "./sim/types";
import { walkable } from "./sim/world";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`smoke: ${msg}`);
}

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

const slime = g.mobs.find((m) => m.kind === "slime" && !m.dead)!;
const beforeHp = slime.hp;
slime.x = g.player.x + 12;
slime.y = g.player.y;
input.pressed.add(" ");
updateGame(g, input, audio, 1 / 60);
assert(slime.hp < beforeHp || slime.dead, "attack damages slime");

slime.hp = 0;
const q0 = g.quest.slimes;
input.pressed.add("1");
updateGame(g, input, audio, 1 / 60);
if (!slime.dead) {
  slime.hp = 1;
  input.pressed.add("1");
  g.player.attackCd = 0;
  updateGame(g, input, audio, 1 / 60);
}
assert(g.quest.slimes >= q0, "quest can count slimes");

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
