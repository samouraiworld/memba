import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { create } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import { QuestClaimSchema } from "../gen/memba/v1/memba_pb"
import { renderWithProviders } from "../test/test-utils"

const wallet = { address: "g1reviewer" }
const auth = { token: { userAddress: "g1reviewer" } }
const listPendingClaims = vi.fn()
const reviewQuestClaim = vi.fn()

vi.mock("../hooks/useAdena", () => ({ useAdena: () => wallet }))
vi.mock("../hooks/useAuth", () => ({ useAuth: () => auth }))
vi.mock("../hooks/useNetworkNav", () => ({ useNetworkKey: () => "pearl" }))
vi.mock("../lib/questClaims", () => ({
    listPendingClaims: (...args: unknown[]) => listPendingClaims(...args),
    reviewQuestClaim: (...args: unknown[]) => reviewQuestClaim(...args),
}))

import QuestAdmin from "./QuestAdmin"

function claim(id: number, questId = "fix-upstream-bug") {
    return create(QuestClaimSchema, {
        id: BigInt(id), questId, address: `g1applicant${id}`,
        proofUrl: "https://example.com/pr/1", proofText: "Merged upstream fix",
        createdAt: "2026-09-28T00:00:00Z",
    })
}

describe("QuestAdmin", () => {
    beforeEach(() => {
        wallet.address = "g1reviewer"
        auth.token = { userAddress: "g1reviewer" }
        listPendingClaims.mockReset()
        reviewQuestClaim.mockReset().mockResolvedValue("approved")
    })

    it("waits for a matching signed-in wallet before requesting private claims", () => {
        wallet.address = "g1different"
        renderWithProviders(<QuestAdmin />, { route: "/pearl/quest-admin" })
        expect(screen.getByText(/Connect and sign in with a reviewer wallet/)).toBeInTheDocument()
        expect(listPendingClaims).not.toHaveBeenCalled()
    })

    it("distinguishes an empty queue from a network failure", async () => {
        listPendingClaims.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([])
        renderWithProviders(<QuestAdmin />, { route: "/pearl/quest-admin" })
        fireEvent.click(await screen.findByRole("button", { name: "Retry loading claims" }))
        expect(await screen.findByText(/No pending claims/)).toBeInTheDocument()
    })

    it("shows a reviewer restriction for server PermissionDenied", async () => {
        listPendingClaims.mockRejectedValue(new ConnectError("denied", Code.PermissionDenied))
        renderWithProviders(<QuestAdmin />, { route: "/pearl/quest-admin" })
        expect(await screen.findByText(/restricted to quest reviewers/)).toBeInTheDocument()
        expect(screen.queryByText(/No pending claims/)).toBeNull()
    })

    it("refreshes the bounded queue after review and labels actions by claim", async () => {
        listPendingClaims.mockResolvedValueOnce([claim(1)]).mockResolvedValueOnce([claim(101)])
        renderWithProviders(<QuestAdmin />, { route: "/pearl/quest-admin" })
        const approve = await screen.findByRole("button", { name: /Approve Upstream Contributor claim from g1applicant1/ })
        fireEvent.click(approve)
        await waitFor(() => expect(reviewQuestClaim).toHaveBeenCalledWith(auth.token, 1n, true))
        expect(await screen.findByRole("button", { name: /Approve Upstream Contributor claim from g1applicant101/ })).toBeInTheDocument()
    })
})
