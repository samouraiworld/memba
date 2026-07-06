#!/usr/bin/env node
// Public seed verification script for Block Party.
//
// Anyone can run this against a PUBLIC Gno RPC node to independently re-derive
// today's (or any date's) Block Party seed/board and confirm the backend did
// not hand-pick it. It reproduces, byte-for-byte, the derivation implemented
// in the Go backend:
//
//   backend/internal/blockparty/seed.go        (DeriveSeed, DeriveModifier, DerivePar)
//   backend/internal/blockparty/blockselect.go (SelectDailyBlock)
//   backend/internal/blockparty/budget.go      (MoveBudget)
//
// Zero dependencies: only Node's built-in `fetch` and `node:crypto`.
//
// Usage:
//   node scripts/verify-blockparty-seed.mjs [--date YYYY-MM-DD] [--rpc <url>]
//   node scripts/verify-blockparty-seed.mjs --selftest
//
// Defaults: --date = today (UTC), --rpc = https://rpc.test13.testnets.gno.land

import { createHash } from "node:crypto";

const DEFAULT_RPC = "https://rpc.test13.testnets.gno.land";

// ---------------------------------------------------------------------------
// Derivation (must match backend/internal/blockparty exactly)
// ---------------------------------------------------------------------------

/**
 * DeriveSeed = SHA256(blockHash + "blockparty:" + date), first 4 bytes,
 * interpreted big-endian, as an unsigned 32-bit integer.
 * Mirrors seed.go:DeriveSeed.
 */
function deriveSeed(blockHash, date) {
  const digest = createHash("sha256")
    .update(blockHash + "blockparty:" + date, "utf8")
    .digest();
  return digest.readUInt32BE(0);
}

const MODIFIERS = ["standard", "doubles", "rush"];

/** Mirrors seed.go:DeriveModifier. */
function deriveModifier(seed) {
  return MODIFIERS[Number(seed % BigInt(MODIFIERS.length))];
}

/** Mirrors seed.go:DerivePar. Range 1000..2999. */
function derivePar(seed) {
  return 1000n + (seed % 2000n);
}

/** Mirrors budget.go:MoveBudget. */
function moveBudget(modifier) {
  return modifier === "rush" ? 24 : 30;
}

// ---------------------------------------------------------------------------
// Chain access (must match backend/internal/service/blockparty_chain.go)
// ---------------------------------------------------------------------------

async function rpcGet(rpcUrl, path) {
  const url = rpcUrl.replace(/\/+$/, "") + path;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`RPC ${path} failed: HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Chain tip height, via /status -> result.sync_info.latest_block_height. */
async function latestHeight(rpcUrl) {
  const body = await rpcGet(rpcUrl, "/status");
  const raw = body?.result?.sync_info?.latest_block_height;
  if (raw === undefined || raw === null) {
    throw new Error("/status response missing result.sync_info.latest_block_height");
  }
  const height = BigInt(raw);
  return height;
}

/**
 * Block hash + header time at a given height, via /block?height=N ->
 * result.block_id.hash / result.block.header.time (RFC3339).
 *
 * NOTE: the backend's httpBlockFetcher (blockparty_chain.go) reads
 * result.block_id.hash, but the live test13 node actually nests it under
 * result.block_meta.block_id.hash (top-level block_id is absent). We check
 * both here so this script works against the real node; see
 * scripts/VERIFY_BLOCKPARTY.md for the flagged backend discrepancy.
 */
async function blockAt(rpcUrl, height) {
  const body = await rpcGet(rpcUrl, `/block?height=${height}`);
  const hash = body?.result?.block_id?.hash ?? body?.result?.block_meta?.block_id?.hash;
  const timeStr = body?.result?.block?.header?.time;
  if (!hash || !timeStr) {
    throw new Error(`/block?height=${height} response missing block_id.hash (or block_meta.block_id.hash) or block.header.time`);
  }
  const time = new Date(timeStr);
  if (Number.isNaN(time.getTime())) {
    throw new Error(`/block?height=${height} has unparseable header.time: ${timeStr}`);
  }
  return { height, hash, time };
}

/** Raised when the day's qualifying block does not exist yet (chain tip is before midnight). */
class NotReadyError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotReadyError";
  }
}

/**
 * SelectDailyBlock: the lowest height whose header time is >= 00:00:00Z of
 * `date`. Binary search over the chain, mirroring blockselect.go exactly
 * (same midpoint formula, same >=/< comparison, same not-ready conditions).
 */
async function selectDailyBlock(rpcUrl, date) {
  const midnight = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(midnight.getTime())) {
    throw new Error(`invalid --date "${date}", expected YYYY-MM-DD`);
  }

  const latest = await latestHeight(rpcUrl);
  if (latest < 1n) {
    throw new NotReadyError("chain has no blocks yet");
  }

  const top = await blockAt(rpcUrl, latest);
  if (top.time.getTime() < midnight.getTime()) {
    throw new NotReadyError(
      `not ready: chain tip (height ${latest}, ${top.time.toISOString()}) is still before ` +
        `${midnight.toISOString()} — today's block hasn't been mined yet`
    );
  }

  // binary search for the lowest height with time >= midnight
  let lo = 1n;
  let hi = latest;
  let answer = null;
  const cache = new Map();
  const getBlock = async (h) => {
    if (!cache.has(h)) cache.set(h, await blockAt(rpcUrl, h));
    return cache.get(h);
  };

  while (lo <= hi) {
    const mid = lo + (hi - lo) / 2n;
    const b = await getBlock(mid);
    if (b.time.getTime() >= midnight.getTime()) {
      answer = b;
      hi = mid - 1n;
    } else {
      lo = mid + 1n;
    }
  }

  if (!answer) {
    throw new NotReadyError("not ready: no qualifying block found");
  }
  return answer;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const args = { date: todayUTC(), rpc: DEFAULT_RPC, selftest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date") {
      args.date = argv[++i];
    } else if (a === "--rpc") {
      args.rpc = argv[++i];
    } else if (a === "--selftest") {
      args.selftest = true;
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Block Party public seed verification

Usage:
  node scripts/verify-blockparty-seed.mjs [--date YYYY-MM-DD] [--rpc <url>]
  node scripts/verify-blockparty-seed.mjs --selftest

Options:
  --date YYYY-MM-DD   Date to derive the challenge for (default: today, UTC)
  --rpc <url>         Public Gno RPC base URL (default: ${DEFAULT_RPC})
  --selftest          Run a hardcoded known-vector check against the Go
                       derivation and exit, without any network access
  --help              Show this help
`);
}

