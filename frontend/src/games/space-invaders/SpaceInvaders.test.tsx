import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import SpaceInvaders from "./SpaceInvaders";

beforeEach(() => {
  const ctx = {
    clearRect: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
    fillStyle: "", set globalAlpha(_v: number) {},
  } as unknown as CanvasRenderingContext2D;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as never;
  // deterministic rAF: run one frame then stop
  let called = false;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    if (!called) { called = true; setTimeout(() => cb(16), 0); }
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  localStorage.clear();
});

describe("SpaceInvaders shell", () => {
  it("renders the HUD and a start prompt", () => {
    render(<SpaceInvaders />);
    expect(screen.getByText(/score/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/space invaders play area/i)).toBeInTheDocument();
  });

  it("shows a game-over sheet when the game ends", () => {
    render(<SpaceInvaders initialState={{ phase: "gameover", score: 90 } as never} />);
    expect(screen.getByText(/game over/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /play again/i })).toBeInTheDocument();
  });
});
