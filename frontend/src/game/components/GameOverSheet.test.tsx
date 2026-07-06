import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GameOverSheet } from "./GameOverSheet";

const baseProps = {
  date: "2026-07-06", score: 1200, par: 1500, moveLog: "URDL", board: new Array(16).fill(0),
  modifier: "standard", onShare: vi.fn(),
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
});
