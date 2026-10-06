import { screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { weightedConfigSchema, weightedPageSchema, type WeightedProposal as Proposal, type WeightedSnapshot } from "../../lib/dao/weighted"
import { weightedFixture, weightedRealm } from "../../lib/dao/testdata/weighted"
import { OS_READS_ONLY } from "../../lib/dao/weightedView"
import { renderWithProviders } from "../../test/test-utils"
import type { OsSession } from "../shell/useOsSession"

// A version before the application version, on a network where its writes are not held.
vi.mock("../../lib/config", async (original) => ({ ...(await original<typeof import("../../lib/config")>()), GNO_CHAIN_ID: "test-13" }))
vi.mock("../../lib/dao/weighted", async (original) => ({ ...(await original<typeof import("../../lib/dao/weighted")>()), readWeightedSnapshot: vi.fn(), readWeightedBallot: vi.fn() }))
const { WeightedProposalWindow } = await import("./WeightedProposal")
const { readWeightedBallot, readWeightedSnapshot } = await import("../../lib/dao/weighted")

const v2 = weightedFixture(2)
const snapshot = (over: Partial<Proposal>) => {
    const page = weightedPageSchema.parse(v2.page)
    return { config: weightedConfigSchema.parse(v2.config), members: v2.members, page: { ...page, proposals: [{ ...page.proposals[0], ...over }] } } as WeightedSnapshot
}
const member = { status: "member", address: v2.members[1].address, network: { key: "test13" }, openConnect: vi.fn() } as unknown as OsSession
const show = () => renderWithProviders(<WeightedProposalWindow realmPath={weightedRealm} id="1" session={member} />)

beforeEach(() => { vi.clearAllMocks() })

describe("a proposal of a version before the application version", () => {
    it("is read-only in Memba OS, for a seat holder and a guest alike", async () => {
        vi.mocked(readWeightedSnapshot).mockResolvedValue(snapshot({ status: "READY", ready: true, votingClosed: false }))
        const seat = show()
        expect(await screen.findByText(OS_READS_ONLY)).toBeInTheDocument()
        expect(screen.queryByRole("button")).toBeNull()
        // This version publishes no ballot, so none is read.
        expect(readWeightedBallot).not.toHaveBeenCalled()
        seat.unmount()
        renderWithProviders(<WeightedProposalWindow realmPath={weightedRealm} id="1" session={{ ...member, status: "guest", address: "" } as unknown as OsSession} />)
        expect(await screen.findByText(OS_READS_ONLY)).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Connect" })).toBeNull()
    })
})
