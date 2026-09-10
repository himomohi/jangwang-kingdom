import "./style.css";
import { warmArt } from "./art/sprites";
import { cacheSize } from "./art/cache";
import { Synth } from "./audio/synth";
import { Input } from "./input/keys";
import { PostFX } from "./render/postfx";
import { drawWorld } from "./render/view";
import { createGame, updateGame } from "./sim/game";
import { INTERNAL_H, INTERNAL_W, STEP } from "./sim/types";
import { Hud } from "./ui/hud";

const viewEl = document.querySelector<HTMLCanvasElement>("#view");
const hudRoot = document.querySelector<HTMLElement>("#hud");
if (!viewEl || !hudRoot) throw new Error("boot: missing #view or #hud");
const view = viewEl;

const scene = document.createElement("canvas");
scene.width = INTERNAL_W;
scene.height = INTERNAL_H;
const ctx = scene.getContext("2d", { alpha: false });
if (!ctx) throw new Error("boot: 2d context");

const input = new Input();
input.bind(view);
const audio = new Synth();
const hud = new Hud(hudRoot, audio);

warmArt();
const game = createGame();
hud.bind(game);

const post = new PostFX(view);
const fallback = !post.ok ? view.getContext("2d") : null;
if (fallback) fallback.imageSmoothingEnabled = false;

function fit(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  view!.width = Math.floor(view!.clientWidth * dpr);
  view!.height = Math.floor(view!.clientHeight * dpr);
}
window.addEventListener("resize", fit);
fit();

window.addEventListener(
  "pointerdown",
  () => {
    audio.unlock();
  },
  { once: true },
);

let acc = 0;
let last = performance.now();
let armed = false;

function frame(now: number): void {
  const raw = Math.min(0.05, (now - last) / 1000);
  last = now;
  acc += raw;
  while (acc >= STEP) {
    updateGame(game, input, audio, STEP);
    acc -= STEP;
  }
  drawWorld(ctx!, game);
  if (post.ok) post.draw(scene, game.time);
  else if (fallback) {
    fallback.fillStyle = "#0B0C14";
    fallback.fillRect(0, 0, view!.width, view!.height);
    const scale = Math.min(view!.width / INTERNAL_W, view!.height / INTERNAL_H);
    const dw = Math.floor(INTERNAL_W * scale);
    const dh = Math.floor(INTERNAL_H * scale);
    fallback.drawImage(scene, ((view!.width - dw) / 2) | 0, ((view!.height - dh) / 2) | 0, dw, dh);
  }
  hud.sync(game);
  if (game.screen === "play") audio.tickMusic(raw);
  requestAnimationFrame(frame);
}

if (!armed) {
  armed = true;
  console.info(`잔광왕국 boot · sprites ${cacheSize()}`);
  requestAnimationFrame(frame);
}
