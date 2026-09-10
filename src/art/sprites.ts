import { C } from "./palette";
import { bake, PixelBuf } from "./pixels";
import { cached } from "./cache";
import { Tile } from "../sim/world";
import type { BodyLook, CapeLook, Facing, HelmLook, JobId, WeaponLook } from "../sim/types";

export interface ActorLook {
  job: JobId;
  helm: HelmLook;
  body: BodyLook;
  cape: CapeLook;
  weapon: WeaponLook;
  plated: boolean;
}

const JOB_CAPE: Record<JobId, number> = {
  commoner: C.ember,
  knight: C.life,
  blader: C.water,
  arcanist: C.deepWater,
  shrine: C.metal,
};

const JOB_BODY: Record<JobId, number> = {
  commoner: C.cloth,
  knight: C.mist,
  blader: C.brick,
  arcanist: C.deepWater,
  shrine: C.shine,
};

export function tileSprite(t: number): HTMLCanvasElement {
  return cached(`tile:${t}`, () =>
    bake((b) => {
      switch (t) {
        case Tile.Grass:
          b.fill(0, 0, 16, 16, C.grass);
          b.set(2, 3, C.grassLite);
          b.set(9, 6, C.grassLite);
          b.set(5, 11, C.soil);
          b.set(13, 13, C.grassLite);
          break;
        case Tile.GrassTall:
          b.fill(0, 0, 16, 16, C.grass);
          b.set(3, 8, C.grassLite);
          b.set(4, 7, C.grassLite);
          b.set(10, 6, C.grassLite);
          b.set(11, 5, C.grassLite);
          b.set(7, 9, C.grassLite);
          break;
        case Tile.Dirt:
          b.fill(0, 0, 16, 16, C.soil);
          b.set(4, 4, C.brick);
          b.set(10, 11, C.grass);
          b.set(7, 8, C.stone);
          break;
        case Tile.Path:
          b.fill(0, 0, 16, 16, C.mist);
          b.set(3, 5, C.stone);
          b.set(11, 10, C.highlightStone);
          b.set(7, 2, C.stone);
          break;
        case Tile.Floor:
          b.fill(0, 0, 16, 16, C.stone);
          b.set(2, 2, C.mist);
          b.set(9, 8, C.brick);
          b.set(13, 13, C.mist);
          break;
        case Tile.Wall:
          b.fill(0, 0, 16, 16, C.brick);
          b.fill(0, 0, 16, 4, C.mist);
          b.fill(1, 1, 6, 2, C.highlightStone);
          b.fill(0, 12, 16, 4, C.shade);
          break;
        case Tile.Water:
          b.fill(0, 0, 16, 16, C.deepWater);
          b.set(2, 5, C.water);
          b.set(3, 6, C.water);
          b.set(10, 11, C.water);
          b.set(11, 10, C.highlightStone);
          break;
        case Tile.Tree:
          b.fill(0, 0, 16, 16, C.grass);
          b.fill(7, 10, 3, 6, C.soil);
          b.circle(8, 7, 6, C.grassLite);
          b.circle(6, 6, 3, C.grass);
          b.set(8, 4, C.shine);
          break;
        case Tile.Flower:
          b.fill(0, 0, 16, 16, C.grass);
          b.set(8, 9, C.grassLite);
          b.set(8, 7, C.life);
          b.set(7, 6, C.ember);
          b.set(9, 6, C.shine);
          break;
        case Tile.Torch:
          b.fill(0, 0, 16, 16, C.stone);
          b.fill(7, 8, 2, 7, C.soil);
          b.fill(6, 3, 4, 6, C.ember);
          b.set(7, 2, C.shine);
          b.set(8, 4, C.metal);
          break;
        case Tile.Rug:
          b.fill(0, 0, 16, 16, C.stone);
          b.fill(2, 2, 12, 12, C.brick);
          b.set(4, 4, C.life);
          b.set(11, 11, C.metal);
          break;
        case Tile.Ruin:
          b.fill(0, 0, 16, 16, C.shade);
          b.set(5, 4, C.stone);
          b.set(12, 10, C.mist);
          b.set(3, 13, C.brick);
          break;
        case Tile.Fence:
          b.fill(0, 0, 16, 16, C.grass);
          b.fill(2, 7, 12, 2, C.soil);
          b.fill(3, 4, 2, 9, C.metal);
          b.fill(11, 4, 2, 9, C.metal);
          break;
        case Tile.Hedge:
          b.fill(0, 0, 16, 16, C.grass);
          b.circle(8, 8, 6, C.grassLite);
          b.set(5, 6, C.grass);
          b.set(11, 9, C.ember);
          break;
        case Tile.Crypt:
          b.fill(0, 0, 16, 16, C.brick);
          b.set(4, 4, C.metal);
          b.set(11, 9, C.mist);
          b.set(7, 12, C.shade);
          break;
        default:
          b.fill(0, 0, 16, 16, C.night);
      }
    }, 16, 16),
  );
}

