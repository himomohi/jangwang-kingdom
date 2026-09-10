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
  commoner: C.stone,
  knight: C.life,
  blader: C.water,
  arcanist: C.deepWater,
  shrine: C.cloth,
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
          b.fill(0, 0, 16, 1, C.grassLite);
          b.set(3, 5, C.grassLite);
          b.set(11, 9, C.soil);
          b.set(7, 12, C.grassLite);
          break;
        case Tile.GrassTall:
          b.fill(0, 0, 16, 16, C.grass);
          for (let i = 0; i < 5; i++) b.line(2 + i * 3, 14, 2 + i * 3, 6 + (i % 2), C.grassLite);
          break;
        case Tile.Dirt:
          b.fill(0, 0, 16, 16, C.soil);
          b.set(4, 4, C.brick);
          b.set(10, 11, C.grass);
          break;
        case Tile.Path:
          b.fill(0, 0, 16, 16, C.stone);
          b.fill(0, 0, 16, 1, C.mist);
          b.set(2, 7, C.brick);
          b.set(12, 4, C.highlightStone);
          break;
        case Tile.Floor:
          b.fill(0, 0, 16, 16, C.stone);
          b.fill(0, 0, 1, 16, C.brick);
          b.fill(0, 0, 16, 1, C.mist);
          break;
        case Tile.Wall:
          b.fill(0, 0, 16, 16, C.brick);
          b.fill(0, 0, 16, 3, C.mist);
          b.fill(0, 13, 16, 3, C.shade);
          b.line(8, 3, 8, 13, C.stone);
          break;
        case Tile.Water:
          b.fill(0, 0, 16, 16, C.deepWater);
          b.line(1, 5, 6, 4, C.water);
          b.line(8, 11, 14, 10, C.water);
          break;
        case Tile.Tree:
          b.fill(0, 0, 16, 16, C.grass);
          b.fill(6, 9, 4, 7, C.soil);
          b.circle(8, 7, 6, C.grass);
          b.circle(8, 6, 4, C.grassLite);
          b.set(5, 4, C.soil);
          break;
        case Tile.Flower:
          b.fill(0, 0, 16, 16, C.grass);
          b.set(8, 10, C.grassLite);
          b.set(8, 8, C.life);
          b.set(7, 7, C.ember);
          b.set(9, 7, C.shine);
          break;
        case Tile.Torch:
          b.fill(0, 0, 16, 16, C.stone);
          b.fill(7, 8, 2, 7, C.soil);
          b.fill(6, 4, 4, 5, C.ember);
          b.set(7, 3, C.shine);
          break;
        case Tile.Rug:
          b.fill(0, 0, 16, 16, C.brick);
          b.fill(1, 1, 14, 14, C.life);
          b.fill(3, 3, 10, 10, C.brick);
          break;
        case Tile.Ruin:
          b.fill(0, 0, 16, 16, C.shade);
          b.fill(0, 0, 16, 2, C.brick);
          b.set(5, 8, C.stone);
          b.set(12, 12, C.mist);
          break;
        case Tile.Fence:
          b.fill(0, 0, 16, 16, C.grass);
          b.fill(1, 6, 14, 3, C.soil);
          b.fill(3, 3, 2, 10, C.soil);
          b.fill(11, 3, 2, 10, C.soil);
          break;
        case Tile.Hedge:
          b.fill(0, 0, 16, 16, C.grass);
          b.circle(8, 8, 7, C.grass);
          b.circle(8, 7, 5, C.grassLite);
          break;
        case Tile.Crypt:
          b.fill(0, 0, 16, 16, C.shade);
          b.line(0, 8, 15, 8, C.brick);
          b.set(4, 4, C.metal);
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
      const fy = 4 + bob;

      b.ellipse(16, 28, 6, 2, C.shade);

      const cape = capeColor(look);
      if (facing === 3) {
        b.fill(10, 10 + fy, 12, 12, cape);
        b.fill(9, 12 + fy, 14, 10, cape);
      } else {
        b.fill(11, 14 + fy, 10, 10, cape);
        if (facing === 1) b.fill(7, 13 + fy, 6, 11, cape);
        if (facing === 2) b.fill(19, 13 + fy, 6, 11, cape);
      }

      const boot = C.shade;
      if (facing === 0 || facing === 3) {
        b.fill(12, 22 + fy + (facing === 0 ? -leg : 0), 3, 6, boot);
        b.fill(17, 22 + fy + (facing === 0 ? leg : 0), 3, 6, boot);
      } else {
        b.fill(14, 22 + fy + leg, 4, 6, boot);
      }

      const body = bodyColor(look);
      b.fill(11, 13 + fy, 10, 10, body);
      if (look.plated || look.body === "plate" || look.job === "knight") {
        b.fill(12, 14 + fy, 8, 3, C.metal);
      }
      if (look.job === "shrine") b.fill(14, 16 + fy, 4, 2, C.metal);
      if (look.job === "arcanist") b.fill(13, 18 + fy, 6, 2, C.water);

      const hx = facing === 1 ? 15 : facing === 2 ? 17 : 16;
      const hy = 8 + fy;
      b.circle(hx, hy, 5, C.cloth);
      b.circle(hx, hy - 1, 4, C.cloth);

      const helm = look.helm;
      if (helm === "helm" || look.job === "knight") {
        b.ellipse(hx, hy - 1, 5, 4, C.metal);
        b.fill(hx - 2, hy, 4, 2, C.cloth);
        b.fill(hx - 1, hy - 4, 2, 2, C.ember);
      } else if (helm === "hood" || look.job === "arcanist") {
        b.ellipse(hx, hy - 1, 5, 5, C.brick);
        b.fill(hx - 2, hy, 4, 2, C.cloth);
      } else if (helm === "circlet" || look.job === "shrine") {
        b.fill(hx - 4, hy - 3, 8, 2, C.metal);
        b.set(hx, hy - 4, C.shine);
      } else {
        b.ellipse(hx, hy - 2, 5, 3, C.shade);
        if (facing !== 3) {
          b.set(hx - 2, hy, C.shade);
          b.set(hx + 1, hy, C.shade);
        }
      }

      const swing = attack ? (facing === 1 ? -6 : facing === 2 ? 6 : 0) : 0;
      const wy = attack ? 10 + fy : 16 + fy;
      drawWeapon(b, look.weapon, facing, hx, wy, swing);

      if (facing !== 3) {
        b.fill(hx - 4, 15 + fy, 3, 5, C.cloth);
        b.fill(hx + 2, 15 + fy, 3, 5, C.cloth);
      }

      b.rim(C.brick);
    }, 32, 32),
  );
}

