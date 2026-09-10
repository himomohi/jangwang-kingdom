import { JOB_NAMES, JOB_SKILL, ZONE_NAMES } from '../sim/config';
import type { Sim } from '../sim/game';
import type { Sound } from '../audio/sound';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
}

/** DOM HUD: bars, stats, zone/clock, boss bar, skill cooldown, toasts. */
export class HUD {
  onButton: ((name: 'inv' | 'status' | 'help' | 'mute' | 'menu') => void) | null = null;
  private cache = new Map<string, string>();
  private toastWrap: HTMLElement;

  constructor(private sound: Sound) {
    this.toastWrap = el('toast-wrap');
  }

  private set(id: string, value: string): void {
    if (this.cache.get(id) === value) return;
    this.cache.set(id, value);
    (document.getElementById(id) as HTMLElement).textContent = value;
  }

  private bar(fillId: string, ratio: number): void {
    const key = `bar:${fillId}`;
    const v = Math.round(Math.max(0, Math.min(1, ratio)) * 200).toString();
    if (this.cache.get(key) === v) return;
    this.cache.set(key, v);
    (document.getElementById(fillId) as HTMLElement).style.width = `${(Number(v) / 2).toFixed(1)}%`;
  }

  attach(): void {
    const bind = (id: string, name: 'inv' | 'status' | 'help' | 'mute' | 'menu'): void => {
      el<HTMLButtonElement>(id).addEventListener('click', () => {
        this.sound.ensure();
        this.sound.sfx('ui');
        this.onButton?.(name);
      });
    };
    bind('btn-inv', 'inv');
    bind('btn-status', 'status');
    bind('btn-help', 'help');
    bind('btn-mute', 'mute');
    bind('btn-menu', 'menu');
  }

  show(): void {
    el('hud').classList.remove('hidden');
  }

  hide(): void {
    el('hud').classList.add('hidden');
  }

  setMuted(m: boolean): void {
    el('btn-mute').textContent = m ? '🔇' : '🔊';
  }

  toast(text: string, ms = 2600): void {
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = text;
    this.toastWrap.appendChild(div);
    while (this.toastWrap.children.length > 4) {
      this.toastWrap.firstChild?.remove();
    }
    window.setTimeout(() => {
      div.classList.add('out');
      window.setTimeout(() => div.remove(), 400);
    }, ms);
  }

  update(sim: Sim): void {
    const p = sim.player;
    this.bar('hp-fill', p.hp / p.stats.maxHp);
    this.bar('mp-fill', p.mp / p.stats.maxMp);
    this.bar('xp-fill', p.xp / Math.max(1, p.xpNext));
    this.set('hp-text', `${Math.ceil(p.hp)}/${p.stats.maxHp}`);
    this.set('mp-text', `${Math.floor(p.mp)}/${p.stats.maxMp}`);
    this.set('lv-text', `Lv.${p.level}`);
    this.set('job-text', JOB_NAMES[p.job]);
    this.set('gold-text', `💰 ${p.gold}G · 🧪${p.potions}`);
    this.set('zone-text', ZONE_NAMES[sim.zone]);
    this.set('clock-text', sim.clockText());

    // skill cooldown pill
    const sk = JOB_SKILL[p.job];
    const ready = p.skillCd <= 0;
    const ratio = ready ? 1 : 1 - p.skillCd / Math.max(0.01, p.skillCdMax);
    this.bar('skill-cd-fill', ratio);
    this.set('skill-cd-text', ready ? `✨ ${sk.name} (MP${sk.mp})` : `${p.skillCd.toFixed(1)}s`);
    el('skill-cd').classList.toggle('ready', ready);

    // boss bar: elite within 420px
    let boss = null as null | { hp: number; maxHp: number };
    let best = 420;
    for (const e of sim.enemies) {
      if (e.dead || !e.elite) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < best) {
        best = d;
        boss = e;
      }
    }
    const bossBar = el('boss-bar');
    if (boss) {
      bossBar.classList.remove('hidden');
      this.set('boss-name', '⚔️ 철갑감시자');
      this.bar('boss-fill', boss.hp / boss.maxHp);
    } else {
      bossBar.classList.add('hidden');
    }
  }
}
