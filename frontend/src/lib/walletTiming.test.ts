import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { __resetWalletDebug } from "./walletDebug"
import { startWalletFlow } from "./walletTiming"

const log = () => ((window as unknown as { __membaWalletLog?: () => Array<{ event: string; detail?: string }> }).__membaWalletLog?.() ?? [])

beforeEach(() => {
    localStorage.setItem("memba_wallet_debug", "1")
    __resetWalletDebug()
    performance.clearMeasures()
})
afterEach(() => {
    localStorage.removeItem("memba_wallet_debug")
    __resetWalletDebug()
})

describe("startWalletFlow", () => {
    it("measures each step from the flow's start and logs it, then ignores steps after the end", () => {
        const flow = startWalletFlow("connect")
        flow.step("click")
        flow.step("account")
        expect(performance.getEntriesByType("measure").map((m) => m.name)).toEqual(["memba:wallet:connect:click", "memba:wallet:connect:account"])
        flow.end("connected")
        flow.step("late")
        expect(log().filter((e) => e.event === "timing").map((e) => e.detail?.replace(/\+\d+ms$/, ""))).toEqual([
            "connect click ", "connect account ", "connect end:connected ",
        ])
    })

    it("clears the flow's marks and measures when it ends", () => {
        performance.clearMarks()
        const flow = startWalletFlow("connect")
        flow.step("click")
        flow.end("connected")
        const ours = (type: string) => performance.getEntriesByType(type).filter((e) => e.name.startsWith("memba:wallet:connect"))
        expect(ours("mark")).toEqual([])
        expect(ours("measure")).toEqual([])
    })

    it("keeps the flow going when the Performance API is missing", () => {
        const real = performance.mark
        ;(performance as unknown as { mark: unknown }).mark = undefined
        try {
            const flow = startWalletFlow("sign-in")
            expect(() => { flow.step("click"); flow.end("token") }).not.toThrow()
        } finally {
            performance.mark = real
        }
    })
})
