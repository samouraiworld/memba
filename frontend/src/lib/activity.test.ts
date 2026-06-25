/**
 * Tests for the recent-activity parser — maps tx-indexer GraphQL transactions
 * into honest, human-readable activity items. Fixtures mirror the real shape
 * returned by indexer.test13.testnets.gno.land (MsgCall / MsgAddPackage /
 * BankMsgSend / MsgRun / UnexpectedMessage).
 */
import { describe, it, expect } from "vitest"
import { parseActivity, type IndexerTx } from "./activity"

const tx = (block_height: number, hash: string, messages: { value: Record<string, unknown> }[]): IndexerTx =>
    ({ hash, block_height, success: true, messages }) as IndexerTx
const call = (caller: string, pkg_path: string, func: string) =>
    ({ value: { __typename: "MsgCall", caller, pkg_path, func } })
const addpkg = (creator: string, path: string) =>
    ({ value: { __typename: "MsgAddPackage", creator, package: { path } } })
const send = (from_address: string, to_address: string, amount: string) =>
    ({ value: { __typename: "BankMsgSend", from_address, to_address, amount } })
const run = (caller: string) => ({ value: { __typename: "MsgRun", caller } })
const unknown = () => ({ value: { __typename: "UnexpectedMessage" } })

describe("parseActivity", () => {
    it("maps a MsgCall to a call item (actor, pkgPath, func, tx coords)", () => {
        const items = parseActivity([tx(100, "h1", [call("g1abc", "gno.land/r/gnoswap/gns", "Approve")])], new Map())
        expect(items).toHaveLength(1)
        expect(items[0]).toMatchObject({
            kind: "call", actor: "g1abc", pkgPath: "gno.land/r/gnoswap/gns",
            func: "Approve", txHash: "h1", blockHeight: 100,
        })
    })

    it("classifies a tokenfactory call as a token event", () => {
        const items = parseActivity([tx(101, "h2", [call("g1c", "gno.land/r/samcrew/tokenfactory_v2", "New")])], new Map())
        expect(items[0].kind).toBe("token")
    })

    it("classifies a valopers call as a validator event", () => {
        const items = parseActivity([tx(102, "h3", [call("g1d", "gno.land/r/gnops/valopers", "Register")])], new Map())
        expect(items[0].kind).toBe("validator")
    })

    it("classifies a gov/dao call as a governance event", () => {
        const items = parseActivity([tx(103, "h4", [call("g1e", "gno.land/r/gov/dao", "MustCreateProposal")])], new Map())
        expect(items[0].kind).toBe("governance")
    })

    it("maps MsgAddPackage to a deploy item with the package path", () => {
        const items = parseActivity([tx(104, "h5", [addpkg("g1f", "gno.land/r/demo/foo")])], new Map())
        expect(items[0]).toMatchObject({ kind: "deploy", actor: "g1f", pkgPath: "gno.land/r/demo/foo" })
    })

    it("maps BankMsgSend to a transfer item (actor = sender)", () => {
        const items = parseActivity([tx(105, "h6", [send("g1g", "g1h", "1000000ugnot")])], new Map())
        expect(items[0]).toMatchObject({ kind: "transfer", actor: "g1g" })
    })

    it("maps MsgRun to a run item", () => {
        const items = parseActivity([tx(106, "h7", [run("g1i")])], new Map())
        expect(items[0].kind).toBe("run")
    })

    it("summarizes a multi-message tx with an extraCount", () => {
        const items = parseActivity([tx(107, "h8", [
            call("g1j", "gno.land/r/x/a", "F"),
            call("g1j", "gno.land/r/x/b", "G"),
            call("g1j", "gno.land/r/x/c", "H"),
        ])], new Map())
        expect(items).toHaveLength(1)
        expect(items[0].extraCount).toBe(2)
    })

    it("orders newest block first and honors the limit", () => {
        const items = parseActivity(
            [tx(10, "old", [call("g1", "p", "F")]), tx(20, "new", [call("g1", "p", "G")])],
            new Map(), { limit: 1 },
        )
        expect(items).toHaveLength(1)
        expect(items[0].txHash).toBe("new")
    })

    it("attaches the block time from the height→time map when present", () => {
        const items = parseActivity([tx(30, "h9", [call("g1", "p", "F")])], new Map([[30, "2026-06-25T13:00:00Z"]]))
        expect(items[0].time).toBe("2026-06-25T13:00:00Z")
    })

    it("falls through to the first classifiable message when the first is unknown", () => {
        const items = parseActivity([tx(40, "h10", [unknown(), call("g1k", "gno.land/r/x/y", "Z")])], new Map())
        expect(items).toHaveLength(1)
        expect(items[0]).toMatchObject({ kind: "call", actor: "g1k", func: "Z" })
    })

    it("omits a tx whose messages are all unclassifiable (no throw)", () => {
        const items = parseActivity([tx(41, "h11", [unknown()])], new Map())
        expect(items).toEqual([])
    })

    it("never fabricates: an empty tx list yields no items", () => {
        expect(parseActivity([], new Map())).toEqual([])
    })
})
