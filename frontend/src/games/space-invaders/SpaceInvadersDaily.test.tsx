import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import SpaceInvaders from "./SpaceInvaders";

// Shell/daily tests drive thousands of deterministic ticks to game over. The
// Canvas renderer has its own focused suite; stubbing it here keeps the full
// repository run from spending its per-test budget painting every synthetic
// frame in JSDOM.
vi.mock("./render/draw", () => ({ draw: vi.fn() }));

// Daily/Free mode wiring: the daily run seeds from the shared UTC day string,
// records the quantized input log, self-verifies it at game over, and only
// then (and only with both flags on) offers the on-chain certify control.
// Free play records the same replay without using the legacy Daily publisher.

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
  const surface = screen.getByRole("group", { name: /signal defense game surface/i });
  flushFrame(0);
  fireEvent.keyDown(surface, { key: "ArrowRight" });
  flushFrame(250);
  fireEvent.keyUp(surface, { key: "ArrowRight" });
  let t = 250;
  // Drive the remaining deterministic frame budget in one React transaction.
  // Querying the DOM and opening an `act` scope for every synthetic frame made
  // these full-game scenarios sensitive to repository-wide worker contention.
  act(() => {
    for (let i = 0; i < maxFrames; i++) {
      t += 250;
      const cbs = rafQueue;
      rafQueue = [];
      for (const cb of cbs) cb(t);
    }
  });
  if (!screen.queryByText(/game over/i)) {
    throw new Error("run did not reach game over within the frame budget");
  }
}

describe("SpaceInvaders daily mode", () => {
  it("offers a Daily/Free choice on the ready overlay", () => {
    render(<SpaceInvaders />);
    expect(screen.getByRole("button", { name: /daily run/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /free play/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /defend the gno relay/i })).toBeInTheDocument();
    expect(screen.queryByText(/space fire/i)).toBeNull();
  });

  it("starts the shared UTC Daily without a second input", () => {
    render(<SpaceInvaders />);
    fireEvent.click(screen.getByRole("button", { name: /daily run/i }));
    expect(screen.getByText(/daily · 2026-09-01.*relay standing by/i)).toBeInTheDocument();
    // No second prompt: the next fixed step consumes the recorded launch pulse.
    expect(screen.queryByRole("heading", { name: /relay standing by/i })).not.toBeInTheDocument();
  });

  it("self-verifies the recorded daily run at game over (Verified badge, day pinned)", () => {
    render(<SpaceInvaders />);
    fireEvent.click(screen.getByRole("button", { name: /daily run/i }));
    nudgeAndDie();
    expect(screen.getByText(/daily · 2026-09-01 · replay checked/i)).toBeInTheDocument();
    expect(screen.getByText(/replay checked on this device/i)).toBeInTheDocument();
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
    expect(screen.getByText(/replay checked on this device/i)).toBeInTheDocument();
    expect(screen.queryByText(/certify on-chain/i)).toBeNull();
  });

  it("Play again on a daily reuses the day's seed (the chip still names the same day)", () => {
    render(<SpaceInvaders />);
    fireEvent.click(screen.getByRole("button", { name: /daily run/i }));
    nudgeAndDie();
    fireEvent.click(screen.getByRole("button", { name: /play again/i }));
    // Restart keeps the day and immediately queues the next launch pulse.
    expect(screen.getByText(/daily · 2026-09-01.*relay standing by/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /relay standing by/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/game over/i)).toBeNull();
  });

  it("free play emits a locally verified replay without a Daily publisher", () => {
    // A fixed prop seed makes the free run deterministic for the drive loop.
    const onReplayReady = vi.fn();
    render(<SpaceInvaders seed={3070363140} onReplayReady={onReplayReady} />);
    fireEvent.click(screen.getByRole("button", { name: /free play/i }));
    nudgeAndDie();
    expect(screen.getByText(/game over/i)).toBeInTheDocument();
    expect(screen.queryByText(/daily ·/i)).toBeNull();
    expect(screen.queryByText(/verified/i)).toBeNull();
    expect(screen.queryByText(/replay not verified/i)).toBeNull();
    expect(screen.getByText(/free play · replay checked on this device/i)).toBeInTheDocument();
    expect(screen.queryByText(/certify/i)).toBeNull();
    expect(onReplayReady).toHaveBeenCalledTimes(1);
    expect(onReplayReady).toHaveBeenCalledWith(expect.objectContaining({ mode: "free", seed: 3070363140, verified: true, simVersion: 1 }));
    expect(onReplayReady.mock.calls[0][0].events[0]).toEqual(expect.arrayContaining([0]));
  });

  it("Menu preserves the completed daily snapshot and can return to its result", () => {
    render(<SpaceInvaders />);
    fireEvent.click(screen.getByRole("button", { name: /daily run/i }));
    nudgeAndDie();
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    expect(screen.getByRole("button", { name: /daily run/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /game over/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /back to result/i }));
    expect(screen.getByRole("heading", { name: /game over/i })).toHaveFocus();
    expect(screen.getByText(/daily · 2026-09-01 · replay checked/i)).toBeInTheDocument();
  });
});
