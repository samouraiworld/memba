import { describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { readGovernanceReceipt, saveGovernanceReceipt } from "../../lib/dao/governanceRecovery"
import { ChainRejectedError, setTxConfirmationCallback } from "../../lib/grc20"
import type { OsSession } from "../shell/useOsSession"
import { accountMark, accountMarkAfterBlocks } from "./accountMark"
import { useSigner } from "./signerContext"
import { SignerProvider } from "./SignerProvider"

// The chain reads behind the "rejected" check; their own tests are in accountMark.test.ts.
vi.mock("./accountMark", () => ({ accountMark: vi.fn(async () => "7 5000000ugnot"), accountMarkAfterBlocks: vi.fn(async () => "7 5000000ugnot") }))

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

    it("closes the review when the network refuses the transaction, keeps the reason in the tray and settles as failed", async () => {
        const onSettled = vi.fn()
        const refused = {
            ...request,
            send: vi.fn(async () => { throw new ChainRejectedError("Error: out of gas error", "Data: std.OutOfGasError{}\nMsg Traces:\n    0  out of gas in location: WritePerByte", "H") }),
            onSettled,
        }
        function RefusedReview() {
            const signer = useSigner()
            return <><button type="button" onClick={() => signer.sign(refused)}>Open refused review</button><ul>{signer.notices.map((n) => <li key={n.id}>{n.kind} | {n.title} | {n.sub}</li>)}</ul></>
        }
        const toast = vi.fn()
        render(<SignerProvider session={session("member")} toast={toast}><RefusedReview /></SignerProvider>)
        fireEvent.click(screen.getByRole("button", { name: "Open refused review" }))
        fireEvent.click(screen.getByRole("button", { name: "Sign in Adena" }))
        await waitFor(() => expect(onSettled).toHaveBeenCalledWith("failed", undefined))
        expect(screen.queryByRole("dialog")).toBeNull()
        expect(screen.getByText(/^fail \| Refused by the network · Vote \| The network refused this transaction: out of gas in location: WritePerByte\. It was not included in a block/)).toBeInTheDocument()
        expect(toast).toHaveBeenCalledWith(expect.stringContaining("Refused by the network"))
        expect(refused.send).toHaveBeenCalledTimes(1)
    })

    describe("a 'rejected' reply from Adena after its window opened", () => {
        const onSettled = vi.fn()
        const rejected = {
            ...request,
            // The broadcaster's order: the review's confirmation, the pre-sign checks, then the wallet.
            send: vi.fn(async (_choice: string | undefined, beforeSign: () => Promise<unknown>) => {
                const confirm = setTxConfirmationCallback(null) ?? (async () => true)
                setTxConfirmationCallback(confirm)
                await confirm([], "")
                await beforeSign()
                throw new Error("The transaction has been rejected by the user.")
            }),
            onSettled,
        }
        function RejectedReview() {
            const signer = useSigner()
            return <><button type="button" onClick={() => signer.sign(rejected)}>Open rejected review</button><ul>{signer.notices.map((n) => <li key={n.id}>{n.kind} | {n.title} | {n.sub}</li>)}</ul></>
        }
        let blocksLater!: (mark: string) => void
        const open = () => {
            vi.clearAllMocks()
            vi.mocked(accountMarkAfterBlocks).mockImplementation(() => new Promise<string>((resolve) => { blocksLater = resolve }))
            const toast = vi.fn()
            render(<SignerProvider session={session("member", "g1alpha")} toast={toast}><RejectedReview /></SignerProvider>)
            fireEvent.click(screen.getByRole("button", { name: "Open rejected review" }))
            fireEvent.click(screen.getByRole("button", { name: "Sign in Adena" }))
            return toast
        }

        it("reads the signer's own account, says it is checking, and cannot be dismissed meanwhile", async () => {
            const toast = open()
            const heading = await screen.findByRole("heading", { name: "Checking your account…" })
            expect(heading.closest('[role="status"]')).toHaveTextContent("waits three blocks and compares your account")
            expect(accountMark).toHaveBeenCalledWith("g1alpha")
            expect(accountMarkAfterBlocks).toHaveBeenCalledWith("g1alpha", expect.any(AbortSignal))
            fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
            expect(screen.getByRole("dialog")).toBeInTheDocument()
            expect(onSettled).not.toHaveBeenCalled()
            await act(async () => { blocksLater("7 5000000ugnot") })
            await waitFor(() => expect(onSettled).toHaveBeenCalledWith("cancelled", undefined))
            expect(toast).toHaveBeenCalledWith("Cancelled in Adena. Your account shows no change three blocks later.")
            expect(screen.queryByRole("dialog")).toBeNull()
        })

        it("stops the account check when the provider goes away", async () => {
            const toast = vi.fn()
            vi.clearAllMocks()
            // As the real check does: it ends when told to stop.
            vi.mocked(accountMarkAfterBlocks).mockImplementation((_address, stop) => new Promise<string>((_resolve, reject) => {
                stop?.addEventListener("abort", () => reject(new Error("No longer needed")))
            }))
            const view = render(<SignerProvider session={session("member", "g1alpha")} toast={toast}><RejectedReview /></SignerProvider>)
            fireEvent.click(screen.getByRole("button", { name: "Open rejected review" }))
            fireEvent.click(screen.getByRole("button", { name: "Sign in Adena" }))
            await screen.findByRole("heading", { name: "Checking your account…" })
            const stop = vi.mocked(accountMarkAfterBlocks).mock.calls[0][1] as AbortSignal
            expect(stop.aborted).toBe(false)
            view.unmount()
            expect(stop.aborted).toBe(true)
            // The signature ends there, as an unknown outcome nobody is left to show: nothing is released.
            await act(async () => {})
            expect(onSettled).not.toHaveBeenCalled()
        })

        it("keeps the explanation in the tray when the account moved", async () => {
            open()
            await screen.findByRole("heading", { name: "Checking your account…" })
            await act(async () => { blocksLater("8 4990000ugnot") })
            await waitFor(() => expect(onSettled).toHaveBeenCalledWith("unknown", undefined))
            expect(screen.getByText("warn | Outcome unknown · Vote | Adena reported a cancellation, but Memba could not confirm it on chain. Check your account before trying again.")).toBeInTheDocument()
        })
    })

    it("says once, for any request with a network fee line, that Adena shows the fee it signs", () => {
        const withFee = { ...request, title: "Send", lines: () => [["To", "g1bob"], ["Network fee", "0.002 GNOT"]] as [string, string][] }
        function Reviews() {
            const signer = useSigner()
            return <><button type="button" onClick={() => signer.sign(withFee)}>With fee</button><button type="button" onClick={() => signer.sign(request)}>Without fee</button></>
        }
        render(<SignerProvider session={session("member")} toast={vi.fn()}><Reviews /></SignerProvider>)
        fireEvent.click(screen.getByRole("button", { name: "With fee" }))
        expect(screen.getAllByText("Adena shows the fee it signs. It can differ from the figure above.")).toHaveLength(1)
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
        fireEvent.click(screen.getByRole("button", { name: "Without fee" }))
        expect(screen.getByRole("dialog", { name: "Review · Vote" })).toBeInTheDocument()
        expect(screen.queryByText(/Adena shows the fee it signs/)).toBeNull()
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

    it("keeps a control shown above the dialog (a live meeting's Leave) in the Tab order", () => {
        render(<SignerProvider session={session("member")} toast={vi.fn()}>
            <div className="memba-os"><main className="os-desk"><OpenReview /></main><button type="button" data-os-over-dialog="">Leave</button></div>
        </SignerProvider>)
        fireEvent.click(screen.getByRole("button", { name: "Open review" }))
        const dialog = screen.getByRole("dialog", { name: "Review · Vote" })
        const leave = screen.getByRole("button", { name: "Leave" })
        const stops = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]')]
        stops.at(-1)!.focus()
        fireEvent.keyDown(document.activeElement!, { key: "Tab" })
        expect(leave).toHaveFocus()
        fireEvent.keyDown(leave, { key: "Tab" })
        expect(stops[0]).toHaveFocus()
        fireEvent.keyDown(stops[0], { key: "Tab", shiftKey: true })
        expect(leave).toHaveFocus()
        fireEvent.keyDown(leave, { key: "Tab", shiftKey: true })
        expect(stops.at(-1)).toHaveFocus()
    })

    it("never replaces a review that is on screen: a later request is refused, said so, and the first keeps its focus return", async () => {
        const toast = vi.fn()
        const other = { ...request, title: "Publish", label: () => "Publish" }
        const opened: boolean[] = []
        // Stands for a second window, or a quote that returned late: it is not part of the inert desktop.
        function Late() {
            const signer = useSigner()
            return <button type="button" onClick={() => { opened.push(signer.sign(other)) }}>Late request</button>
        }
        render(<SignerProvider session={session("member")} toast={toast}>
            <div className="memba-os"><main className="os-desk"><OpenReview /></main></div><Late />
        </SignerProvider>)
        const opener = screen.getByRole("button", { name: "Open review" })
        const late = screen.getByRole("button", { name: "Late request" })
        opener.focus()
        fireEvent.click(opener)
        fireEvent.click(late)
        expect(opened).toEqual([false])
        expect(toast).toHaveBeenCalledWith("A signature review is already open. Finish or cancel it first.")
        expect(screen.getByRole("dialog", { name: "Review · Vote" })).toBeInTheDocument()
        expect(screen.queryByRole("dialog", { name: "Review · Publish" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
        await waitFor(() => expect(opener).toHaveFocus())
        // Once it is closed the next request opens, and a further one is refused again.
        fireEvent.click(late)
        fireEvent.click(late)
        expect(opened).toEqual([false, true, false])
        expect(screen.getByRole("dialog", { name: "Review · Publish" })).toBeInTheDocument()
    })

    it("opens only the first of two requests made in the same tick", () => {
        const first = { ...request, title: "First" }
        const second = { ...request, title: "Second" }
        const opened: boolean[] = []
        function Twice() {
            const signer = useSigner()
            return <button type="button" onClick={() => { opened.push(signer.sign(first), signer.sign(second)) }}>Two at once</button>
        }
        render(<SignerProvider session={session("member")} toast={vi.fn()}><Twice /></SignerProvider>)
        fireEvent.click(screen.getByRole("button", { name: "Two at once" }))
        expect(opened).toEqual([true, false])
        expect(screen.getByRole("dialog", { name: "Review · First" })).toBeInTheDocument()
        expect(screen.queryByRole("dialog", { name: "Review · Second" })).toBeNull()
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
