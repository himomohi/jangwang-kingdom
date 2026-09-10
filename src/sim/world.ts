import { TILE, WORLD_W, WORLD_H } from './config';
import type { ZoneId } from './types';

/** Tile ids. */
export const T_GRASS = 0;
export const T_TREE = 1;
export const T_ROAD = 2;
export const T_PLAZA = 3;
export const T_WATER = 4;
export const T_WALL = 5;
export const T_RUIN = 6;
export const T_SAND = 7;
export const T_FLOWER = 8;

export interface Building {
  tx: number;
  ty: number;
  tw: number;
  th: number;
  roof: string;
  wall: string;
  sign: string | null;
  label: string;
}

export interface Decor {
  kind: 'tree' | 'rock' | 'flowers' | 'tuft' | 'pillar' | 'lamp';
  x: number;
  y: number;
  variant: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TOWN_RECT = { x0: 38, y0: 44, x1: 57, y1: 62 };
export const RUIN_RECT = { x0: 34, y0: 6, x1: 62, y1: 24 };
export const ARENA_RECT = { x0: 43, y0: 7, x1: 53, y1: 14 };
export const FOREST_RECT = { x0: 5, y0: 18, x1: 32, y1: 58 };
export const CAMP_RECT = { x0: 74, y0: 30, x1: 88, y1: 46 };
export const RIVER_X = [66, 67, 68];

export class World {
  tiles = new Uint8Array(WORLD_W * WORLD_H);
  buildings: Building[] = [];
  decor: Decor[] = [];
  lamps: { x: number; y: number }[] = [];
  spawnSpots: Record<ZoneId, { x: number; y: number }[]> = {
    town: [],
    field: [],
    forest: [],
    road: [],
    ruin: [],
    arena: [],
  };

  constructor(seed = 20260910) {
    this.generate(seed);
  }

  idx(tx: number, ty: number): number {
    return ty * WORLD_W + tx;
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < WORLD_W && ty < WORLD_H;
  }

  tileAt(tx: number, ty: number): number {
    if (!this.inBounds(tx, ty)) return T_WALL;
    return this.tiles[this.idx(tx, ty)];
  }

  zoneAt(tx: number, ty: number): ZoneId {
    if (tx >= ARENA_RECT.x0 && tx <= ARENA_RECT.x1 && ty >= ARENA_RECT.y0 && ty <= ARENA_RECT.y1) return 'arena';
    if (tx >= TOWN_RECT.x0 && tx <= TOWN_RECT.x1 && ty >= TOWN_RECT.y0 && ty <= TOWN_RECT.y1) return 'town';
    if (tx >= RUIN_RECT.x0 && tx <= RUIN_RECT.x1 && ty >= RUIN_RECT.y0 && ty <= RUIN_RECT.y1) return 'ruin';
    if (tx >= CAMP_RECT.x0 && tx <= CAMP_RECT.x1 && ty >= CAMP_RECT.y0 && ty <= CAMP_RECT.y1) return 'road';
    const t = this.tileAt(tx, ty);
    if (t === T_ROAD) {
      // west path through forest counts as forest
      if (tx < TOWN_RECT.x0 && ty >= 50) return 'forest';
      return 'road';
    }
    if (tx >= FOREST_RECT.x0 && tx <= FOREST_RECT.x1 && ty >= FOREST_RECT.y0 && ty <= FOREST_RECT.y1) return 'forest';
    if (tx > RIVER_X[2] && this.tileAt(tx, ty) === T_SAND) return 'road';
    return 'field';
  }

  zoneAtPx(x: number, y: number): ZoneId {
    return this.zoneAt(Math.floor(x / TILE), Math.floor(y / TILE));
  }

