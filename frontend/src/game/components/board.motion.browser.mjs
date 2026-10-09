/**
 * Real-browser regression for translucent OS tiles. Run from frontend:
 * node --test src/game/components/board.motion.browser.mjs
 * Uses the actual Board/useGame/engine and OS styles, without the app backend.
 * Optional BP_MOTION_SCREENSHOTS=/absolute/path keeps before/after evidence.
 */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { chromium, webkit } from '@playwright/test';

const sourceDir = fileURLToPath(new URL('../../', import.meta.url));
let server;
let url;
const pair = [2, 2, 0, 0, 64, 64, 0, 0, 1024, 1024, 0, 0, 0, 0, 0, 0];
const merged = [4, 0, 0, 0, 128, 0, 0, 0, 2048, 0, 0, 0, 0, 0, 0, 2];

before(async () => {
  const bundle = await build({
    stdin: {
      resolveDir: sourceDir,
      loader: 'tsx',
      contents: `
        import React, { useLayoutEffect } from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { Board } from './game/components/Board';
        import { useGame } from './game/hooks/useGame';
        import { initGame, step } from './game/engine';
        const root = createRoot(document.getElementById('root'));
        window.fixture = (board, log) => flushSync(() => root.render(<Board board={board} moveLog={log} onMove={() => {}} />));
        function Game() {
          const game = useGame({ seed: 4242, modifier: 'standard', mode: 'practice', moveBudget: Infinity });
          useLayoutEffect(() => { window.game = game; });
          return <Board board={game.board} moveLog={game.moveLog} onMove={game.play} />;
        }
        window.startGame = () => flushSync(() => root.render(<Game />));
        window.action = (method, ...args) => flushSync(() => window.game[method](...args));
        window.reference = (log) => {
          let state = initGame(4242, 'standard');
          for (const move of log) state = step(state, move);
          return { board: state.board, score: state.score };
        };
      `,
    },
    bundle: true, write: false, outfile: '/board.js', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const script = bundle.outputFiles.find(f => f.path.endsWith('.js')).text;
  const boardCSS = bundle.outputFiles.find(f => f.path.endsWith('.css')).text;
  const styles = await Promise.all(['tokens.css', 'index.css', 'os/os.css', 'os/classic-bridge.css', 'pages/blockparty.css']
    .map(path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')));
  const html = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles.join('\n')}\n${boardCSS}\n.memba-os { background: var(--os-opaque); } .os-classic { padding: 24px; } </style><body class="memba-os" data-os-theme="dark"><main class="os-classic"><div id="root"></div></main><script>${script}</script>`;
  server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

async function frame(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function settle(page) {
  await page.evaluate(async () => { await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))); });
}
async function visibleSources(page) {
  return page.locator('.k-bp-tile-pos[data-kind="consumed"]').evaluateAll(nodes => nodes.filter(node => {
    const style = getComputedStyle(node);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
  }).length);
}
async function capture(page, name) {
  if (!process.env.BP_MOTION_SCREENSHOTS) return;
  await mkdir(process.env.BP_MOTION_SCREENSHOTS, { recursive: true });
  await page.locator('.k-bp-board-shell').screenshot({ path: `${process.env.BP_MOTION_SCREENSHOTS}/${name}.png`, animations: 'allow' });
}
async function liveBoard(page) {
  return page.locator('.k-bp-tile-pos:not([data-kind="consumed"])').evaluateAll(nodes => {
    const board = Array(16).fill(0);
    for (const node of nodes) {
      const index = Number(node.style.getPropertyValue('--bp-row')) * 4 + Number(node.style.getPropertyValue('--bp-col'));
      if (board[index]) throw new Error('Two live tiles occupy the same target');
      board[index] = Number(node.querySelector('.k-bp-tile-val').textContent);
    }
    return board;
  });
}

for (const [name, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: fusion handoff, idle, reduced motion, fast moves, undo and restart`, { timeout: 20_000 }, async () => {
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
      await page.goto(url);
      await page.waitForFunction(() => typeof window.fixture === 'function');
      for (const theme of ['dark', 'light']) {
        await page.locator('body').evaluate((el, theme) => el.dataset.osTheme = theme, theme);
        await page.evaluate(board => window.fixture(board, ''), pair);
        await settle(page);
        await page.evaluate(board => window.fixture(board, 'L'), merged);
        await frame(page);
        // Freeze CSS time: sources travel first, then disappear before the result.
        await page.evaluate(() => document.getAnimations().forEach(a => { a.pause(); a.currentTime = 60; }));
        assert.equal(await visibleSources(page), 6, 'source tiles still travel during the slide');
        assert.equal(await page.locator('.k-bp-tile[data-kind="merged"]').first().evaluate(el => getComputedStyle(el).opacity), '0');
        await page.evaluate(() => document.getAnimations().forEach(a => a.currentTime = 120));
        assert.equal(await visibleSources(page), 0, 'the handoff must hide sources at slide completion');
        await page.evaluate(() => document.getAnimations().forEach(a => a.currentTime = 160));
        await capture(page, `${name}-${theme}-mid-fusion`);
        const midSources = await visibleSources(page);
        await page.evaluate(() => document.getAnimations().forEach(a => a.finish()));
        await capture(page, `${name}-${theme}-settled`);
        assert.equal(midSources, 0, 'source numbers must be hidden when the result appears');
        assert.equal(await visibleSources(page), 0, 'stopping after a merge must not leave source numbers under translucent tiles');
        assert.deepEqual(await liveBoard(page), merged);
        // Catch a broken fixture (e.g. missing screen-reader-only styles).
        const alignment = await page.evaluate(() => {
          const cell = document.querySelector('[role="gridcell"]').getBoundingClientRect();
          const tile = document.querySelector('.k-bp-tile-pos[data-kind="merged"]').getBoundingClientRect();
          return Math.abs(cell.x - tile.x) + Math.abs(cell.y - tile.y) + Math.abs(cell.width - tile.width);
        });
        assert.ok(alignment < 1, `tile and grid must align, got ${alignment}px`);
      }
      // Disabling animations must keep sources hidden, without an end event.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(board => window.fixture(board, ''), pair);
      await page.evaluate(board => window.fixture(board, 'L'), merged);
      await frame(page);
      await capture(page, `${name}-mobile-reduced`);
      assert.equal(await visibleSources(page), 0);
      assert.deepEqual(await liveBoard(page), merged);
      assert.equal(await page.locator('.k-bp-tile-pos').first().evaluate(el => getComputedStyle(el).transitionDuration), '0s');

      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.evaluate(() => window.startGame());
      await settle(page);
      const grid = page.getByRole('grid');
      await grid.focus();
      for (let n = 0; n < 40; n++) await page.keyboard.press(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'][n % 4], { delay: 1 });
      const played = await page.evaluate(() => ({ board: window.game.board, score: window.game.score, log: window.game.moveLog }));
      assert.ok(played.log.length > 10);
      assert.deepEqual(await liveBoard(page), played.board);
      assert.deepEqual(await page.evaluate(log => window.reference(log), played.log), { board: played.board, score: played.score });
      // Undo/restart while a transition is still running, then wait for any stale CSS effects.
      await page.evaluate(() => window.action('undo'));
      assert.equal(await page.evaluate(() => window.game.moveLog), played.log.slice(0, -1));
      assert.deepEqual(await liveBoard(page), await page.evaluate(() => window.game.board));
      await page.evaluate(() => window.action('play', 'R'));
      await page.evaluate(() => window.action('restart', 4242));
      await settle(page);
      assert.equal(await visibleSources(page), 0);
      assert.deepEqual(await liveBoard(page), await page.evaluate(() => window.reference('').board));
      assert.equal(await page.evaluate(() => window.game.score), 0);
      // Touch input follows the same path on the board.
      const bounds = await grid.boundingBox();
      await page.mouse.move(bounds.x + bounds.width * .8, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height / 2);
      await page.mouse.up();
      assert.equal(await page.evaluate(() => window.game.moveLog), 'L');
      await settle(page);
      assert.deepEqual(await liveBoard(page), await page.evaluate(() => window.game.board));
      await page.close();
    } finally { await browser.close(); }
  });
}
