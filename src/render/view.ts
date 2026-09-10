import { overlays } from "../art/overlay";
import { actorSprite, dropSprite, enemySprite, fxSpark, npcSprite, tileSprite } from "../art/sprites";
import { hexOf, PALETTE } from "../art/palette";
import type { Game } from "../sim/game";
import { playerLook } from "../sim/game";
import { ITEMS } from "../sim/items";
import { MAP_H, MAP_W, TILE, INTERNAL_H, INTERNAL_W } from "../sim/types";
import { Tile, tileAt } from "../sim/world";
import { cameraOrigin } from "./camera";

export function drawWorld(ctx: CanvasRenderingContext2D, g: Game): void {
  const { x: ox, y: oy } = cameraOrigin(g.camX, g.camY);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = PALETTE[0];
  ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);

  const x0 = Math.max(0, Math.floor(ox / TILE));
  const y0 = Math.max(0, Math.floor(oy / TILE));
  const x1 = Math.min(MAP_W, Math.ceil((ox + INTERNAL_W) / TILE) + 1);
  const y1 = Math.min(MAP_H, Math.ceil((oy + INTERNAL_H) / TILE) + 1);

  for (let ty = y0; ty < y1; ty++) {
    for (let tx = x0; tx < x1; tx++) {
      const t = tileAt(g.world, tx, ty);
      const spr = tileSprite(t);
      ctx.drawImage(spr, Math.round(tx * TILE - ox), Math.round(ty * TILE - oy));
    }
  }

  // roofs over walls
  for (let ty = y0; ty < y1; ty++) {
    for (let tx = x0; tx < x1; tx++) {
      if (tileAt(g.world, tx, ty) !== Tile.Wall) continue;
      const rx = Math.round(tx * TILE - ox);
      const ry = Math.round(ty * TILE - oy - 6);
      ctx.fillStyle = hexOf(2);
      ctx.fillRect(rx - 1, ry, 18, 8);
      ctx.fillStyle = hexOf(11);
      ctx.fillRect(rx + 3, ry + 1, 10, 3);
    }
  }

  // fountain
  const fx = Math.round(48 * TILE + 1 - ox);
  const fy = Math.round(64 * TILE + 1 - oy);
  ctx.fillStyle = hexOf(3);
  ctx.fillRect(fx, fy, 14, 14);
  ctx.fillStyle = hexOf(10);
  ctx.fillRect(fx + 3, fy + 3, 8, 8);
  ctx.fillStyle = hexOf(15);
  ctx.fillRect(fx + 6, fy + 5, 2, 4);

  for (const d of g.drops) {
    const kind = ITEMS[d.item].slot === "gold" ? "coin" : ITEMS[d.item].slot === "use" ? "gem" : "bag";
    ctx.drawImage(dropSprite(kind), Math.round(d.x - 8 - ox), Math.round(d.y - 8 - oy));
  }

  type Draw = { y: number; fn: () => void };
  const pile: Draw[] = [];

  for (const n of g.npcs) {
    pile.push({
      y: n.y,
      fn: () => {
        const s = npcSprite(n.id, (g.time * 3) | 0);
        ctx.drawImage(s, Math.round(n.x - 16 - ox), Math.round(n.y - 26 - oy));
        ctx.fillStyle = hexOf(15);
        ctx.font = "bold 7px 'Courier New', monospace";
        ctx.textAlign = "center";
        ctx.fillText(n.title, Math.round(n.x - ox), Math.round(n.y - 30 - oy));
      },
    });
  }
  for (const m of g.mobs) {
    if (m.dead) continue;
    pile.push({
      y: m.y,
      fn: () => {
        // drawEnemy: codegen silhouette first; PNG is a low-α hint only.
        const s = enemySprite(m.kind, m.facing, (m.anim | 0) % 2, m.elite);
        const ex = Math.round(m.x - 16 - ox);
        const ey = Math.round(m.y - 26 - oy);
        ctx.drawImage(s, ex, ey);
        if (m.kind === "slime") overlays.drawSlimeHint(ctx, ex, ey, g.time);
        const bw = m.elite ? 22 : 16;
        const hx = Math.round(m.x - bw / 2 - ox);
        const hy = Math.round(m.y - 30 - oy);
        ctx.fillStyle = hexOf(1);
        ctx.fillRect(hx, hy, bw, 2);
        ctx.fillStyle = hexOf(13);
        ctx.fillRect(hx, hy, Math.max(1, (m.hp / m.maxHp) * bw), 2);
      },
    });
  }

  const p = g.player;
  pile.push({
    y: p.y,
    fn: () => {
      if (p.invuln > 0 && ((g.time * 20) | 0) % 2 === 0) return;
      // drawPlayer: codegen silhouette first; knight PNG is a low-α hint only.
      const look = playerLook(p);
      const frame = p.moving ? (p.anim | 0) % 4 : 0;
      const s = actorSprite(look, p.facing, frame, p.attackT > 0);
      const px = Math.round(p.x - 16 - ox);
      const py = Math.round(p.y - 26 - oy);
      ctx.drawImage(s, px, py);
      if (look.job === "knight") overlays.drawKnightHint(ctx, px, py, g.time);
    },
  });

  pile.sort((a, b) => a.y - b.y);
  for (const d of pile) d.fn();

  for (const s of g.shots) {
    ctx.drawImage(fxSpark((g.time * 8) | 0), Math.round(s.x - 8 - ox), Math.round(s.y - 8 - oy));
  }

  // torch glow (warm life accents)
  ctx.globalCompositeOperation = "lighter";
  for (const L of g.world.lights) {
    const gx = L.x - ox;
    const gy = L.y - oy;
    if (gx < -40 || gy < -40 || gx > INTERNAL_W + 40 || gy > INTERNAL_H + 40) continue;
    const grd = ctx.createRadialGradient(gx, gy, 2, gx, gy, L.r);
    grd.addColorStop(0, "rgba(224,144,64,0.28)");
    grd.addColorStop(0.4, "rgba(200,160,96,0.10)");
    grd.addColorStop(1, "rgba(200,160,96,0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(gx, gy, L.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  ctx.font = "bold 8px 'Courier New', monospace";
  ctx.textAlign = "center";
  for (const f of g.floats) {
    ctx.fillStyle = hexOf(f.color);
    ctx.fillText(f.text, Math.round(f.x - ox), Math.round(f.y - oy));
  }
  if (g.hint && g.screen === "play") {
    ctx.textAlign = "center";
    ctx.fillStyle = hexOf(11);
    ctx.font = "bold 9px 'Courier New', monospace";
    ctx.fillText(g.hint, INTERNAL_W / 2, INTERNAL_H - 18);
  }
  ctx.textAlign = "left";
}
