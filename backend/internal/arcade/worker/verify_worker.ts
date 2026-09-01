/**
 * Arcade verify worker — the one and only re-simulation the attester trusts.
 * ONE bundle, multiple games: it dispatches on `job.game` (BARRICADE and
 * Space Invaders today; a missing/empty game is grandfathered as BARRICADE,
 * the pre-multigame job shape).
 *
 * A Node subprocess: reads ONE job object as JSON on stdin, re-runs the exact
 * same deterministic sim the client ran, and writes ONE result object as JSON
 * on stdout. Each game's sim source is the frontend's own module (imported
 * below and esbuild-bundled by build.mjs) — never a second port, because a
 * re-implementation is exactly where sort-stability / integer semantics
 * diverge (Step-0 review).
 *
 * Contract:
 *   in  { game?: string, seed: string, simVersion: number, finalTick?: number, events: unknown[] }
 *   out { ok: true,  score, waves, won, overtimeRound, stateHash, simVersion, stats?, logHash }
 *     | { ok: false, error: string }
 *
 * It ALWAYS writes valid JSON and exits 0 — a `{ok:false}` is a clean rejection
 * (bad input / unsupported version / unknown game), never a crash. The Go
 * runner treats a non-zero exit / timeout / unparseable stdout as an
 * infrastructure error (retryable) and `{ok:false}` as a verification
 * rejection (terminal).
 */
import { createHash } from "node:crypto"
import { canonicalLog, MAX_REPLAY_EVENTS, runReplay } from "../../../../frontend/src/games/barricade/sim/replay"
import { SIM_VERSION, type SimEvent } from "../../../../frontend/src/games/barricade/sim/types"
import { REPLAY_VERSION, type InputDelta } from "../../../../frontend/src/games/space-invaders/lib/replay"
import { simulateReplay } from "../../../../frontend/src/games/space-invaders/lib/verify"

type Job = { game?: string; seed: string; simVersion: number; finalTick?: number; events: unknown[] }

/** Space Invaders sim version this build re-simulates. Tracks the engine +
 *  its replay wire format (REPLAY_VERSION); bump BOTH on a behavior change. */
const INVADERS_SIM_VERSION = 1

/** Space Invaders caps — mirror MaxEventsInvaders / MaxFinalTick in
 *  backend/internal/arcade/validate.go (the Go gate runs first; these are the
 *  worker's own defense in depth for direct callers). The binding constraint
 *  is their PRODUCT: simulateReplay's inputAtTick scans the delta list per
 *  tick (O(finalTick × deltas)), so raising either cap needs a re-benchmark
 *  against the 20s runner timeout — see validate.go for the numbers. */
const MAX_INVADERS_EVENTS = 10_000
const MAX_FINAL_TICK = 216_000

function ok(r: {
    score: number
    waves: number
    won?: boolean
    overtimeRound?: number
    stateHash: string
    simVersion: number
    stats?: string
    logHash: string
}): string {
    return JSON.stringify({ ok: true, ...r })
}

function fail(error: string): string {
    return JSON.stringify({ ok: false, error })
}

/** Pure job→result: no I/O, so the boundary is testable without a process. */
export function processJob(raw: string): string {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return fail("invalid json")
    }
    if (typeof parsed !== "object" || parsed === null) {
        return fail("job must be an object")
    }
    const job = parsed as Partial<Job>
    if (typeof job.seed !== "string" || job.seed.length === 0) {
        return fail("seed must be a non-empty string")
    }
    const game = job.game === undefined || job.game === "" ? "barricade" : job.game
    switch (game) {
        case "barricade":
            return processBarricade(job)
        case "invaders":
            return processInvaders(job)
        default:
            return fail(`unknown game: ${String(game)}`)
    }
}

/**
 * BARRICADE — byte-identical to the single-game worker: same checks, same
 * runReplay, and the SAME logHash preimage `seed + "\n" + canonicalLog(events)`
 * (the pinned loop/fixture tests prove it never drifts). The only addition is
 * refusing a stray finalTick, which is not a BARRICADE concept.
 */
