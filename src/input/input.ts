import { facingFromVec } from '../sim/combat';
import type { Facing, SimInput } from '../sim/types';

/** Pure builder — used by Input and by headless touch-simulation tests. */
export function buildSimInput(
  mx: number,
  my: number,
  edges: { attack?: boolean; skill?: boolean; interact?: boolean; potion?: boolean },
): SimInput {
  const clamp = (v: number): number => Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0));
  return {
    mx: clamp(mx),
    my: clamp(my),
    attack: !!edges.attack,
    skill: !!edges.skill,
    interact: !!edges.interact,
    potion: !!edges.potion,
  };
}

/**
 * 8-way facing for a move vector (keyboard WASD/arrows + virtual joystick).
 * Diagonals (|mx|>0.3 && |my|>0.3) map to NE/SE/SW/NW via 45-degree sectors.
 */
export function inputToFacing(mx: number, my: number): Facing {
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return 0;
  if (Math.hypot(mx, my) < 0.12) return 0;
  return facingFromVec(mx, my);
}

/** Alias. */
export const moveVecToFacing = inputToFacing;

/** Pure virtual joystick state (no DOM) — testable headlessly. */
export class VirtualJoystick {
  x = 0;
  y = 0;
  active = false;

  /** Set from a drag vector in px relative to base center; radius normalizes. */
  setDrag(dx: number, dy: number, radius: number): void {
    const r = Math.max(1, radius);
    let nx = dx / r;
    let ny = dy / r;
    const m = Math.hypot(nx, ny);
    if (m > 1) {
      nx /= m;
      ny /= m;
    }
    // deadzone
    if (Math.hypot(nx, ny) < 0.12) {
      nx = 0;
      ny = 0;
    }
    this.x = nx;
    this.y = ny;
    this.active = true;
  }

  release(): void {
    this.x = 0;
    this.y = 0;
    this.active = false;
  }
}

const KEYMAP: Record<string, 'up' | 'down' | 'left' | 'right' | 'attack' | 'skill' | 'interact' | 'potion' | 'inv' | 'status' | 'mute' | 'menu' | 'close'> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  KeyJ: 'attack',
  KeyZ: 'attack',
  Space: 'attack',
  KeyK: 'skill',
  KeyX: 'skill',
  ShiftLeft: 'skill',
  ShiftRight: 'skill',
  KeyE: 'interact',
  KeyF: 'interact',
  Enter: 'interact',
  KeyP: 'potion',
  KeyI: 'inv',
  KeyC: 'status',
  KeyM: 'mute',
  Escape: 'menu',
};

export class Input {
  keys = new Set<string>();
  joy = new VirtualJoystick();
  private edges = { attack: false, skill: false, interact: false, potion: false };
  /** UI-level callbacks (panels/mute/menu), wired by orchestrator. */
  onUi: ((action: 'inv' | 'status' | 'mute' | 'menu' | 'close' | 'interact') => void) | null = null;
  enabled = true;
  readonly isTouchDevice: boolean;

  constructor() {
    this.isTouchDevice =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0);
  }

  attach(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const a = KEYMAP[e.code];
      if (!a) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(a);
      if (a === 'attack') this.edges.attack = true;
      else if (a === 'skill') this.edges.skill = true;
      else if (a === 'interact') {
        this.edges.interact = true;
        this.onUi?.('interact');
      } else if (a === 'potion') this.edges.potion = true;
      else if (a === 'inv') this.onUi?.('inv');
      else if (a === 'status') this.onUi?.('status');
      else if (a === 'mute') this.onUi?.('mute');
      else if (a === 'menu') this.onUi?.('menu');
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.keys.delete(a);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.joy.release();
    });
  }

  /** Touch buttons call this (also used by touch-simulation tests via buildSimInput). */
  press(name: 'attack' | 'skill' | 'interact' | 'potion'): void {
    if (!this.enabled) return;
    this.edges[name] = true;
    if (name === 'interact') this.onUi?.('interact');
  }

  setJoystick(x: number, y: number, active: boolean): void {
    if (!active) {
      this.joy.release();
      return;
    }
    this.joy.x = Math.max(-1, Math.min(1, x));
    this.joy.y = Math.max(-1, Math.min(1, y));
    this.joy.active = true;
  }

  /** Build this tick's SimInput and clear edges. */
  consume(): SimInput {
    let mx = 0;
    let my = 0;
    if (this.enabled) {
      if (this.keys.has('left')) mx -= 1;
      if (this.keys.has('right')) mx += 1;
      if (this.keys.has('up')) my -= 1;
      if (this.keys.has('down')) my += 1;
      if (this.joy.active) {
        mx += this.joy.x;
        my += this.joy.y;
      }
    }
    const out = buildSimInput(mx, my, this.edges);
    this.edges.attack = false;
    this.edges.skill = false;
    this.edges.interact = false;
    this.edges.potion = false;
    return out;
  }
}
