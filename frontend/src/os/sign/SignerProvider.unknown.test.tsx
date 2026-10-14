import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { OsSession } from "../shell/useOsSession"
import { useSigner } from "./signerContext"
import { SignerProvider } from "./SignerProvider"

// The outcome itself is decided in signer.ts (its own tests); this file checks only
// what an "Outcome unknown" notice keeps of it.
const executeSignature = vi.hoisted(() => vi.fn())
vi.mock("./signer", async (orig) => ({ ...(await orig<typeof import("./signer")>()), executeSignature }))
vi.mock("../../lib/dao/chainIdentity", async (orig) => ({ ...(await orig<typeof import("../../lib/dao/chainIdentity")>()), assertActiveRpcChain: vi.fn(async () => undefined) }))

const request = { title: "Vote", summary: "Vote on a proposal", lines: () => [], label: () => "Vote", prepare: () => ({ msgs: [] }), send: vi.fn() }
const session = { status: "member", address: "g1alpha", network: { chainId: "gnoland-1" }, walletChainId: "gnoland-1", openConnect: vi.fn() } as unknown as OsSession

function Notices() {
    const signer = useSigner()
    return <><button type="button" onClick={() => signer.sign(request)}>Open review</button><ul>{signer.notices.map((n) => <li key={n.id}>{n.title} | {n.tx ? `${n.tx.chainId} ${n.tx.hash}` : "no tx"}</li>)}</ul></>
}

async function settleUnknown(hash?: string) {
    executeSignature.mockResolvedValueOnce({ outcome: "unknown", error: "Check before trying again.", ...(hash === undefined ? {} : { hash }) })
    render(<SignerProvider session={session} toast={vi.fn()}><Notices /></SignerProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Open review" }))
    fireEvent.click(screen.getByRole("button", { name: "Sign in Adena" }))
}

afterEach(cleanup)

describe("an Outcome unknown notice", () => {
    it("keeps the transaction when the wallet returned its hash", async () => {
        const hash = "0dd0".padEnd(64, "2")
        await settleUnknown(hash)
        expect(await screen.findByText(`Outcome unknown · Vote | gnoland-1 ${hash}`)).toBeInTheDocument()
    })

    it("has no transaction when no hash is known", async () => {
        await settleUnknown()
        expect(await screen.findByText("Outcome unknown · Vote | no tx")).toBeInTheDocument()
        cleanup()
        await settleUnknown("")
        expect(await screen.findByText("Outcome unknown · Vote | no tx")).toBeInTheDocument()
    })
})