function capeColor(look: ActorLook): number {
  if (look.cape === "royal") return C.life;
  if (look.cape === "light") return C.water;
  if (look.cape === "arcane") return C.deepWater;
  if (look.cape === "holy") return C.shine;
  return JOB_CAPE[look.job];
}

function bodyColor(look: ActorLook): number {
  if (look.plated || look.body === "plate") return C.mist;
  if (look.body === "mail") return C.highlightStone;
  if (look.body === "coat") return C.brick;
  if (look.body === "robe") return C.deepWater;
  if (look.body === "vestment") return C.cloth;
  return JOB_BODY[look.job];
}

export function actorSprite(look: ActorLook, facing: Facing, frame: number, attack: boolean): HTMLCanvasElement {
  const key = `a:${look.job}:${look.helm}:${look.body}:${look.cape}:${look.weapon}:${look.plated}:${facing}:${frame}:${attack ? 1 : 0}`;
  return cached(key, () =>
    bake((b) => {
      const walk = frame % 4;
      const leg = walk === 1 ? -1 : walk === 3 ? 1 : 0;
      const bob = walk === 2 ? 1 : 0;
      const fy = 3 + bob;

      b.ellipse(16, 29, 7, 2, C.shade);

      const cape = capeColor(look);
      if (facing === 3) {
        b.fill(8, 11 + fy, 16, 14, cape);
        b.fill(7, 14 + fy, 18, 10, cape);
      } else {
        b.fill(9, 13 + fy, 14, 13, cape);
        if (facing === 1) b.fill(4, 12 + fy, 8, 13, cape);
        if (facing === 2) b.fill(20, 12 + fy, 8, 13, cape);
      }

      const boot = C.brick;
      if (facing === 0 || facing === 3) {
        b.fill(11, 23 + fy + (facing === 0 ? -leg : 0), 4, 6, boot);
        b.fill(17, 23 + fy + (facing === 0 ? leg : 0), 4, 6, boot);
      } else {
        b.fill(14, 23 + fy + leg, 5, 6, boot);
      }

      const body = bodyColor(look);
      b.fill(10, 12 + fy, 12, 11, body);
      b.fill(11, 13 + fy, 10, 3, C.highlightStone);
      if (look.plated || look.body === "plate" || look.job === "knight") {
        b.fill(11, 14 + fy, 10, 4, C.metal);
      }
      if (look.job === "shrine") b.fill(13, 16 + fy, 6, 3, C.metal);
      if (look.job === "arcanist") b.fill(12, 17 + fy, 8, 3, C.water);

      const hx = facing === 1 ? 15 : facing === 2 ? 17 : 16;
      const hy = 8 + fy;
      b.circle(hx, hy, 6, C.cloth);
      b.circle(hx, hy - 1, 5, C.cloth);
      b.set(hx, hy - 2, C.shine);

      const helm = look.helm;
      if (helm === "helm" || look.job === "knight") {
        b.ellipse(hx, hy - 1, 6, 5, C.metal);
        b.fill(hx - 2, hy, 5, 2, C.cloth);
        b.fill(hx - 1, hy - 5, 3, 3, C.ember);
      } else if (helm === "hood" || look.job === "arcanist") {
        b.ellipse(hx, hy - 1, 6, 6, C.water);
        b.fill(hx - 2, hy, 5, 2, C.cloth);
      } else if (helm === "circlet" || look.job === "shrine") {
        b.fill(hx - 5, hy - 4, 10, 2, C.metal);
        b.set(hx, hy - 5, C.shine);
      } else {
        b.ellipse(hx, hy - 3, 6, 3, C.brick);
        if (facing !== 3) {
          b.set(hx - 2, hy, C.brick);
          b.set(hx + 2, hy, C.brick);
        }
      }

      if (facing !== 3) {
        b.fill(hx - 5, 14 + fy, 3, 6, C.cloth);
        b.fill(hx + 3, 14 + fy, 3, 6, C.cloth);
      }

      b.rim(C.stone);
      const swing = attack ? (facing === 1 ? -7 : facing === 2 ? 7 : 0) : 0;
      const wy = attack ? 9 + fy : 15 + fy;
      drawWeapon(b, look.weapon, facing, hx, wy, swing);
    }, 32, 32),
  );
}

