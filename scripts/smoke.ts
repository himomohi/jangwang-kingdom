/** Headless smoke test: sim rules + touch-simulation logic. Runs in node via esbuild. */
import { enemyAnim, enemyStride, jobSilhouette, playerAnim, strideFootfall, swingAngle, weaponTip } from '../src/art/anim';
import { PALETTE } from '../src/art/palette';
import { buildSimInput, VirtualJoystick } from '../src/input/input';
import { calcDamage } from '../src/sim/combat';
import { ENEMIES, ITEMS, JOB_SKILL, SHOP_STOCK, TEMPO, TILE, ZONE_NAMES, xpForLevel } from '../src/sim/config';
import { Sim } from '../src/sim/game';
import { rollLoot } from '../src/sim/loot';
import { mulberry32 } from '../src/sim/world';
import type { JobId, SimInput } from '../src/sim/types';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name} ${extra}`);
  }
}

function finite(n: number): boolean {
  return Number.isFinite(n);
}

// ---------- 1. palette locked ----------
ok('palette has 16 entries', PALETTE.length === 16);
ok('palette has no pure black', !PALETTE.map((c) => c.toLowerCase()).includes('#000000'));
ok('palette entries unique', new Set(PALETTE).size === 16);

// ---------- 2. config integrity ----------
ok('xp curve grows', xpForLevel(2) > xpForLevel(1) && xpForLevel(10) > xpForLevel(5));
for (const [kind, def] of Object.entries(ENEMIES)) {
  ok(`enemy ${kind} sane`, def.hp > 0 && def.atk > 0 && def.spd > 0 && def.xp > 0 && def.aggro > 0 && def.zones.length > 0);
  ok(`enemy ${kind} zone names valid`, def.zones.every((z) => z in ZONE_NAMES));
}
for (const id of SHOP_STOCK) ok(`shop item ${id} exists`, id in ITEMS);
for (const [id, d] of Object.entries(ITEMS)) {
  const slotOk = d.kind === 'potion' ? d.slot === undefined : d.slot !== undefined;
  ok(`item ${id} slot/kind consistent`, slotOk);
}
const jobs: JobId[] = ['commoner', 'knight', 'blader', 'arcanist', 'shrine'];
for (const j of jobs) ok(`job ${j} has skill`, !!JOB_SKILL[j] && JOB_SKILL[j].mp > 0);

// ---------- 3. combat math ----------
{
  const rng = mulberry32(42);
  let min = Infinity;
  for (let i = 0; i < 500; i++) {
    const r = calcDamage(10, 5, 0.1, rng);
    min = Math.min(min, r.dmg);
    if (!finite(r.dmg)) break;
  }
  ok('damage always >= 1 and finite', min >= 1);
  const weak = calcDamage(1, 999, 0, rng);
  ok('high defense still deals 1', weak.dmg === 1);
}

// ---------- 4. loot ----------
{
  const rng = mulberry32(7);
  for (const k of ['slime', 'wolf', 'bandit', 'shade', 'watcher'] as const) {
    const def = ENEMIES[k];
    let good = true;
    for (let i = 0; i < 200; i++) {
      const l = rollLoot(k, rng);
      if (l.gold < def.goldMin || l.gold > def.goldMax) good = false;
      if (l.equipId && !(l.equipId in ITEMS)) good = false;
    }
    ok(`loot ${k} bounded`, good);
  }
}

// ---------- 5. sim boot + movement ----------
const sim = new Sim();
ok('sim boots with player alive', sim.player.alive && sim.player.hp > 0);
ok('sim spawns ambient enemies', sim.enemies.length > 5);
ok('sim starts in town', sim.zone === 'town');
ok('npcs placed', sim.npcs.length === 4);
ok('spawn spots exist', sim.world.spawnSpots.field.length > 10 && sim.world.spawnSpots.ruin.length > 5);

{
  const x0 = sim.player.x;
  const inp: SimInput = { mx: 1, my: 0, attack: false, skill: false, interact: false, potion: false };
  for (let i = 0; i < 60; i++) sim.update(1 / 60, inp);
  ok('player moves right with input', sim.player.x > x0);
  // numbers stay finite
  const p = sim.player;
  ok('player numbers finite', finite(p.x) && finite(p.y) && finite(p.hp) && finite(p.mp) && finite(p.xp));
}

// ---------- 6. touch simulation logic (hard requirement) ----------
{
  const joy = new VirtualJoystick();
  joy.setDrag(0, 0, 52);
  ok('joystick deadzone centers', joy.x === 0 && joy.y === 0);
  joy.setDrag(26, 0, 52);
  ok('joystick half deflection', Math.abs(joy.x - 0.5) < 0.01 && Math.abs(joy.y) < 0.01);
  joy.setDrag(200, 0, 52);
  ok('joystick clamps to unit', Math.abs(joy.x - 1) < 0.001);
  joy.release();
  ok('joystick release resets', joy.x === 0 && joy.y === 0 && !joy.active);

  // full touch path: joystick + buttons → SimInput → sim movement + attack + interact
  const sim2 = new Sim();
  const j2 = new VirtualJoystick();
  j2.setDrag(0, -52, 52); // push up
  const before = { x: sim2.player.x, y: sim2.player.y };
  for (let i = 0; i < 30; i++) {
    sim2.update(1 / 60, buildSimInput(j2.x, j2.y, {}));
  }
  ok('touch joystick moves player', Math.hypot(sim2.player.x - before.x, sim2.player.y - before.y) > 5);

  const atk = buildSimInput(0, 0, { attack: true });
  ok('touch attack edge builds', atk.attack === true && atk.skill === false);
  const sk = buildSimInput(0.2, 0.3, { skill: true });
  ok('touch skill edge builds', sk.skill === true && Math.abs(sk.mx - 0.2) < 0.001);
  const inp2 = buildSimInput(NaN, Infinity, {});
  ok('touch input sanitizes NaN/Inf', inp2.mx === 0 && inp2.my === 0);
}

// ---------- 7. combat cycle ----------
{
  const s = new Sim();
  // teleport next to a slime
  const e = s.enemies.find((x) => !x.dead);
  ok('enemy available for combat test', !!e);
  if (e) {
    s.player.x = e.x - 20;
    s.player.y = e.y;
    s.player.facing = 3;
    const hp0 = e.hp;
    s.tryAttack();
    ok('attack damages enemy', e.hp < hp0 || e.dead);
    // fight to death
    let guard = 0;
    while (!e.dead && guard++ < 60) {
      s.player.atkCd = 0;
      s.player.x = e.x - 20;
      s.player.y = e.y;
      s.tryAttack();
      s.update(1 / 60, { mx: 0, my: 0, attack: false, skill: false, interact: false, potion: false });
    }
    ok('enemy dies from attacks', e.dead);
    ok('kill grants xp/gold or drops', s.player.xp > 0 || s.pickups.length > 0);
  }
}

// ---------- 8. skills for every job ----------
for (const j of jobs) {
  const s = new Sim();
  s.player.job = j;
  s.recompute(true);
  const okSkill = s.trySkill();
  ok(`skill works for ${j}`, okSkill && s.player.skillCd > 0);
}

// ---------- 9. potion / shop / equip / inn / jobs ----------
{
  const s = new Sim();
  s.player.hp = 10;
  const n0 = s.player.potions;
  ok('potion heals', s.tryPotion() && s.player.hp > 10 && s.player.potions === n0 - 1);
  s.player.gold = 1000;
  const buy = s.buyItem('w1');
  ok('shop buy works', buy.ok && s.player.inv.some((i) => i.id === 'w1'));
  const atk0 = s.player.stats.atk;
  s.equipItem('w1');
  ok('equip raises atk', s.player.stats.atk > atk0);
  s.unequipItem('weapon');
  ok('unequip restores inv', s.player.inv.some((i) => i.id === 'w1'));
  s.player.hp = 5;
  s.player.gold = 100;
  const inn = s.innRest();
  ok('inn heals full', inn.ok && s.player.hp === s.player.stats.maxHp);
  s.player.level = 4;
  const deny = s.jobChange('knight');
  ok('job change denied before Lv5', !deny.ok);
  s.player.level = 5;
  const allow = s.jobChange('knight');
  ok('job change works at Lv5', allow.ok && s.player.job === 'knight');
}

// ---------- 10. dialogue data ----------
{
  const s = new Sim();
  s.player.level = 5;
  for (const n of s.npcs) {
    const d = s.getDialog(n.id);
    ok(`dialog ${n.id} has lines+choices`, d.lines.length > 0 && d.choices.length > 0);
  }
  const r = s.dialogChoice('merchant', 'buy:potion');
  ok('dialog buy choice resolves', r.lines.length > 0 && !r.close);
}

// ---------- 11. world collision ----------
{
  const s = new Sim();
  ok('border wall blocked', s.world.isBlockedPx(TILE * 1, TILE * 10, 5));
  ok('town plaza walkable', !s.world.isBlockedPx(47.5 * TILE, 55 * TILE, 5));
  ok('hall blocked', s.world.isBlockedPx(47.5 * TILE, 47.5 * TILE, 5));
}

// ---------- 12. long soak: 1200 ticks random play ----------
{
  const s = new Sim();
  const rng = mulberry32(99);
  let threw = false;
  try {
    for (let i = 0; i < 1200; i++) {
      const a = rng() * Math.PI * 2;
      const inp: SimInput = {
        mx: Math.cos(a),
        my: Math.sin(a),
        attack: rng() < 0.1,
        skill: rng() < 0.03,
        interact: false,
        potion: rng() < 0.005,
      };
      s.update(1 / 60, inp);
      s.events.length = 0;
      if (!finite(s.player.x) || !finite(s.player.hp)) throw new Error('NaN state');
    }
  } catch (err) {
    threw = true;
    console.log('soak error', err);
  }
  ok('1200-tick soak stable', !threw);
  ok('particles bounded', s.particles.length <= 401);
  ok('enemies bounded', s.enemies.length <= 60);
}

// ---------- 13. tempo tuning (readable late-90s MMO pace) ----------
{
  ok('tempo: player speed down 15-25%', TEMPO.playerBaseSpd >= 72 && TEMPO.playerBaseSpd <= 82);
  const s = new Sim();
  ok('tempo: commoner walks at TEMPO speed', s.player.stats.spd === TEMPO.playerBaseSpd);
  ok('tempo: attack recovery longer', TEMPO.playerAttackCd > 0.38 && TEMPO.playerAttackCd < 0.6);
  ok('tempo: swing poses readable', TEMPO.playerSwingDur >= 0.26 && TEMPO.enemySwingDur >= 0.3);
  ok('tempo: i-frames readable', TEMPO.playerHurtCd >= 0.8 && TEMPO.enemyHurtFlash >= 0.3);
  ok('tempo: camera smoother', TEMPO.cameraFollow < 6 && TEMPO.cameraFollow > 1.5);
  ok('tempo: chase slowed', TEMPO.enemySpeedMul >= 0.75 && TEMPO.enemySpeedMul < 1);
  ok('tempo: enemy cadence slower', TEMPO.enemyAtkCdMul > 1 && TEMPO.enemyRecover > 0.3);
  const w = TEMPO.windup;
  ok('tempo: telegraphs 0.2-0.4s', w.slime >= 0.2 && w.slime <= 0.4 && w.wolf >= 0.2 && w.wolf <= 0.4 && w.bandit >= 0.2 && w.bandit <= 0.4 && w.shade >= 0.2 && w.shade <= 0.4);
  ok('tempo: elite telegraph heavier', w.watcher > 0.4);
  ok('tempo: dash less frantic', TEMPO.dashDur > 0.16 && TEMPO.dashDist / TEMPO.dashDur < 287);
}

// ---------- 14. animation pose timers (sim drives, renderer interprets) ----------
{
  // cast pose
  const s = new Sim();
  s.player.job = 'arcanist';
  s.recompute(true);
  s.trySkill();
  ok('anim: arcanist skill starts cast pose', s.player.castT === 0);
  for (let i = 0; i < 40; i++) s.update(1 / 60, { mx: 0, my: 0, attack: false, skill: false, interact: false, potion: false });
  ok('anim: cast pose finishes', s.player.castT === -1);
  // blader drives both swing + cast
  const b = new Sim();
  b.player.job = 'blader';
  b.recompute(true);
  b.trySkill();
  ok('anim: blader skill drives swing+cast', b.player.swingT === 0 && b.player.castT === 0);
  // potion pose
  const s2 = new Sim();
  s2.player.hp = 10;
  s2.tryPotion();
  ok('anim: potion starts drink pose', s2.player.potionT === 0);
  for (let i = 0; i < 60; i++) s2.update(1 / 60, { mx: 0, my: 0, attack: false, skill: false, interact: false, potion: false });
  ok('anim: drink pose finishes', s2.player.potionT === -1);
  // talk pose via interact near npc
  const s3 = new Sim();
  const npc = s3.npcs[0];
  s3.player.x = npc.x + 10;
  s3.player.y = npc.y;
  s3.update(1 / 60, { mx: 0, my: 0, attack: false, skill: false, interact: true, potion: false });
  ok('anim: interact starts talk pose', s3.player.talkT > 0);
  // death timer ticks
  const s4 = new Sim();
  s4.player.hp = 1;
  s4.player.hurtCd = 0;
  s4.damagePlayer(9999, s4.player.x + 10, s4.player.y);
  ok('anim: death starts deadT', !s4.player.alive && s4.player.deadT === 0);
  s4.update(1 / 60, { mx: 0, my: 0, attack: false, skill: false, interact: false, potion: false });
  ok('anim: deadT ticks while dead', s4.player.deadT > 0);
  s4.respawn();
  ok('anim: respawn resets poses', s4.player.alive && s4.player.deadT === 0 && s4.player.swingT === -1 && s4.player.castT === -1);
}

// ---------- 15. animation state machines (art/anim.ts) ----------
{
  const s = new Sim();
  // player: idle -> potion -> skill -> attack -> hurt -> talk priority
  s.player.potionT = 0.5;
  ok('anim: potion state wins', playerAnim(s.player, false).state === 'potion');
  s.player.potionT = -1;
  s.player.castT = 0.5;
  ok('anim: skill state', playerAnim(s.player, false).state === 'skill');
  s.player.castT = -1;
  s.player.swingT = 0.5;
  ok('anim: attack state', playerAnim(s.player, false).state === 'attack');
  s.player.swingT = -1;
  s.player.hurtCd = TEMPO.playerHurtCd;
  ok('anim: hurt state on fresh hit', playerAnim(s.player, false).state === 'hurt');
  s.player.hurtCd = 0;
  s.player.talkT = 1;
  ok('anim: talk state', playerAnim(s.player, false).state === 'talk');
  s.player.talkT = 0;
  s.player.alive = false;
  s.player.deadT = 0.2;
  ok('anim: dead state', playerAnim(s.player, false).state === 'dead');
  s.player.alive = true;
  ok('anim: idle fallback', playerAnim(s.player, false).state === 'idle');

  // enemy: windup -> attack -> hurt -> dead
  const e = s.enemies.find((x) => !x.dead);
  ok('anim: enemy available', !!e);
  if (e) {
    e.ai = 'windup';
    e.stateT = 0.1;
    e.hurtCd = 0;
    ok('anim: enemy windup with progress', enemyAnim(e, false).state === 'windup' && enemyAnim(e, false).windupK > 0);
    e.ai = 'chase';
    e.swingT = 0.5;
    ok('anim: enemy attack', enemyAnim(e, false).state === 'attack');
    e.swingT = -1;
    e.hurtCd = TEMPO.enemyHurtFlash;
    ok('anim: enemy hurt', enemyAnim(e, false).state === 'hurt');
    e.hurtCd = 0;
    ok('anim: enemy move/idle split', enemyAnim(e, true).state === 'move' && enemyAnim(e, false).state === 'idle');
    e.dead = true;
    e.deadT = 0.1;
    ok('anim: enemy dead', enemyAnim(e, false).state === 'dead');
    e.dead = false;
  }

  // job silhouettes read differently
  const knight = jobSilhouette('knight');
  const blader = jobSilhouette('blader');
  const arc = jobSilhouette('arcanist');
  ok('anim: knight broad, blader slim', knight.torsoHW > blader.torsoHW);
  ok('anim: knight shielded, blader scarfed', knight.shield > 0 && blader.scarfLen > 0);
  ok('anim: arcanist robed + staff', arc.robe && arc.staff);

  // swing arcs differ per job; tips stay finite
  const angK = swingAngle('knight', 0.5);
  const angB = swingAngle('blader', 0.5);
  ok('anim: job swing arcs differ', Math.abs(angK - angB) > 0.05);
  let tipsFinite = true;
  for (const job of ['commoner', 'knight', 'blader', 'arcanist', 'shrine'] as JobId[]) {
    for (const f of [0, 1, 2, 3] as const) {
      for (const sw of [0, 0.5, 1]) {
        const tip = weaponTip(100, 100, f, sw, 1, job);
        if (!finite(tip.x) || !finite(tip.y)) tipsFinite = false;
      }
    }
  }
  for (const kind of ['slime', 'wolf', 'bandit', 'shade', 'watcher']) {
    const tip = weaponTip(100, 100, 3, 0.5, 1.7, kind);
    if (!finite(tip.x) || !finite(tip.y)) tipsFinite = false;
  }
  ok('anim: weapon tips finite for all jobs/kinds', tipsFinite);

  // footfall sync fires on zero crossings only
  ok('anim: footfall on crossing', strideFootfall(-0.2, 0.2, true) && strideFootfall(0.3, -0.1, true));
  ok('anim: no footfall without motion', !strideFootfall(-0.2, 0.2, false) && !strideFootfall(0.1, 0.4, true));

  // elite strides heavier
  const elite = enemyStride('watcher', true);
  const normal = enemyStride('wolf', false);
  ok('anim: elite heavier stride', elite.rateMul < normal.rateMul && elite.squashAmp > normal.squashAmp);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} smoke tests failed`);
