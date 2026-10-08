#!/usr/bin/env node
/**
 * Captures storefront screenshots as WebP with no metadata.
 * Usage: node scripts/capture-store-media.mjs <key> <url> <shot-number> [waitForSelector]
 * Public pages only: no wallet, no sign-in, no personal data on screen.
 * Writes frontend/public/store/<key>/shot-<n>.webp (1600×1000 viewport, cwebp -q 80).
 * The committed game shots used a taller viewport (1600×1250) for Space Invaders and BARRICADE,
 * and some interaction shots were taken with one-off helpers through this same cwebp pipeline.
 */
import { chromium } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const [key, url, n, wait] = process.argv.slice(2)
if (!/^[a-z0-9-]+$/.test(key ?? "") || !/^https:\/\//.test(url ?? "") || !/^[1-6]$/.test(n ?? "")) {
    console.error("usage: capture-store-media.mjs <key> <https-url> <1-6> [selector]"); process.exit(2)
}
const out = join(import.meta.dirname, "../public/store", key)
mkdirSync(out, { recursive: true })
const dir = mkdtempSync(join(tmpdir(), "store-capture-"))
const png = join(dir, `store-${key}-${n}.png`)
let browser
try {
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, colorScheme: "dark" })
    await page.goto(url, { waitUntil: "load", timeout: 45_000 })
    // Live pages (sockets, polling) never go fully idle: wait for a quiet network, but not forever.
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {})
    if (wait) await page.waitForSelector(wait, { timeout: 20_000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: png })
    // cwebp writes no EXIF/XMP unless -metadata is given.
    execFileSync("cwebp", ["-quiet", "-q", "80", "-resize", "1440", "0", png, "-o", join(out, `shot-${n}.webp`)])
    console.log(`wrote public/store/${key}/shot-${n}.webp`)
} finally {
    await browser?.close()
    rmSync(dir, { recursive: true, force: true })
}
