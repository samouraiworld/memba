import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getContributors } from "../../../lib/gnoloveApi"
import { LeaderboardTab } from "./LeaderboardTab"

vi.mock("../../../lib/gnoloveApi", () => ({ getContributors: vi.fn() }))

describe("Directory contributor leaderboard", () => {
    it("ranks by displayed score and opens the selected contributor", async () => {
        vi.mocked(getContributors).mockResolvedValue({ users: [
            { login: "lower", name: "Lower", score: 3, avatarUrl: "" },
            { login: "higher", name: "Higher", score: 10, avatarUrl: "" },
        ] } as never)
        const navigate = vi.fn()
        render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LeaderboardTab navigate={navigate} /></QueryClientProvider>)
        const higher = await screen.findByRole("button", { name: /Higher/ })
        const lower = screen.getByRole("button", { name: /Lower/ })
        expect(higher).toHaveTextContent("#1")
        expect(lower).toHaveTextContent("#2")
        fireEvent.click(higher)
        expect(navigate).toHaveBeenCalledWith("/gnolove/contributor/higher")
    })
})
