/**
 * The notes-private bundle gate against synthetic builds: a flag-off build must carry no private
 * chunk or marker (negative), and --expect-present must find the chunk and every marker (positive).
 */
import { afterEach, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const MARKERS = ["Memba Notes unlock v1", "RegisterKey", "SetSeedBackup", "sampleCBD"]
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function dist(files: Record<string, string>, html = '<script type="module" src="/assets/index-a.js"></script>', sw = 'precacheAndRoute([{url:"assets/index-a.js",revision:null}])') {
  const dir = mkdtempSync(join(tmpdir(), "notes-private-gate-")); dirs.push(dir)
  mkdirSync(join(dir, "assets"))
  writeFileSync(join(dir, "index.html"), html)
  writeFileSync(join(dir, "sw.js"), sw)
  for (const [name, code] of Object.entries({ "index-a.js": 'const n="xwing-v1";', ...files })) writeFileSync(join(dir, "assets", name), code)
  return dir
}
function gate(dir: string, on: boolean, ...extra: string[]) {
  const env = { ...process.env }; delete env.VITE_ENABLE_NOTES_ENCRYPTED
  if (on) env.VITE_ENABLE_NOTES_ENCRYPTED = "true"
  return spawnSync(process.execPath, ["scripts/check-lazy-chunk.mjs", "notes-private", dir, ...extra], { encoding: "utf8", env }).status
}
const privateChunk = `export const t=${JSON.stringify(MARKERS.join(" "))};`
const lazyApp = 'const l=()=>import("./privateNotes-b.js");'

describe("bundle gate: notes-private", () => {
  it("passes a flag-off build without private code, whose public key-suite name is not a marker", () => {
    expect(gate(dist({ "apps-c.js": 'const r="gno.land/r/samcrew/enckeys_v1";' }), false)).toBe(0)
  })
  it("fails a flag-off build carrying the private chunk or any single marker", () => {
    expect(gate(dist({ "privateNotes-b.js": privateChunk, "apps-c.js": lazyApp }), false)).toBe(1)
    for (const marker of MARKERS) expect(gate(dist({ "apps-c.js": `const m=${JSON.stringify(marker)};` }), false), marker).toBe(1)
  })
  it("--expect-present passes a flag-on build whose lazy chunk holds every marker", () => {
    expect(gate(dist({ "privateNotes-b.js": privateChunk, "apps-c.js": lazyApp }), true, "--expect-present")).toBe(0)
  })
  it("--expect-present fails without the chunk, or when a marker stopped matching", () => {
    expect(gate(dist({}), true, "--expect-present")).toBe(1)
    for (const marker of MARKERS) {
      const partial = `export const t=${JSON.stringify(MARKERS.filter(m => m !== marker).join(" "))};`
      expect(gate(dist({ "privateNotes-b.js": partial, "apps-c.js": lazyApp }), true, "--expect-present"), marker).toBe(1)
    }
  })
  it("fails a flag-on build that loads the private chunk eagerly or precaches it", () => {
    const eager = '<script type="module" src="/assets/index-a.js"></script><link rel="modulepreload" href="/assets/privateNotes-b.js">'
    expect(gate(dist({ "privateNotes-b.js": privateChunk }, eager), true, "--expect-present")).toBe(1)
    expect(gate(dist({ "privateNotes-b.js": privateChunk, "index-a.js": 'import"./privateNotes-b.js";' }), true, "--expect-present")).toBe(1)
    expect(gate(dist({ "privateNotes-b.js": privateChunk, "apps-c.js": lazyApp }, undefined, 'precacheAndRoute([{url:"assets/privateNotes-b.js",revision:null}])'), true, "--expect-present")).toBe(1)
  })
})
