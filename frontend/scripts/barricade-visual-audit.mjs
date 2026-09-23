import { chromium } from '@playwright/test'

const output = process.argv[2]
if (!output) throw new Error('usage: node scripts/barricade-visual-audit.mjs OUTPUT.png')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 })
await page.goto('http://localhost:5174/mainnet/game/barricade?r25d=1')
await page.getByRole('button', { name: 'Practice' }).waitFor()

await page.evaluate(async () => {
  const { drawMachine, MACHINE_COLOR } = await import('/src/games/barricade/render/draw.ts')
  const { registerSprite } = await import('/src/games/barricade/render/sprites.ts')
  const authored = ['drone', 'walker', 'testudo', 'mortar', 'broadcast']
  await Promise.all(authored.map((kind) => new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => { registerSprite(kind, image); resolve() }
    image.onerror = reject
    image.src = `/games/barricade/${kind}.webp`
  })))

  const kinds = [
    'drone', 'walker', 'phalanx', 'netter', 'siege', 'testudo', 'swarm',
    'rampart', 'charger', 'flanker', 'mortar', 'marshal', 'marshal-open',
    'kettle', 'dampener', 'carrier', 'jammer', 'mender', 'panopticon', 'broadcast',
  ]
  document.body.innerHTML = ''
  document.body.style.cssText = 'margin:0;background:#0a0812;color:#efe7d4;font:700 13px ui-monospace,monospace'
  const title = document.createElement('h1')
  title.textContent = 'BARRICADE · 2.5D enemy art at play scale'
  title.style.cssText = 'font:800 24px ui-monospace,monospace;margin:24px 28px 8px;color:#00d4aa'
  document.body.append(title)
  const note = document.createElement('p')
  note.textContent = 'Authored cutouts: drone, walker, testudo, mortar, broadcast. Remaining chassis are procedural.'
  note.style.cssText = 'margin:0 28px 20px;color:#c9c2b0'
  document.body.append(note)
  const grid = document.createElement('div')
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:12px;padding:0 28px 28px'
  document.body.append(grid)

  for (const label of kinds) {
    const kind = label === 'marshal-open' ? 'marshal' : label
    const card = document.createElement('figure')
    card.style.cssText = 'margin:0;border:1px solid #2a2536;border-radius:10px;background:#141026;padding:8px'
    const canvas = document.createElement('canvas')
    canvas.width = 210
    canvas.height = 150
    canvas.style.cssText = 'display:block;width:100%;height:auto;background:linear-gradient(#211a30,#141026)'
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#211a30'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgba(239,231,212,.06)'
    ctx.fillRect(0, 117, canvas.width, 1)
    ctx.save()
    ctx.translate(105, 116)
    ctx.scale(1, .22)
    ctx.fillStyle = 'rgba(0,0,0,.55)'
    ctx.beginPath()
    ctx.arc(0, 0, 52, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    drawMachine(ctx, kind, 105, 116, kind === 'broadcast' ? 112 : 92, MACHINE_COLOR[kind], label === 'marshal-open')
    const caption = document.createElement('figcaption')
    caption.textContent = label.replace('-', ' · ')
    caption.style.cssText = 'padding:8px 2px 2px;text-transform:uppercase;letter-spacing:.08em'
    card.append(canvas, caption)
    grid.append(card)
  }
})

await page.screenshot({ path: output, fullPage: true })
await browser.close()