// Known vector, computed once from the Go implementation
// (backend/internal/blockparty/seed.go) for hash="ABC123", date="2026-07-06".
// If this ever fails, the JS derivation has drifted from the Go source of
// truth and MUST be fixed before trusting any live output below.
const SELFTEST_VECTOR = {
  hash: "ABC123",
  date: "2026-07-06",
  expectedSeed: 4207658137n,
  expectedModifier: "doubles",
  expectedPar: 1137n,
};

function runSelftest() {
  const { hash, date, expectedSeed, expectedModifier, expectedPar } = SELFTEST_VECTOR;
  const seed = BigInt(deriveSeed(hash, date));
  const modifier = deriveModifier(seed);
  const par = derivePar(seed);

  const checks = [
    ["seed", seed, expectedSeed],
    ["modifier", modifier, expectedModifier],
    ["par", par, expectedPar],
  ];

  let ok = true;
  for (const [label, got, want] of checks) {
    const pass = got === want;
    ok = ok && pass;
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}: got=${got} want=${want}`);
  }

  if (!ok) {
    console.error("\nSELFTEST FAILED — the JS derivation no longer matches seed.go. Do not trust live output.");
    process.exit(1);
  }
  console.log("\nSELFTEST OK — derivation matches the known Go-computed vector.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.selftest) {
    runSelftest();
    return;
  }

  console.log("Block Party — public seed verification");
  console.log("========================================");
  console.log(`date        : ${args.date}`);
  console.log(`rpc         : ${args.rpc}`);
  console.log("");

  let block;
  try {
    block = await selectDailyBlock(args.rpc, args.date);
  } catch (err) {
    if (err instanceof NotReadyError) {
      console.log(`NOT READY: ${err.message}`);
      console.log("\nToday's board has not been minted onto the chain yet. Try again shortly,");
      console.log("or check back after 00:00:00 UTC has actually elapsed on-chain (block time,");
      console.log("not wall-clock time).");
      process.exitCode = 2;
      return;
    }
    console.error(`ERROR: could not reach or parse response from RPC "${args.rpc}"`);
    console.error(`       ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const seed = BigInt(deriveSeed(block.hash, args.date));
  const modifier = deriveModifier(seed);
  const par = derivePar(seed);
  const budget = moveBudget(modifier);

  console.log("Selected block (lowest height with header.time >= 00:00:00Z of date):");
  console.log(`  blockHeight : ${block.height}`);
  console.log(`  blockHash   : ${block.hash}`);
  console.log(`  blockTime   : ${block.time.toISOString()}`);
  console.log("");
  console.log("Derived challenge (must match GetDailyChallenge RPC response):");
  console.log(`  seed        : ${seed}`);
  console.log(`  modifier    : ${modifier}`);
  console.log(`  par         : ${par}`);
  console.log(`  moveBudget  : ${budget}`);
  console.log("");
  console.log("Compare the seed / blockHeight / blockHash / modifier / par / moveBudget above");
  console.log("against the values returned by the backend's GetDailyChallenge RPC for the same");
  console.log("date. A match proves the board came from this public, unpickable chain state —");
  console.log("see scripts/VERIFY_BLOCKPARTY.md for exactly what this does and does not prove.");
}

main().catch((err) => {
  console.error("UNEXPECTED ERROR:", err.stack || err.message || err);
  process.exitCode = 1;
});