function processBarricade(job: Partial<Job>): string {
    // This build is a single tagged sim version per game. A submission for any
    // other version must route to that version's frozen build (a future season
    // concern); here it is a hard reject so a mismatched build can never
    // silently attest a wrong result.
    if (job.simVersion !== SIM_VERSION) {
        return fail(`unsupported simVersion: worker build is v${SIM_VERSION}`)
    }
    if (job.finalTick !== undefined && job.finalTick !== 0) {
        return fail("finalTick is not a barricade field")
    }
    if (!Array.isArray(job.events)) {
        return fail("events must be an array")
    }
    // Defense in depth: runReplay itself truncates + sanitizes, but reject a log
    // that is already over the cap so the payload can't smuggle unbounded bytes
    // past a caller that skipped the size check.
    if (job.events.length > MAX_REPLAY_EVENTS) {
        return fail(`too many events: ${job.events.length} > ${MAX_REPLAY_EVENTS}`)
    }
    const events = job.events as SimEvent[]
    const r = runReplay(job.seed as string, events)
    // The certify commitment binds the SEED and the CANONICAL sanitized log (the
    // exact stream the sim consumed) — never the raw request bytes. Binding the
    // seed keeps two identical logs on different seeds distinct (e.g. two empty
    // runs on different days must not collide in the realm's global hashOwners),
    // while a theft — a valid log copied for the SAME shared daily seed — still
    // collides and is caught. Hashed here (Node) because the sim runs sync in the
    // browser too, where sha256 isn't synchronous. The seed charset (validated
    // backend-side) excludes '\n', so the separator is unambiguous.
    const logHash = createHash("sha256")
        .update((job.seed as string) + "\n" + canonicalLog(events))
        .digest("hex")
    return ok({
        score: r.score,
        waves: r.waves,
        won: r.won,
        overtimeRound: r.overtimeRound,
        stateHash: r.stateHash,
        simVersion: r.simVersion,
        logHash,
    })
}

/**
 * fnv1aSeed — the SHARED Space Invaders seed derivation: FNV-1a (32-bit) over
 * the seed STRING's UTF-8 bytes → the engine's numeric uint32 seed.
 *
 * ⚠ CROSS-IMPLEMENTATION CONTRACT: the frontend client (M3) MUST derive its
 * engine seed with this exact function, and the Go spec twin
 * (backend/internal/arcade/validate.go invadersEngineSeed) pins reference
 * vectors in TestInvadersEngineSeed_Vectors — e.g.
 * "invaders-2026-07-13" → 3389276757. If any copy drifts, the re-simulated
 * stateHash stops matching the client's claim and every submission rejects.
 */
function fnv1aSeed(seed: string): number {
    let h = 0x811c9dc5
    const bytes = Buffer.from(seed, "utf8")
    for (const b of bytes) {
        h = Math.imul(h ^ b, 0x01000193) >>> 0
    }
    return h >>> 0
}

/**
 * canonicalInvadersLog — the canonical, byte-representation-invariant string
 * for a Space Invaders input log: the finalTick then each sanitized delta as
 * `tick|move10|fire|pause`, ';'-joined. finalTick is BOUND INTO the
 * commitment: the same deltas run to a different tick count are a different
 * run (the sim keeps scoring after the last input).
 */
function canonicalInvadersLog(finalTick: number, deltas: number[][]): string {
    const lines = deltas.map((d) => `${d[0]}|${d[1]}|${d[2]}|${d[3]}`)
    return [String(finalTick), ...lines].join(";")
}

/**
 * Space Invaders — re-simulate a delta-encoded input log with the frontend's
 * own engine (simulateReplay from lib/verify). The wire format is STRICT
 * (reject, never repair — an M3 client always produces it exactly):
 *
 *   events: 4-int tuples [tick, move10, fire, pause]
 *     tick    ∈ [0, finalTick), strictly increasing across tuples
 *     move10  ∈ [-10, 10]   → engine move = move10 / 10 (the client must
 *                             QUANTIZE its live input the same way, or replay
 *                             and live diverge)
 *     fire    ∈ {0, 1}
 *     pause   ∈ {0, 1}
 *
 * stateHash is the engine's fnv1a state digest as 8 lowercase hex chars
 * (zero-padded) — the client's claimedHash must format it identically.
 */
