/**
 * QuestDetail — quests whose realm isn't deployed on the active network show
 * "Not available on this network yet" and offer no verify action.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, fireEvent, waitFor } from "@testing-library/react"
import { Routes, Route } from "react-router-dom"
import { renderWithProviders } from "../test/test-utils"

const ADDR = "g1abcdefghijklmnopqrstuvwxyz0123456789ab"
const tokenWallet = { address: ADDR }

vi.mock("../hooks/useAdena", () => ({
    useAdena: () => ({
        connected: true,
        address: ADDR,
        pubkeyJSON: "",
        chainId: "",
        installed: true,
        loading: false,
        connect: vi.fn().mockResolvedValue(true),
        disconnect: vi.fn(),
        signArbitrary: vi.fn().mockResolvedValue(null),
    }),
}))

vi.mock("../hooks/useAuth", () => ({
    useAuth: () => ({ token: { userAddress: tokenWallet.address }, address: tokenWallet.address, loading: false, error: null }),
}))

const completeQuestVerified = vi.fn()
vi.mock("../lib/quests", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../lib/quests")>()),
    completeQuestVerified: (...args: unknown[]) => completeQuestVerified(...args),
}))

import QuestDetail from "./QuestDetail"

function renderQuest(route: string) {
    return renderWithProviders(
        <Routes>
            <Route path="/:network/quests/:questId" element={<QuestDetail />} />
        </Routes>,
        { route },
    )
}

describe("QuestDetail — quest realm not on this network", () => {
    beforeEach(() => {
        completeQuestVerified.mockReset()
        localStorage.clear()
        tokenWallet.address = ADDR
    })

    it.each(["join-dao", "create-token", "submit-candidature"])(
        "%s on mainnet: marked not available, no verify action",
        (id) => {
            renderQuest(`/mainnet/quests/${id}`)
            expect(screen.getByText("Not available on this network yet")).toBeInTheDocument()
            expect(screen.queryByRole("button", { name: /verify|check completion/i })).toBeNull()
            expect(screen.queryByText("Available")).toBeNull()
        },
    )

    it("join-dao on a network with memba_dao offers the verify action", () => {
        renderQuest("/pearl/quests/join-dao")
        expect(screen.getByRole("button", { name: /verify on-chain/i })).toBeInTheDocument()
        expect(screen.queryByText("Not available on this network yet")).toBeNull()
    })

    it("shows the server's not-deployed rejection instead of 'complete the action'", async () => {
        completeQuestVerified.mockRejectedValue(
            new Error("[failed_precondition] not available on this network yet: gno.land/r/samcrew/memba_dao is not deployed"),
        )
        renderQuest("/pearl/quests/join-dao")
        fireEvent.click(screen.getByRole("button", { name: /verify on-chain/i }))
        await waitFor(() =>
            expect(screen.getByText("Not available on this network yet: gno.land/r/samcrew/memba_dao is not deployed.")).toBeInTheDocument(),
        )
        expect(screen.queryByText(/complete the action/i)).toBeNull()
    })

    it("still reads as 'not met yet' for any other rejection", async () => {
        completeQuestVerified.mockRejectedValue(new Error("[failed_precondition] quest requirements not met on-chain"))
        renderQuest("/pearl/quests/join-dao")
        fireEvent.click(screen.getByRole("button", { name: /verify on-chain/i }))
        await waitFor(() => expect(screen.getByText(/complete the action, then try again/i)).toBeInTheDocument())
    })

    it("waits for the server before completing a creator-only team quest", async () => {
        completeQuestVerified.mockRejectedValue(new Error("team creator requirement not met"))
        renderQuest("/pearl/quests/create-team")
        fireEvent.click(screen.getByRole("button", { name: "Verify with Memba" }))
        await waitFor(() => expect(screen.getByText(/Couldn't verify this action yet/)).toBeInTheDocument())
        expect(screen.queryByText("Completed")).toBeNull()
        expect(completeQuestVerified).toHaveBeenCalledWith("create-team", "", expect.objectContaining({ userAddress: ADDR }))
    })

    it("blocks generic completion while auth still belongs to the previous wallet", () => {
        tokenWallet.address = "g1previouswallet"
        renderQuest("/pearl/quests/connect-wallet")
        fireEvent.click(screen.getByRole("button", { name: "Check Completion" }))
        expect(screen.getByText("Sign in with this wallet to verify.")).toBeInTheDocument()
        expect(screen.queryByText("Completed")).toBeNull()
        expect(localStorage.getItem(`memba_quests_${ADDR}`)).toBeNull()
    })
})
