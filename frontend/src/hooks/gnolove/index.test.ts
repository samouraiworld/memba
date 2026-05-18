/**
 * Tests for the gnolove hooks index — visibility / export contract.
 *
 * @module hooks/gnolove/index.test
 */

import { describe, it, expect } from "vitest"
import * as gnoloveHooks from "."

describe("hooks/gnolove exports", () => {
    // useGnoloveYearReport was internal in v6.1 but the team-hub rework
    // (Phase 4) needs to layer derived hooks on top of it from new files.
    // Lock its visibility in so future refactors don't silently re-privatise it.
    it("re-exports useGnoloveYearReport for downstream layering", () => {
        expect(typeof (gnoloveHooks as Record<string, unknown>).useGnoloveYearReport).toBe("function")
    })
})
