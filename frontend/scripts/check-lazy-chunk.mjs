#!/usr/bin/env node
/**
 * Bundle CI gate for heavy vendor stacks that must stay in a lazy async chunk.
 *
 * Usage: node scripts/check-lazy-chunk.mjs <three|evm> [distDir] [--expect-present]
 *   three  BARRICADE 3D renderer (three / react-three-fiber / postprocessing)
 *   evm    EVM network adapter (viem / wagmi), behind VITE_ENABLE_EVM
 *   distDir          the build to check (default: dist)
 *   --expect-present positive control: also FAIL when the chunk is missing, for a
 *                    build with the flag on (proves the gate still sees the chunk)
 *
 * FAILS the build if the `vendor-<name>` chunk:
 *   1) is loaded by the EAGER entry graph (index.html script/modulepreload, or a
 *      static import from an eager chunk) — it may only arrive via lazy import();
 *   2) is in the Workbox PRECACHE manifest (globIgnores must strip it), or every
 *      user would download it on service-worker install;
 *   3) exists at all while its flag (if any) is not "true": a flag-off build
 *      must not ship the stack, nor any JS carrying one of the gate's markers
 *      (strings only the gated code holds, so app code that stopped folding
 *      away is caught even when it imports no vendor module).
 *
 * Run after `vite build` (needs dist/). Inert-but-passing while no such chunk exists.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"

// The command-line argument only SELECTS a gate: every pattern below is built
// from these constants, never from the argument.
const GATES = {
  three: { chunk: "vendor-three-", flag: null, markers: [] },
  // viem's and wagmi's own names (a flag-off build has no vendor-evm chunk to find them by), the
  // Base Sepolia RPC host (lib/chain/evm/networks.ts) and the adapter's storage key (adapter.ts).
  evm: { chunk: "vendor-evm-", flag: "VITE_ENABLE_EVM", markers: ["viem@", "wagmi", "sepolia.base.org", "memba.evm"] },
}
const args = process.argv.slice(2)
const expectPresent = args.includes("--expect-present")
const [name, distArg] = args.filter((a) => a !== "--expect-present")
const gate = Object.hasOwn(GATES, name) ? GATES[name] : null
if (!gate) {
  console.error(`usage: check-lazy-chunk.mjs <${Object.keys(GATES).join("|")}> [distDir] [--expect-present]`)
  process.exit(2)
}
const { chunk: CHUNK, flag: flagVar, markers: MARKERS } = gate

const DIST = resolve(process.cwd(), distArg || "dist")
const ASSETS = join(DIST, "assets")
const CHUNK_RE = new RegExp(`${CHUNK}[^"'\\s]*\\.js`)

function fail(msg) {
  console.error(`\n❌ bundle gate (${name}): ${msg}\n`)
  process.exit(1)
}

if (!existsSync(DIST)) fail("dist/ not found — run `npm run build` first.")

const jsFiles = existsSync(ASSETS) ? readdirSync(ASSETS).filter((f) => f.endsWith(".js")) : []
const chunks = jsFiles.filter((f) => f.startsWith(CHUNK))

// ---- Positive control: a flag-on build must contain the chunk -------------
if (expectPresent && chunks.length === 0) {
  fail(`--expect-present: ${DIST} has no ${CHUNK}* chunk — the build did not include the gated code, so the checks below prove nothing.`)
}

// ---- Check 3: a flag-off build must not contain the chunk -----------------
if (flagVar && process.env[flagVar] !== "true") {
  if (chunks.length > 0) fail(`${flagVar} is off but dist/ contains ${chunks.join(", ")} — the gated import stopped folding away.`)
  // JS only: index.html legitimately names the RPC hosts in its CSP.
  for (const file of jsFiles) {
    const code = readFileSync(join(ASSETS, file), "utf8")
    const marker = MARKERS.find((m) => code.includes(m))
    if (marker) fail(`${flagVar} is off but ${file} contains "${marker}" — gated code stopped folding away.`)
  }
}

// ---- Check 1: the chunk must not be in the EAGER entry graph ---------------
// Vite emits <script type=module src> for the entry and <link rel=modulepreload>
// for its STATIC import graph. A lazily-imported chunk appears in neither.
const indexPath = join(DIST, "index.html")
const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : ""
if (CHUNK_RE.test(indexHtml)) {
  fail(`${CHUNK}* is referenced by index.html (script/modulepreload) — it must be lazy-imported only.`)
}
// Also scan each eager chunk for a STATIC import of the vendor chunk. A static
// import is bare `import"..."` / `from"..."`; a dynamic one is `import("...")` and
// is allowed. We approximate by rejecting the static forms.
const eager = new Set()
for (const m of indexHtml.matchAll(/(?:src|href)="[^"]*\/assets\/([^"]+\.js)"/g)) eager.add(m[1])
const staticImport = new RegExp(`(?:^|[^.\\w$])import\\s*["'][^"']*${CHUNK}[^"']*\\.js["']`)
const staticFrom = new RegExp(`\\bfrom\\s*["'][^"']*${CHUNK}[^"']*\\.js["']`)
for (const file of eager) {
  const p = join(ASSETS, file)
  if (!existsSync(p)) continue
  const code = readFileSync(p, "utf8")
  if (staticImport.test(code) || staticFrom.test(code)) {
    fail(`eager chunk ${file} statically imports ${CHUNK}* — it must be a dynamic (lazy) import only.`)
  }
}

// ---- Check 2: the chunk must be PRECACHE-EXCLUDED --------------------------
// vite-plugin-pwa (generateSW) inlines the precache manifest into dist/sw.js as an
// array of {url, revision} entries. A runtimeCaching route may ALSO mention the
// chunk (as a RegExp literal), so match ONLY manifest url entries here.
const swPath = ["sw.js", "service-worker.js"].map((f) => join(DIST, f)).find(existsSync)
if (swPath) {
  const sw = readFileSync(swPath, "utf8")
  if (new RegExp(`["']?url["']?\\s*:\\s*["'][^"']*${CHUNK}[^"']*\\.js["']`).test(sw)) {
    fail(`${CHUNK}* is in the Workbox precache MANIFEST (sw.js) — verify globIgnores strips it.`)
  }
} else {
  console.warn(`bundle gate (${name}): no sw.js found (PWA build skipped?) — precache check skipped.`)
}

console.log(
  `✅ bundle gate (${name}): isolated${chunks.length ? ` (async chunk: ${chunks.join(", ")})` : " (not in the bundle)"} and precache-excluded.`,
)
