import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import type { OsSession } from "../shell/useOsSession"
import { useSigner } from "./signerContext"
import { SignerProvider } from "./SignerProvider"

const request = {
    title: "Vote", summary: "Vote on a proposal", lines: () => [], label: () => "Vote",
    prepare: () => ({ msgs: [] }), send: vi.fn(),
}

function OpenReview() {
    const signer = useSigner()
    return <button type="button" onClick={() => signer.sign(request)}>Open review</button>
}

const session = (status: "member" | "guest") => ({
    status, network: { chainId: "gnoland-1" }, walletChainId: "gnoland-1", openConnect: vi.fn(),
}) as unknown as OsSession

describe("OS signing session boundary", () => {
    it("disables an already-open review when the member session ends", () => {
        const toast = vi.fn()
        const { rerender } = render(<SignerProvider session={session("member")} toast={toast}><OpenReview /></SignerProvider>)
        fireEvent.click(screen.getByRole("button", { name: "Open review" }))
        expect(screen.getByRole("button", { name: "Sign in Adena" })).toBeEnabled()
        rerender(<SignerProvider session={session("guest")} toast={toast}><OpenReview /></SignerProvider>)
        expect(screen.getByRole("alert")).toHaveTextContent("session ended")
        expect(screen.getByRole("button", { name: "Sign in Adena" })).toBeDisabled()
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
        expect(screen.queryByRole("dialog", { name: "Review · Vote" })).toBeNull()
        expect(request.send).not.toHaveBeenCalled()
    })
})
