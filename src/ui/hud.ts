import { chooseJob, jobLabel, questText, skillLabel, useItem, type Game } from "../sim/game";
import { ITEMS } from "../sim/items";
import type { JobId } from "../sim/types";
import type { Synth } from "../audio/synth";

export class Hud {
  root: HTMLElement;
  private lastDirty = -1;
  private lastScreen = "";
  private audio: Synth;
  private game: Game | null = null;

  constructor(root: HTMLElement, audio: Synth) {
    this.root = root;
    this.audio = audio;
  }

  bind(g: Game): void {
    this.game = g;
    this.lastDirty = -1;
    this.paint(g, true);
  }

  sync(g: Game): void {
    if (!this.game) this.game = g;
    const force = g.dirtyUi !== this.lastDirty || g.screen !== this.lastScreen;
    this.paint(g, force);
    this.live(g);
  }

  private live(g: Game): void {
    const hp = this.root.querySelector<HTMLElement>("[data-hp]");
    const mp = this.root.querySelector<HTMLElement>("[data-mp]");
    const xp = this.root.querySelector<HTMLElement>("[data-xp]");
    const hps = this.root.querySelector("[data-hps]");
    const mps = this.root.querySelector("[data-mps]");
    const xps = this.root.querySelector("[data-xps]");
    if (hp) hp.style.width = `${(g.player.hp / g.player.maxHp) * 100}%`;
    if (mp) mp.style.width = `${(g.player.mp / Math.max(1, g.player.maxMp)) * 100}%`;
    if (xp) xp.style.width = `${(g.player.xp / g.player.xpNext) * 100}%`;
    if (hps) hps.textContent = `${Math.ceil(g.player.hp)}/${g.player.maxHp}`;
    if (mps) mps.textContent = `${Math.ceil(g.player.mp)}/${g.player.maxMp}`;
    if (xps) xps.textContent = `${g.player.xp}/${g.player.xpNext}`;
    const s2 = this.root.querySelector("[data-slot='2']");
    s2?.classList.toggle("cd", g.player.skillCd > 0);
    const toast = this.root.querySelector("#toasts");
    if (toast) toast.textContent = g.toasts[0]?.text ?? "";
  }

  private paint(g: Game, force: boolean): void {
    if (!force) return;
    this.lastDirty = g.dirtyUi;
    this.lastScreen = g.screen;
    const p = g.player;
    const uses = p.inv.filter((s) => ITEMS[s.id].slot === "use");
    const overlay = this.overlay(g);

    this.root.innerHTML = `
      <div id="vitals" class="panel">
        <div class="who">${p.name} <small>Lv.${p.level} ${jobLabel(p.job)}</small></div>
        <div>생명</div>
        <div class="bar hp"><i data-hp></i><span data-hps></span></div>
        <div>마나</div>
        <div class="bar mp"><i data-mp></i><span data-mps></span></div>
        <div>경험</div>
        <div class="bar xp"><i data-xp></i><span data-xps></span></div>
        <div class="note">공격 ${p.atk} · 방어 ${p.def} · 잔화 ${p.gold}</div>
      </div>
      <div id="quest" class="panel">
        <b>의뢰</b>
        ${questText(g.quest)}
      </div>
      <div id="log">${g.log.map((l) => `<div>${l}</div>`).join("")}</div>
      <div id="hotbar">
        <button class="slot" data-slot="1"><em>1</em>공격</button>
        <button class="slot" data-slot="2"><em>2</em>${skillLabel(p.job)}</button>
        <button class="slot" data-slot="3"><em>3</em>${uses[0] ? `${ITEMS[uses[0].id].name}×${uses[0].qty}` : "—"}</button>
        <button class="slot" data-slot="4"><em>4</em>${uses[1] ? `${ITEMS[uses[1].id].name}×${uses[1].qty}` : "—"}</button>
        <button class="slot" data-slot="5"><em>5</em>${uses[2] ? `${ITEMS[uses[2].id].name}×${uses[2].qty}` : "—"}</button>
      </div>
      <div id="tools">
        <button type="button" data-act="bag">가방 I</button>
        <button type="button" data-act="help">도움 H</button>
      </div>
      ${
        g.bagOpen
          ? `<div id="bag" class="panel"><h3>가방</h3>${
              p.inv.length
                ? p.inv
                    .map(
                      (s) =>
                        `<div class="item" data-item="${s.id}"><span>${ITEMS[s.id].name} ×${s.qty}</span><span>${ITEMS[s.id].desc}</span></div>`,
                    )
                    .join("")
                : "<div>비어 있다.</div>"
            }
            <div class="note">장비/소모품을 눌러 사용</div>
            <div class="note">무기 ${p.equip.weapon ? ITEMS[p.equip.weapon].name : "없음"} · 투구 ${p.equip.helm ? ITEMS[p.equip.helm].name : "없음"} · 갑옷 ${p.equip.body ? ITEMS[p.equip.body].name : "없음"} · 망토 ${p.equip.cape ? ITEMS[p.equip.cape].name : "없음"}</div>
          </div>`
          : ""
      }
      <div id="toasts"></div>
      ${overlay}
    `;
    this.wire(g);
    this.live(g);
  }

