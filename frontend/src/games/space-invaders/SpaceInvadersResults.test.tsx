import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import SpaceInvaders from "./SpaceInvaders";

// Full-shell coverage for the results card: the NEW BEST moment must compare
// against the best as it stood BEFORE the finished run was saved.
vi.mock("./render/draw", () => ({ draw: vi.fn() }));

let rafQueue: FrameRequestCallback[] = [];
let now = 0;

function flushFrame(time: number) {
  const cbs = rafQueue;
  rafQueue = [];
  act(() => {
    for (const cb of cbs) cb(time);
  });
}

beforeEach(() => {
  const ctx = {
    clearRect: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
    translate: vi.fn(), fillText: vi.fn(),
    fillStyle: "", set globalAlpha(_v: number) {}, set font(_v: string) {}, set textAlign(_v: string) {},
  } as unknown as CanvasRenderingContext2D;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as never;
  rafQueue = [];
  now = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => rafQueue.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  localStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

/** Hold fire from a fixed spot until game over (deterministic seed), so the
 *  run scores points instead of idling to a zero. */
function playToGameOver(maxFrames = 2000): void {
  const surface = screen.getByRole("group", { name: /signal defense game surface/i });
  flushFrame(now);
  fireEvent.keyDown(surface, { key: " " });
  act(() => {
    for (let i = 0; i < maxFrames && !document.querySelector(".si-gameover"); i++) {
      now += 250;
      const cbs = rafQueue;
      rafQueue = [];
      for (const cb of cbs) cb(now);
    }
  });
  fireEvent.keyUp(surface, { key: " " });
  if (!screen.queryByText(/game over/i)) throw new Error("run did not reach game over");
  // Let the score count-up finish.
  for (let i = 0; i < 8; i++) {
    now += 250;
    flushFrame(now);
  }
}

describe("SpaceInvaders results card", () => {
  it("celebrates a new best, then not for an identical replay of the same seed", () => {
    localStorage.setItem("memba.space-invaders.best", "1");
    render(<SpaceInvaders seed={3070363140} />);
    fireEvent.click(screen.getByRole("button", { name: /free play/i }));
    playToGameOver();
    expect(screen.getByText(/new best/i, { selector: ".si-new-best" })).toBeInTheDocument();
    // The live region announces it too.
    expect(screen.getByText(/signal lost\. final score \d+\. new best\./i)).toBeInTheDocument();
    expect(screen.getByText(`Previous best ${(1).toLocaleString()}`)).toBeInTheDocument();
    const first = screen.getByTestId("si-final-score").textContent;
    expect(Number(first?.replace(/\D/g, ""))).toBeGreaterThan(1);
    expect(screen.getByLabelText("Run summary")).toHaveTextContent(/accuracy\s*\d+%/i);

    fireEvent.click(screen.getByRole("button", { name: /play again/i }));
    playToGameOver();
    expect(screen.getByTestId("si-final-score").textContent).toBe(first);
    // A tie with the saved best is not a new best.
    expect(screen.queryByText(/new best/i)).toBeNull();
    expect(screen.getByText(`Best signal ${first}`)).toBeInTheDocument();
  });

  it("does not celebrate a run that falls short of the stored best", () => {
    localStorage.setItem("memba.space-invaders.best", "999999");
    render(<SpaceInvaders seed={3070363140} />);
    fireEvent.click(screen.getByRole("button", { name: /free play/i }));
    playToGameOver();
    expect(screen.queryByText(/new best/i)).toBeNull();
    expect(screen.getByRole("button", { name: /share result/i })).toBeInTheDocument();
  });
});
