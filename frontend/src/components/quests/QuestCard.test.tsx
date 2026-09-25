import { describe, it, expect } from "vitest"
import { screen } from "@testing-library/react"
import { Routes, Route } from "react-router-dom"
import { renderWithProviders } from "../../test/test-utils"
import { QuestCard } from "./QuestCard"
import { getQuestById } from "../../lib/gnobuilders"

function renderCard(network: string, id: string) {
    const quest = getQuestById(id)!
    return renderWithProviders(
        <Routes>
            <Route path="/:network/quests" element={<QuestCard quest={quest} completed={false} available />} />
        </Routes>,
        { route: `/${network}/quests` },
    )
}

describe("QuestCard — network availability", () => {
    it("marks a quest whose realm isn't on the network as not available", () => {
        renderCard("mainnet", "join-dao")
        expect(screen.getByText("Not available on this network yet")).toBeInTheDocument()
        expect(screen.queryByText("Available")).toBeNull()
        expect(screen.getByTestId("quest-join-dao")).toHaveClass("k-quest-card--locked")
    })

    it("keeps the quest available where its realm is deployed", () => {
        renderCard("pearl", "join-dao")
        expect(screen.getByText("Available")).toBeInTheDocument()
    })

    it("leaves quests that read no Memba realm untouched on mainnet", () => {
        renderCard("mainnet", "register-username")
        expect(screen.getByText("Available")).toBeInTheDocument()
    })
})