  isBlockedPx(x: number, y: number, r = 5): boolean {
    // tile collision
    const x0 = Math.floor((x - r) / TILE);
    const x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE);
    const y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = this.tileAt(tx, ty);
        if (t === T_WALL || t === T_WATER || t === T_TREE) return true;
      }
    }
    // building collision (slightly inset so doors/edges feel fair)
    for (const b of this.buildings) {
      const bx0 = b.tx * TILE + 2;
      const by0 = (b.ty + 1) * TILE;
      const bx1 = (b.tx + b.tw) * TILE - 2;
      const by1 = (b.ty + b.th) * TILE - 4;
      if (x + r > bx0 && x - r < bx1 && y + r > by0 && y - r < by1) return true;
    }
    return false;
  }

  /** Slide movement with collision. Mutates pos. Returns actual moved dx,dy. */
  moveCircle(pos: { x: number; y: number }, dx: number, dy: number, r: number): void {
    const nx = pos.x + dx;
    if (!this.isBlockedPx(nx, pos.y, r)) pos.x = nx;
    const ny = pos.y + dy;
    if (!this.isBlockedPx(pos.x, ny, r)) pos.y = ny;
    pos.x = Math.max(TILE * 2.5, Math.min(WORLD_W * TILE - TILE * 2.5, pos.x));
    pos.y = Math.max(TILE * 2.5, Math.min(WORLD_H * TILE - TILE * 2.5, pos.y));
  }

  private set(tx: number, ty: number, t: number): void {
    if (this.inBounds(tx, ty)) this.tiles[this.idx(tx, ty)] = t;
  }

  private generate(seed: number): void {
    const rnd = mulberry32(seed);
    // base grass
    this.tiles.fill(T_GRASS);

    // flower meadows
    for (let i = 0; i < 260; i++) {
      const tx = 3 + Math.floor(rnd() * (WORLD_W - 6));
      const ty = 3 + Math.floor(rnd() * (WORLD_H - 6));
      this.set(tx, ty, T_FLOWER);
    }

    // river (north-south) with bridge gap
    for (let ty = 2; ty < WORLD_H - 2; ty++) {
      if (ty >= 38 && ty <= 40) continue; // bridge
      for (const tx of RIVER_X) this.set(tx, ty, T_WATER);
    }

    // town plaza + walls + gates
    const T0 = TOWN_RECT;
    for (let ty = T0.y0; ty <= T0.y1; ty++) {
      for (let tx = T0.x0; tx <= T0.x1; tx++) this.set(tx, ty, T_PLAZA);
    }
    for (let tx = T0.x0; tx <= T0.x1; tx++) {
      this.set(tx, T0.y0, T_WALL);
      this.set(tx, T0.y1, T_WALL);
    }
    for (let ty = T0.y0; ty <= T0.y1; ty++) {
      this.set(T0.x0, ty, T_WALL);
      this.set(T0.x1, ty, T_WALL);
    }
    // gates
    for (let tx = 46; tx <= 49; tx++) {
      this.set(tx, T0.y0, T_ROAD);
      this.set(tx, T0.y1, T_ROAD);
    }

    // buildings (original layout)
    this.buildings = [
      { tx: 44, ty: 46, tw: 8, th: 4, roof: '#8e2f3c', wall: '#d8cfae', sign: '#f2c14e', label: '전직관' },
      { tx: 39, ty: 52, tw: 5, th: 4, roof: '#3a4a6b', wall: '#d8cfae', sign: '#e8933c', label: '상점' },
      { tx: 52, ty: 52, tw: 5, th: 4, roof: '#4f7d5a', wall: '#d8cfae', sign: '#e14e2b', label: '여관' },
      { tx: 53, ty: 59, tw: 3, th: 2, roof: '#5c4a7a', wall: '#7d9bbf', sign: null, label: '창고' },
      { tx: 40, ty: 59, tw: 3, th: 2, roof: '#5c4a7a', wall: '#7d9bbf', sign: null, label: '민가' },
    ];
    // clear tiles under buildings to plaza
    for (const b of this.buildings) {
      for (let ty = b.ty; ty < b.ty + b.th; ty++) {
        for (let tx = b.tx; tx < b.tx + b.tw; tx++) this.set(tx, ty, T_PLAZA);
      }
    }

    // roads
    for (let ty = 8; ty <= 69; ty++) {
      if (ty >= T0.y0 && ty <= T0.y1) continue; // inside town handled below
      for (let tx = 46; tx <= 49; tx++) {
        if (this.tileAt(tx, ty) !== T_WATER) this.set(tx, ty, T_ROAD);
      }
    }
    // town interior streets
    for (let ty = T0.y0 + 1; ty <= T0.y1 - 1; ty++) {
      this.set(47, ty, T_ROAD);
      this.set(48, ty, T_ROAD);
    }
    for (let tx = T0.x0 + 1; tx <= T0.x1 - 1; tx++) {
      this.set(tx, 51, T_ROAD);
      this.set(tx, 57, T_ROAD);
    }
    // east road (with bridge over river)
    for (let tx = T0.x1 + 1; tx <= 93; tx++) {
      for (let ty = 38; ty <= 40; ty++) this.set(tx, ty, T_ROAD);
    }
    // west path
    for (let tx = 5; tx <= T0.x0; tx++) {
      if (this.tileAt(tx, 52) === T_GRASS || this.tileAt(tx, 52) === T_FLOWER) this.set(tx, 52, T_ROAD);
      if (this.tileAt(tx, 53) === T_GRASS || this.tileAt(tx, 53) === T_FLOWER) this.set(tx, 53, T_ROAD);
    }

    // ruin ground
    const R0 = RUIN_RECT;
    for (let ty = R0.y0; ty <= R0.y1; ty++) {
      for (let tx = R0.x0; tx <= R0.x1; tx++) {
        const cur = this.tileAt(tx, ty);
        if (cur === T_GRASS || cur === T_FLOWER) this.set(tx, ty, T_RUIN);
      }
    }
    // arena floor = sand
    const A0 = ARENA_RECT;
    for (let ty = A0.y0; ty <= A0.y1; ty++) {
      for (let tx = A0.x0; tx <= A0.x1; tx++) this.set(tx, ty, T_SAND);
    }

    // bandit camp ground
    const C0 = CAMP_RECT;
    for (let ty = C0.y0; ty <= C0.y1; ty++) {
      for (let tx = C0.x0; tx <= C0.x1; tx++) {
        const cur = this.tileAt(tx, ty);
        if (cur === T_GRASS || cur === T_FLOWER) this.set(tx, ty, T_SAND);
      }
    }

    // border walls
    for (let tx = 0; tx < WORLD_W; tx++) {
      this.set(tx, 0, T_WALL); this.set(tx, 1, T_WALL);
      this.set(tx, WORLD_H - 1, T_WALL); this.set(tx, WORLD_H - 2, T_WALL);
    }
    for (let ty = 0; ty < WORLD_H; ty++) {
      this.set(0, ty, T_WALL); this.set(1, ty, T_WALL);
      this.set(WORLD_W - 1, ty, T_WALL); this.set(WORLD_W - 2, ty, T_WALL);
    }

    // forest trees (dense west)
    const F0 = FOREST_RECT;
    for (let ty = F0.y0; ty <= F0.y1; ty++) {
      for (let tx = F0.x0; tx <= F0.x1; tx++) {
        const cur = this.tileAt(tx, ty);
        if ((cur === T_GRASS || cur === T_FLOWER) && rnd() < 0.3) this.set(tx, ty, T_TREE);
      }
    }
    // scattered trees elsewhere
    for (let i = 0; i < 700; i++) {
      const tx = 3 + Math.floor(rnd() * (WORLD_W - 6));
      const ty = 3 + Math.floor(rnd() * (WORLD_H - 6));
      const cur = this.tileAt(tx, ty);
      if (cur === T_GRASS && rnd() < 0.12) this.set(tx, ty, T_TREE);
    }

    // decor: tufts / flowers / rocks on walkable tiles
    for (let i = 0; i < 420; i++) {
      const tx = 3 + Math.floor(rnd() * (WORLD_W - 6));
      const ty = 3 + Math.floor(rnd() * (WORLD_H - 6));
      const cur = this.tileAt(tx, ty);
      if (cur !== T_GRASS && cur !== T_FLOWER && cur !== T_RUIN) continue;
      const roll = rnd();
      const kind = roll < 0.45 ? 'tuft' : roll < 0.75 ? 'flowers' : 'rock';
      this.decor.push({
        kind,
        x: tx * TILE + 3 + rnd() * 10,
        y: ty * TILE + 4 + rnd() * 10,
        variant: Math.floor(rnd() * 100),
      });
    }
    // ruin pillars
    for (let i = 0; i < 16; i++) {
      const tx = R0.x0 + 1 + Math.floor(rnd() * (R0.x1 - R0.x0 - 1));
      const ty = R0.y0 + 1 + Math.floor(rnd() * (R0.y1 - R0.y0 - 1));
      if (this.tileAt(tx, ty) !== T_RUIN) continue;
      if (tx >= 45 && tx <= 50) continue; // keep road clear
      this.decor.push({ kind: 'pillar', x: tx * TILE + 8, y: ty * TILE + 12, variant: Math.floor(rnd() * 100) });
    }
    // arena pillars (symmetric, original arrangement)
    const pillarPairs: [number, number][] = [
      [43, 7], [53, 7], [43, 14], [53, 14], [45, 10], [51, 10],
    ];
    for (const [tx, ty] of pillarPairs) {
      this.decor.push({ kind: 'pillar', x: tx * TILE + 8, y: ty * TILE + 12, variant: (tx * 7 + ty) % 100 });
    }

    // lamps (town + key points)
    const lampTiles: [number, number][] = [
      [45, 43], [50, 43], [45, 63], [50, 63], // gates
      [41, 47], [54, 47], [41, 58], [54, 58], // plaza corners
      [47, 54], // center
      [42, 51], [53, 51], // street
      [65, 37], [69, 41], // bridge
      [76, 33], [86, 43], // camp
      [45, 25], [51, 25], // ruin entrance
    ];
    for (const [tx, ty] of lampTiles) {
      this.lamps.push({ x: tx * TILE + 8, y: ty * TILE + 8 });
      this.decor.push({ kind: 'lamp', x: tx * TILE + 8, y: ty * TILE + 8, variant: 0 });
    }

    // spawn spots per zone (walkable, away from town center for field mobs)
    const townCx = 47.5 * TILE;
    const townCy = 53 * TILE;
    for (let i = 0; i < 2600; i++) {
      const tx = 3 + Math.floor(rnd() * (WORLD_W - 6));
      const ty = 3 + Math.floor(rnd() * (WORLD_H - 6));
      const t = this.tileAt(tx, ty);
      if (t === T_WALL || t === T_WATER || t === T_TREE || t === T_PLAZA) continue;
      const x = tx * TILE + 8;
      const y = ty * TILE + 10;
      const zone = this.zoneAt(tx, ty);
      if (zone === 'town' || zone === 'arena') continue;
      const dTown = Math.hypot(x - townCx, y - townCy);
      if (dTown < 130) continue; // safe apron around gates
      if (this.spawnSpots[zone].length < 90) this.spawnSpots[zone].push({ x, y });
    }
  }

  randomSpot(zone: ZoneId, rnd: () => number): { x: number; y: number } | null {
    const list = this.spawnSpots[zone];
    if (list.length === 0) return null;
    return list[Math.floor(rnd() * list.length)];
  }
}
