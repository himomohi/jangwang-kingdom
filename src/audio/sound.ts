/** Web Audio synth: SFX + procedural BGM. No audio assets. */

export type MusicMode = 'town' | 'field' | 'boss' | 'off';

const MUTE_KEY = 'jangwang-kingdom-muted';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;
  private mode: MusicMode = 'off';
  private step = 0;
  private nextT = 0;
  private timer: number | null = null;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
  }

  /** Must be called from a user gesture at least once. */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.32;
      this.musicGain.connect(this.master);
      // shared noise buffer
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startSequencer();
    } catch {
      this.ctx = null;
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* noop */
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  setMode(mode: MusicMode): void {
    this.mode = mode;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slideTo = 0,
    delay = 0,
    music = false,
  ): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (slideTo > 0) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(music && this.musicGain ? this.musicGain : this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, vol: number, filterFreq: number, delay = 0, q = 1): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = filterFreq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  sfx(id: string): void {
    if (!this.ctx || this.muted) return;
    switch (id) {
      case 'swing':
        this.noise(0.09, 0.25, 2600, 0, 2);
        break;
      case 'swing_hit':
        this.noise(0.1, 0.3, 2000, 0, 2);
        this.tone(220, 0.12, 'square', 0.14, 110);
        break;
      case 'hit':
        this.tone(330, 0.08, 'square', 0.12, 180);
        this.noise(0.07, 0.2, 1500);
        break;
      case 'hurt':
        this.tone(180, 0.22, 'sawtooth', 0.2, 70);
        break;
      case 'die':
        this.tone(300, 0.3, 'square', 0.16, 60);
        this.noise(0.25, 0.2, 900);
        break;
      case 'elite_die':
        this.tone(220, 0.7, 'sawtooth', 0.24, 40);
        this.noise(0.6, 0.3, 600);
        this.tone(523, 0.4, 'triangle', 0.2, 0, 0.25);
        break;
      case 'player_die':
        this.tone(260, 1, 'sawtooth', 0.22, 50);
        break;
      case 'coin':
        this.tone(988, 0.07, 'square', 0.1);
        this.tone(1319, 0.12, 'square', 0.1, 0, 0.06);
        break;
      case 'pickup':
        this.tone(660, 0.1, 'triangle', 0.18, 990);
        break;
      case 'equip_drop':
        this.tone(523, 0.12, 'triangle', 0.2);
        this.tone(659, 0.12, 'triangle', 0.2, 0, 0.1);
        this.tone(784, 0.2, 'triangle', 0.2, 0, 0.2);
        break;
      case 'levelup':
        for (let i = 0; i < 5; i++) this.tone(523 * Math.pow(1.2, i), 0.16, 'square', 0.12, 0, i * 0.08);
        break;
      case 'potion':
        this.tone(400, 0.18, 'sine', 0.22, 800);
        break;
      case 'heal':
        this.tone(523, 0.3, 'sine', 0.18, 1046);
        this.tone(784, 0.4, 'sine', 0.14, 1175, 0.15);
        break;
      case 'buy':
        this.tone(880, 0.08, 'square', 0.12);
        this.tone(1174, 0.12, 'square', 0.12, 0, 0.07);
        break;
      case 'equip':
        this.noise(0.12, 0.25, 3200, 0, 3);
        this.tone(440, 0.1, 'triangle', 0.14);
        break;
      case 'talk':
        this.tone(520, 0.07, 'triangle', 0.14);
        break;
      case 'deny':
        this.tone(160, 0.15, 'square', 0.14, 120);
        break;
      case 'ui':
        this.tone(700, 0.05, 'triangle', 0.1);
        break;
      case 'bash':
        this.noise(0.18, 0.32, 700);
        this.tone(140, 0.18, 'sawtooth', 0.2, 60);
        break;
      case 'shield_charge':
        this.noise(0.25, 0.34, 500);
        this.tone(110, 0.3, 'sawtooth', 0.24, 55);
        this.tone(660, 0.2, 'triangle', 0.14, 0, 0.1);
        break;
      case 'triple':
        for (let i = 0; i < 3; i++) {
          this.noise(0.08, 0.28, 3000 - i * 500, i * 0.07, 2);
          this.tone(500 + i * 120, 0.08, 'square', 0.1, 0, i * 0.07);
        }
        break;
      case 'fireball':
        this.noise(0.3, 0.3, 1200);
        this.tone(300, 0.3, 'sawtooth', 0.18, 90);
        break;
      case 'bolt':
        this.tone(800, 0.15, 'sawtooth', 0.12, 200);
        break;
      case 'holy':
        this.tone(659, 0.4, 'sine', 0.2);
        this.tone(880, 0.5, 'sine', 0.18, 0, 0.12);
        this.tone(1318, 0.6, 'sine', 0.14, 0, 0.24);
        break;
      case 'slam':
        this.tone(70, 0.4, 'sine', 0.4, 35);
        this.noise(0.35, 0.35, 300);
        break;
      case 'jobchange':
        for (let i = 0; i < 6; i++) this.tone(440 * Math.pow(1.15, i), 0.2, 'triangle', 0.16, 0, i * 0.09);
        break;
      case 'save':
        this.tone(784, 0.12, 'triangle', 0.16);
        this.tone(1046, 0.2, 'triangle', 0.16, 0, 0.1);
        break;
      case 'gameover':
        this.tone(330, 0.8, 'triangle', 0.2, 110);
        break;
      default:
        break;
    }
  }

  // ---- procedural BGM sequencer ----
  private startSequencer(): void {
    if (this.timer != null || !this.ctx) return;
    this.nextT = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 110);
  }

  private schedule(): void {
    if (!this.ctx || this.muted || this.mode === 'off') {
      if (this.ctx) this.nextT = Math.max(this.nextT, this.ctx.currentTime + 0.1);
      return;
    }
    if (!this.ctx || !this.musicGain) return;
    const bpm = this.mode === 'town' ? 92 : this.mode === 'field' ? 126 : 148;
    const stepDur = 60 / bpm / 2; // 8th notes
    while (this.nextT < this.ctx.currentTime + 0.35) {
      const delay = Math.max(0, this.nextT - this.ctx.currentTime);
      this.playStep(this.step, delay, stepDur);
      this.nextT += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  private mtone(freq: number, dur: number, type: OscillatorType, vol: number, delay: number): void {
    this.tone(freq, dur, type, vol, 0, delay, true);
  }

  private playStep(step: number, delay: number, stepDur: number): void {
    // A-minor pentatonic family: A C D E G
    const townLead = [220, 0, 261.6, 0, 293.7, 329.6, 0, 293.7, 261.6, 0, 220, 0, 196, 220, 0, 0];
    const fieldLead = [329.6, 0, 392, 440, 0, 392, 329.6, 0, 293.7, 329.6, 0, 261.6, 293.7, 0, 329.6, 0];
    const bossLead = [110, 110, 0, 130.8, 0, 110, 98, 0, 110, 110, 0, 146.8, 130.8, 0, 98, 110];
    const bassLine = [110, 0, 0, 0, 87.3, 0, 0, 0, 98, 0, 0, 0, 82.4, 0, 73.4, 0];
    const lead = this.mode === 'town' ? townLead : this.mode === 'field' ? fieldLead : bossLead;
    const idx = step % 16;
    const bar = Math.floor(step / 16) % 2;
    const l = lead[(idx + bar * 5) % 16];
    if (l > 0) {
      this.mtone(l, stepDur * 2.2, this.mode === 'boss' ? 'sawtooth' : 'triangle', this.mode === 'boss' ? 0.5 : 0.6, delay);
      if (this.mode === 'town') this.mtone(l * 2, stepDur * 1.6, 'sine', 0.25, delay);
    }
    const b = bassLine[idx];
    if (b > 0 && step % 2 === 0) this.mtone(b / 2, stepDur * 3, 'sine', 0.7, delay);
    // hat tick on off-beats for field/boss
    if (this.mode !== 'town' && step % 2 === 1 && this.ctx && this.musicGain && this.noiseBuf) {
      const t0 = this.ctx.currentTime + delay;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 6000;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.12, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
      src.connect(f);
      f.connect(g);
      g.connect(this.musicGain);
      src.start(t0);
      src.stop(t0 + 0.08);
    }
  }
}
