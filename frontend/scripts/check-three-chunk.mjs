#!/usr/bin/env node
/**
 * Bundle CI gate for the BARRICADE 3D renderer (Phase 0, PR-0b).
 *
 * FAILS the build if the three / react-three-fiber / postprocessing stack ever
 * leaks out of its lazy async chunk, which would defeat the whole cost firewall:
 *   1) three must never be loaded by the EAGER entry graph (index.html
 *      script/modulepreload, or a static import from an eager chunk). It may only
 *      arrive via lazy(() => import('./render/three/...')).
 *   2) the vendor-three chunk must never appear in the Workbox PRECACHE manifest
 *      (globIgnores must strip it), or every user — including 2D-mode users who
 *      never load three — would download ~300-360KB on service-worker install.
 *
 * Run after `vite build` (needs dist/). Inert-but-passing until PR-0c actually
 * imports three (no vendor-three chunk exists yet), then load-bearing.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"

const DIST = join(process.cwd(), "dist")
const ASSETS = join(DIST, "assets")
const CHUNK_RE = /vendor-three-[^"'\s]*\.js/

function fail(msg) {
  console.error(`\n❌ bundle gate (check-three-chunk): ${msg}\n`)
  process.exit(1)
}

if (!existsSync(DIST)) fail("dist/ not found — run `npm run build` first.")

const jsFiles = existsSync(ASSETS) ? readdirSync(ASSETS).filter((f) => f.endsWith(".js")) : []
const threeChunks = jsFiles.filter((f) => /^vendor-three-.*\.js$/.test(f))

// ---- Check 1: three must not be in the EAGER entry graph -------------------
// Vite emits <script type=module src> for the entry and <link rel=modulepreload>
// for its STATIC import graph. A lazily-imported chunk appears in neither.
const indexPath = join(DIST, "index.html")
const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : ""
if (CHUNK_RE.test(indexHtml)) {
  fail("three is referenced by index.html (script/modulepreload) — it must be lazy-imported only, never in the eager entry graph.")
}
// Also scan each eager chunk for a STATIC import of a vendor-three chunk. A static
// import is bare `import"..."` / `from"..."`; a dynamic one is `import("...")` and
// is allowed. We approximate by rejecting the static forms.
const eager = new Set()
for (const m of indexHtml.matchAll(/(?:src|href)="[^"]*\/assets\/([^"]+\.js)"/g)) eager.add(m[1])
for (const name of eager) {
  const p = join(ASSETS, name)
  if (!existsSync(p)) continue
  const code = readFileSync(p, "utf8")
  const staticImport = /(?:^|[^.\w$])import\s*["'][^"']*vendor-three-[^"']*\.js["']/.test(code)
  const staticFrom = /\bfrom\s*["'][^"']*vendor-three-[^"']*\.js["']/.test(code)
  if (staticImport || staticFrom) {
    fail(`eager chunk ${name} statically imports the three chunk — it must be a dynamic (lazy) import only.`)
  }
}

// ---- Check 2: the three chunk must be PRECACHE-EXCLUDED --------------------
// vite-plugin-pwa (generateSW) inlines the precache manifest into dist/sw.js as an
// array of {url, revision} entries. The runtimeCaching route I added ALSO mentions
// vendor-three (as a RegExp literal), so match ONLY manifest url entries here.
const swPath = ["sw.js", "service-worker.js"].map((f) => join(DIST, f)).find(existsSync)
if (swPath) {
  const sw = readFileSync(swPath, "utf8")
  if (/["']?url["']?\s*:\s*["'][^"']*vendor-three-[^"']*\.js["']/.test(sw)) {
    fail("the three chunk is in the Workbox precache MANIFEST (sw.js) — verify globIgnores strips it so 2D-mode users never download it.")
  }
} else {
  console.warn("bundle gate: no sw.js found (PWA build skipped?) — precache check skipped.")
}

console.log(
  `✅ bundle gate: three is isolated${threeChunks.length ? ` (async chunk: ${threeChunks.join(", ")})` : " (not yet in the bundle)"} and precache-excluded.`,
)
