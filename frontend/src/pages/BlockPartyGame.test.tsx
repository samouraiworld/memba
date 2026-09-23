// frontend/src/pages/BlockPartyGame.test.tsx
import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Code, ConnectError } from "@connectrpc/connect";
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
import { initGame, step, type Move } from "../game/engine";
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
    localStorage.clear();
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

  it("falls into Practice when the service has Daily disabled, and keeps Daily honest", async () => {
    vi.mocked(gameApi.getDailyChallenge).mockRejectedValue(
      new ConnectError("block party is disabled", Code.Unimplemented)
    );
    wrap(<BlockPartyGame />);

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /practice/i })).toHaveAttribute("aria-selected", "true")
    );
    expect(screen.getByText(/daily ranked play is paused/i)).toBeTruthy();
    // A disabled service is final: no retries.
    expect(gameApi.getDailyChallenge).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: /daily/i }));
    expect(screen.getByText(/daily play is paused/i)).toBeTruthy();
    expect(screen.queryByText(/leaderboard unavailable/i)).toBeNull();
    expect(screen.queryByText(/0 moves remaining/i)).toBeNull();
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

  describe("daily run persistence", () => {
    // Enumerate with key(i): this test environment's Storage does not expose keys to Object.keys.
    const runKeys = () => {
      const out: string[] = [];
      for (let k = 0; k < localStorage.length; k++) {
        const key = localStorage.key(k);
        if (key?.startsWith("bp:run:v1:")) out.push(key);
      }
      return out;
    };
    const storedLog = () => {
      const keys = runKeys();
      expect(keys).toHaveLength(1);
      return (JSON.parse(localStorage.getItem(keys[0])!) as { log: string }).log;
    };

    async function readyDaily() {
      const view = wrap(<BlockPartyGame />);
      await waitFor(() => expect(screen.getByText(/block #42/i)).toBeTruthy());
      await waitFor(() => expect(screen.getByText(/live daily/i)).toBeTruthy());
      return view;
    }

    it("restores an in-progress Daily run after a reload instead of dealing a fresh board", async () => {
      const first = await readyDaily();
      for (let i = 0; i < 3; i++) playOneMove();
      const board = cells();
      const log = storedLog();
      expect(log).toHaveLength(3);
      first.unmount();

      await readyDaily();
      await waitFor(() => expect(cells()).toEqual(board));
      expect(screen.getByText("27")).toBeTruthy(); // moves remaining carried over
      expect(storedLog()).toBe(log);
    });

    it("restores a finished, unsubmitted run as finished", async () => {
      const first = await readyDaily();
      const key = runKeys()[0];
      first.unmount();
      localStorage.setItem(key, JSON.stringify({
        version: 1, date: TODAY, seed: 12345, modifier: "standard", log: legalLog(12345, 30),
      }));

      await readyDaily();
      expect(await screen.findByRole("heading", { name: /round complete/i })).toBeTruthy();
    });

    it("ignores a saved run for a different challenge", async () => {
      const first = await readyDaily();
      const key = runKeys()[0];
      first.unmount();
      localStorage.setItem(key, JSON.stringify({ version: 1, date: TODAY, seed: 999, modifier: "standard", log: "L" }));

      await readyDaily();
      await waitFor(() => expect(cells()).toEqual(openingCells(12345)));
      expect(storedLog()).toBe("");
    });

    it("ignores a corrupt saved run", async () => {
      const first = await readyDaily();
      const key = runKeys()[0];
      first.unmount();
      for (const raw of ["{oops", JSON.stringify({ version: 1, date: TODAY, seed: 12345, modifier: "standard", log: "LLLLLLLLLLLLLLLL" })]) {
        localStorage.setItem(key, raw);
        const view = await readyDaily();
        await waitFor(() => expect(cells()).toEqual(openingCells(12345)));
        expect(storedLog()).toBe("");
        view.unmount();
      }
    });

    it("never persists Practice moves", async () => {
      await readyDaily();
      fireEvent.click(screen.getByRole("tab", { name: /practice/i }));
      for (let i = 0; i < 3; i++) playOneMove();
      expect(storedLog()).toBe("");
    });
  });

  describe("undo", () => {
    it("steps back in Practice from the button and the U key", async () => {
      wrap(<BlockPartyGame />);
      await waitFor(() => expect(screen.getByRole("grid")).toBeTruthy());
      fireEvent.click(screen.getByRole("tab", { name: /practice/i }));
      const undo = screen.getByRole("button", { name: /^undo/i });
      expect(undo).toBeDisabled();

      const start = cells();
      playOneMove();
      expect(undo).toBeEnabled();
      fireEvent.click(undo);
      expect(cells()).toEqual(start);

      playOneMove();
      fireEvent.keyDown(window, { key: "u" });
      expect(cells()).toEqual(start);

      playOneMove();
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
      expect(cells()).toEqual(start);
    });

    it("is not offered in the ranked Daily", async () => {
      wrap(<BlockPartyGame />);
      await waitFor(() => expect(screen.getByText(/live daily/i)).toBeTruthy());
      expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
      playOneMove();
      const after = cells();
      fireEvent.keyDown(window, { key: "u" });
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
      expect(cells()).toEqual(after);
    });
  });

  describe("first-run intro", () => {
    it("shows three plain steps once and remembers the dismissal", async () => {
      const first = wrap(<BlockPartyGame />);
      const intro = await screen.findByRole("region", { name: /how to play/i });
      expect(intro).toHaveTextContent(/swipe or the arrow keys/i);
      expect(intro).toHaveTextContent(/equal numbers/i);
      expect(intro).toHaveTextContent(/one ranked run per day/i);
      fireEvent.click(screen.getByRole("button", { name: /got it/i }));
      expect(screen.queryByRole("region", { name: /how to play/i })).toBeNull();
      expect(localStorage.getItem("bp:intro:v1")).toBe("1");
      first.unmount();

      wrap(<BlockPartyGame />);
      await waitFor(() => expect(screen.getByRole("grid")).toBeTruthy());
      expect(screen.queryByRole("region", { name: /how to play/i })).toBeNull();
    });

    it("uses plain language on the page, keeping the lab flavour to the kicker", async () => {
      wrap(<BlockPartyGame />);
      await waitFor(() => expect(screen.getByRole("grid")).toBeTruthy());
      expect(screen.getByText(/equal numbers merge and add to your score/i)).toBeTruthy();
      expect(screen.queryByText(/route matching signals/i)).toBeNull();
      expect(screen.queryByText(/nodes fuse/i)).toBeNull();
      expect(screen.getByText(/signal lab/i)).toBeTruthy();
    });
  });
});

function cells(): string[] {
  return Array.from(screen.getByRole("grid").querySelectorAll('[role="gridcell"]')).map(
    (el) => el.getAttribute("aria-label") ?? "",
  );
}

function openingCells(seed: number): string[] {
  const board = initGame(seed, "standard").board;
  return board.map((v, i) => `Row ${Math.floor(i / 4) + 1}, column ${(i % 4) + 1}, ${v === 0 ? "empty" : v}`);
}

/** Press arrows on the board until one changes it. */
function playOneMove(): void {
  const grid = screen.getByRole("grid");
  const before = cells().join("|");
  for (const key of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]) {
    fireEvent.keyDown(grid, { key });
    if (cells().join("|") !== before) return;
  }
  throw new Error("no direction changed the board");
}

function legalLog(seed: number, n: number): string {
  let g = initGame(seed, "standard");
  let log = "";
  const dirs: Move[] = ["L", "U", "R", "D"];
  for (let i = 0; log.length < n && i < n * 8 && !g.over; i++) {
    const next = step(g, dirs[i % 4]);
    if (next !== g) { g = next; log += dirs[i % 4]; }
  }
  return log;
}
