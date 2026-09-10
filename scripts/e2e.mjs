/** Headless Chrome E2E: boot, new game, keyboard+touch play, screenshots. */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, cpSync, rmSync } from 'node:fs';

const PORT = 8099;
const ROOT = '/tmp/jw-serve';

// mount dist under /jangwang-kingdom/ like GitHub Pages
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(`${ROOT}/jangwang-kingdom`, { recursive: true });
cpSync('dist', `${ROOT}/jangwang-kingdom`, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', ROOT], {
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 1200));

const errors = [];
const browser = await launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--window-size=1280,800'],
});

try {
  // ---------- desktop ----------
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('[console] ' + m.text());
  });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await page.goto(`http://localhost:${PORT}/jangwang-kingdom/`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('#game-title', { timeout: 10000 });
  await page.screenshot({ path: '/tmp/jw-title.png' });

  await page.click('#btn-new');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 2500));

  const pos0 = await page.evaluate(() => {
    const g = window.__jw;
    return { x: g.sim.player.x, y: g.sim.player.y, hp: g.sim.player.hp, enemies: g.sim.enemies.length };
  });
  console.log('start pos:', JSON.stringify(pos0));

  // move right + attack via keyboard
  await page.keyboard.down('KeyD');
  await new Promise((r) => setTimeout(r, 800));
  await page.keyboard.up('KeyD');
  await page.keyboard.press('KeyJ');
  await new Promise((r) => setTimeout(r, 400));
  const pos1 = await page.evaluate(() => ({ x: window.__jw.sim.player.x, y: window.__jw.sim.player.y }));
  console.log('after move:', JSON.stringify(pos1));
  if (!(pos1.x > pos0.x + 10)) throw new Error('keyboard move failed');
  await page.screenshot({ path: '/tmp/jw-field.png' });

  // teleport to field, fight, skill, potion
  await page.evaluate(() => {
    const g = window.__jw;
    g.sim.player.x = 30 * 16;
    g.sim.player.y = 40 * 16;
  });
  await page.keyboard.press('KeyK');
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: '/tmp/jw-combat.png' });

  // night + ruin + elite visuals
  await page.evaluate(() => {
    const g = window.__jw;
    g.sim.time = 0.86;
    g.sim.player.x = 48 * 16;
    g.sim.player.y = 16 * 16;
  });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: '/tmp/jw-night-ruin.png' });

  // job change flow at Lv5
  await page.evaluate(() => {
    const g = window.__jw;
    g.sim.player.level = 5;
    g.sim.recompute(true);
    g.sim.player.x = 47.5 * 16;
    g.sim.player.y = 51.5 * 16;
    g.sim.time = 0.3;
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.keyboard.press('KeyE');
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: '/tmp/jw-dialog.png' });
  const hasJobChoice = await page.evaluate(() =>
    document.getElementById('dialog-choices').textContent.includes('왕국기사'),
  );
  if (!hasJobChoice) throw new Error('job dialog missing knight choice');

  // inventory panel
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.press('KeyI');
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: '/tmp/jw-inv.png' });
  await page.keyboard.press('Escape');

  // post canvas active?
  const postState = await page.evaluate(() => ({
    postOk: window.__jw.post.ok,
    postVisible: getComputedStyle(document.getElementById('post')).display !== 'none',
  }));
  console.log('post:', JSON.stringify(postState));

  // ---------- mobile emulation ----------
  const mob = await browser.newPage();
  mob.on('pageerror', (e) => errors.push('[mob pageerror] ' + e.message));
  await mob.emulate({
    viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await mob.goto(`http://localhost:${PORT}/jangwang-kingdom/`, { waitUntil: 'networkidle0', timeout: 30000 });
  await mob.tap('#btn-new');
  await new Promise((r) => setTimeout(r, 2000));
  const touchVisible = await mob.evaluate(() => !document.getElementById('touch').classList.contains('hidden'));
  console.log('touch visible:', touchVisible);
  if (!touchVisible) throw new Error('touch controls not shown on mobile');

  const m0 = await mob.evaluate(() => ({ x: window.__jw.sim.player.x, y: window.__jw.sim.player.y }));
  // drag joystick upward
  const joy = await mob.evaluate(() => {
    const r = document.getElementById('joy-base').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await mob.touchscreen.touchStart(joy.x, joy.y);
  await mob.touchscreen.touchMove(joy.x, joy.y - 50);
  await new Promise((r) => setTimeout(r, 900));
  const m1 = await mob.evaluate(() => ({ x: window.__jw.sim.player.x, y: window.__jw.sim.player.y }));
  await mob.touchscreen.touchEnd();
  console.log('touch move:', JSON.stringify(m0), '->', JSON.stringify(m1));
  if (!(m1.y < m0.y - 5)) throw new Error('touch joystick move failed');
  // tap attack + skill buttons
  await mob.tap('#t-attack');
  await mob.tap('#t-skill');
  await new Promise((r) => setTimeout(r, 600));
  await mob.screenshot({ path: '/tmp/jw-mobile.png' });

  console.log('E2E OK');
} finally {
  await browser.close();
  server.kill();
}

const realErrors = errors.filter(
  (e) => !e.includes('favicon') && !e.includes('manifest') && !e.includes('404'),
);
console.log('console/page errors:', realErrors.length);
for (const e of realErrors) console.log(e);
if (realErrors.length > 0) throw new Error('page errors detected');
