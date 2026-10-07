import { afterEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { ConnectHere, CopyAddressButton, MemberChips, SigDots, ThresholdAvatar } from "./MultisigParts"

const A = "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const B = "g1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
const C = "g1cccccccccccccccccccccccccccccccccccccc"

afterEach(() => { vi.unstubAllGlobals() })

describe("the multisig window's network-neutral parts", () => {
    it("asks a guest to connect, and waits while the wallet resumes", () => {
        const onConnect = vi.fn()
        const { rerender } = render(<ConnectHere resuming={false} onConnect={onConnect} text="Connect to see them." />)
        expect(screen.getByRole("status")).toHaveTextContent("Connect to see them.")
        fireEvent.click(screen.getByRole("button", { name: "Connect" }))
        expect(onConnect).toHaveBeenCalledOnce()
        rerender(<ConnectHere resuming onConnect={onConnect} text="Connect to see them." />)
        expect(screen.getByText("Loading your wallet…")).toBeInTheDocument()
        expect(screen.queryByRole("button")).toBeNull()
    })

    it("shows the threshold over the member count", () => {
        const { container } = render(<ThresholdAvatar threshold={2} members={3} />)
        expect(container).toHaveTextContent("2/3")
    })

    it("names the connected member You and shortens the others", () => {
        render(<MemberChips members={[A, B]} me={A} />)
        const chips = screen.getByLabelText("Members")
        expect(chips).toHaveTextContent("You")
        expect(screen.getByTitle(B)).not.toHaveTextContent(B)
    })

    it("lights only verified signatures and says which were submitted", () => {
        render(<SigDots members={[A, B, C]} signed={new Set([A, B])} verified={new Set([A])} threshold={2} />)
        expect(screen.getByLabelText("2 submitted, 1 verified, threshold 2")).toBeInTheDocument()
        expect(screen.getByTitle(`${A}: verified`)).toHaveClass("os-on")
        expect(screen.getByTitle(`${B}: submitted, unverified`)).not.toHaveClass("os-on")
        expect(screen.getByTitle(`${C}: not signed`)).not.toHaveClass("os-on")
        expect(screen.getByText("2 submitted · 1 verified · threshold 2")).toBeInTheDocument()
    })

    it("copies the address and says so; a refused clipboard keeps the label", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        vi.stubGlobal("navigator", { clipboard: { writeText } })
        const { unmount } = render(<CopyAddressButton address={A} label="Copy deposit address" />)
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy deposit address" })) })
        expect(writeText).toHaveBeenCalledWith(A)
        expect(screen.getByRole("button", { name: "Address copied" })).toBeInTheDocument()
        unmount()

        vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } })
        render(<CopyAddressButton address={A} label="Copy deposit address" />)
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy deposit address" })) })
        expect(screen.getByRole("button", { name: "Copy deposit address" })).toBeInTheDocument()
    })
})
