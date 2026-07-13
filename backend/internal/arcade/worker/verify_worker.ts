/**
 * BARRICADE verify worker — the one and only re-simulation the attester trusts.
 *
 * A Node subprocess: reads ONE job object as JSON on stdin, re-runs the exact
 * same deterministic sim the client ran, and writes ONE result object as JSON
 * on stdout. The sim source is the frontend's `runReplay` (imported below and
 * esbuild-bundled by build.mjs) — never a second port, because a re-implementation
 * is exactly where sort-stability / integer semantics diverge (Step-0 review).
 *
 * Contract:
 *   in  { seed: string, simVersion: number, events: unknown[] }
 *   out { ok: true,  score, waves, won, overtimeRound, stateHash, simVersion }
 *     | { ok: false, error: string }
 *
 * It ALWAYS writes valid JSON and exits 0 — a `{ok:false}` is a clean rejection
 * (bad input / unsupported version), never a crash. The Go runner treats a
 * non-zero exit / timeout / unparseable stdout as an infrastructure error
 * (retryable) and `{ok:false}` as a verification rejection (terminal).
 */
import { runReplay } from "../../../../frontend/src/games/barricade/sim/replay"
import { MAX_REPLAY_EVENTS } from "../../../../frontend/src/games/barricade/sim/replay"
import { SIM_VERSION, type SimEvent } from "../../../../frontend/src/games/barricade/sim/types"

type Job = { seed: string; simVersion: number; events: unknown[] }

function ok(r: {
    score: number
    waves: number
    won: boolean
    overtimeRound: number
    stateHash: string
    simVersion: number
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
    // This build is a single tagged sim version. A submission for any other
    // version must route to that version's frozen build (a future season
    // concern); here it is a hard reject so a mismatched build can never
    // silently attest a wrong result.
    if (job.simVersion !== SIM_VERSION) {
        return fail(`unsupported simVersion: worker build is v${SIM_VERSION}`)
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
    const r = runReplay(job.seed, job.events as SimEvent[])
    return ok({
        score: r.score,
        waves: r.waves,
        won: r.won,
        overtimeRound: r.overtimeRound,
        stateHash: r.stateHash,
        simVersion: r.simVersion,
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
