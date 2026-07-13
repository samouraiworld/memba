import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { runReplay } from "./sim/replay"
import { SIM_VERSION, type SimEvent } from "./sim/types"

/**
 * Cross-boundary determinism — frontend half.
 *
 * The attester's verify worker (backend/internal/arcade/worker) re-runs THIS
 * sim, esbuild-bundled, under node. These fixtures pin what that bundle produces;
 * here we assert the frontend `runReplay` reproduces the same `expected` values,
 * and the Go boundary test (runner_boundary_test.go) asserts the bundled worker
 * does too. Both green ⇒ the frontend and the attester agree byte-for-byte.
 *
 * If this fails after an intentional sim change, the sim and the committed bundle
 * have diverged: rebuild (`node backend/internal/arcade/worker/build.mjs`),
 * regenerate the expecteds, and bump SIM_VERSION per the season-cutover rule.
 */
type Fixture = {
    name: string
    job: { seed: string; simVersion: number; events: SimEvent[] }
    expected: {
        ok: true
        score: number
        waves: number
        won: boolean
        overtimeRound: number
        stateHash: string
        simVersion: number
    }
}

const fixtures = JSON.parse(
    readFileSync(
        join(import.meta.dirname, "../../../../backend/internal/arcade/worker/testdata/fixtures.json"),
        "utf8",
    ),
) as { simVersion: number; cases: Fixture[] }

describe("verify worker fixtures — frontend sim reproduces the pinned results", () => {
    it("fixtures target the current SIM_VERSION", () => {
        // A fixture set for a different sim version would silently pass/skip;
        // pin it so a SIM_VERSION bump forces a regen.
        expect(fixtures.simVersion).toBe(SIM_VERSION)
    })

    fixtures.cases.forEach((fx) => {
        it(`reproduces "${fx.name}"`, () => {
            const r = runReplay(fx.job.seed, fx.job.events)
            expect(r.score).toBe(fx.expected.score)
            expect(r.waves).toBe(fx.expected.waves)
            expect(r.won).toBe(fx.expected.won)
            expect(r.overtimeRound).toBe(fx.expected.overtimeRound)
            expect(r.stateHash).toBe(fx.expected.stateHash)
            expect(r.simVersion).toBe(fx.expected.simVersion)
        })
    })
})
