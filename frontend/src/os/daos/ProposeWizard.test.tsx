import { fireEvent, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import type { OsSession } from "../shell/useOsSession"

vi.mock("./useOsDao", async original => ({
    ...(await original<typeof import("./useOsDao")>()),
    useDaoConfig: vi.fn(),
    useDaoMembers: vi.fn(),
}))
vi.mock("../../hooks/useDaoKind", () => ({ useDaoKind: vi.fn() }))
vi.mock("../sign/signerContext", () => ({ useSigner: vi.fn(() => ({})) }))
const { ProposeWizard } = await import("./ProposeWizard")
const { useDaoConfig, useDaoMembers } = await import("./useOsDao")
const { useDaoKind } = await import("../../hooks/useDaoKind")

const session = { status: "member", address: "g1fixturealice00000000000000000000000000", network: { key: "mainnet" }, layout: {}, openConnect: vi.fn() } as unknown as OsSession
const kindOf = (kind: string, propose: string[]) =>
    vi.mocked(useDaoKind).mockReturnValue({ kind, loading: false, error: null, capabilities: { propose } } as unknown as ReturnType<typeof useDaoKind>)

beforeEach(() => {
    vi.mocked(useDaoConfig).mockReturnValue({ data: { name: "Team" }, isPending: false, isError: false, refetch: vi.fn() } as unknown as ReturnType<typeof useDaoConfig>)
    vi.mocked(useDaoMembers).mockReturnValue({ data: [], isPending: false, isError: false } as unknown as ReturnType<typeof useDaoMembers>)
})

describe("ProposeWizard for a DAO contract other than version 2", () => {
    it("opens the contract's own proposal form in a DAOs window when it takes proposals", () => {
        kindOf("memba-v1", ["text"])
        const open = vi.fn()
        renderWithProviders(<ProposeWizard dao="alice.team" session={session} open={open} close={vi.fn()} />)
        expect(screen.getByText("This DAO's contract takes new proposals on its own form.")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Open the proposal form" }))
        expect(open).toHaveBeenCalledWith(expect.objectContaining({ key: "daos:dao/gno.land/r/alice/team/propose", target: { kind: "app", app: "daos", section: "dao/gno.land/r/alice/team/propose" } }))
    })

    it("says so when the contract takes no proposals through Memba", () => {
        kindOf("govdao", [])
        renderWithProviders(<ProposeWizard dao="govdao" session={session} open={vi.fn()} close={vi.fn()} />)
        expect(screen.getByText("This DAO's contract does not accept new proposals through Memba.")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Open the proposal form" })).not.toBeInTheDocument()
    })

    it("offers a retry when a version-2 DAO's settings can't be read", () => {
        kindOf("memba-v2", ["text"])
        vi.mocked(useDaoConfig).mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: vi.fn() } as unknown as ReturnType<typeof useDaoConfig>)
        renderWithProviders(<ProposeWizard dao="alice.team" session={session} open={vi.fn()} close={vi.fn()} />)
        expect(screen.getByText("The DAO's settings couldn't be read.")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Try again" }))
        expect(vi.mocked(useDaoConfig).mock.results.at(-1)!.value.refetch).toHaveBeenCalled()
    })
})
