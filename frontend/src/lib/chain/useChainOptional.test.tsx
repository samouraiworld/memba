/**
 * useChainOptional — the B-5 migration access pattern (Phase 2b).
 * Two branches: flag on → the mounted context; flag off → null even if a
 * context were mounted (the guarantee that keeps prod byte-identical should
 * the provider ever be mounted by mistake).
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { useChainOptional, ChainContext, type ChainContextValue } from "./context"
import * as config from "../config"

const FAKE = { provider: { family: "gno" }, family: "gno" } as unknown as ChainContextValue
const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ChainContext.Provider, { value: FAKE }, children)

afterEach(() => vi.restoreAllMocks())

describe("useChainOptional", () => {
    it("returns the mounted context when the CAL flag is on", () => {
        vi.spyOn(config, "isCalEnabled").mockReturnValue(true)
        const { result } = renderHook(() => useChainOptional(), { wrapper })
        expect(result.current).toBe(FAKE)
    })

    it("returns null when the flag is off — even with a provider mounted", () => {
        vi.spyOn(config, "isCalEnabled").mockReturnValue(false)
        const { result } = renderHook(() => useChainOptional(), { wrapper })
        expect(result.current).toBeNull()
    })

    it("returns null when no provider is mounted regardless of flag", () => {
        vi.spyOn(config, "isCalEnabled").mockReturnValue(true)
        const { result } = renderHook(() => useChainOptional())
        expect(result.current).toBeNull()
    })
})
