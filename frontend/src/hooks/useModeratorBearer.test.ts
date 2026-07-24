import { describe, it, expect, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useModeratorBearer } from "./useModeratorBearer"

const KEY = "memba_feed_mod_bearer"

describe("useModeratorBearer", () => {
    beforeEach(() => {
        sessionStorage.clear()
        localStorage.clear()
    })

    it("reads the initial bearer from sessionStorage", () => {
        sessionStorage.setItem(KEY, "abc")
        const { result } = renderHook(() => useModeratorBearer())
        expect(result.current.bearer).toBe("abc")
        expect(result.current.hasBearer).toBe(true)
    })

    it("defaults to empty with no stored bearer", () => {
        const { result } = renderHook(() => useModeratorBearer())
        expect(result.current.bearer).toBe("")
        expect(result.current.hasBearer).toBe(false)
    })

    it("setBearer trims and persists to sessionStorage ONLY (never localStorage)", () => {
        const { result } = renderHook(() => useModeratorBearer())
        act(() => result.current.setBearer("  s3cret  "))
        expect(result.current.bearer).toBe("s3cret")
        expect(sessionStorage.getItem(KEY)).toBe("s3cret")
        expect(localStorage.getItem(KEY)).toBeNull() // never cross-tab / persistent
    })

    it("clearBearer removes it from sessionStorage", () => {
        sessionStorage.setItem(KEY, "abc")
        const { result } = renderHook(() => useModeratorBearer())
        act(() => result.current.clearBearer())
        expect(result.current.bearer).toBe("")
        expect(result.current.hasBearer).toBe(false)
        expect(sessionStorage.getItem(KEY)).toBeNull()
    })
})
