import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
vi.mock("../../lib/gameApi", () => ({
  gameApi: { getDailyLeaderboard: vi.fn().mockResolvedValue({
    entries: [{ address: "g1winner", score: 9000n, rank: 1 }, { address: "g1second", score: 800n, rank: 2 }],
  }) },
}));
import { DailyLeaderboardPanel } from "./DailyLeaderboardPanel";
import { gameApi } from "../../lib/gameApi";

const entries = {
  entries: [{ address: "g1winner", score: 9000n, rank: 1 }, { address: "g1second", score: 800n, rank: 2 }],
};
const wrap = (ui: React.ReactNode) => {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={c}>{ui}</QueryClientProvider>);
};
describe("DailyLeaderboardPanel", () => {
  beforeEach(() => {
    vi.mocked(gameApi.getDailyLeaderboard).mockReset().mockResolvedValue(entries);
  });

  it("renders ranked entries with numeric scores", async () => {
    wrap(<DailyLeaderboardPanel date="2026-07-06" />);
    await waitFor(() => expect(screen.getByText("9,000")).toBeTruthy());
    expect(screen.getByText("#1")).toBeTruthy();
  });

  it("distinguishes a failed request from a legitimate empty leaderboard and retries", async () => {
    const getLeaderboard = vi.mocked(gameApi.getDailyLeaderboard);
    getLeaderboard.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ entries: [] });
    wrap(<DailyLeaderboardPanel date="2026-07-06" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/not an empty board/i);
    fireEvent.click(screen.getByRole("button", { name: /retry leaderboard/i }));
    expect(await screen.findByText(/no verified scores yet/i)).toBeTruthy();
    expect(getLeaderboard).toHaveBeenCalledTimes(2);
  });

  it("keeps leaderboard caches separate across source scopes", async () => {
    wrap(
      <>
        <DailyLeaderboardPanel date="2026-07-06" scope="pearl" />
        <DailyLeaderboardPanel date="2026-07-06" scope="testnet" />
      </>,
    );
    await waitFor(() => expect(gameApi.getDailyLeaderboard).toHaveBeenCalledTimes(2));
  });
});
