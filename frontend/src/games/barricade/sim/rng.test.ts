import { describe, expect, it } from "vitest"
import { rngInt, rngNext, seedToState } from "./rng"

describe("deterministic rng", () => {
    it("same seed -> identical sequence; different seed -> different", () => {
        let sa1 = seedToState("membas-2026-07-11")
        let sa2 = seedToState("membas-2026-07-11")
        let sb = seedToState("membas-2026-07-12")
        const seqA1: number[] = []
        const seqA2: number[] = []
        const seqB: number[] = []
        for (let i = 0; i < 100; i++) {
            sa1 = rngNext(sa1)
            seqA1.push(sa1)
            sa2 = rngNext(sa2)
            seqA2.push(sa2)
            sb = rngNext(sb)
            seqB.push(sb)
        }
        expect(seqA1).toEqual(seqA2)
        expect(seqA1).not.toEqual(seqB)
    })

    it("rngInt stays in range and threads state", () => {
        let s = seedToState("range")
        for (let i = 0; i < 1000; i++) {
            const [v, next] = rngInt(s, 3)
            expect(v).toBeGreaterThanOrEqual(0)
            expect(v).toBeLessThan(3)
            expect(next).not.toBe(s)
            s = next
        }
    })

    it("state is always a non-zero uint32", () => {
        let s = seedToState("")
        expect(s).not.toBe(0)
        for (let i = 0; i < 100; i++) {
            s = rngNext(s)
            expect(s >>> 0).toBe(s)
            expect(s).not.toBe(0)
        }
    })
})