function drawWeapon(b: PixelBuf, w: WeaponLook, facing: Facing, hx: number, wy: number, swing: number): void {
  const side = facing === 1 ? -1 : 1;
  const ox = facing === 0 ? 6 : facing === 3 ? -5 : 7 * side;
  const x = hx + ox + swing;
  if (w === "staff" || w === "rod") {
    b.line(x, wy + 11, x, wy - 10, C.metal);
    b.line(x + 1, wy + 11, x + 1, wy - 10, C.soil);
    b.circle(x, wy - 11, w === "staff" ? 4 : 3, w === "staff" ? C.ember : C.metal);
    b.set(x, wy - 11, C.shine);
  } else if (w === "sword") {
    b.line(x, wy + 3, x + (facing === 1 ? -1 : 1), wy - 12, C.shine);
    b.line(x + side, wy + 3, x + side * 2, wy - 11, C.highlightStone);
    b.line(x - 3, wy + 2, x + 3, wy + 2, C.metal);
  } else if (w === "saber") {
    b.line(x, wy + 2, x + 3 * side, wy - 11, C.shine);
    b.line(x, wy + 1, x + 2 * side, wy - 10, C.metal);
    b.set(x, wy + 2, C.ember);
  } else {
    b.line(x, wy + 1, x + side * 2, wy - 7, C.metal);
    b.line(x + side, wy + 1, x + side * 3, wy - 6, C.highlightStone);
  }
}

export function enemySprite(kind: string, facing: Facing, frame: number, elite = false): HTMLCanvasElement {
  return cached(`e:${kind}:${facing}:${frame}:${elite ? 1 : 0}`, () =>
    bake((b) => {
      const bob = frame % 2;
      b.ellipse(16, 27, 6, 2, C.shade);
      if (kind === "slime") {
        b.ellipse(16, 20 - bob, 9, 7 + bob, C.grassLite);
        b.ellipse(16, 18 - bob, 7, 5, C.grass);
        b.set(13, 16 - bob, C.brick);
        b.set(19, 16 - bob, C.brick);
        b.set(16, 21 - bob, C.life);
        b.set(15, 14 - bob, C.shine);
      } else if (kind === "wolf") {
        b.fill(9, 17, 14, 7, C.stone);
        b.fill(20, 15 - bob, 8, 6, C.mist);
        b.fill(7, 22, 4, 5, C.brick);
        b.fill(18, 22, 4, 5, C.brick);
        b.set(25, 16, C.cloth);
        b.set(22, 16, C.life);
        b.set(13, 16, C.shade);
      } else if (kind === "bandit") {
        b.fill(11, 13, 10, 10, C.soil);
        b.circle(16, 9, 5, C.cloth);
        b.ellipse(16, 8, 6, 3, C.ember);
        b.line(22, 15, 28, 10, C.metal);
        b.line(23, 15, 29, 10, C.shine);
        b.fill(10, 22, 4, 6, C.brick);
        b.fill(18, 22, 4, 6, C.brick);
      } else if (kind === "shade") {
        b.ellipse(16, 16 + bob, 7, 11, C.water);
        b.ellipse(16, 12 + bob, 5, 5, C.highlightStone);
        b.set(14, 11 + bob, C.shine);
        b.set(18, 11 + bob, C.shine);
      } else {
        b.fill(9, 11, 14, 15, C.mist);
        b.fill(10, 12, 12, 5, C.metal);
        b.fill(11, 7, 10, 7, C.highlightStone);
        b.fill(13, 10, 6, 3, C.brick);
        b.line(24, 13, 30, 6, C.metal);
        b.line(25, 13, 30, 7, C.shine);
        b.fill(10, 24, 5, 5, C.brick);
        b.fill(17, 24, 5, 5, C.brick);
        if (elite) b.fill(15, 5, 3, 3, C.ember);
      }
      b.rim(C.stone);
    }, 32, 32),
  );
}

