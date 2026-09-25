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
 * appear anywhere outside src/os, so any hit in dist/ is a leak. Positive
 * control: run it on a beta build (VITE_MEMBA_OS=true
 * MEMBA_OS_BETA_SITE=true) and it must fail.
 *
 * Usage (after `vite build`): node scripts/check-os-chunk.mjs [distDir]
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const DIST = resolve(process.argv[2] || "dist")
const SENTINEL = "memba-os"
const CHUNK_NAME = /^OsRoot[-.]/i
const FONT_NAME = /manrope/i

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
const files = all.filter((p) => /\.(js|mjs|css|html|webmanifest|json)$/.test(p))
const leaks = []
for (const p of all) {
  const rel = relative(DIST, p)
  if (FONT_NAME.test(rel)) leaks.push(`${rel} (Memba OS font)`)
}
for (const p of files) {
  const rel = relative(DIST, p)
  const base = rel.split("/").pop()
  if (CHUNK_NAME.test(base)) { leaks.push(`${rel} (Memba OS chunk)`); continue }
  const text = readFileSync(p, "utf8")
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
