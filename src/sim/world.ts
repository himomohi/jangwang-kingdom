import { C } from "../art/palette";
import { hashSeed, irand, mulberry32 } from "./rng";
import { MAP_H, MAP_W, TILE } from "./types";

export const enum Tile {
  Grass = 1,
  GrassTall = 2,
  Dirt = 3,
  Path = 4,
  Floor = 5,
  Wall = 6,
  Water = 7,
  Tree = 8,
  Flower = 9,
  Torch = 10,
  Rug = 11,
  Ruin = 12,
  Fence = 13,
  Hedge = 14,
  Crypt = 15,
}

export const SOLID: Record<number, boolean> = {
  [Tile.Wall]: true,
  [Tile.Water]: true,
  [Tile.Tree]: true,
  [Tile.Fence]: true,
  [Tile.Hedge]: true,
};

export interface Light {
  x: number;
  y: number;
  r: number;
}

export interface World {
  tiles: Uint8Array;
  seed: number;
  lights: Light[];
}

export function tileAt(w: World, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return Tile.Wall;
  return w.tiles[ty * MAP_W + tx]!;
}

export function walkable(w: World, x: number, y: number, rad = 5): boolean {
  const pts: Array<[number, number]> = [
    [x - rad, y],
    [x + rad, y],
    [x, y - rad * 0.6],
    [x, y + rad],
  ];
  for (const [px, py] of pts) {
    const t = tileAt(w, Math.floor(px / TILE), Math.floor(py / TILE));
    if (SOLID[t]) return false;
  }
  return true;
}

function setTile(tiles: Uint8Array, x: number, y: number, t: number): void {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
  tiles[y * MAP_W + x] = t;
}

function fill(tiles: Uint8Array, x: number, y: number, w: number, h: number, t: number): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) setTile(tiles, xx, yy, t);
  }
}

function rectWall(tiles: Uint8Array, x: number, y: number, w: number, h: number, floor = Tile.Floor): void {
  fill(tiles, x, y, w, h, Tile.Wall);
  fill(tiles, x + 1, y + 1, w - 2, h - 2, floor);
}

function hline(tiles: Uint8Array, x0: number, x1: number, y: number, t: number): void {
  const a = Math.min(x0, x1);
  const b = Math.max(x0, x1);
  for (let x = a; x <= b; x++) setTile(tiles, x, y, t);
}

