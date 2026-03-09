/**
 * Unit tests for realm address derivation.
 *
 * Validates our client-side bech32 derivation from pkgPath preimage.
 * The formula is: SHA256("pkgPath:" + realmPath) → first 20 bytes → bech32("g", ...)
 *
 * NOTE: Some DAOs may have addresses derived differently (e.g., deployer-based).
 * For production use, we also support querying `auth/accounts/` as fallback.
 *
 * @module lib/dao/realmAddress.test
 */
import { describe, test, expect } from "vitest"
import { derivePkgBech32Addr } from "./realmAddress"

describe("derivePkgBech32Addr", () => {
    test("produces a valid g1-prefixed bech32 address", async () => {
        const addr = await derivePkgBech32Addr("gno.land/r/gov/dao/v2")
        expect(addr).toMatch(/^g1[a-z0-9]+$/)
    })

    test("address is 40 characters (g1 HRP + 38 data chars)", async () => {
        const addr = await derivePkgBech32Addr("gno.land/r/gov/dao/v2")
        expect(addr.length).toBe(40)
    })

    test("address is deterministic", async () => {
        const addr1 = await derivePkgBech32Addr("gno.land/r/test/realm")
        const addr2 = await derivePkgBech32Addr("gno.land/r/test/realm")
        expect(addr1).toBe(addr2)
    })

    test("different realm paths produce different addresses", async () => {
        const addr1 = await derivePkgBech32Addr("gno.land/r/foo/bar")
        const addr2 = await derivePkgBech32Addr("gno.land/r/baz/qux")
        expect(addr1).not.toBe(addr2)
    })

    test("custom HRP works", async () => {
        const addr = await derivePkgBech32Addr("gno.land/r/gov/dao/v2", "cosmos")
        expect(addr).toMatch(/^cosmos1/)
    })

    test("various realm paths all produce valid addresses", async () => {
        const paths = [
            "gno.land/r/gov/dao",
            "gno.land/r/demo/users",
            "gno.land/r/samcrew/samourai_dao",
            "gno.land/r/gnoswap/pool",
        ]
        for (const p of paths) {
            const addr = await derivePkgBech32Addr(p)
            expect(addr).toMatch(/^g1[a-z0-9]{38}$/)
        }
    })

    test("empty path still produces a valid address", async () => {
        const addr = await derivePkgBech32Addr("")
        expect(addr).toMatch(/^g1/)
    })
})
