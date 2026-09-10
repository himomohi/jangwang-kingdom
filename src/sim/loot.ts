import { DROPS, EQUIP_DROP_CHANCE, POTION_DROP_CHANCE, ENEMIES } from './config';
import type { EnemyKind } from './types';

export interface LootResult {
  gold: number;
  potion: boolean;
  equipId: string | null;
}

/** Roll loot for a killed enemy. Pure in sim. */
export function rollLoot(kind: EnemyKind, rng: () => number, luckBonus = 0): LootResult {
  const def = ENEMIES[kind];
  const gold = def.goldMin + Math.floor(rng() * (def.goldMax - def.goldMin + 1));
  const potion = rng() < (POTION_DROP_CHANCE[kind] ?? 0.1);
  let equipId: string | null = null;
  if (rng() < (EQUIP_DROP_CHANCE[kind] ?? 0) + luckBonus) {
    const table = DROPS[kind] ?? [];
    let total = 0;
    for (const e of table) total += e.w;
    if (total > 0) {
      let r = rng() * total;
      for (const e of table) {
        r -= e.w;
        if (r <= 0) {
          equipId = e.id;
          break;
        }
      }
      if (!equipId) equipId = table[table.length - 1].id;
    }
  }
  return { gold, potion, equipId };
}
