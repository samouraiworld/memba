import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("../../../lib/directory", async importOriginal => ({
    ...await importOriginal<typeof import("../../../lib/directory")>(),
    batchFetchUserAvatars: vi.fn(async () => new Map()),
}))

vi.mock("../../../lib/dao/shared", () => ({
    queryRender: vi.fn().mockRejectedValue(new Error("RPC unavailable")),
}))

import { queryRender } from "../../../lib/dao/shared"
import { AbciQueryError } from "../../../lib/rpcFallback"
import { UsersTab } from "./UsersTab"

describe("Directory users during an RPC outage", () => {
    it("offers a retry rather than reporting an empty member list", async () => {
        vi.mocked(queryRender).mockRejectedValue(new Error("RPC unavailable"))
        render(<UsersTab navigate={vi.fn()} />)
        expect(await screen.findByText("Couldn't reach the network to load members. Try again.")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
        expect(screen.queryByText("No DAO members found on this network yet")).not.toBeInTheDocument()
        expect(vi.mocked(queryRender).mock.calls.every(call => call[3] === true)).toBe(true)
    })

    it("treats a chain-level missing realm response as an empty network", async () => {
        vi.mocked(queryRender).mockRejectedValue(new AbciQueryError("vm/qrender", "not found"))
        render(<UsersTab navigate={vi.fn()} />)
        expect(await screen.findByText("No DAO members found on this network yet")).toBeInTheDocument()
        expect(screen.queryByText("Couldn't reach the network to load members. Try again.")).not.toBeInTheDocument()
    })

    it("discloses partial coverage when one DAO has members and another read fails", async () => {
        let calls = 0
        vi.mocked(queryRender).mockImplementation(async () => {
            calls++
            if (calls === 1) return `Member: g1${"a".repeat(38)}`
            throw new Error("RPC unavailable")
        })
        render(<UsersTab navigate={vi.fn()} />)
        expect(await screen.findByText("Some DAO member lists could not be checked. Showing partial results.")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Retry all lists" })).toBeInTheDocument()
        expect(screen.getByText("1 member found")).toBeInTheDocument()
    })
})
