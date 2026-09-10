# sprites

Optional transparent PNG overlays only.

- Code-generated bodies in `src/art` are the primary silhouette.
- Runtime hint alpha is capped at ~0.32 (`src/art/overlay.ts`).
- Never replace `drawPlayer` / `drawEnemy` codegen with PNG alone.

Sheets on main (`f45f447`, `4769536`):

- `knight/sprite-sheet-alpha.png` — idle 4 frames, 1024×256
- `enemies/sprite-sheet-alpha.png` — slime idle 4 frames, 1024×256
