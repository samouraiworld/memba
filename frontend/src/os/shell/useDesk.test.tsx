import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DEFAULT_NETWORK, NETWORKS } from "../../lib/config"
import { deskKey } from "./desk"
import { useDesk } from "./useDesk"

describe("useDesk reset", () => {
    it("drops in-memory member icons after storage is cleared without saving them back", () => {
        const address = "g103kjrkw6l0a9le0a0q0dsgy0uyt4jyha55cd4l"
        const key = deskKey(address)
        localStorage.setItem(key, JSON.stringify([{ ty: "app", ref: "feed", c: 0, r: 0 }]))
        const { result } = renderHook(() => useDesk(address, DEFAULT_NETWORK))
        expect(result.current.items).toHaveLength(1)

        localStorage.removeItem(key)
        act(() => result.current.resetFromStorage())

        expect(result.current.items).toEqual([])
        expect(localStorage.getItem(key)).toBeNull()
    })

    it("reloads pinned icons when the network changes for the same wallet", () => {
        const address = "g103kjrkw6l0a9le0a0q0dsgy0uyt4jyha55cd4l"
        const other = Object.keys(NETWORKS).find((key) => key !== DEFAULT_NETWORK)!
        localStorage.setItem(deskKey(address, DEFAULT_NETWORK), JSON.stringify([{ ty: "dao", ref: "memba_dao", c: 0, r: 0 }]))
        const { result, rerender } = renderHook(({ network }) => useDesk(address, network), { initialProps: { network: DEFAULT_NETWORK } })
        expect(result.current.items).toHaveLength(1)
        rerender({ network: other })
        expect(result.current.items).toEqual([])
        act(() => result.current.pin({ ty: "app", ref: "feed" }))
        expect(localStorage.getItem(deskKey(address, other))).toContain("feed")
        expect(localStorage.getItem(deskKey(address, DEFAULT_NETWORK))).toContain("memba_dao")
    })
})
