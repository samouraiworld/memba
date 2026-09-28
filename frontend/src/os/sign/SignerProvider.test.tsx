import { describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { readGovernanceReceipt, saveGovernanceReceipt } from "../../lib/dao/governanceRecovery"
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

const session = (status: "member" | "guest", address = "g1alpha") => ({
    status, address, network: { chainId: "gnoland-1" }, walletChainId: "gnoland-1", openConnect: vi.fn(),
}) as unknown as OsSession

describe("OS signing session boundary", () => {
    it("releases a durable governance receipt after chain verification succeeds", async () => {
        const receipt = { chainId: "gnoland-1", realmPath: "gno.land/r/test/dao", caller: "g1alpha", operation: "vote:51" }
        const verified = {
            ...request,
            receipt,
            send: vi.fn(async () => ({ hash: "CONFIRMED_HASH" })),
            verify: vi.fn(async () => true),
        }
        function ConfirmedReview() {
            const signer = useSigner()
            return <button type="button" onClick={() => signer.sign(verified)}>Open confirmed review</button>
        }
        render(<SignerProvider session={session("member")} toast={vi.fn()}><ConfirmedReview /></SignerProvider>)
        fireEvent.click(screen.getByRole("button", { name: "Open confirmed review" }))
        fireEvent.click(screen.getByRole("button", { name: "Sign in Adena" }))
        await waitFor(() => expect(verified.verify).toHaveBeenCalledOnce())
        await waitFor(() => expect(readGovernanceReceipt(receipt)).toBeNull())
    })

    it("retains a confirmed proposal ID after verification so a reload remains locked", async () => {
        const receipt = { chainId: "gnoland-1", realmPath: "gno.land/r/test/dao", caller: "g1alpha", operation: "proposal" }
        const verified = {
            ...request,
            receipt,
            retainConfirmedReceipt: true,
            send: vi.fn(async () => ({ hash: "PROPOSAL_HASH" })),
            verify: vi.fn(async () => {
                saveGovernanceReceipt(receipt, { phase: "confirmed", hash: "PROPOSAL_HASH", label: "Proposal", proposalId: 2 })
                return true
            }),
        }
        function ConfirmedProposal() {
            const signer = useSigner()
            return <button type="button" onClick={() => signer.sign(verified)}>Open proposal review</button>
        }
        render(<SignerProvider session={session("member")} toast={vi.fn()}><ConfirmedProposal /></SignerProvider>)
        fireEvent.click(screen.getByRole("button", { name: "Open proposal review" }))
        fireEvent.click(screen.getByRole("button", { name: "Sign in Adena" }))
        await waitFor(() => expect(verified.verify).toHaveBeenCalledOnce())
        await waitFor(() => expect(readGovernanceReceipt(receipt)).toMatchObject({ phase: "confirmed", proposalId: 2 }))
    })

    it("contains transaction review focus and returns it to the invoking control", async () => {
        const { container } = render(<SignerProvider session={session("member")} toast={vi.fn()}>
            <div className="memba-os"><main className="os-desk"><OpenReview /></main></div>
        </SignerProvider>)
        const opener = screen.getByRole("button", { name: "Open review" })
        opener.focus()
        fireEvent.click(opener)
        const dialog = screen.getByRole("dialog", { name: "Review · Vote" })
        expect(dialog).toHaveFocus()
        expect(container.querySelector(".os-desk")).toHaveAttribute("inert")
        expect(container.querySelector(".os-desk")).toHaveAttribute("aria-hidden", "true")
        const stops = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]')]
        fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })
        expect(stops.at(-1)).toHaveFocus()
        fireEvent.keyDown(dialog, { key: "Tab" })
        expect(stops[0]).toHaveFocus()
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
        await waitFor(() => expect(opener).toHaveFocus())
        expect(container.querySelector(".os-desk")).not.toHaveAttribute("inert")
    })

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

    it("does not open the old member's wallet or report their result after an account switch", async () => {
        let finishRecheck!: () => void
        const recheck = new Promise<void>((resolve) => { finishRecheck = resolve })
        const afterPreflight = vi.fn()
        const onSettled = vi.fn()
        const onNothingSent = vi.fn()
        const oldRequest = {
            ...request,
            recheck: () => recheck,
            send: vi.fn(async (_choice: string | undefined, beforeSign: () => Promise<void>) => {
                await beforeSign()
                afterPreflight()
                return { hash: "old-hash" }
            }),
            onSettled,
            onNothingSent,
        }
        function OldReview() {
            const signer = useSigner()
            return <button type="button" onClick={() => signer.sign(oldRequest)}>Open old review</button>
        }
        const toast = vi.fn()
        const { rerender } = render(<SignerProvider key="gnoland-1:g1alpha" session={session("member", "g1alpha")} toast={toast}><OldReview /></SignerProvider>)
        fireEvent.click(screen.getByRole("button", { name: "Open old review" }))
        fireEvent.click(screen.getByRole("button", { name: "Sign in Adena" }))
        await waitFor(() => expect(oldRequest.send).toHaveBeenCalledOnce())
        rerender(<SignerProvider key="gnoland-1:g1beta" session={session("member", "g1beta")} toast={toast}><OpenReview /></SignerProvider>)
        await act(async () => { finishRecheck(); await recheck })
        expect(afterPreflight).not.toHaveBeenCalled()
        expect(onNothingSent).toHaveBeenCalledOnce()
        expect(onSettled).not.toHaveBeenCalled()
        expect(screen.queryByRole("dialog", { name: "Review · Vote" })).toBeNull()
        expect(toast).not.toHaveBeenCalled()
    })
})
