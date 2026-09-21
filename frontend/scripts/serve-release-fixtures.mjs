// Test-only server; switches immutable build roots without changing origin.
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
let release = 'a'
let brokenChunk = ''
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:5211')
    if (url.pathname === '/__release' && req.method === 'POST') {
        if (url.searchParams.has('build')) release = url.searchParams.get('build') === 'b' ? 'b' : 'a'
        brokenChunk = url.searchParams.get('break') || ''
        res.end('ok'); return
    }
    const root = resolve(`.release-builds/${release}`)
    const file = resolve(root, '.' + decodeURIComponent(url.pathname))
    if (!file.startsWith(root + sep)) { res.writeHead(404).end(); return }
    if (brokenChunk && file.includes(brokenChunk) && file.endsWith('.js')) { res.writeHead(503).end('unavailable'); return }
    // Never turn missing assets into HTML: exercise a real failed module load.
    const target = existsSync(file) && extname(file) ? file : extname(file) ? '' : resolve(root, 'index.html')
    if (!target) { res.writeHead(404).end(); return }
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', types[extname(target)] || 'application/octet-stream')
    res.end(readFileSync(target))
}).listen(5211, '127.0.0.1')