export function npcSprite(id: string, frame: number): HTMLCanvasElement {
  return cached(`n:${id}:${frame}`, () =>
    bake((b) => {
      b.ellipse(16, 28, 6, 2, C.shade);
      b.fill(10, 13, 12, 12, id === "trainer" ? C.metal : C.mist);
      b.circle(16, 8, 6, C.cloth);
      b.ellipse(16, 6, 6, 3, C.brick);
      if (id === "trainer") {
        b.fill(11, 3, 10, 3, C.ember);
        b.line(24, 16, 24, 4, C.metal);
        b.circle(24, 4, 2, C.shine);
      } else {
        b.fill(12, 16, 8, 4, C.life);
      }
      b.rim(C.stone);
    }, 32, 32),
  );
}

export function dropSprite(kind: "bag" | "coin" | "gem"): HTMLCanvasElement {
  return cached(`d:${kind}`, () =>
    bake((b) => {
      if (kind === "coin") {
        b.circle(8, 8, 5, C.metal);
        b.set(8, 7, C.shine);
        b.set(7, 8, C.ember);
      } else if (kind === "gem") {
        b.fill(5, 4, 6, 7, C.ember);
        b.set(8, 6, C.shine);
        b.set(7, 5, C.life);
      } else {
        b.fill(3, 5, 10, 8, C.soil);
        b.fill(4, 4, 8, 4, C.metal);
        b.set(8, 6, C.ember);
      }
    }, 16, 16),
  );
}

export function fxSlash(frame: number): HTMLCanvasElement {
  return cached(`fx:slash:${frame}`, () =>
    bake((b) => {
      const a = 4 + frame * 3;
      b.ellipse(12, 12, 8, 3, C.shine);
      b.line(4, 14, a + 8, 6, C.metal);
    }, 24, 24),
  );
}

export function fxSpark(frame: number): HTMLCanvasElement {
  return cached(`fx:spark:${frame}`, () =>
    bake((b) => {
      b.circle(8, 8, 2 + (frame % 2), C.ember);
      b.set(8, 8, C.shine);
    }, 16, 16),
  );
}

export function warmArt(): void {
  for (let t = 1; t <= 15; t++) tileSprite(t);
  const looks: ActorLook[] = [
    { job: "commoner", helm: "hair", body: "tunic", cape: "short", weapon: "dagger", plated: false },
    { job: "knight", helm: "helm", body: "mail", cape: "royal", weapon: "sword", plated: false },
    { job: "blader", helm: "hair", body: "coat", cape: "light", weapon: "saber", plated: false },
    { job: "arcanist", helm: "hood", body: "robe", cape: "arcane", weapon: "staff", plated: false },
    { job: "shrine", helm: "circlet", body: "vestment", cape: "holy", weapon: "rod", plated: false },
  ];
  for (const look of looks) {
    for (let f = 0 as Facing; f < 4; f = ((f + 1) as Facing)) {
      for (let fr = 0; fr < 4; fr++) actorSprite(look, f, fr, false);
    }
  }
  for (const k of ["slime", "wolf", "bandit", "shade", "ironward"]) {
    enemySprite(k, 0, 0);
    enemySprite(k, 0, 1);
  }
}
