import { Sound } from './audio/sound';
import { Input } from './input/input';
import { PostFX } from './render/post';
import { WorldRenderer } from './render/worldRenderer';
import { Sim } from './sim/game';
import { hasSave, loadGame, saveGame } from './sim/save';
import { Dialog } from './ui/dialog';
import { HUD } from './ui/hud';
import { Panels } from './ui/panels';
import { TouchControls } from './ui/touch';
import type { SimInput } from './sim/types';

type UiState = 'title' | 'playing' | 'paused' | 'over' | 'help';

const STEP = 1 / 60;

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e;
}

export class Game {
  private sim = new Sim();
  private renderer: WorldRenderer;
  private post: PostFX;
  private sound = new Sound();
  private input = new Input();
  private hud = new HUD(this.sound);
  private dialog = new Dialog();
  private panels = new Panels(this.sound);
  private touch: TouchControls;
  private state: UiState = 'title';
  private stateBeforeHelp: UiState = 'title';
  private last = 0;
  private acc = 0;
  private pendingInput: SimInput | null = null;
  private emptyInput: SimInput = { mx: 0, my: 0, attack: false, skill: false, interact: false, potion: false };
  private elapsed = 0;
  private autosaveT = 0;
  private musicT = 0;
  private overT = -1;
  private dialogRefresh = false;

  constructor() {
    this.renderer = new WorldRenderer(el('world') as HTMLCanvasElement);
    this.post = new PostFX(el('post') as HTMLCanvasElement);
    this.touch = new TouchControls(this.input);
  }