function drawWeapon(b: PixelBuf, w: WeaponLook, facing: Facing, hx: number, wy: number, swing: number): void {
  const side = facing === 1 ? -1 : 1;
  const ox = facing === 0 ? 6 : facing === 3 ? -5 : 7 * side;
  const x = hx + ox + swing;
  if (w === "staff" || w === "rod") {
    b.line(x, wy + 10, x, wy - 8, C.soil);
    b.circle(x, wy - 9, w === "staff" ? 3 : 2, w === "staff" ? C.ember : C.metal);
    b.set(x, wy - 9, C.shine);
  } else if (w === "sword") {
    b.line(x, wy + 2, x + (facing === 1 ? -1 : 1), wy - 9, C.highlightStone);
    b.line(x - 2, wy + 1, x + 2, wy + 1, C.metal);
  } else if (w === "saber") {
    b.line(x, wy + 1, x + 2 * side, wy - 8, C.shine);
    b.set(x, wy + 1, C.metal);
  } else {
    b.line(x, wy, x + side, wy - 5, C.metal);
  }
}

export function enemySprite(kind: string, facing: Facing, frame: number, elite = false): HTMLCanvasElement {
  return cached(`e:${kind}:${facing}:${frame}:${elite ? 1 : 0}`, () =>
    bake((b) => {
      const bob = frame % 2;
      b.ellipse(16, 27, 6, 2, C.shade);
      if (kind === "slime") {
        b.ellipse(16, 20 - bob, 8, 6 + bob, C.grassLite);
        b.ellipse(16, 18 - bob, 6, 4, C.grass);
        b.set(13, 17 - bob, C.shade);
        b.set(18, 17 - bob, C.shade);
        b.set(16, 21 - bob, C.life);
      } else if (kind === "wolf") {
        b.fill(10, 18, 12, 6, C.brick);
        b.fill(20, 16 - bob, 7, 5, C.shade);
        b.fill(8, 22, 3, 4, C.shade);
        b.fill(18, 22, 3, 4, C.shade);
        b.set(24, 17, C.cloth);
        b.set(14, 17, C.shade);
      } else if (kind === "bandit") {
        b.fill(12, 14, 8, 9, C.soil);
        b.circle(16, 10, 4, C.cloth);
        b.ellipse(16, 9, 5, 3, C.shade);
        b.line(22, 16, 26, 12, C.metal);
        b.fill(11, 22, 3, 5, C.shade);
        b.fill(18, 22, 3, 5, C.shade);
      } else if (kind === "shade") {
        b.ellipse(16, 16 + bob, 6, 10, C.deepWater);
        b.ellipse(16, 12 + bob, 4, 4, C.water);
        b.set(14, 12 + bob, C.shine);
        b.set(18, 12 + bob, C.shine);
      } else {
        b.fill(10, 12, 12, 14, C.mist);
        b.fill(11, 13, 10, 4, C.metal);
        b.fill(12, 8, 8, 6, C.highlightStone);
        b.fill(14, 10, 4, 2, C.brick);
        b.line(24, 14, 28, 8, C.metal);
        b.fill(11, 24, 4, 5, C.shade);
        b.fill(17, 24, 4, 5, C.shade);
        if (elite) b.set(16, 7, C.ember);
      }
      b.rim(C.brick);
    }, 32, 32),
  );
}

export function npcSprite(id: string, frame: number): HTMLCanvasElement {
  return cached(`n:${id}:${frame}`, () =>
    bake((b) => {
      b.ellipse(16, 28, 6, 2, C.shade);
      b.fill(11, 14, 10, 11, id === "trainer" ? C.metal : C.stone);
      b.circle(16, 9, 5, C.cloth);
      b.ellipse(16, 7, 5, 3, C.shade);
      if (id === "trainer") {
        b.fill(12, 4, 8, 2, C.ember);
        b.line(24, 16, 24, 6, C.metal);
      } else {
        b.fill(13, 16, 6, 3, C.life);
      }
      b.rim(C.brick);
    }, 32, 32),
  );
}

export function dropSprite(kind: "bag" | "coin" | "gem"): HTMLCanvasElement {
  return cached(`d:${kind}`, () =>
    bake((b) => {
      if (kind === "coin") {
        b.circle(8, 8, 4, C.metal);
        b.set(8, 7, C.shine);
      } else if (kind === "gem") {
        b.fill(6, 5, 5, 6, C.ember);
        b.set(8, 6, C.shine);
      } else {
        b.fill(4, 6, 8, 6, C.soil);
        b.fill(5, 5, 6, 3, C.ember);
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
