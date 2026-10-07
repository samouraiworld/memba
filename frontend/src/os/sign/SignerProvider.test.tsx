import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { readGovernanceReceipt, saveGovernanceReceipt } from "../../lib/dao/governanceRecovery"
import { ChainRejectedError, setTxConfirmationCallback } from "../../lib/grc20"
import type { OsSession } from "../shell/useOsSession"
import { accountMark, accountMarkAfterBlocks } from "./accountMark"
import { useSigner } from "./signerContext"
import { SignerProvider } from "./SignerProvider"

const warm = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock("../../lib/dao/chainIdentity", async (orig) => ({ ...(await orig<typeof import("../../lib/dao/chainIdentity")>()), assertActiveRpcChain: warm }))

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

    it("reports a transaction the chain ran and refused as refused, not as not shown yet, and settles as failed", async () => {
        const onSettled = vi.fn()
        const refusedOnChain = { ...request, send: vi.fn(async () => ({ hash: "REFUSED_HASH" })), verify: vi.fn(async () => "failed" as const), onSettled }
        function RefusedOnChain() {
            const signer = useSigner()
            return <><button type="button" onClick={() => signer.sign(refusedOnChain)}>Open review</button><ul>{signer.notices.map((n) => <li key={n.id}>{n.kind} | {n.title} | {n.sub}</li>)}</ul></>
        }
        const toast = vi.fn()
        render(<SignerProvider session={session("member")} toast={toast}><RefusedOnChain /></SignerProvider>)
        fireEvent.click(screen.getByRole("button", { name: "Open review" }))
        fireEvent.click(screen.getByRole("button", { name: "Sign in Adena" }))
        await waitFor(() => expect(onSettled).toHaveBeenCalledWith("failed", undefined))
        expect(refusedOnChain.verify).toHaveBeenCalledOnce()
        expect(screen.getByText(/^fail \| Refused by the network · Vote \| gnoland-1 · REFUSED_HA…: the chain ran it and refused it\. It did not take effect; the network fee was still charged\.$/)).toBeInTheDocument()
        expect(screen.queryByText(/hasn't shown it yet/)).toBeNull()
        expect(toast).toHaveBeenCalledWith("Refused by the network: Vote. It did not take effect; the network fee was still charged.")
    })

    it("names what refused it when the transaction went through but its purpose didn't", async () => {
        const onSettled = vi.fn()
        const denied = {
            ...request, send: vi.fn(async () => ({ hash: "DENIED_HASH" })), verify: vi.fn(async () => "failed" as const), onSettled,
            failedTitle: () => "Denied by GovDAO", failedNote: () => "the proposal's action failed.",
        }
        function Denied() {
            const signer = useSigner()
            return <><button type="button" onClick={() => signer.sign(denied)}>Open review</button><ul>{signer.notices.map((n) => <li key={n.id}>{n.kind} | {n.title} | {n.sub}</li>)}</ul></>
        }
        const toast = vi.fn()
        render(<SignerProvider session={session("member")} toast={toast}><Denied /></SignerProvider>)
        fireEvent.click(screen.getByRole("button", { name: "Open review" }))
        fireEvent.click(screen.getByRole("button", { name: "Sign in Adena" }))
        await waitFor(() => expect(onSettled).toHaveBeenCalledWith("failed", undefined))
        expect(screen.getByText("fail | Denied by GovDAO · Vote | gnoland-1 · DENIED_HAS…: the proposal's action failed.")).toBeInTheDocument()
        expect(toast).toHaveBeenCalledWith("Denied by GovDAO: Vote. Your transaction went through; the details are in Notifications.")
    })

    it("says why the chain refused it when the request knows", async () => {
        const onSettled = vi.fn()
        const lostRace = { ...request, send: vi.fn(async () => ({ hash: "RACE_HASH" })), verify: vi.fn(async () => "failed" as const), failedNote: () => "another member did it first.", onSettled }
        function LostRace() {
            const signer = useSigner()
            return <><button type="button" onClick={() => signer.sign(lostRace)}>Open review</button><ul>{signer.notices.map((n) => <li key={n.id}>{n.kind} | {n.title} | {n.sub}</li>)}</ul></>
        }
        render(<SignerProvider session={session("member")} toast={vi.fn()}><LostRace /></SignerProvider>)
        fireEvent.click(screen.getByRole("button", { name: "Open review" }))
        fireEvent.click(screen.getByRole("button", { name: "Sign in Adena" }))
        await waitFor(() => expect(onSettled).toHaveBeenCalledWith("failed", undefined))
        expect(screen.getByText("fail | Refused by the network · Vote | gnoland-1 · RACE_HASH…: another member did it first.")).toBeInTheDocument()
    })

    describe("as the sheet opens", () => {
        afterEach(() => { cleanup(); vi.unstubAllGlobals() })
        const ok = { status: "success", data: { address: "g1alpha", chainId: "gnoland-1" } }
        const net = { status: "success", data: { chainId: "gnoland-1", rpcUrl: "https://rpc.gno.land:443" } }

        it("reads the wallet and verifies the node while the person reads, and says nothing when all is well", async () => {
            const wallet = { GetAccount: vi.fn(async () => ok), GetNetwork: vi.fn(async () => net) }
            vi.stubGlobal("adena", wallet)
            warm.mockClear()
            render(<SignerProvider session={session("member")} toast={vi.fn()}><OpenReview /></SignerProvider>)
            fireEvent.click(screen.getByRole("button", { name: "Open review" }))
            await waitFor(() => expect(wallet.GetAccount).toHaveBeenCalled())
            expect(warm).toHaveBeenCalled()
            expect(screen.queryByText(/Adena is locked/)).toBeNull()
            expect(screen.getByRole("button", { name: "Sign in Adena" })).toBeEnabled()
        })

        it("tells before the click that Adena is locked and will ask for the password, without blocking", async () => {
            const locked = { status: "failure", type: "WALLET_LOCKED", data: {} }
            vi.stubGlobal("adena", { GetAccount: vi.fn(async () => locked), GetNetwork: vi.fn(async () => locked), AddEstablish: vi.fn() })
            render(<SignerProvider session={session("member")} toast={vi.fn()}><OpenReview /></SignerProvider>)
            fireEvent.click(screen.getByRole("button", { name: "Open review" }))
            expect(await screen.findByText("Adena is locked. It asks for your password when you sign.")).toBeInTheDocument()
            expect(screen.getByRole("button", { name: "Sign in Adena" })).toBeEnabled()
            // Nothing opens in Adena until the person signs.
            expect((window as unknown as { adena: { AddEstablish: ReturnType<typeof vi.fn> } }).adena.AddEstablish).not.toHaveBeenCalled()
        })
    })

    describe("the wallet note stays current", () => {
        afterEach(() => { cleanup(); vi.unstubAllGlobals() })
        const LOCKED = { status: "failure", type: "WALLET_LOCKED", data: {} }
        const account = (address: string) => ({ status: "success", data: { address, chainId: "gnoland-1" } })
        const NET = { status: "success", data: { chainId: "gnoland-1", rpcUrl: "https://rpc.gno.land:443" } }
        function wallet(first: unknown) {
            const state = { reply: first }
            vi.stubGlobal("adena", { GetAccount: vi.fn(async () => state.reply), GetNetwork: vi.fn(async () => (state.reply === LOCKED ? LOCKED : NET)), AddEstablish: vi.fn() })
            return state
        }
        const LOCKED_NOTE = "Adena is locked. It asks for your password when you sign."

        it("clears the locked note once Adena is unlocked and this window is back in front", async () => {
            const state = wallet(LOCKED)
            render(<SignerProvider session={session("member")} toast={vi.fn()}><OpenReview /></SignerProvider>)
            fireEvent.click(screen.getByRole("button", { name: "Open review" }))
            expect(await screen.findByText(LOCKED_NOTE)).toBeInTheDocument()
            state.reply = account("g1alpha")
            await act(async () => { window.dispatchEvent(new Event("focus")) })
            await waitFor(() => expect(screen.queryByText(LOCKED_NOTE)).toBeNull())
        })

        it("clears the other-account note once the session's account is back in Adena", async () => {
            const state = wallet(account("g1other"))
            render(<SignerProvider session={session("member")} toast={vi.fn()}><OpenReview /></SignerProvider>)
            fireEvent.click(screen.getByRole("button", { name: "Open review" }))
            expect(await screen.findByText(/not the one connected to Memba/)).toBeInTheDocument()
            state.reply = account("g1alpha")
            await act(async () => { window.dispatchEvent(new Event("focus")) })
            await waitFor(() => expect(screen.queryByText(/not the one connected to Memba/)).toBeNull())
        })

        it("back on the review after a refusal, hides the earlier note at once and says what the wallet says now", async () => {
            const state = wallet(LOCKED)
            let answerNow!: () => void
            const refusing = {
                ...request,
                send: vi.fn(async () => {
                    // The wallet's next answer waits: an earlier note must not stand in for it meanwhile.
                    state.reply = new Promise((resolve) => { answerNow = () => resolve(account("g1alpha")) })
                    throw new Error("This vote is no longer available.")
                }),
            }
            function Refusing() {
                const signer = useSigner()
                return <button type="button" onClick={() => signer.sign(refusing)}>Open review</button>
            }
            render(<SignerProvider session={session("member")} toast={vi.fn()}><Refusing /></SignerProvider>)
            fireEvent.click(screen.getByRole("button", { name: "Open review" }))
            expect(await screen.findByText(LOCKED_NOTE)).toBeInTheDocument()
            fireEvent.click(screen.getByRole("button", { name: "Sign in Adena" }))
            expect(await screen.findByText(/no longer available/)).toBeInTheDocument()
            expect(screen.queryByText(LOCKED_NOTE)).toBeNull()
            await act(async () => { answerNow() })
            expect(screen.queryByText(LOCKED_NOTE)).toBeNull()
        })

        it("shows no wallet note once the session has ended", async () => {
            wallet(LOCKED)
            const { rerender } = render(<SignerProvider session={session("member")} toast={vi.fn()}><OpenReview /></SignerProvider>)
            fireEvent.click(screen.getByRole("button", { name: "Open review" }))
            expect(await screen.findByText(LOCKED_NOTE)).toBeInTheDocument()
            rerender(<SignerProvider session={session("guest")} toast={vi.fn()}><OpenReview /></SignerProvider>)
            expect(screen.getByText(/Your Memba session ended/)).toBeInTheDocument()
            expect(screen.queryByText(LOCKED_NOTE)).toBeNull()
        })
    })

    describe("Adena's unlock window", () => {
        const LOCKED = { status: "failure", type: "WALLET_LOCKED", data: {} }
        const OK_ACCOUNT = { status: "success", data: { address: "g1alpha", chainId: "gnoland-1" } }
        const OK_NETWORK = { status: "success", data: { chainId: "gnoland-1", rpcUrl: "https://rpc.gno.land:443" } }
        let closeWindow = () => {}
        function lockedAdena() {
            let unlock = () => {}
            const state = { locked: true }
            vi.stubGlobal("adena", {
                GetAccount: vi.fn(async () => (state.locked ? LOCKED : OK_ACCOUNT)),
                GetNetwork: vi.fn(async () => (state.locked ? LOCKED : OK_NETWORK)),
                AddEstablish: vi.fn(() => new Promise((resolve) => { unlock = () => { state.locked = false; resolve({ status: "failure", type: "ALREADY_CONNECTED" }) } })),
            })
            closeWindow = () => unlock()
            return { unlock: () => unlock() }
        }
        function Open({ req }: { req: typeof request }) {
            const signer = useSigner()
            return <button type="button" onClick={() => signer.sign(req)}>Open review</button>
        }
        // Each signature is ended by the test: only one may be in flight at a time.
        let stop = () => {}
        let sent: Promise<unknown> = Promise.resolve()
        const held = () => new Promise<never>((_, reject) => { stop = () => reject(new Error("stopped by the test")) })
        const start = (send: typeof request.send) => {
            const tracked = vi.fn((...args: Parameters<typeof request.send>) => { sent = Promise.resolve(send(...args)); return sent })
            render(<SignerProvider session={session("member")} toast={vi.fn()}><Open req={{ ...request, send: tracked }} /></SignerProvider>)
            fireEvent.click(screen.getByRole("button", { name: "Open review" }))
            fireEvent.click(screen.getByRole("button", { name: "Sign in Adena" }))
        }
        afterEach(async () => {
            // An unlock window still open is closed first, so the signature reaches the point the test ends it.
            await act(async () => { closeWindow(); await new Promise((r) => setTimeout(r, 0)); stop(); await sent.catch(() => {}) })
            closeWindow = () => {}
            cleanup()
            vi.unstubAllGlobals()
        })

        it("a slow check with an unlocked wallet still says Memba is checking", async () => {
            const { beginWalletActivity } = await import("../../lib/walletActivity")
            // The reload hold every OS signature keeps is not an unlock window.
            start(vi.fn(async () => { const end = beginWalletActivity(); try { return await held() } finally { end() } }))
            expect(await screen.findByRole("heading", { name: "Checking before you sign…" })).toBeInTheDocument()
            expect(screen.queryByRole("heading", { name: "Unlock Adena" })).toBeNull()
        })

        it("says to unlock while the window is open, and goes back to checking when it closes", async () => {
            const { assertLiveWalletNetwork } = await import("../../lib/walletNetworkGuard")
            const adena = lockedAdena()
            start(vi.fn(async () => { await assertLiveWalletNetwork("gnoland-1", { unlock: true }); return held() }))
            expect(await screen.findByRole("heading", { name: "Unlock Adena" })).toBeInTheDocument()
            expect(screen.getByText("Adena is locked. Enter your password in the window it opened; Memba then continues to the signature.")).toBeInTheDocument()
            await act(async () => { adena.unlock() })
            expect(await screen.findByRole("heading", { name: "Checking before you sign…" })).toBeInTheDocument()
            expect(screen.queryByRole("heading", { name: "Unlock Adena" })).toBeNull()
        })

        it("an unlock at the last check, after Adena was announced, says to unlock and hides the checklist", async () => {
            const { assertLiveWalletNetwork } = await import("../../lib/walletNetworkGuard")
            lockedAdena()
            start(vi.fn(async (_c: unknown, beforeSign: () => Promise<unknown>) => {
                // As doContractBroadcast does: the reviewed messages are confirmed before beforeSign.
                const confirm = setTxConfirmationCallback(null)
                setTxConfirmationCallback(confirm)
                await confirm!([], "")
                await beforeSign()
                await assertLiveWalletNetwork("gnoland-1", { unlock: true })
                return held()
            }) as typeof request.send)
            expect(await screen.findByRole("heading", { name: "Unlock Adena" })).toBeInTheDocument()
            expect(screen.queryByText("If anything differs, reject it in Adena.")).toBeNull()
        })
    })

    it("says what the request knows when the chain does not confirm yet, in the tray and the toast", async () => {
        const onSettled = vi.fn()
        const parked = { ...request, send: vi.fn(async () => ({ hash: "PARKED_HASH" })), verify: vi.fn(async () => false), verifyAttempts: 1, pendingNote: () => "Waiting for network approval.", onSettled }
        function Parked() {
            const signer = useSigner()
            return <><button type="button" onClick={() => signer.sign(parked)}>Open review</button><ul>{signer.notices.map((n) => <li key={n.id}>{n.kind} | {n.title} | {n.sub}</li>)}</ul></>
        }
        const toast = vi.fn()
        render(<SignerProvider session={session("member")} toast={toast}><Parked /></SignerProvider>)
        fireEvent.click(screen.getByRole("button", { name: "Open review" }))
        fireEvent.click(screen.getByRole("button", { name: "Sign in Adena" }))
        await waitFor(() => expect(onSettled).toHaveBeenCalledWith("submitted", undefined))
        expect(screen.getByText("warn | Submitted · Vote | Waiting for network approval.")).toBeInTheDocument()
        expect(screen.queryByText(/hasn't shown it yet/)).toBeNull()
        expect(toast).toHaveBeenCalledWith("Submitted: Vote. Waiting for network approval.")
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
            // The signature ends there, as an unknown outcome nobody is left to show; the request still learns it.
            await waitFor(() => expect(onSettled).toHaveBeenCalledWith("unknown", undefined))
        })

        it("keeps the explanation in the tray when the account moved", async () => {
            open()
            await screen.findByRole("heading", { name: "Checking your account…" })
            await act(async () => { blocksLater("8 4990000ugnot") })
            await waitFor(() => expect(onSettled).toHaveBeenCalledWith("unknown", undefined))
            expect(screen.getByText("warn | Outcome unknown · Vote | Adena reported a cancellation, but Memba could not confirm it on chain. Check your account before trying again.")).toBeInTheDocument()
        })
    })

    it("says once, for any request with a network fee line, that the wallet sets the fee it signs", () => {
        const withFee = { ...request, title: "Send", lines: () => [["To", "g1bob"], ["Network fee", "0.002 GNOT"]] as [string, string][] }
        function Reviews() {
            const signer = useSigner()
            return <><button type="button" onClick={() => signer.sign(withFee)}>With fee</button><button type="button" onClick={() => signer.sign(request)}>Without fee</button></>
        }
        render(<SignerProvider session={session("member")} toast={vi.fn()}><Reviews /></SignerProvider>)
        fireEvent.click(screen.getByRole("button", { name: "With fee" }))
        expect(screen.getAllByText("Your wallet sets the fee it signs from its own gas estimate, usually lower than the figure above. Check the fee in Adena before you approve.")).toHaveLength(1)
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
        fireEvent.click(screen.getByRole("button", { name: "Without fee" }))
        expect(screen.getByRole("dialog", { name: "Review · Vote" })).toBeInTheDocument()
        expect(screen.queryByText(/Your wallet sets the fee it signs/)).toBeNull()
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

    it("keeps a control shown above the dialog (a live meeting's Leave) in the Tab order, and Escape there cancels the review", async () => {
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
        leave.focus()
        fireEvent.keyDown(leave, { key: "Escape" })
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
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
        // Nothing was sent, and the old request still learns it: whatever waits on it is released.
        await waitFor(() => expect(onSettled).toHaveBeenCalledWith("failed", undefined))
        expect(screen.queryByRole("dialog", { name: "Review · Vote" })).toBeNull()
        expect(toast).not.toHaveBeenCalled()
    })

    it("settles a request the wallet returns after the session ended, without a word to the screen", async () => {
        let walletReturns!: (value: { hash: string }) => void
        const wallet = new Promise<{ hash: string }>((resolve) => { walletReturns = resolve })
        const onSettled = vi.fn()
        const verify = vi.fn(async () => true)
        const inWallet = vi.fn()
        const sent = {
            ...request,
            // The broadcaster's order: the review's confirmation, the pre-sign checks, then the wallet.
            send: vi.fn(async (_choice: string | undefined, beforeSign: () => Promise<void>) => {
                const confirm = setTxConfirmationCallback(null) ?? (async () => true)
                setTxConfirmationCallback(confirm)
                await confirm([], "")
                await beforeSign()
                inWallet()
                return wallet
            }),
            verify,
            onSettled,
        }
        function SentReview() {
            const signer = useSigner()
            return <><button type="button" onClick={() => signer.sign(sent)}>Open review</button><ul>{signer.notices.map((n) => <li key={n.id}>{n.title}</li>)}</ul></>
        }
        const toast = vi.fn()
        const { rerender } = render(<SignerProvider session={session("member")} toast={toast}><SentReview /></SignerProvider>)
        fireEvent.click(screen.getByRole("button", { name: "Open review" }))
        fireEvent.click(screen.getByRole("button", { name: "Sign in Adena" }))
        // The wallet has the request when the session ends.
        await waitFor(() => expect(inWallet).toHaveBeenCalledOnce())
        rerender(<SignerProvider session={session("guest")} toast={toast}><SentReview /></SignerProvider>)
        await act(async () => { walletReturns({ hash: "LATE_HASH" }); await wallet })
        await waitFor(() => expect(onSettled).toHaveBeenCalledWith("submitted", undefined))
        expect(verify).not.toHaveBeenCalled()
        expect(toast).not.toHaveBeenCalled()
        expect(screen.queryAllByRole("listitem")).toHaveLength(0)
    })

    it("settles a request whose verification ends after an account switch, and leaves nothing pending", async () => {
        let verified!: (value: boolean) => void
        const verification = new Promise<boolean>((resolve) => { verified = resolve })
        const onSettled = vi.fn()
        const sent = { ...request, send: vi.fn(async () => ({ hash: "SENT_HASH" })), verify: vi.fn(() => verification), onSettled }
        function SentReview() {
            const signer = useSigner()
            return <><button type="button" onClick={() => signer.sign(sent)}>Open review</button><ul>{signer.pending.map((p) => <li key={p.id}>{p.label}</li>)}</ul></>
        }
        const toast = vi.fn()
        const { rerender } = render(<SignerProvider session={session("member", "g1alpha")} toast={toast}><SentReview /></SignerProvider>)
        fireEvent.click(screen.getByRole("button", { name: "Open review" }))
        fireEvent.click(screen.getByRole("button", { name: "Sign in Adena" }))
        await waitFor(() => expect(sent.verify).toHaveBeenCalledOnce())
        expect(screen.getByRole("listitem")).toHaveTextContent("Vote")
        rerender(<SignerProvider session={session("member", "g1beta")} toast={toast}><SentReview /></SignerProvider>)
        await act(async () => { verified(true); await verification })
        await waitFor(() => expect(onSettled).toHaveBeenCalledWith("confirmed", undefined))
        expect(screen.queryAllByRole("listitem")).toHaveLength(0)
        expect(toast).not.toHaveBeenCalled()
    })
})
