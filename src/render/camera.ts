import { INTERNAL_H, INTERNAL_W, MAP_H, MAP_W, TILE } from "../sim/types";

export function cameraOrigin(camX: number, camY: number): { x: number; y: number } {
  const hw = INTERNAL_W / 2;
  const hh = INTERNAL_H / 2;
  const maxX = MAP_W * TILE - INTERNAL_W;
  const maxY = MAP_H * TILE - INTERNAL_H;
  return {
    x: Math.max(0, Math.min(maxX, camX - hw)),
    y: Math.max(0, Math.min(maxY, camY - hh)),
  };
}

export function worldToScreen(wx: number, wy: number, ox: number, oy: number): { x: number; y: number } {
  return { x: Math.round(wx - ox), y: Math.round(wy - oy) };
}
