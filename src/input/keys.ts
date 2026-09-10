export class Input {
  readonly down = new Set<string>();
  readonly pressed = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseWorldX = 0;
  mouseWorldY = 0;
  click = false;
  bound = false;

  bind(target: HTMLElement): void {
    if (this.bound) return;
    this.bound = true;
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.down.add(k);
      this.pressed.add(k);
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Spacebar"].includes(e.key)) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.down.delete(k);
    });
    target.addEventListener("mousemove", (e) => {
      const r = target.getBoundingClientRect();
      this.mouseX = ((e.clientX - r.left) / r.width) * target.clientWidth;
      this.mouseY = ((e.clientY - r.top) / r.height) * target.clientHeight;
    });
    target.addEventListener("mousedown", () => {
      this.click = true;
    });
    window.addEventListener("blur", () => {
      this.down.clear();
    });
  }

  axis(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.down.has("a") || this.down.has("ArrowLeft")) x -= 1;
    if (this.down.has("d") || this.down.has("ArrowRight")) x += 1;
    if (this.down.has("w") || this.down.has("ArrowUp")) y -= 1;
    if (this.down.has("s") || this.down.has("ArrowDown")) y += 1;
    if (x && y) {
      const inv = 1 / Math.SQRT2;
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }

  consume(key: string): boolean {
    if (!this.pressed.has(key)) return false;
    this.pressed.delete(key);
    return true;
  }

  consumeAttack(): boolean {
    const space = this.consume(" ") || this.consume("Spacebar");
    const click = this.click;
    this.click = false;
    return space || click;
  }

  endFrame(): void {
    this.pressed.clear();
    this.click = false;
  }
}
