#!/usr/bin/env node
/**
 * Bundle CI gate for Memba OS (behind VITE_MEMBA_OS, off by default).
 *
 * FAILS if a flag-off production build ships any Memba OS code. App.tsx gates
 * the lazy import itself (`OS_ENABLED ? lazy(() => import("./os/OsRoot")) : null`),
 * which only drops the chunk while the flag folds to a literal `false`. If that
 * ever stops folding, the chunk is emitted again and the service worker
 * precaches it for every user — and the dev-server e2e can't see it.
 *
 * Detection: the "memba-os" root class (os.css + OsRoot.tsx), the OsRoot
 * chunk name, any file whose name contains "manrope", and — since a flag-off
 * build inlines the self-hosted font as base64 (vite.config.ts's
 * assetsInlineLimit override) rather than emitting a separate manrope-named
 * file — any text file whose *contents* contain "manrope" too. None of these
 * appear anywhere outside src/os, so any hit in dist/ is a leak. Beta brand
 * paths and share filenames, exact artwork hashes (including renamed files),
 * and inline SVG/base64 contents are checked too. Positive
 * control: run it on a beta build (VITE_MEMBA_OS=true
 * MEMBA_OS_BETA_SITE=true) and it must fail.
 *
 * Usage (after `vite build`): node scripts/check-os-chunk.mjs [distDir]
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

const DIST = resolve(process.argv[2] || "dist")
const SENTINEL = "memba-os"
const CHUNK_NAME = /^OsRoot[-.]/i
const FONT_NAME = /manrope/i
const BRAND_NAME = /(?:brand[\/]os(?:[\/]|$)|share-1200x(?:630|1200)|osSiteIdentity)/i
const BRAND_DIR = fileURLToPath(new URL('../src/os/brand/', import.meta.url))
const brand = readdirSync(BRAND_DIR).filter(name => /\.(png|svg)$/.test(name)).map(name => {
  const bytes = readFileSync(join(BRAND_DIR, name))
  return { hash: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64'),
    svg: name.endsWith('.svg') ? bytes.toString('utf8').trim() : null }
})

function fail(msg) {
  console.error(`\n❌ bundle gate (check-os-chunk): ${msg}\n`)
  process.exit(1)
}

if (!existsSync(DIST)) fail(`${DIST} not found — run \`npm run build\` first.`)

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const all = walk(DIST)
const files = all.filter((p) => /\.(js|mjs|css|html|webmanifest|json|svg|xml|txt|map)$/.test(p))
const leaks = []
for (const p of all) {
  const rel = relative(DIST, p)
  if (FONT_NAME.test(rel)) leaks.push(`${rel} (Memba OS font)`)
  if (BRAND_NAME.test(rel)) leaks.push(`${rel} (beta brand filename)`)
  const hash = createHash('sha256').update(readFileSync(p)).digest('hex')
  if (brand.some(asset => asset.hash === hash)) leaks.push(`${rel} (beta artwork contents)`)

}
for (const p of files) {
  const rel = relative(DIST, p)
  const base = rel.split("/").pop()
  if (CHUNK_NAME.test(base)) { leaks.push(`${rel} (Memba OS chunk)`); continue }
  const text = readFileSync(p, "utf8")
  if (BRAND_NAME.test(text) || brand.some(asset => text.includes(asset.base64)
    || (asset.svg && (text.includes(asset.svg) || text.includes(encodeURIComponent(asset.svg)))))) leaks.push(`${rel} (beta brand reference or inline artwork)`)
  if (text.includes(SENTINEL)) leaks.push(`${rel} (contains "${SENTINEL}")`)
  else if (FONT_NAME.test(text)) leaks.push(`${rel} (contains "manrope" — a flag-off build inlines the font as base64; see assetsInlineLimit in vite.config.ts)`)
}

if (leaks.length) {
  fail(
    `Memba OS code is in a flag-off build:\n  - ${leaks.join("\n  - ")}\n` +
      `Keep the lazy import in App.tsx behind OS_ENABLED so the chunk is never emitted or precached, ` +
      `and keep any src/os import (including os-fonts.css) reachable only from that lazy subtree — ` +
      `see the assetsInlineLimit override in vite.config.ts for why the font can't just be a public asset.`,
  )
}

console.log(`✅ bundle gate: no Memba OS code in ${relative(process.cwd(), DIST) || "."} (${files.length} files scanned).`)
