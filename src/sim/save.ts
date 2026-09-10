import { SAVE_KEY } from './config';
import { Sim } from './game';

interface SaveData {
  v: number;
  time: number;
  playTime: number;
  rngState: number;
  player: unknown;
  watcherT: number;
}

/** Serialize sim to localStorage. Returns false when storage unavailable. */
export function saveGame(sim: Sim): boolean {
  try {
    const data: SaveData = {
      v: 1,
      time: sim.time,
      playTime: sim.playTime,
      rngState: sim.rngState,
      player: sim.player,
      watcherT: sim.watcherT,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function hasSave(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) != null;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* noop */
  }
}

/** Load save into sim. Returns true on success. */
export function loadGame(sim: Sim): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw) as SaveData;
    if (!data || data.v !== 1 || !data.player) return false;
    sim.newGame();
    Object.assign(sim.player, data.player);
    // sanitize
    const p = sim.player;
    p.hp = Math.min(p.stats.maxHp, Math.max(1, p.hp));
    p.mp = Math.min(p.stats.maxMp, Math.max(0, p.mp));
    p.alive = true;
    p.atkCd = 0;
    p.skillCd = 0;
    p.hurtCd = 0;
    p.swingT = -1;
    p.castT = -1;
    p.potionT = -1;
    p.talkT = 0;
    p.deadT = 0;
    sim.time = typeof data.time === 'number' ? data.time % 1 : 0.3;
    sim.playTime = data.playTime || 0;
    sim.watcherT = typeof data.watcherT === 'number' ? data.watcherT : 30;
    sim.recompute(false);
    sim.zone = sim.world.zoneAtPx(p.x, p.y);
    return true;
  } catch {
    return false;
  }
}
