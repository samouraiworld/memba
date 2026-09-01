import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import SpaceInvaders from "./SpaceInvaders";

// Daily/Free mode wiring: the daily run seeds from the shared UTC day string,
// records the quantized input log, self-verifies it at game over, and only
// then (and only with both flags on) offers the on-chain certify control.
// Free play is the untouched default — starts on first input, records nothing.

// The lazy certify chunk pulls in wallet hooks — stub it with a recognizable
// control so these tests assert the RENDER GATE, not the submit flow
// (SpaceInvadersCertify.test.tsx covers the component itself).
vi.mock("./SpaceInvadersCertify", () => ({
  default: ({ run }: { run: { seed: string; finalTick: number } }) => (
    <button type="button">
      Certify on-chain {run.seed} @{run.finalTick}
    </button>
  ),
}));

let rafQueue: FrameRequestCallback[] = [];
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
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => rafQueue.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  localStorage.clear();
  // Pin the UTC day: invaders-2026-09-01 (engine seed 3070363140 — an
  // undefended run ends in well under 5k ticks). Only Date is faked.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** Start the run with a short steer nudge, then idle until the game-over sheet. */
function nudgeAndDie(maxFrames = 600): void {
  flushFrame(0);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  flushFrame(250);
  window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight" }));
  let t = 250;
  for (let i = 0; i < maxFrames; i++) {
    t += 250;
    flushFrame(t);
    if (screen.queryByText(/game over/i)) return;
  }
  throw new Error("run did not reach game over within the frame budget");
}

describe("SpaceInvaders daily mode", () => {
  it("offers a Daily/Free choice on the ready overlay", () => {
    render(<SpaceInvaders />);
    expect(screen.getByRole("button", { name: /daily run/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /free play/i })).toBeInTheDocument();
    // The original ready prompt survives (the polish suite pins it too).
    expect(screen.getByText(/space fire/i)).toBeInTheDocument();
  });

  it("arms the day's shared seed on Daily: the chip names the UTC day and the run awaits first input", () => {
    render(<SpaceInvaders />);
    fireEvent.click(screen.getByRole("button", { name: /daily run/i }));
    expect(screen.getByText(/daily · 2026-09-01/i)).toBeInTheDocument();
    // Still on the ready overlay — the engine starts on first meaningful input
    // (never forced from the shell, so the replay reproduces the start too).
    expect(screen.getByText(/space fire/i)).toBeInTheDocument();
  });

  it("self-verifies the recorded daily run at game over (Verified badge, day pinned)", () => {
    render(<SpaceInvaders />);
    fireEvent.click(screen.getByRole("button", { name: /daily run/i }));
    nudgeAndDie();
    expect(screen.getByText(/daily · 2026-09-01/i)).toBeInTheDocument();
    expect(screen.getByText(/verified ✓/i)).toBeInTheDocument();
    // Certify flags are OFF here — the wallet surface must not render.
    expect(screen.queryByText(/certify on-chain/i)).toBeNull();
  });

  it("renders the certify control only when BOTH flags are on and the run verified", async () => {
    vi.stubEnv("VITE_ENABLE_SPACE_INVADERS", "true");
    vi.stubEnv("VITE_ENABLE_SPACE_INVADERS_CERTIFY", "true");
    render(<SpaceInvaders />);
    fireEvent.click(screen.getByRole("button", { name: /daily run/i }));
    nudgeAndDie();
    // The stubbed control echoes the submit identity: the day's seed string
    // and a positive finalTick (the wire's required SI field).
    const btn = await screen.findByRole("button", { name: /certify on-chain invaders-2026-09-01 @\d+/i });
    expect(btn).toBeInTheDocument();
  });

  it("keeps the certify control dark when only the play flag is on", async () => {
    vi.stubEnv("VITE_ENABLE_SPACE_INVADERS", "true");
    vi.stubEnv("VITE_ENABLE_SPACE_INVADERS_CERTIFY", "false");
    render(<SpaceInvaders />);
    fireEvent.click(screen.getByRole("button", { name: /daily run/i }));
    nudgeAndDie();
    expect(screen.getByText(/verified ✓/i)).toBeInTheDocument();
    expect(screen.queryByText(/certify on-chain/i)).toBeNull();
  });

  it("Play again on a daily reuses the day's seed (the chip still names the same day)", () => {
    render(<SpaceInvaders />);
    fireEvent.click(screen.getByRole("button", { name: /daily run/i }));
    nudgeAndDie();
    fireEvent.click(screen.getByRole("button", { name: /play again/i }));
    // Back on the ready overlay, still armed for the SAME day (re-attest can
    // only raise a score, so replaying the daily is safe).
    expect(screen.getByText(/daily · 2026-09-01/i)).toBeInTheDocument();
    expect(screen.getByText(/space fire/i)).toBeInTheDocument();
    expect(screen.queryByText(/game over/i)).toBeNull();
  });

  it("free play stays the no-recording default: no daily chip, no verify badge, no certify", () => {
    // A fixed prop seed makes the free run deterministic for the drive loop.
    render(<SpaceInvaders seed={3070363140} />);
    nudgeAndDie();
    expect(screen.getByText(/game over/i)).toBeInTheDocument();
    expect(screen.queryByText(/daily ·/i)).toBeNull();
    expect(screen.queryByText(/verified/i)).toBeNull();
    expect(screen.queryByText(/unverified/i)).toBeNull();
    expect(screen.queryByText(/certify/i)).toBeNull();
  });

  it("Menu from a daily game over returns to the free-mode chooser", () => {
    render(<SpaceInvaders />);
    fireEvent.click(screen.getByRole("button", { name: /daily run/i }));
    nudgeAndDie();
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    expect(screen.getByRole("button", { name: /daily run/i })).toBeInTheDocument();
    expect(screen.queryByText(/daily · 2026-09-01/i)).toBeNull();
  });
});
