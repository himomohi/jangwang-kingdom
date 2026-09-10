import type { DialogData } from '../sim/game';

/** Typewriter NPC dialog box with choice buttons. */
export class Dialog {
  onChoice: ((action: string) => void) | null = null;
  private npcId = '';
  private lines: string[] = [];
  private lineIdx = 0;
  private charIdx = 0;
  private timer: number | null = null;
  private choices: DialogData['choices'] = [];
  open = false;

  private root(): HTMLElement {
    return document.getElementById('dialog') as HTMLElement;
  }

  show(npcId: string, data: DialogData): void {
    this.npcId = npcId;
    this.lines = data.lines.length > 0 ? data.lines : ['...'];
    this.choices = data.choices;
    this.lineIdx = 0;
    this.charIdx = 0;
    this.open = true;
    (document.getElementById('dialog-name') as HTMLElement).textContent = data.name;
    (document.getElementById('dialog-choices') as HTMLElement).innerHTML = '';
    this.root().classList.remove('hidden');
    this.type();
  }

  /** Advance on interact key/tap. Returns true if consumed. */
  advance(): boolean {
    if (!this.open) return false;
    const full = this.lines[this.lineIdx];
    const textEl = document.getElementById('dialog-text') as HTMLElement;
    if (this.charIdx < full.length) {
      // complete current line instantly
      this.charIdx = full.length;
      textEl.textContent = full;
      return true;
    }
    if (this.lineIdx < this.lines.length - 1) {
      this.lineIdx++;
      this.charIdx = 0;
      this.type();
      return true;
    }
    // lines done — if choices visible, do nothing (must tap a choice)
    return true;
  }

  getNpcId(): string {
    return this.npcId;
  }

  hide(): void {
    this.open = false;
    this.stop();
    this.root().classList.add('hidden');
  }

  private stop(): void {
    if (this.timer != null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private type(): void {
    this.stop();
    const textEl = document.getElementById('dialog-text') as HTMLElement;
    textEl.textContent = '';
    (document.getElementById('dialog-choices') as HTMLElement).innerHTML = '';
    this.timer = window.setInterval(() => {
      const full = this.lines[this.lineIdx];
      this.charIdx += 2;
      textEl.textContent = full.slice(0, this.charIdx);
      if (this.charIdx >= full.length) {
        this.stop();
        if (this.lineIdx >= this.lines.length - 1) this.renderChoices();
      }
    }, 24);
  }

  private renderChoices(): void {
    const wrap = document.getElementById('dialog-choices') as HTMLElement;
    wrap.innerHTML = '';
    for (const c of this.choices) {
      const b = document.createElement('button');
      b.className = 'choice-btn';
      b.textContent = c.label;
      b.disabled = !!c.disabled;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onChoice?.(c.action);
      });
      wrap.appendChild(b);
    }
  }
}
