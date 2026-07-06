import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { GameOverSheet } from "./GameOverSheet";
import { gameApi } from "../../lib/gameApi";

vi.mock("../../lib/gameApi", () => ({ gameApi: { submitScore: vi.fn() } }));

const baseProps = {
  date: "2026-07-06", score: 1200, par: 1500, moveLog: "URDL", board: new Array(16).fill(0),
  modifier: "standard",
};

describe("GameOverSheet", () => {
  it("guest without Adena sees a desktop note, still can share, never a broken Connect", () => {
    render(<GameOverSheet {...baseProps}
      wallet={{ installed: false, connect: vi.fn() }}
      auth={{ isAuthenticated: false }} />);
    expect(screen.getByRole("button", { name: /share/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^connect/i })).toBeNull();
    expect(screen.getByText(/adena extension/i)).toBeTruthy();
  });

  it("authenticated: submits (token, date, moveLog) exactly once — never a score — and shows the percentile", async () => {
    const submit = vi.mocked(gameApi.submitScore);
    submit.mockResolvedValue({ score: 1200n, percentile: 88, par: 1500n, streak: { current: 3, longest: 3, freezesRemaining: 1 } } as any);
    const token = { nonce: "n", userAddress: "g1me", expiration: "", serverSignature: "s" } as any;
    render(<GameOverSheet {...baseProps}
      wallet={{ installed: true, connect: vi.fn() }}
      auth={{ isAuthenticated: true, token }} />);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith(token, baseProps.date, baseProps.moveLog); // token, date, moveLog — no score arg
    await screen.findByText(/88%/);
  });

  it("Share button actually shares: falls back to clipboard with the real result text", async () => {
    const originalShare = (navigator as unknown as { share?: unknown }).share;
    // Ensure navigator.share is undefined so the clipboard fallback path is taken.
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<GameOverSheet {...baseProps}
      wallet={{ installed: false, connect: vi.fn() }}
      auth={{ isAuthenticated: false }} />);

    screen.getByRole("button", { name: /share/i }).click();

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const shared = writeText.mock.calls[0][0] as string;
    expect(shared).toMatch(/beat me/i);
    expect(shared).toMatch(/Block Party/i);

    Object.defineProperty(navigator, "share", { value: originalShare, configurable: true });
  });
});
