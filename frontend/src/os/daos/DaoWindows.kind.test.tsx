import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import type { OsSession } from "../shell/useOsSession"

// The real contract-kind hook over a stubbed probe; the loaders of the DAO kinds themselves are not under test.
vi.mock("../../lib/dao/kind", async original => ({ ...(await original<typeof import("../../lib/dao/kind")>()), resolveDaoKind: vi.fn() }))
vi.mock("./useOsDao", async original => ({
    ...(await original<typeof import("./useOsDao")>()),
    useDaoConfig: vi.fn(() => ({ data: { name: "Team", description: "", memberCount: 3, threshold: "" }, isPending: false, isError: false })),
    useDaoProposals: vi.fn(() => ({ data: [], isPending: false, isError: false })),
    useDaoMembers: vi.fn(() => ({ data: [], isPending: false, isError: false })),
}))
const { resolveDaoKind } = await import("../../lib/dao/kind")
const { DaoFolder } = await import("./DaoWindows")

const session = { status: "guest", address: "", network: { key: "mainnet" }, layout: {}, openConnect: vi.fn() } as unknown as OsSession
const ALICE = "gno.land/r/alice/team"
const BOB = "gno.land/r/bob/team"
const probes = (realm: string) => vi.mocked(resolveDaoKind).mock.calls.filter(([ctx]) => ctx.realmPath === realm).length

beforeEach(() => { vi.clearAllMocks() })

describe("two DAO windows and one failing contract probe", () => {
    it("retries only the failing DAO's probe, shows that it is loading, and leaves the other window as it is", async () => {
        let failBob: (() => void) | undefined
        vi.mocked(resolveDaoKind).mockImplementation(async ({ realmPath }) => {
            if (realmPath === ALICE) return "memba-v2"
            // The first probe fails at once; a retry stays in flight until the test fails it too.
            if (probes(BOB) === 1) throw new Error("RPC unavailable")
            return new Promise((_, reject) => { failBob = () => reject(new Error("RPC unavailable")) })
        })
        renderWithProviders(
            <>
                <section aria-label="alice"><DaoFolder name="alice.team" section="overview" open={vi.fn()} session={session} /></section>
                <section aria-label="bob"><DaoFolder name="bob.team" section="overview" open={vi.fn()} session={session} /></section>
            </>,
        )
        const alice = within(screen.getByRole("region", { name: "alice" }))
        const bob = within(screen.getByRole("region", { name: "bob" }))
        expect(await alice.findByRole("tablist", { name: "DAO sections" })).toBeInTheDocument()
        expect(await bob.findByRole("alert")).toHaveTextContent("Couldn't load this DAO's contract.")
        expect(bob.queryByRole("tablist")).toBeNull()

        fireEvent.click(bob.getByRole("button", { name: "Try again" }))
        // While the probe runs again the window says so, and offers no second retry.
        expect(await bob.findByRole("status")).toHaveTextContent("Loading the DAO contract…")
        expect(bob.queryByRole("button", { name: "Try again" })).toBeNull()
        await waitFor(() => expect(probes(BOB)).toBe(2))
        failBob!()
        expect(await bob.findByRole("button", { name: "Try again" })).toBeInTheDocument()

        // The other DAO was not probed again and its window never left its sections.
        expect(probes(ALICE)).toBe(1)
        expect(alice.getByRole("tablist", { name: "DAO sections" })).toBeInTheDocument()
        expect(alice.queryByRole("alert")).toBeNull()
    })
})
