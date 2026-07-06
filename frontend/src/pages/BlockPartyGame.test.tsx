// frontend/src/pages/BlockPartyGame.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
});
