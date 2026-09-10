const mem = new Map<string, HTMLCanvasElement>();

export function cached(key: string, build: () => HTMLCanvasElement): HTMLCanvasElement {
  const hit = mem.get(key);
  if (hit) return hit;
  const made = build();
  mem.set(key, made);
  return made;
}

export function cacheSize(): number {
  return mem.size;
}

export function warm(entries: Array<[string, () => HTMLCanvasElement]>): void {
  for (const [k, fn] of entries) cached(k, fn);
}
