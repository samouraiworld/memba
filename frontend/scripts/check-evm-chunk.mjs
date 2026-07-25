#!/usr/bin/env node
/**
 * Bundle CI gate for the EVM/viem stack (B-5 Phase 1).
 *
 * The CAL mount (ChainContextProvider in main.tsx) is in the EAGER entry graph,
 * but viem must never be: EvmProvider is reached exclusively via a dynamic
 * import, so the ~100KB+ viem stack rides the lazy `vendor-evm` chunk that only
 * CAL-flag-on sessions ever fetch. This gate FAILS the build if:
 *   1) a vendor-evm chunk is referenced by index.html (script/modulepreload) or
 *      statically imported by any eager chunk — i.e. viem leaked into the
 *      entry graph every user downloads; or
 *   2) the vendor-evm chunk appears in the Workbox PRECACHE manifest — every
 *      user (flag-off included) would download it on service-worker install.
 *
 * Mirrors scripts/check-three-chunk.mjs (the BARRICADE 3D cost firewall).
 * Run after `vite build` (needs dist/).
 */
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"

const DIST = join(process.cwd(), "dist")
const ASSETS = join(DIST, "assets")
const CHUNK_RE = /vendor-evm-[^"'\s]*\.js/

function fail(msg) {
  console.error(`\n❌ bundle gate (check-evm-chunk): ${msg}\n`)
  process.exit(1)
}

if (!existsSync(DIST)) fail("dist/ not found — run `npm run build` first.")

const jsFiles = existsSync(ASSETS) ? readdirSync(ASSETS).filter((f) => f.endsWith(".js")) : []
const evmChunks = jsFiles.filter((f) => /^vendor-evm-.*\.js$/.test(f))

// ---- Check 1: viem must not be in the EAGER entry graph --------------------
const indexPath = join(DIST, "index.html")
const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : ""
if (CHUNK_RE.test(indexHtml)) {
  fail("the EVM/viem chunk is referenced by index.html (script/modulepreload) — EvmProvider must stay a dynamic (lazy) import only.")
}
const eager = new Set()
for (const m of indexHtml.matchAll(/(?:src|href)="[^"]*\/assets\/([^"]+\.js)"/g)) eager.add(m[1])
for (const name of eager) {
  const p = join(ASSETS, name)
  if (!existsSync(p)) continue
  const code = readFileSync(p, "utf8")
  const staticImport = /(?:^|[^.\w$])import\s*["'][^"']*vendor-evm-[^"']*\.js["']/.test(code)
  const staticFrom = /\bfrom\s*["'][^"']*vendor-evm-[^"']*\.js["']/.test(code)
  if (staticImport || staticFrom) {
    fail(`eager chunk ${name} statically imports the EVM/viem chunk — it must be a dynamic (lazy) import only.`)
  }
}

// ---- Check 2: the EVM chunk must be PRECACHE-EXCLUDED ----------------------
const swPath = ["sw.js", "service-worker.js"].map((f) => join(DIST, f)).find(existsSync)
if (swPath) {
  const sw = readFileSync(swPath, "utf8")
  if (/["']?url["']?\s*:\s*["'][^"']*vendor-evm-[^"']*\.js["']/.test(sw)) {
    fail("the EVM/viem chunk is in the Workbox precache MANIFEST (sw.js) — verify globIgnores strips it so flag-off users never download it.")
  }

  // ---- Check 3: CONTENT grep — viem must not hide under another name -------
  // Checks 1-2 match the vendor-evm NAME, which only exists while the
  // manualChunks assignment does. If that line is removed/renamed, viem
  // inlines into the (differently-named, precached) EvmProvider async chunk
  // and the name checks false-PASS. viem embeds a "viem@<version>" client id
  // in its build — grep every precached and eager js file for it.
  const precached = new Set()
  for (const m of sw.matchAll(/["']?url["']?\s*:\s*["']assets\/([^"']+\.js)["']/g)) precached.add(m[1])
  for (const name of new Set([...precached, ...eager])) {
    const p = join(ASSETS, name)
    if (!existsSync(p)) continue
    if (readFileSync(p, "utf8").includes("viem@")) {
      const where = eager.has(name) ? "EAGER chunk" : "PRECACHED chunk"
      fail(`${where} ${name} CONTAINS viem (content marker "viem@") — viem escaped the vendor-evm isolation (renamed/inlined chunk?).`)
    }
  }
} else {
  console.warn("bundle gate: no sw.js found (PWA build skipped?) — precache check skipped.")
}

console.log(
  `✅ bundle gate: viem is isolated${evmChunks.length ? ` (async chunk: ${evmChunks.join(", ")})` : " (not yet in the bundle)"} and precache-excluded.`,
)
