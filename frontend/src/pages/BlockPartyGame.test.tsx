// frontend/src/pages/BlockPartyGame.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
vi.mock("../lib/gameApi", () => ({
  gameApi: {
    getDailyChallenge: vi.fn().mockResolvedValue({
      date: "2026-07-06", seed: 12345, modifier: "standard", par: 1500n, moveBudget: 30,
      blockHeight: 42n, blockHash: "abc", ready: true,
    }),
    getDailyLeaderboard: vi.fn().mockResolvedValue({ entries: [] }),
    getStreak: vi.fn().mockResolvedValue({ streak: { current: 0, longest: 0, freezesRemaining: 1 } }),
  },
}));
vi.mock("../hooks/useAdena", () => ({ useAdena: () => ({ installed: false, connected: false, address: "" }) }));
import { gameApi } from "../lib/gameApi";
import BlockPartyGame from "./BlockPartyGame";
const wrap = (ui: React.ReactNode) => {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={c}>{ui}</QueryClientProvider>);
};
describe("BlockPartyGame", () => {
  it("renders the daily header and board without a wallet", async () => {
    wrap(<BlockPartyGame />);
    await waitFor(() => expect(screen.getByRole("grid")).toBeTruthy());
    expect(screen.getByText(/Block Party/i)).toBeTruthy();
  });

  it("switches to Practice mode and keeps the board rendered", async () => {
    wrap(<BlockPartyGame />);
    await waitFor(() => expect(screen.getByRole("grid")).toBeTruthy());

    fireEvent.click(screen.getByRole("tab", { name: /practice/i }));

    expect(screen.getByRole("tab", { name: /practice/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("grid")).toBeTruthy();
  });

  it("shows the not-ready notice and still renders a board when the daily challenge isn't ready", async () => {
    vi.mocked(gameApi.getDailyChallenge).mockResolvedValueOnce({
      date: "2026-07-06", seed: 12345, modifier: "standard", par: 1500n, moveBudget: 30,
      blockHeight: 42n, blockHash: "abc", ready: false,
    });
    wrap(<BlockPartyGame />);

    await waitFor(() =>
      expect(screen.getByText(/Today's board mints shortly — try Practice while you wait\./i)).toBeTruthy()
    );
    expect(screen.getByRole("button", { name: /play practice/i })).toBeTruthy();
    expect(screen.getByRole("grid")).toBeTruthy();
  });
});
