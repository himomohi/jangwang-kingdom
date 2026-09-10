import { ITEMS, JOB_DESC, JOB_NAMES, JOB_SKILL } from '../sim/config';
import type { Sim } from '../sim/game';
import type { Sound } from '../audio/sound';

/** Fullscreen-ish modal panels: inventory/equip + status/skill. */
export class Panels {
  open: null | 'inv' | 'status' = null;
  onChanged: (() => void) | null = null;

  constructor(private sound: Sound) {}

  private root(): HTMLElement {
    return document.getElementById('panel') as HTMLElement;
  }

  attach(sim: Sim): void {
    (document.getElementById('panel-close') as HTMLButtonElement).addEventListener('click', () => {
      this.sound.sfx('ui');
      this.hide();
    });
    this.root().addEventListener('click', (e) => {
      if (e.target === this.root()) this.hide();
    });
    // re-render helpers need sim; store via closure on demand
    void sim;
  }

  isOpen(): boolean {
    return this.open != null;
  }

  hide(): void {
    this.open = null;
    this.root().classList.add('hidden');
  }

  toggle(which: 'inv' | 'status', sim: Sim): void {
    if (this.open === which) {
      this.hide();
      return;
    }
    this.open = which;
    this.root().classList.remove('hidden');
    this.render(sim);
  }

  render(sim: Sim): void {
    if (this.open === 'inv') this.renderInv(sim);
    else if (this.open === 'status') this.renderStatus(sim);
  }

  private renderInv(sim: Sim): void {
    const p = sim.player;
    (document.getElementById('panel-title') as HTMLElement).textContent = `🎒 가방 — ${p.gold}G · 물약 ${p.potions}/9`;
    const body = document.getElementById('panel-body') as HTMLElement;
    body.innerHTML = '';

    const mkSection = (title: string): HTMLElement => {
      const h = document.createElement('h3');
      h.textContent = title;
      body.appendChild(h);
      const div = document.createElement('div');
      div.className = 'item-list';
      body.appendChild(div);
      return div;
    };

    // equipment
    const eq = mkSection('장비 중');
    const slots = [
      ['weapon', '무기'],
      ['armor', '방어구'],
      ['charm', '장신구'],
    ] as const;
    for (const [slot, label] of slots) {
      const id = p.equip[slot];
      const row = document.createElement('div');
      row.className = 'item-row equipped';
      if (id && ITEMS[id]) {
        const d = ITEMS[id];
        row.innerHTML = `<span><b>[${label}] ${d.name}</b><br/><small>${d.desc}</small></span>`;
        const btn = document.createElement('button');
        btn.className = 'mini-btn';
        btn.textContent = '해제';
        btn.addEventListener('click', () => {
          sim.unequipItem(slot);
          this.render(sim);
          this.onChanged?.();
        });
        row.appendChild(btn);
      } else {
        row.innerHTML = `<span>[${label}] 비어 있음</span>`;
      }
      eq.appendChild(row);
    }

    // inventory
    const inv = mkSection('소지품 (탭하여 장착)');
    if (p.inv.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'item-row';
      empty.textContent = '비어 있습니다. 필드에서 장비를 주워보세요!';
      inv.appendChild(empty);
    }
    for (const entry of p.inv) {
      const d = ITEMS[entry.id];
      if (!d) continue;
      const row = document.createElement('button');
      row.className = 'item-row clickable';
      row.innerHTML = `<span><b>${d.name}</b> ×${entry.qty}<br/><small>${d.desc}</small></span><span class="tier">T${d.tier}</span>`;
      row.addEventListener('click', () => {
        if (d.kind === 'potion') {
          sim.addItem('potion', 1);
        } else {
          sim.equipItem(entry.id);
        }
        this.render(sim);
        this.onChanged?.();
      });
      inv.appendChild(row);
    }

    const hint = document.createElement('p');
    hint.className = 'panel-hint';
    hint.textContent = '물약 사용: P 키 또는 🧪 버튼';
    body.appendChild(hint);
  }

  private renderStatus(sim: Sim): void {
    const p = sim.player;
    (document.getElementById('panel-title') as HTMLElement).textContent = '📊 상태';
    const body = document.getElementById('panel-body') as HTMLElement;
    body.innerHTML = '';
    const sk = JOB_SKILL[p.job];
    const s = p.stats;
    const box = document.createElement('div');
    box.className = 'status-box';
    box.innerHTML = `
      <div class="status-job">${JOB_NAMES[p.job]} <small>Lv.${p.level}</small></div>
      <div class="status-desc">${JOB_DESC[p.job]}</div>
      <div class="status-grid">
        <span>HP</span><b>${Math.ceil(p.hp)} / ${s.maxHp}</b>
        <span>MP</span><b>${Math.floor(p.mp)} / ${s.maxMp}</b>
        <span>공격력</span><b>${s.atk}</b>
        <span>방어력</span><b>${s.def}</b>
        <span>이동속도</span><b>${Math.round(s.spd)}</b>
        <span>치명타</span><b>${Math.round(s.crit * 100)}%</b>
        <span>XP</span><b>${p.xp} / ${p.xpNext}</b>
        <span>처치 수</span><b>${p.kills}</b>
        <span>플레이</span><b>${Math.floor(sim.playTime / 60)}분</b>
      </div>
      <div class="status-skill">✨ <b>${sk.name}</b> (MP ${sk.mp} · ${sk.cd}s)<br/><small>${sk.desc}</small></div>
      ${sim.canJobChange() && p.job === 'commoner'
        ? '<div class="status-tip">전직 가능! 엠버게이트 전직관 헤론에게 말을 거세요.</div>'
        : ''}
    `;
    body.appendChild(box);
  }
}
