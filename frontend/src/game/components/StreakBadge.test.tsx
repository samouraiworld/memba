import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/gameApi", () => ({ gameApi: { getStreak: vi.fn() } }));

import { gameApi } from "../../lib/gameApi";
import { StreakBadge } from "./StreakBadge";

function renderBadge(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("StreakBadge", () => {
  beforeEach(() => vi.mocked(gameApi.getStreak).mockReset());

  it("labels a guest's local streak without making a request", () => {
    renderBadge(<StreakBadge scope="chain-a" localStreak={3} />);
    expect(screen.getByLabelText("3 day streak")).toBeTruthy();
    expect(gameApi.getStreak).not.toHaveBeenCalled();
  });

  it("does not misreport a failed remote streak as zero and offers retry", async () => {
    const getStreak = vi.mocked(gameApi.getStreak);
    getStreak
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ streak: { current: 4, longest: 8, freezesRemaining: 1 } } as Awaited<ReturnType<typeof gameApi.getStreak>>);
    renderBadge(<StreakBadge address="g1player" scope="chain-a" localStreak={2} />);

    expect(await screen.findByText(/streak unavailable/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    await waitFor(() => expect(screen.getByLabelText("4 day streak")).toBeTruthy());
    expect(getStreak).toHaveBeenCalledTimes(2);
  });

  it("refetches a connected streak after a network switch", async () => {
    const getStreak = vi.mocked(gameApi.getStreak);
    getStreak
      .mockResolvedValueOnce({ streak: { current: 2, longest: 2, freezesRemaining: 0 } } as Awaited<ReturnType<typeof gameApi.getStreak>>)
      .mockResolvedValueOnce({ streak: { current: 5, longest: 5, freezesRemaining: 0 } } as Awaited<ReturnType<typeof gameApi.getStreak>>);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const badge = (scope: string) => <QueryClientProvider client={client}><StreakBadge address="g1player" scope={scope} localStreak={0} /></QueryClientProvider>;
    const view = render(badge("chain-a"));
    expect(await screen.findByLabelText("2 day streak")).toBeTruthy();
    view.rerender(badge("chain-b"));
    expect(await screen.findByLabelText("5 day streak")).toBeTruthy();
    expect(getStreak).toHaveBeenCalledTimes(2);
  });
});
