import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_NETWORK } from "../../lib/config"
import { FEATURED_DESK, loadDesk } from "./desk"

afterEach(() => localStorage.clear())

describe("guest desk on an EVM network", () => {
    it("starts empty: the featured desk is gno.land's DAOs and Arcade", () => {
        expect(loadDesk(null, "base-sepolia")).toEqual([])
        expect(loadDesk(null, DEFAULT_NETWORK)).toEqual(FEATURED_DESK)
    })
})
