import type { Input } from '../input/input';

/**
 * Touch controls: left virtual joystick + right action buttons.
 * Pointer Events based (mouse + touch). touch-action:none + preventDefault
 * keep the page from scrolling while playing.
 */
export class TouchControls {
  private zone: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private joyPointer = -1;
  private centerX = 0;
  private centerY = 0;
  private radius = 52;

  constructor(private input: Input) {
    this.zone = document.getElementById('joy-zone') as HTMLElement;
    this.base = document.getElementById('joy-base') as HTMLElement;
    this.knob = document.getElementById('joy-knob') as HTMLElement;
  }

  attach(): void {
    const root = document.getElementById('touch') as HTMLElement;
    // Show touch UI on touch devices (hard requirement); also enable via
    // coarse-pointer media as a fallback for hybrid laptops in tablet mode.
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (this.input.isTouchDevice || coarse) root.classList.remove('hidden');

    // --- joystick ---
    this.zone.addEventListener('pointerdown', (e) => {
      if (this.joyPointer !== -1) return;
      this.joyPointer = e.pointerId;
      this.zone.setPointerCapture(e.pointerId);
      const rect = this.base.getBoundingClientRect();
      this.centerX = rect.left + rect.width / 2;
      this.centerY = rect.top + rect.height / 2;
      this.radius = Math.max(40, rect.width / 2);
      this.moveKnob(e.clientX, e.clientY);
      e.preventDefault();
    });
    this.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyPointer) return;
      this.moveKnob(e.clientX, e.clientY);
      e.preventDefault();
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.joyPointer) return;
      this.joyPointer = -1;
      this.knob.style.transform = 'translate(-50%,-50%)';
      this.input.setJoystick(0, 0, false);
    };
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);

    // --- buttons ---
    const bind = (id: string, name: 'attack' | 'skill' | 'interact' | 'potion'): void => {
      const el = document.getElementById(id) as HTMLElement;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.classList.add('pressed');
        this.input.press(name);
      });
      el.addEventListener('pointerup', () => el.classList.remove('pressed'));
      el.addEventListener('pointercancel', () => el.classList.remove('pressed'));
      el.addEventListener('pointerleave', () => el.classList.remove('pressed'));
    };
    bind('t-attack', 'attack');
    bind('t-skill', 'skill');
    bind('t-interact', 'interact');
    bind('t-potion', 'potion');

    // --- never scroll/zoom the page from the game surface ---
    const stage = document.getElementById('stage') as HTMLElement;
    stage.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    stage.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  }

  private moveKnob(cx: number, cy: number): void {
    let dx = cx - this.centerX;
    let dy = cy - this.centerY;
    const m = Math.hypot(dx, dy);
    if (m > this.radius) {
      dx = (dx / m) * this.radius;
      dy = (dy / m) * this.radius;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    this.input.joy.setDrag(dx, dy, this.radius);
  }
}
