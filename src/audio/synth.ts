export class Synth {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  muted = false;
  private musicTimer = 0;
  private beat = 0;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.22;
    this.master.connect(this.ctx.destination);
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slide = 0,
  ): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  ui(): void {
    this.tone(520, 0.06, "square", 0.08);
  }

  swing(): void {
    this.tone(180, 0.08, "square", 0.1, -80);
  }

  hit(): void {
    this.tone(140, 0.09, "sawtooth", 0.12, -60);
    this.tone(320, 0.05, "square", 0.06);
  }

  hurt(): void {
    this.tone(90, 0.16, "sawtooth", 0.14, -40);
  }

  kill(): void {
    this.tone(220, 0.12, "triangle", 0.1, 80);
    this.tone(330, 0.18, "triangle", 0.07, 40);
  }

  loot(): void {
    this.tone(660, 0.08, "square", 0.08);
    this.tone(880, 0.12, "square", 0.06);
  }

  level(): void {
    this.tone(392, 0.1, "triangle", 0.1);
    this.tone(523, 0.12, "triangle", 0.09);
    this.tone(659, 0.18, "triangle", 0.08);
  }

  skill(): void {
    this.tone(240, 0.16, "triangle", 0.1, 180);
  }

  step(): void {
    this.tone(70, 0.04, "sine", 0.04);
  }

  rest(): void {
    this.tone(300, 0.2, "sine", 0.08, 40);
  }

  tickMusic(dt: number): void {
    if (!this.ctx || this.muted) return;
    this.musicTimer += dt;
    if (this.musicTimer < 0.55) return;
    this.musicTimer = 0;
    const motif = [220, 246, 196, 164, 196, 246, 220, 174];
    const f = motif[this.beat % motif.length]!;
    this.beat++;
    this.tone(f / 2, 0.42, "sine", 0.035);
    if (this.beat % 4 === 0) this.tone(f, 0.18, "triangle", 0.02);
  }
}