export function buildWorld(seed = 0x7a6b): World {
  const tiles = new Uint8Array(MAP_W * MAP_H);
  const rng = mulberry32(seed);
  const lights: Light[] = [];

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const n = rng();
      let t = Tile.Grass;
      if (y < 18) t = n < 0.55 ? Tile.Ruin : Tile.Dirt;
      else if (n < 0.08) t = Tile.GrassTall;
      else if (n < 0.11) t = Tile.Dirt;
      setTile(tiles, x, y, t);
    }
  }

  // Field pond
  fill(tiles, 70, 30, 10, 8, Tile.Water);
  fill(tiles, 72, 32, 6, 4, Tile.Water);

  // North road from town gate to crypt
  for (let y = 12; y <= 52; y++) {
    setTile(tiles, 47, y, Tile.Path);
    setTile(tiles, 48, y, Tile.Path);
    setTile(tiles, 49, y, Tile.Path);
  }
  hline(tiles, 40, 56, 64, Tile.Path);
  hline(tiles, 40, 56, 65, Tile.Path);

  // Crypt chamber
  rectWall(tiles, 40, 2, 17, 14, Tile.Crypt);
  hline(tiles, 46, 50, 15, Tile.Path);
  setTile(tiles, 47, 15, Tile.Path);
  setTile(tiles, 48, 15, Tile.Path);
  setTile(tiles, 49, 15, Tile.Path);

  // Town yard
  fill(tiles, 28, 54, 40, 22, Tile.Dirt);
  fill(tiles, 32, 58, 32, 16, Tile.Floor);
  fill(tiles, 40, 61, 16, 8, Tile.Floor);
  fill(tiles, 46, 63, 5, 5, Tile.Path);

  // Town fence + gate
  for (let x = 28; x < 68; x++) {
    if (x < 46 || x > 50) {
      setTile(tiles, x, 53, Tile.Fence);
      setTile(tiles, x, 75, Tile.Fence);
    }
  }
  for (let y = 53; y < 76; y++) {
    setTile(tiles, 28, y, Tile.Fence);
    setTile(tiles, 67, y, Tile.Fence);
  }
  hline(tiles, 46, 50, 53, Tile.Path);

  // Inn west
  rectWall(tiles, 30, 60, 9, 9, Tile.Floor);
  setTile(tiles, 38, 65, Tile.Floor);
  setTile(tiles, 38, 64, Tile.Floor);

  // House east
  rectWall(tiles, 57, 60, 9, 9, Tile.Floor);
  setTile(tiles, 57, 65, Tile.Floor);
  setTile(tiles, 57, 64, Tile.Floor);

  // Trainer booth
  rectWall(tiles, 51, 54, 7, 6, Tile.Floor);
  setTile(tiles, 52, 59, Tile.Floor);
  setTile(tiles, 53, 59, Tile.Floor);

  // Hedge garden
  fill(tiles, 33, 70, 6, 3, Tile.Hedge);
  setTile(tiles, 35, 71, Tile.Flower);

  // Seeded field props (chunks 16x16)
  for (let cy = 1; cy < 4; cy++) {
    for (let cx = 0; cx < 6; cx++) {
      const cr = mulberry32(hashSeed(seed ^ (cx * 131 + cy * 917)));
      for (let i = 0; i < 10; i++) {
        const tx = cx * 16 + irand(cr, 16);
        const ty = cy * 16 + irand(cr, 16);
        if (ty < 16 || ty > 51) continue;
        const cur = tiles[ty * MAP_W + tx]!;
        if (cur !== Tile.Grass && cur !== Tile.GrassTall && cur !== Tile.Dirt) continue;
        const roll = cr();
        if (roll < 0.22) setTile(tiles, tx, ty, Tile.Tree);
        else if (roll < 0.4) setTile(tiles, tx, ty, Tile.Flower);
        else if (roll < 0.7) setTile(tiles, tx, ty, Tile.GrassTall);
      }
    }
  }

  // Torches
  const torchTiles: Array<[number, number]> = [
    [46, 54],
    [50, 54],
    [40, 62],
    [55, 62],
    [48, 16],
    [42, 6],
    [54, 6],
  ];
  for (const [x, y] of torchTiles) {
    const cur = tileAt({ tiles, seed, lights }, x, y);
    if (!SOLID[cur]) setTile(tiles, x, y, Tile.Torch);
    lights.push({ x: x * TILE + 8, y: y * TILE + 8, r: 46 });
  }

  return { tiles, seed, lights };
}

export function tileTint(t: number): number {
  switch (t) {
    case Tile.Grass:
      return C.grass;
    case Tile.GrassTall:
      return C.grassLite;
    case Tile.Dirt:
      return C.soil;
    case Tile.Path:
    case Tile.Floor:
      return C.stone;
    case Tile.Wall:
      return C.brick;
    case Tile.Water:
      return C.deepWater;
    case Tile.Tree:
      return C.soil;
    case Tile.Flower:
      return C.grass;
    case Tile.Torch:
      return C.stone;
    case Tile.Rug:
      return C.brick;
    case Tile.Ruin:
      return C.shade;
    case Tile.Fence:
      return C.soil;
    case Tile.Hedge:
      return C.grass;
    case Tile.Crypt:
      return C.shade;
    default:
      return C.night;
  }
}

export function worldPixel(x: number, y: number): { tx: number; ty: number } {
  return { tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) };
}