  boot(): void {
    this.renderer.overlay.load(import.meta.env.BASE_URL);
    this.input.attach();
    this.touch.attach();
    this.hud.attach();
    this.panels.attach(this.sim);
    this.hud.setMuted(this.sound.muted);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => window.setTimeout(() => this.resize(), 120));
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => this.resize());
    }

    // first gesture unlocks audio
    const unlock = (): void => {
      this.sound.ensure();
      this.updateMusicMode(true);
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });

    // input → UI routing
    this.input.onUi = (action) => {
      if (action === 'interact') {
        this.onInteractPressed();
        return;
      }
      if (this.state === 'title') return;
      if (action === 'inv' && this.state === 'playing' && !this.dialog.open) {
        this.panels.toggle('inv', this.sim);
        this.sound.sfx('ui');
      } else if (action === 'status' && this.state === 'playing' && !this.dialog.open) {
        this.panels.toggle('status', this.sim);
        this.sound.sfx('ui');
      } else if (action === 'mute') {
        this.sound.ensure();
        this.hud.setMuted(this.sound.toggleMute());
      } else if (action === 'menu') {
        this.onMenuPressed();
      }
    };

    this.hud.onButton = (name) => {
      if (name === 'inv' && this.state === 'playing' && !this.dialog.open) this.panels.toggle('inv', this.sim);
      else if (name === 'status' && this.state === 'playing' && !this.dialog.open) this.panels.toggle('status', this.sim);
      else if (name === 'help') this.openHelp();
      else if (name === 'mute') this.hud.setMuted(this.sound.toggleMute());
      else if (name === 'menu') this.onMenuPressed();
    };

    // tap stage advances dialog
    el('stage').addEventListener('pointerdown', () => {
      if (this.dialog.open) this.dialog.advance();
    });

    this.dialog.onChoice = (action) => this.onDialogChoice(action);

    this.wireScreens();
    this.wirePostSettings();
    this.showScreen('title');
    (el('btn-continue') as HTMLButtonElement).disabled = !hasSave();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing') {
          saveGame(this.sim);
          this.pause();
        }
      }
    });

    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---------- screens ----------

  private wireScreens(): void {
    const click = (id: string, fn: () => void): void => {
      (el(id) as HTMLButtonElement).addEventListener('click', () => {
        this.sound.ensure();
        this.sound.sfx('ui');
        fn();
      });
    };
    click('btn-new', () => this.start(true));
    click('btn-continue', () => this.start(false));
    click('btn-howto', () => this.openHelp());
    click('btn-help-back', () => this.closeHelp());
    click('btn-respawn', () => {
      this.sim.respawn();
      this.hideScreens();
      this.state = 'playing';
      this.overT = -1;
    });
    click('btn-title', () => this.toTitle());
    click('btn-save', () => {
      const ok = saveGame(this.sim);
      this.hud.toast(ok ? '💾 저장 완료!' : '⚠️ 저장 실패');
      this.sound.sfx('save');
    });
    click('btn-resume', () => this.resume());
    click('btn-quit-title', () => this.toTitle());
  }

  /** PostFX toggles: bloom/CRT/quality/intensity, persisted in localStorage. */
  private wirePostSettings(): void {
    const bloomBtn = el('btn-bloom') as HTMLButtonElement | null;
    const crtBtn = el('btn-crt') as HTMLButtonElement | null;
    const qBtn = el('btn-quality') as HTMLButtonElement | null;
    const range = el('bloom-range') as HTMLInputElement | null;
    const val = el('bloom-val') as HTMLElement | null;
    const refresh = (): void => {
      const s = this.post.getSettings();
      if (bloomBtn) {
        bloomBtn.textContent = s.bloom ? '🌟 블룸 ON' : '🌟 블룸 OFF';
        bloomBtn.classList.toggle('off', !s.bloom);
      }
      if (crtBtn) {
        crtBtn.textContent = s.crt ? '📺 CRT ON' : '📺 CRT OFF';
        crtBtn.classList.toggle('off', !s.crt);
      }
      if (qBtn) qBtn.textContent = `✨ 화질: ${s.quality}`;
      if (range) range.value = String(Math.round(s.intensity * 100));
      if (val) val.textContent = s.intensity.toFixed(1);
    };
    bloomBtn?.addEventListener('click', () => {
      this.post.toggleBloom();
      this.sound.sfx('ui');
      refresh();
    });
    crtBtn?.addEventListener('click', () => {
      this.post.toggleCrt();
      this.sound.sfx('ui');
      refresh();
    });
    qBtn?.addEventListener('click', () => {
      this.post.cycleQuality();
      this.sound.sfx('ui');
      refresh();
      this.hud.toast(`✨ 화질: ${this.post.getSettings().quality} (${this.post.getPassList().join(' → ')})`, 2200);
    });
    range?.addEventListener('input', () => {
      this.post.setIntensity(Number(range.value) / 100);
      refresh();
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyB') {
        this.post.toggleBloom();
        refresh();
      } else if (e.code === 'KeyV') {
        this.post.toggleCrt();
        refresh();
      } else if (e.code === 'KeyG') {
        this.post.cycleQuality();
        refresh();
      }
    });
    refresh();
  }

  private showScreen(which: 'title' | 'help' | 'over' | 'pause' | null): void {
    for (const id of ['title-screen', 'help-screen', 'over-screen', 'pause-screen']) {
      el(id).classList.add('hidden');
    }
    if (which) el(`${which}-screen`).classList.remove('hidden');
  }

  private hideScreens(): void {
    this.showScreen(null);
  }

  private start(fresh: boolean): void {
    if (fresh) {
      this.sim.newGame();
    } else if (!loadGame(this.sim)) {
      this.hud.toast('세이브를 불러오지 못했습니다. 새로 시작합니다.');
      this.sim.newGame();
    }
    this.hideScreens();
    this.hud.show();
    this.state = 'playing';
    this.overT = -1;
    this.acc = 0;
    this.renderer.camX = 0;
    this.renderer.camY = 0;
    this.renderer.resetFx();
    this.sound.ensure();
    this.updateMusicMode(true);
    this.hud.toast(`📍 ${this.renderer.zoneName(this.sim)}`, 2000);
  }

  private toTitle(): void {
    saveGame(this.sim);
    this.dialog.hide();
    this.panels.hide();
    this.hud.hide();
    this.state = 'title';
    this.showScreen('title');
    (el('btn-continue') as HTMLButtonElement).disabled = !hasSave();
    this.sound.setMode('off');
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.showScreen('pause');
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.hideScreens();
  }

  private openHelp(): void {
    if (this.state === 'help') return;
    this.stateBeforeHelp = this.state;
    this.state = 'help';
    this.showScreen('help');
  }

  private closeHelp(): void {
    if (this.state !== 'help') return;
    this.state = this.stateBeforeHelp === 'help' ? 'title' : this.stateBeforeHelp;
    if (this.state === 'title') this.showScreen('title');
    else if (this.state === 'paused') this.showScreen('pause');
    else this.hideScreens();
  }

  private onMenuPressed(): void {
    if (this.dialog.open) {
      this.dialog.hide();
      return;
    }
    if (this.panels.isOpen()) {
      this.panels.hide();
      return;
    }
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  // ---------- dialog flow ----------

  private onInteractPressed(): void {
    if (this.state !== 'playing') return;
    if (this.dialog.open) {
      this.dialog.advance();
      return;
    }
    if (this.panels.isOpen()) return;
    const r = this.sim.tryInteract();
    if (r.kind === 'npc' && r.npc) {
      this.dialogRefresh = false;
      this.dialog.show(r.npc.id, this.sim.getDialog(r.npc.id));
    }
  }

  private onDialogChoice(action: string): void {
    const npcId = this.dialog.getNpcId();
    this.sound.sfx('ui');
    if (action === '__ok') {
      if (this.dialogRefresh) {
        this.dialogRefresh = false;
        this.dialog.show(npcId, this.sim.getDialog(npcId));
      } else {
        this.dialog.hide();
      }
      return;
    }
    const res = this.sim.dialogChoice(npcId, action);
    if (res.close) {
      this.dialog.hide();
      if (res.lines.length > 0) this.hud.toast(res.lines[0]);
    } else if (res.refresh && res.lines.length === 0) {
      this.dialog.show(npcId, this.sim.getDialog(npcId));
    } else {
      // show result lines with an OK button, then refresh or close
      this.dialogRefresh = res.refresh;
      const name = (document.getElementById('dialog-name') as HTMLElement).textContent ?? '';
      this.dialog.show(npcId, {
        name,
        lines: res.lines,
        choices: [{ label: '확인', action: '__ok' }],
      });
    }
    if (this.panels.isOpen()) this.panels.render(this.sim);
  }

  // ---------- per-frame ----------

  private resize(): void {
    const stage = el('stage');
    const w = stage.clientWidth || window.innerWidth;
    const h = stage.clientHeight || window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.resize(w, h, dpr);
    this.post.resize(this.renderer.canvas.width, this.renderer.canvas.height);
    const world = el('world');
    const post = el('post');
    if (this.post.ok) {
      world.style.display = 'none';
      post.style.display = 'block';
    } else {
      world.style.display = 'block';
      post.style.display = 'none';
    }
  }

  private simRunning(): boolean {
    return this.state === 'playing' && !this.dialog.open && !this.panels.isOpen() && this.overT < 0;
  }

  private loop(now: number): void {
    requestAnimationFrame((t) => this.loop(t));
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0.016;
    dt = Math.min(0.1, dt);
    this.elapsed += dt;

    if (this.simRunning()) {
      this.pendingInput = this.input.consume();
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 4) {
        const inp = steps === 0 && this.pendingInput ? this.pendingInput : this.emptyInput;
        this.sim.update(STEP, inp);
        this.acc -= STEP;
        steps++;
      }
      if (steps === 4) this.acc = 0;
      this.pendingInput = null;
      this.drainEvents(dt);
      // autosave
      this.autosaveT += dt;
      if (this.autosaveT > 20) {
        this.autosaveT = 0;
        saveGame(this.sim);
      }
      // music
      this.musicT += dt;
      if (this.musicT > 1) {
        this.musicT = 0;
        this.updateMusicMode(false);
      }
      this.hud.update(this.sim);
    } else {
      // keep input edges from piling up while paused
      this.input.consume();
      if (this.state === 'playing') this.hud.update(this.sim);
    }

    // death flow
    if (this.overT >= 0) {
      this.overT += dt;
      if (this.overT > 1.4 && this.state === 'playing') {
        this.state = 'over';
        const p = this.sim.player;
        (el('over-stats') as HTMLElement).textContent =
          `Lv.${p.level} ${p.job} · ${Math.floor(this.sim.playTime / 60)}분 플레이 · ${p.kills} 처치`;
        this.showScreen('over');
        this.sound.sfx('gameover');
      }
    }

    // render world every frame (even on title behind overlay for vibe)
    if (this.state !== 'title') {
      this.renderer.render(this.sim, this.elapsed, dt);
      if (this.post.ok) {
        this.post.render(this.renderer.canvas, this.elapsed, this.sim.darkness(), dt);
      }
    }
  }

  private drainEvents(dt: number): void {
    void dt;
    if (this.sim.events.length === 0) return;
    const evs = this.sim.events.splice(0, this.sim.events.length);
    for (const e of evs) {
      // renderer-only VFX (never decides damage)
      this.renderer.handleSimEvent(e, this.sim);
      switch (e.t) {
        case 'sfx':
          this.sound.sfx(e.id);
          break;
        case 'toast':
          this.hud.toast(e.text);
          break;
        case 'shake':
          this.renderer.addShake(e.power);
          break;
        case 'flash':
          this.renderer.addFlash(e.color);
          this.post.addFlash(e.color);
          break;
        case 'levelup':
          if (this.panels.isOpen()) this.panels.render(this.sim);
          break;
        case 'died':
          if (this.overT < 0) this.overT = 0;
          break;
        case 'job':
          if (this.panels.isOpen()) this.panels.render(this.sim);
          break;
        case 'zone':
          this.hud.toast(`📍 ${this.renderer.zoneName(this.sim)}`, 2200);
          this.updateMusicMode(true);
          break;
      }
    }
  }

  private updateMusicMode(force: boolean): void {
    void force;
    if (this.state === 'title') {
      this.sound.setMode('off');
      return;
    }
    if (this.sim.zone === 'town') {
      this.sound.setMode('town');
      return;
    }
    const p = this.sim.player;
    for (const e of this.sim.enemies) {
      if (e.dead || !e.elite) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) < 420) {
        this.sound.setMode('boss');
        return;
      }
    }
    this.sound.setMode('field');
  }
}
