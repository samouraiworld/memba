import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { TxNotice } from "./signerContext"
import { TxNoticeCard } from "./TxNoticeCard"

const HEX = "6035ba06ef" + "0123456789abcdef".repeat(3) + "012345"
// The same 32 bytes as base64, the shape older Adena and broadcast_tx_commit return.
const B64 = btoa(String.fromCharCode(...HEX.match(/../g)!.map((b) => parseInt(b, 16))))
const LINK = { name: "View transaction on Gnoscan" }

const notice = (tx?: TxNotice["tx"]): TxNotice => ({
    id: 1, kind: "ok", title: "Confirmed · Publish note", sub: `${tx?.chainId ?? "gnoland-1"} · ${HEX.slice(0, 10)}…`, tx,
})

afterEach(cleanup)

describe("TxNoticeCard", () => {
    it("links a mainnet transaction to its gnoscan page in a new tab, keeping the truncated hash text", () => {
        render(<TxNoticeCard notice={notice({ hash: HEX, chainId: "gnoland-1" })} />)
        const link = screen.getByRole("link", LINK)
        expect(link).toHaveAttribute("href", `https://gnoscan.io/transactions/details?txhash=${HEX}&chainId=gnoland-1`)
        expect(link).toHaveAttribute("target", "_blank")
        expect(link).toHaveAttribute("rel", "noopener noreferrer")
        expect(screen.getByText("Confirmed · Publish note")).toBeInTheDocument()
        expect(screen.getByText(`gnoland-1 · ${HEX.slice(0, 10)}…`)).toBeInTheDocument()
    })

    it("converts a base64 wallet hash to the hex gnoscan expects", () => {
        render(<TxNoticeCard notice={notice({ hash: B64, chainId: "gnoland-1" })} />)
        expect(screen.getByRole("link", LINK)).toHaveAttribute("href", `https://gnoscan.io/transactions/details?txhash=${HEX}&chainId=gnoland-1`)
    })

    it("links on the chain the transaction was on, never another", () => {
        render(<TxNoticeCard notice={notice({ hash: HEX, chainId: "staging" })} />)
        expect(screen.getByRole("link", LINK)).toHaveAttribute("href", `https://gnoscan.io/transactions/details?txhash=${HEX}&chainId=staging`)
    })

    it("renders plain text on a network gnoscan does not index (Onyx)", () => {
        render(<TxNoticeCard notice={notice({ hash: HEX, chainId: "onyx-1" })} />)
        expect(screen.queryByRole("link")).toBeNull()
        expect(screen.getByText("Confirmed · Publish note")).toBeInTheDocument()
    })

    it("renders plain text without a transaction hash", () => {
        render(<TxNoticeCard notice={notice()} />)
        expect(screen.queryByRole("link")).toBeNull()
        cleanup()
        render(<TxNoticeCard notice={notice({ hash: "", chainId: "gnoland-1" })} />)
        expect(screen.queryByRole("link")).toBeNull()
    })

    it("never links a malformed hash", () => {
        for (const hash of ["6035ba06ef", HEX.slice(0, 63), `${HEX}00`, "zz".repeat(32), "not base64 at all!!", `${HEX}"><script>`]) {
            render(<TxNoticeCard notice={notice({ hash, chainId: "gnoland-1" })} />)
            expect(screen.queryByRole("link")).toBeNull()
            cleanup()
        }
    })

    it("is a native link in the tab order", () => {
        render(<TxNoticeCard notice={notice({ hash: HEX, chainId: "gnoland-1" })} />)
        const link = screen.getByRole("link", LINK)
        expect(link.tagName).toBe("A")
        expect(link.tabIndex).toBe(0)
        link.focus()
        expect(link).toHaveFocus()
    })
})
