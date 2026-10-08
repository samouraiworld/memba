import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ADENA_NO_ANSWER_MESSAGE } from "../../lib/adenaCall"
import { ConnectModal } from "./ConnectModal"
import type { OsSession } from "./useOsSession"

function session(over: Partial<OsSession>): OsSession {
    return {
        stage: "pick", error: null, errorKind: null, slow: false, noPopup: false, note: null,
        walletChainId: "", walletAddress: "", network: { chainId: "gnoland-1" },
        activationForced: false, activationCost: null, activationPriceEstimated: false, noFunds: false, balanceUnknown: false, balanceError: null,
        cancel: vi.fn(), chooseAdena: vi.fn(), recheck: vi.fn(), signIn: vi.fn(), activate: vi.fn(), switchWallet: vi.fn(), refreshBalance: vi.fn(),
        ...over,
    } as unknown as OsSession
}

const SLOW_HINT = "The Adena window may be behind this one or on another screen — click the Adena icon in your toolbar."

const realLocation = window.location
function stubReload() {
    const reload = vi.fn()
    Object.defineProperty(window, "location", { value: { ...realLocation, reload }, configurable: true, writable: true })
    return reload
}
afterEach(() => {
    Object.defineProperty(window, "location", { value: realLocation, configurable: true, writable: true })
})

describe("ConnectModal · waiting on Adena", () => {
    it("says it is opening Adena before any window was asked for", () => {
        render(<ConnectModal session={session({ stage: "waking" })} />)
        expect(screen.getByRole("heading", { name: "Opening Adena…" })).toBeInTheDocument()
        expect(screen.queryByRole("heading", { name: "Approve in Adena" })).toBeNull()
    })

    it("asks to approve with no hint at first, then says where the window may be after 3 s", () => {
        const { rerender } = render(<ConnectModal session={session({ stage: "approve" })} />)
        expect(screen.getByRole("heading", { name: "Approve in Adena" })).toBeInTheDocument()
        expect(screen.queryByText(SLOW_HINT)).toBeNull()
        rerender(<ConnectModal session={session({ stage: "approve", slow: true })} />)
        expect(screen.getByText(SLOW_HINT)).toBeInTheDocument()
        rerender(<ConnectModal session={session({ stage: "loginwait", slow: true })} />)
        expect(screen.getByText(SLOW_HINT)).toBeInTheDocument()
    })

    it("says Adena hasn't answered and offers a tab reload when its window never seemed to open", () => {
        const reload = stubReload()
        render(<ConnectModal session={session({ stage: "approve", slow: true, noPopup: true })} />)
        expect(screen.getByText("Adena hasn’t answered")).toBeInTheDocument()
        expect(screen.queryByText(SLOW_HINT)).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Reload tab" }))
        expect(reload).toHaveBeenCalledOnce()
    })

    it("offers a tab reload with the no-answer error, and only with it", () => {
        const reload = stubReload()
        const { rerender } = render(<ConnectModal session={session({ stage: "pick", error: ADENA_NO_ANSWER_MESSAGE, errorKind: "no-answer" })} />)
        expect(screen.getByRole("alert")).toHaveTextContent(ADENA_NO_ANSWER_MESSAGE)
        fireEvent.click(screen.getByRole("button", { name: "Reload tab" }))
        expect(reload).toHaveBeenCalledOnce()
        rerender(<ConnectModal session={session({ stage: "pick", error: "Adena didn't connect. Approve Memba in the Adena window, then try again." })} />)
        expect(screen.queryByRole("button", { name: "Reload tab" })).toBeNull()
    })
})
