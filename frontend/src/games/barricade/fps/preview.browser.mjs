/**
 * C1 real WebGL/input evidence. Explicit command, outside the default Vitest glob:
 * node src/games/barricade/fps/preview.browser.mjs
 * Serial Chromium only; local HTTP server always stopped. No wallet/backend.
 * FPS_C1_OUTPUT optionally sets the evidence directory (default /private/tmp/memba-c1-proof).
 * The harness mounts the real component, scene and window activity provider.
 * Test-only instrumentation exposes its session and offers a controlled sim clock
 * (?manual=1) for collision/replay fixtures, without shipping a production debug API.
 */
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import postcss from 'postcss'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = process.env.FPS_C1_OUTPUT || '/private/tmp/memba-c1-proof'
await mkdir(output, { recursive: true })
const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
        import React, { useState, lazy, Suspense } from 'react';
        import { createRoot } from 'react-dom/client';
        const FpsPreview = lazy(() => import('./games/barricade/fps/FpsPreview'));
        import { WindowActivityContext } from './os/page/WindowActivity';
        import { position, enemyBoxes } from './games/barricade/sim/fps/collision';
        import { replay, localStateDigest } from './games/barricade/sim/fps/replay';
        window.__manual = new URLSearchParams(location.search).has('manual');
        window.__position = position; window.__boxes = enemyBoxes; window.__replay = replay; window.__digest = localStateDigest;
        function Harness() {
            const [active, setActive] = useState(true);
            const [loaded, setLoaded] = useState(false);
            window.__activate = setActive;
            return <><button id="other-window" onClick={() => setActive(false)}>Other OS window</button>
            <main className="os-wbody"><WindowActivityContext.Provider value={active}><Suspense fallback={<p>Loading preview module</p>}>{loaded ? <FpsPreview onClassic={() => window.__classic = true}/> : <button id="load-preview" onClick={() => setLoaded(true)}>Load preview</button>}</Suspense></WindowActivityContext.Provider></main></>;
        }
        createRoot(document.getElementById('root')).render(<Harness/>);
    ` },
    bundle: true, write: false, outdir: '/bundle', entryNames: 'preview', chunkNames: '[name]-[hash]', format: 'esm', splitting: true, jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}', '__APP_VERSION__': '"C1-browser-fixture"' },
    plugins: [{ name: 'fixture-session-clock', setup(b) {
        b.onLoad({ filter: /\/fps\/FpsPreview\.tsx$/ }, async ({ path }) => {
            const source = await readFile(path, 'utf8')
            return { loader: 'tsx', contents: source.replace("import { createSession } from './session'", "import { createSession as actualCreateSession } from './session'\nconst createSession = (seed: string) => { const session = actualCreateSession(seed); window.__session = session; return session }") }
        })
        b.onLoad({ filter: /\/fps\/FpsScene\.tsx$/ }, async ({ path }) => {
            const source = await readFile(path, 'utf8')
            return { loader: 'tsx', contents: source.replace('const { camera, gl, invalidate } = useThree()', 'const { camera, gl, invalidate } = useThree(); window.__renderer = gl') }
        })
        b.onLoad({ filter: /\/hooks\/useGameLoop\.ts$/ }, async ({ path }) => {
            const source = await readFile(path, 'utf8')
            return { loader: 'ts', contents: source.replace('): void {', '): void {\n    if (window.__manual) { window.__advance = onSteps; window.__onFrame = onFrame; return }') }
        })
    } }],
})
const files = new Map(bundle.outputFiles.map(f => [f.path.replace('/bundle', ''), f.text]))
const css = bundle.outputFiles.filter(f => f.path.endsWith('.css')).map(f => f.text).join('\n')
// Use the actual shared theme tokens without importing global shell selectors.
const tokenSheet = postcss.parse(await readFile(`${root}/index.css`, 'utf8')).nodes
    .filter(node => node.type === 'rule' && [':root', '[data-theme="light"]'].includes(node.selector))
    .map(node => node.toString()).join('\n')
const html = `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#121a17;color:#eee;font-family:system-ui}#other-window{height:40px} .os-wbody{height:calc(100dvh - 40px);overflow:auto} ${tokenSheet} ${css}</style></head><body><div id="root"></div><script type="module" src="/preview.js"></script></body></html>`
const server = createServer((req, res) => {
    const asset = files.get(req.url)
    res.setHeader('Content-Type', asset ? 'text/javascript' : 'text/html')
    res.end(asset || html)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true }).catch(async error => {
    await new Promise(resolve => server.close(resolve))
    throw error
})
const results = { screenshots: [], layouts: [], errors: [], consoleErrors: [], requests: [], checks: [], timings: {} }
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
page.on('pageerror', error => results.errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') results.consoleErrors.push(message.text()) })
page.on('request', request => { if (!request.url().startsWith(base)) results.requests.push(request.url()) })
async function frame() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
async function capture(name) { await frame(); const path = `${output}/${name}.png`; await page.screenshot({ path }); results.screenshots.push(path) }
async function open(manual = true) {
    const start = performance.now()
    await page.goto(`${base}/${manual ? '?manual=1' : ''}`)
    await page.locator('#load-preview').waitFor()
    const before = await page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name))
    assert(!before.some(url => /\/Fps(?:Preview|Scene)-/.test(url)), 'FPS module loaded before explicit preview request')
    await page.locator('#load-preview').click()
    await page.getByRole('button', { name: 'Jouer · visée libre', exact: true }).waitFor()
    await page.waitForFunction(() => !document.querySelector('.fps-actions button').disabled)
    const after = await page.evaluate(() => performance.getEntriesByType('resource').map(r => new URL(r.name).pathname))
    assert(after.some(url => /\/FpsPreview-/.test(url))); assert(after.some(url => /\/FpsScene-/.test(url)))
    results.lazyLoadEvidence = { before: before.map(url => new URL(url).pathname), after }
    results.timings[manual ? 'manualReadyMs' : 'liveReadyMs'] = Math.round(performance.now() - start)
}
async function start() { await page.getByRole('button', { name: 'Jouer · visée libre', exact: true }).click() }
async function step(n) { await page.evaluate(n => { window.__advance(n); window.__onFrame(1) }, n); await frame() }
async function layout(label) {
    const data = await page.evaluate(() => {
        const box = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right } }
        return { viewport: { width: innerWidth, height: innerHeight }, root: box(document.querySelector('.fps-preview')), stage: box(document.querySelector('.fps-viewport')),
            buttons: [...document.querySelectorAll('.fps-header button,.fps-controls > button,.fps-settings summary')].map(e => ({ text: e.textContent, ...box(e) })), scrollWidth: document.documentElement.scrollWidth }
    })
    results.layouts.push({ label, ...data })
    assert(data.scrollWidth <= data.viewport.width + 1, `${label}: horizontal overflow`)
    for (const b of data.buttons) {
        assert(b.width >= 44 && b.height >= 44, `${label}: target too small ${b.text}`)
        assert(b.y >= 0 && b.bottom <= data.viewport.height + 1 && b.right <= data.viewport.width + 1, `${label}: clipped control ${b.text} bottom=${b.bottom}`)
    }
}
try {
    await open(); await capture('desktop-ready')
    await page.evaluate(() => document.documentElement.dataset.theme = 'light'); await capture('desktop-light-theme-ready')
    await page.evaluate(() => delete document.documentElement.dataset.theme); await start(); await step(900)
    await layout('desktop'); await capture('desktop-dusk')
    results.render = await page.evaluate(async () => {
        const gl = window.__renderer, context = gl.getContext(), debug = context.getExtension('WEBGL_debug_renderer_info')
        const frames = []; let last = performance.now()
        for (let i = 0; i < 120; i++) { await new Promise(requestAnimationFrame); const now = performance.now(); frames.push(now-last); last = now }
        frames.sort((a,b)=>a-b)
        return { renderer: debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable', calls: gl.info.render.calls, triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, frameMedianMs: frames[60], frameP95Ms: frames[114], fixtureEnemies: window.__session.read().state.enemies.length }
    })
    await page.locator('.fps-settings summary').click(); await page.getByLabel('Lumière').selectOption('day'); await page.locator('.fps-settings summary').click(); await capture('desktop-day')
    for (const [w, h, name] of [[390, 844, 'portrait-390'], [320, 568, 'portrait-320'], [667, 375, 'landscape-667']]) {
        await page.setViewportSize({ width: w, height: h }); await frame(); await layout(name); await capture(name)
    }
    results.checks.push('desktop and compact controls stay visible')
    await page.setViewportSize({ width: 1440, height: 900 }); await open(); await start(); await step(600)
    // The same quantized direction drives the actual camera and authority ray.
    async function aim(kind, y) {
        await page.evaluate(({kind,y}) => {
            const s = window.__session, data = s.read(), e = data.state.enemies.find(e => e.kind === kind)
            const p = window.__position(e), dx = p.x, dy = y - 1650, dz = p.z + (kind === 'robot' ? 440 : 420) - 1800
            const yaw = Math.atan2(dx, -dz) * 180 / Math.PI, pitch = Math.atan2(dy, Math.hypot(dx,dz)) * 180 / Math.PI
            s.aim(yaw - data.yaw, pitch - data.pitch); window.__targetId = e.id
        }, { kind, y }); await frame()
    }
    await aim('robot', 1315); await capture('robot-weakpoint-before')
    await page.keyboard.down('Space'); await step(1); await page.keyboard.up('Space')
    assert.equal(await page.evaluate(() => window.__session.read().impact?.kind), 'weak'); results.checks.push('robot weak point first hit')
    await capture('robot-weakpoint-impact')
    await step(10); await page.evaluate(() => { const s = window.__session; while (!window.__boxes(s.read().state.enemies.find(e => e.kind === 'crs'), s.read().state.tick).some(b => b.part === 'shield')) window.__advance(1); window.__onFrame(1) }); await aim('crs', 1000); await capture('crs-shield-before')
    await page.keyboard.down('Space'); await step(1); await page.keyboard.up('Space')
    const shield = await page.evaluate(() => window.__session.read().impact?.kind)
    assert.equal(shield, 'shield'); results.checks.push('CRS frontal shield first hit'); await capture('crs-shield-impact')
    await step(10)
    await page.evaluate(() => { const s = window.__session; while (window.__boxes(s.read().state.enemies.find(e => e.kind === 'crs'), s.read().state.tick).some(b => b.part === 'shield')) window.__advance(1); window.__onFrame(1) })
    await aim('crs', 1000); await capture('crs-open-before')
    await page.keyboard.down('Space'); await step(1); await page.keyboard.up('Space')
    assert.equal(await page.evaluate(() => window.__session.read().impact?.kind), 'body')
    await capture('crs-open-impact'); await step(10); await aim('crs', 1650)
    await page.keyboard.down('Space'); await step(1); await page.keyboard.up('Space')
    assert.equal(await page.evaluate(() => window.__session.read().impact?.kind), 'weak')
    await capture('crs-head-impact'); results.checks.push('CRS open shield permits body damage; above-shield head hits weak volume')
    // Cross-window focus and explicit resume.
    await page.getByRole('button', { name: 'Other OS window', exact: true }).click()
    assert.equal(await page.evaluate(() => document.activeElement.id), 'other-window')
    assert.equal(await page.locator('.fps-preview').getAttribute('data-status'), 'paused')
    const frozen = await page.evaluate(() => window.__session.read().state.tick); await step(120)
    assert.equal(await page.evaluate(() => window.__session.read().state.tick), frozen)
    await page.evaluate(() => window.__activate(true)); await frame()
    assert.equal(await page.locator('.fps-preview').getAttribute('data-status'), 'paused'); results.checks.push('inactive window keeps external focus; reactivation stays paused')
    await capture('paused')
    // Two naturally spawned opponents share the central axis; the nearer robot
    // must take the body hit, leaving the farther CRS untouched.
    await open(); await start(); await step(900); await aim('robot', 1650)
    const aligned = await page.evaluate(() => window.__session.read().state.enemies.filter(e => e.axis === 1).map(e => ({id:e.id,hp:e.hp,progress:e.progress})))
    assert.equal(aligned.length, 2); assert(aligned[0].progress > aligned[1].progress)
    await capture('depth-aligned-before')
    await page.keyboard.down('Space'); await step(1); await page.keyboard.up('Space')
    const afterDepth = await page.evaluate(() => window.__session.read().state.enemies.filter(e => e.axis === 1).map(e => ({id:e.id,hp:e.hp})))
    assert.equal(await page.evaluate(() => window.__session.read().impact?.kind), 'body')
    assert.equal(afterDepth[0].hp, aligned[0].hp - 34); assert.equal(afterDepth[1].hp, aligned[1].hp)
    results.depthEvidence = { before: aligned, after: afterDepth }
    await capture('depth-aligned-impact'); results.checks.push('aligned natural spawns: near robot body takes hit; farther CRS unchanged')
    // Full controlled-clock run, all inputs use the real session journal. Let two opponents
    // reach the wall to exercise repair, then use a deterministic input agent for completion.
    await open(); await start()
    await page.evaluate(() => {
        const session = window.__session
        let escaped = 0, previousHp = 100
        for (let guard = 0; guard < 10_800 && session.read().status === 'playing'; guard++) {
            const { state, yaw, pitch } = session.read()
            if (state.hp < previousHp) { escaped++; previousHp = state.hp }
            if (state.phase === 'repair') break
            if (escaped >= 2 && state.enemies.length && !state.reloadUntil) {
                if (!state.ammo) session.command({ type: 'reload' })
                else if (state.tick >= state.fireAt) {
                    const e = state.enemies[0], p = window.__position(e), y = e.kind === 'crs' ? 1650 : 1315
                    const dx = p.x, dz = p.z + (e.kind === 'robot' ? 440 : 0) - 1800, dy = y - 1650
                    session.aim(Math.atan2(dx, -dz)*180/Math.PI-yaw, Math.atan2(dy, Math.hypot(dx,dz))*180/Math.PI-pitch)
                    session.fire(true); session.fire(false)
                }
            }
            window.__advance(1); window.__onFrame(1)
        }
    }); await frame(); await capture('repair-before')
    await page.getByRole('button', { name: 'Réparer +40% · une fois', exact: true }).click(); await capture('repair-after')
    await page.getByRole('button', { name: 'À la barricade', exact: true }).click()
    await page.evaluate(() => {
        const session = window.__session
        for (let guard = 0; guard < 10_800 && session.read().status === 'playing'; guard++) {
            const { state, yaw, pitch } = session.read()
            if (state.phase === 'repair') session.command({ type: 'continue' })
            else if (!state.reloadUntil) {
                if (!state.ammo) session.command({ type: 'reload' })
                else if (state.tick >= state.fireAt && state.enemies.length) {
                    const e = state.enemies[0], p = window.__position(e), y = e.kind === 'crs' ? 1650 : 1315, dx = p.x, dz = p.z + (e.kind === 'robot' ? 440 : 0) - 1800, dy = y - 1650
                    session.aim(Math.atan2(dx,-dz)*180/Math.PI-yaw, Math.atan2(dy,Math.hypot(dx,dz))*180/Math.PI-pitch)
                    session.fire(true); session.fire(false)
                }
            }
            window.__advance(1); window.__onFrame(1)
        }
    }); await frame(); await capture('result')
    assert.equal(await page.locator('.fps-preview').getAttribute('data-phase'), 'won')
    assert.equal(await page.evaluate(() => window.__session.getSnapshot().verified), true)
    const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Exporter le replay', exact: true }).click()
    await (await downloadPromise).saveAs(`${output}/winning-replay.json`)
    results.checks.push('controlled-clock complete run, repair, replay parity and exported journal')
    await open(false); await start(); await page.keyboard.down('Space'); await page.waitForTimeout(500); await page.keyboard.up('Space')
    assert((await page.evaluate(() => window.__session.read().state.shots)) > 0)
    await page.getByRole('button', { name: 'Pause · P', exact: true }).click(); const tick = await page.evaluate(() => window.__session.read().state.tick)
    await page.waitForTimeout(250); assert.equal(await page.evaluate(() => window.__session.read().state.tick), tick)
    results.checks.push('real-time RAF loop shoots and pauses')
    // Native mouse drag, explicit pointer lock, then loss of lock must pause.
    await open(); await start()
    const surface = await page.locator('.fps-input').boundingBox()
    await page.mouse.move(surface.x + surface.width/2, surface.y + surface.height/2)
    await page.mouse.down(); await page.mouse.move(surface.x + surface.width/2 + 80, surface.y + surface.height/2 - 30); await page.mouse.up()
    assert((await page.evaluate(() => window.__session.read().yaw)) > 10)
    await page.getByRole('button', { name: 'Pause · P', exact: true }).click()
    await page.getByRole('button', { name: 'Jouer · capturer la souris', exact: true }).click()
    await page.waitForFunction(() => document.pointerLockElement || document.querySelector('.fps-notice'))
    if (await page.evaluate(() => !!document.pointerLockElement)) {
        await page.evaluate(() => document.exitPointerLock())
        await page.waitForFunction(() => window.__session.read().status === 'paused')
        results.checks.push('native drag changes aim; explicit pointer lock succeeds; lock loss pauses')
    } else {
        assert.match(await page.locator('.fps-notice').innerText(), /Capture indisponible|Capture refusée/)
        results.checks.push('native drag changes aim; headless pointer lock rejected; drag fallback shown')
        results.pointerLockLimitation = 'This Chromium headless environment rejected capture; actual lock loss still needs a headed browser.'
        await capture('pointer-lock-refused')
    }
    // Browser-generated multi-touch, independent aim and fire pointers.
    await page.setViewportSize({ width: 390, height: 844 }); await open(); await start()
    await page.evaluate(() => {
        window.__events = []
        for (const name of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'focusin', 'focusout', 'blur']) document.addEventListener(name, e => window.__events.push({name, id:e.pointerId, type:e.pointerType, target:e.target.className || e.target.textContent?.slice(0,30)}), true)
    })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
    const area = await page.locator('.fps-input').boundingBox(), trigger = await page.getByRole('button', { name: 'Tirer', exact: true }).boundingBox()
    let aimPoint = { id: 1, x: area.x + area.width/2, y: area.y + area.height/2 }
    const firePoint = { id: 2, x: trigger.x + trigger.width/2, y: trigger.y + trigger.height/2 }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [aimPoint] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [aimPoint, firePoint] })
    aimPoint = { ...aimPoint, x: aimPoint.x + 30 }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [aimPoint, firePoint] }); await step(10)
    assert((await page.evaluate(() => window.__session.read().yaw)) > 0)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [aimPoint] })
    const beforeRelease = await page.evaluate(() => window.__session.read().state.shots); await step(20)
    results.touchEvidence = await page.evaluate(() => ({ events: window.__events, shots: window.__session.read().state.shots, status:window.__session.read().status }))
    results.touchEvidence.beforeRelease = beforeRelease
    assert((await page.evaluate(() => window.__session.read().state.shots)) > beforeRelease)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    const cancelled = await page.evaluate(() => window.__session.read().state.shots); await step(20)
    assert.equal(await page.evaluate(() => window.__session.read().state.shots), cancelled)
    results.checks.push('browser two-finger aim/fire; aim release preserves fire; touch cancel stops fire')
    await capture('portrait-touch'); await cdp.detach()
    // Real context loss reaches the explicit Classic fallback.
    await page.evaluate(() => window.__renderer.getContext().getExtension('WEBGL_lose_context').loseContext())
    await page.getByRole('heading', { name: 'FPS 3D indisponible' }).waitFor()
    assert.equal(await page.evaluate(() => window.__session.read().status), 'paused')
    await capture('webgl-fallback')
    await page.getByRole('button', { name: 'Jouer à Classic', exact: true }).click()
    assert.equal(await page.evaluate(() => window.__classic), true)
    results.checks.push('actual WebGL context loss pauses and offers working Classic exit')
    assert.equal(results.errors.length, 0); assert.equal(results.consoleErrors.length, 0); assert.equal(results.requests.length, 0)
} catch (error) {
    results.failure = String(error.stack || error)
    await capture('failure').catch(() => {})
    process.exitCode = 1
} finally {
    await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2))
    await browser.close()
    await new Promise(resolve => server.close(resolve))
    console.log(JSON.stringify(results, null, 2))
}