  private overlay(g: Game): string {
    if (g.screen === "title") {
      return `<div id="overlay"><div class="panel">
        <h1>잔광왕국</h1>
        <div class="sub">JANGWANG KINGDOM</div>
        <p>늦을 90년대 한국 탑다운 판타지 MMO의 <b>감성</b>을 빌린 오리지널 단편. 공식 명칭·맵·스킬·자산을 복제하지 않는다.</p>
        <p>평민으로 잔광성 외곽 마을에 선다. 들판에서 사냥하고, 룻을 걸치며, 성문 교관에게 길을 묻는다.</p>
        <p><button type="button" data-act="start">시작</button></p>
        <div class="note">WASD 이동 · 스페이스 공격 · E 대화 · I 가방</div>
      </div></div>`;
    }
    if (g.screen === "dead") {
      return `<div id="overlay"><div class="panel">
        <h1>잔광이 흐려진다</h1>
        <p>숨이 끊겼다. 광장 우물가에서 다시 눈을 뜰 수 있다.</p>
        <p><button type="button" data-act="revive">광장으로 (Enter / R)</button></p>
      </div></div>`;
    }
    if (g.jobPick) {
      const cards: Array<[JobId, string]> = [
        ["knight", "방패 대신 직검과 붉은 망토. 돌격베기."],
        ["blader", "가벼운 세장검. 연참."],
        ["arcanist", "후드와 지팡이. 잔광탄."],
        ["shrine", "성소의 홀. 파동과 온기."],
      ];
      return `<div id="overlay"><div class="panel">
        <h1>전직</h1>
        <p>레벨 5. 성문 교관이 네 갈래 길을 열어 준다.</p>
        <div class="jobs">${cards
          .map(
            ([id, d], i) =>
              `<button class="job-card" data-job="${id}"><b>${i + 1}. ${jobLabel(id)}</b>${d}</button>`,
          )
          .join("")}</div>
      </div></div>`;
    }
    if (g.dialogKind !== "none" && g.dialog.length) {
      return `<div id="overlay"><div class="panel">
        ${g.dialog.map((line, i) => (i === 0 ? `<h1 style="font-size:20px">${line}</h1>` : `<p>${line}</p>`)).join("")}
        <p><button type="button" data-act="close">닫기</button></p>
      </div></div>`;
    }
    return "";
  }

  private wire(g: Game): void {
    this.root.querySelectorAll<HTMLElement>("[data-slot]").forEach((el) => {
      el.addEventListener("click", () => {
        const n = Number(el.dataset.slot);
        const ev = new KeyboardEvent("keydown", { key: String(n) });
        window.dispatchEvent(ev);
        window.dispatchEvent(new KeyboardEvent("keyup", { key: String(n) }));
      });
    });
    this.root.querySelectorAll<HTMLElement>("[data-item]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.item as keyof typeof ITEMS;
        useItem(g, this.audio, id);
        this.lastDirty = -1;
      });
    });
    this.root.querySelectorAll<HTMLElement>("[data-job]").forEach((el) => {
      el.addEventListener("click", () => {
        chooseJob(g, this.audio, el.dataset.job as JobId);
        this.lastDirty = -1;
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((el) => {
      el.addEventListener("click", () => {
        const act = el.dataset.act;
        if (act === "start") {
          g.screen = "play";
          this.audio.unlock();
          this.audio.ui();
          g.dirtyUi++;
        } else if (act === "revive") {
          g.player.x = 48 * 16 + 8;
          g.player.y = 66 * 16 + 8;
          g.player.hp = g.player.maxHp;
          g.player.mp = g.player.maxMp;
          g.screen = "play";
          g.dirtyUi++;
          this.audio.rest();
        } else if (act === "bag") {
          g.bagOpen = !g.bagOpen;
          g.dirtyUi++;
          this.audio.ui();
        } else if (act === "help") {
          g.dialogKind = "help";
          g.dialog = [
            "조작",
            "WASD / 방향키 이동 · 스페이스/클릭 공격 · E 상호작용",
            "1 기본공격 · 2 전직기 · 3~5 소모품 · I 가방",
          ];
          g.dirtyUi++;
          this.audio.ui();
        } else if (act === "close") {
          g.dialogKind = "none";
          g.dialog = [];
          g.jobPick = false;
          g.dirtyUi++;
        }
        this.lastDirty = -1;
      });
    });
  }
}
