import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
vi.mock("../../lib/gameApi", () => ({
  gameApi: { getDailyLeaderboard: vi.fn().mockResolvedValue({
    entries: [{ address: "g1winner", score: 9000n, rank: 1 }, { address: "g1second", score: 800n, rank: 2 }],
  }) },
}));
import { DailyLeaderboardPanel } from "./DailyLeaderboardPanel";
const wrap = (ui: React.ReactNode) => {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={c}>{ui}</QueryClientProvider>);
};
describe("DailyLeaderboardPanel", () => {
  it("renders ranked entries with numeric scores", async () => {
    wrap(<DailyLeaderboardPanel date="2026-07-06" />);
    await waitFor(() => expect(screen.getByText("9,000")).toBeTruthy());
    expect(screen.getByText("#1")).toBeTruthy();
  });
});
