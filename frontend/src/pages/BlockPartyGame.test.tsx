// frontend/src/pages/BlockPartyGame.test.tsx
import { beforeEach, describe, it, expect, vi } from "vitest";
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
const TODAY = new Date().toISOString().slice(0, 10);
const readyChallenge = {
  date: TODAY, seed: 12345, modifier: "standard", par: 1500n, moveBudget: 30,
  blockHeight: 42n, blockHash: "abc", ready: true,
};
const wrap = (ui: React.ReactNode) => {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={c}>{ui}</QueryClientProvider>);
};
describe("BlockPartyGame", () => {
  beforeEach(() => {
    vi.mocked(gameApi.getDailyChallenge).mockReset().mockResolvedValue(readyChallenge);
    vi.mocked(gameApi.getDailyLeaderboard).mockReset().mockResolvedValue({ entries: [] });
    vi.mocked(gameApi.getStreak).mockReset().mockResolvedValue({
      streak: { current: 0, longest: 0, freezesRemaining: 1 },
    });
  });

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

  // The APG keyboard contract itself is covered in
  // hooks/useTabListKeyboard.test.tsx; these pin that the mode switch is wired
  // through the hook. The companion concern — that a tab-focused arrow press
  // must NOT also move a piece via the game's window-level listener — is pinned
  // in game/hooks/useKeyboard.test.tsx.
  it("gives the mode tabs a roving tabindex (single tab stop)", async () => {
    wrap(<BlockPartyGame />);
    await waitFor(() => expect(screen.getByRole("grid")).toBeTruthy());
    expect(screen.getByRole("tab", { name: /daily/i })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: /practice/i })).toHaveAttribute("tabindex", "-1");
  });

  it("ArrowRight moves selection from Daily to Practice", async () => {
    wrap(<BlockPartyGame />);
    await waitFor(() => expect(screen.getByRole("grid")).toBeTruthy());
    fireEvent.keyDown(screen.getByRole("tab", { name: /daily/i }), { key: "ArrowRight" });
    const practice = screen.getByRole("tab", { name: /practice/i });
    expect(practice).toHaveAttribute("aria-selected", "true");
    expect(practice).toHaveAttribute("tabindex", "0");
  });

  it("does not show the game-over sheet while the challenge is loading", async () => {
    // The bug this pins: with no challenge yet, moveBudget=0 makes `0 >= 0`
    // read as budget-exhausted, and the sheet fired on first render.
    vi.mocked(gameApi.getDailyChallenge).mockImplementationOnce(() => new Promise(() => {}));
    wrap(<BlockPartyGame />);
    await waitFor(() => expect(screen.getByRole("grid")).toBeTruthy());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows an error notice with a retry action when the fetch fails — and never the sheet", async () => {
    // useDailyChallenge owns its retry policy, so keep every attempt failed.
    vi.mocked(gameApi.getDailyChallenge).mockRejectedValue(new Error("boom"));
    wrap(<BlockPartyGame />);
    await waitFor(() => expect(screen.getByText(/daily seed unavailable/i)).toBeTruthy());
    expect(screen.getByRole("button", { name: /retry daily/i })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("re-seeds the ranked board when the challenge arrives", async () => {
    // Cold ranked load starts on the placeholder seed 0; without a re-seed the
    // player plays a board the server never issued and the replay is garbage.
    let resolveChallenge!: (v: unknown) => void;
    vi.mocked(gameApi.getDailyChallenge).mockImplementationOnce(
      () => new Promise((res) => { resolveChallenge = res; }) as never
    );
    wrap(<BlockPartyGame />);
    await waitFor(() => expect(screen.getByRole("grid")).toBeTruthy());

    resolveChallenge({
      date: TODAY, seed: 12345, modifier: "standard", par: 1500n, moveBudget: 30,
      blockHeight: 42n, blockHash: "abc", ready: true,
    });

    const { initGame } = await import("../game/engine");
    const expected = initGame(12345, "standard").board.map((v) => (v === 0 ? "" : String(v)));
    // Position-aware: read all 16 cells in board order (empty cells included),
    // so a coincidental same-value spawn on a different square still fails.
    await waitFor(() => {
      const cells = Array.from(screen.getByRole("grid").querySelectorAll('[role="gridcell"]')).map(
        (el) => {
          const label = el.getAttribute("aria-label") ?? "";
          return label.endsWith("empty") ? "" : (label.match(/column \d+, (\d+)/)?.[1] ?? "");
        }
      );
      expect(cells).toEqual(expected);
    });
  });

  it("renders the seed proof (block height, hash, verify link) once the challenge is ready", async () => {
    wrap(<BlockPartyGame />);
    await waitFor(() => expect(screen.getByText(/block #42/i)).toBeTruthy());
    expect(screen.getByRole("link", { name: /verify/i })).toBeTruthy();
  });

  it("shows the not-ready notice and still renders a board when the daily challenge isn't ready", async () => {
    vi.mocked(gameApi.getDailyChallenge).mockResolvedValueOnce({
      date: TODAY, seed: 12345, modifier: "standard", par: 1500n, moveBudget: 30,
      blockHeight: 42n, blockHash: "abc", ready: false,
    });
    wrap(<BlockPartyGame />);

    await waitFor(() =>
      expect(screen.getByText(/Today's board is still minting\./i)).toBeTruthy()
    );
    expect(screen.getByRole("button", { name: /play practice/i })).toBeTruthy();
    expect(screen.getByRole("grid")).toBeTruthy();
  });
});