function processInvaders(job: Partial<Job>): string {
    if (job.simVersion !== INVADERS_SIM_VERSION) {
        return fail(`unsupported simVersion: invaders worker build is v${INVADERS_SIM_VERSION}`)
    }
    const finalTick = job.finalTick
    if (typeof finalTick !== "number" || !Number.isInteger(finalTick) || finalTick <= 0) {
        return fail("finalTick must be a positive integer")
    }
    if (finalTick > MAX_FINAL_TICK) {
        return fail(`finalTick too large: ${finalTick} > ${MAX_FINAL_TICK}`)
    }
    if (!Array.isArray(job.events)) {
        return fail("events must be an array")
    }
    if (job.events.length > MAX_INVADERS_EVENTS) {
        return fail(`too many events: ${job.events.length} > ${MAX_INVADERS_EVENTS}`)
    }

    const deltas: number[][] = []
    let lastTick = -1
    for (let i = 0; i < job.events.length; i++) {
        const e = job.events[i]
        if (!Array.isArray(e) || e.length !== 4) {
            return fail(`event ${i}: must be a [tick, move10, fire, pause] tuple`)
        }
        const [tick, move10, fire, pause] = e as unknown[]
        if (
            typeof tick !== "number" || !Number.isInteger(tick) ||
            typeof move10 !== "number" || !Number.isInteger(move10) ||
            typeof fire !== "number" || !Number.isInteger(fire) ||
            typeof pause !== "number" || !Number.isInteger(pause)
        ) {
            return fail(`event ${i}: all tuple fields must be integers`)
        }
        if (tick < 0 || tick >= finalTick) {
            return fail(`event ${i}: tick ${tick} out of range [0, ${finalTick})`)
        }
        if (tick <= lastTick) {
            return fail(`event ${i}: ticks must be strictly increasing`)
        }
        if (move10 < -10 || move10 > 10) {
            return fail(`event ${i}: move10 ${move10} out of range [-10, 10]`)
        }
        if ((fire !== 0 && fire !== 1) || (pause !== 0 && pause !== 1)) {
            return fail(`event ${i}: fire/pause must be 0 or 1`)
        }
        lastTick = tick
        deltas.push([tick, move10, fire, pause])
    }

    const inputs: InputDelta[] = deltas.map((d) => ({
        tick: d[0],
        move: d[1] / 10,
        fire: d[2] === 1,
        pause: d[3] === 1,
    }))
    const r = simulateReplay({
        version: REPLAY_VERSION,
        seed: fnv1aSeed(job.seed as string),
        finalTick,
        inputs,
    })
    // Same commitment recipe as BARRICADE: sha256 over the seed and the
    // canonical (JSON-independent) log — with the finalTick bound in, since the
    // run's identity includes how long it ran.
    const logHash = createHash("sha256")
        .update((job.seed as string) + "\n" + canonicalInvadersLog(finalTick, deltas))
        .digest("hex")
    // Honest per-game display stats from the terminal GameState: the wave
    // reached and the shots/hits tally (the accuracy story). Never ranked —
    // the realm stores the blob opaquely and reads echo it.
    const stats = JSON.stringify({ wave: r.state.wave, shots: r.state.shots, hits: r.state.hits })
    return ok({
        score: r.score,
        waves: r.state.wave, // the cross-game "how far" display number
        stateHash: r.hash.toString(16).padStart(8, "0"),
        simVersion: INVADERS_SIM_VERSION,
        stats,
        logHash,
    })
}

function readStdin(): Promise<string> {
    return new Promise((resolve) => {
        let input = ""
        process.stdin.setEncoding("utf8")
        process.stdin.on("data", (chunk) => {
            input += chunk
        })
        process.stdin.on("end", () => resolve(input))
    })
}

async function main(): Promise<void> {
    let out: string
    try {
        out = processJob(await readStdin())
    } catch (e) {
        // A genuine sim crash on an input the sanitizer somehow let through:
        // still emit clean JSON so the runner classifies it, not a raw stack.
        out = fail("verify crashed: " + (e instanceof Error ? e.message : String(e)))
    }
    process.stdout.write(out)
    process.exit(0)
}

void main()
