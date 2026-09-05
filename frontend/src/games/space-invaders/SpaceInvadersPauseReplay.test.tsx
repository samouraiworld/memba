import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import SpaceInvaders from "./SpaceInvaders";

// Determinism fix 1 (pause) — the replay-fidelity pin. While paused the shell
// must consume NO engine ticks (skip stepping, drop the rAF accumulator), so
// the recorded daily timeline is pause-free and re-simulates to the identical
// score + hash. Under the old behavior (stepping through the paused phase),
// paused wall-time advanced live ticks in a frozen world while the replay ran
// those same ticks in the PLAYING phase — the self-verify below would fail.

// The lazy certify chunk pulls in wallet hooks — stub it (this file only pins
// the daily verify pipeline, not the certify submit).
vi.mock("./SpaceInvadersCertify", () => ({
  default: () => <button type="button">Certify on-chain</button>,
}));

// Deterministic rAF: callbacks queue up and only run when a test flushes them.
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
  // Pin the UTC day so the daily seed is the known-fast-death fixture
  // (invaders-2026-09-01 → engine seed 3070363140: an undefended run ends in
  // well under 5k ticks). Only Date is faked — rAF is our own queue above.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

/** Flush 250ms frames (≈15 fixed steps each) until the game-over sheet shows. */
function driveToGameover(t0: number, maxFrames = 600): number {
  let t = t0;
  for (let i = 0; i < maxFrames; i++) {
    t += 250;
    flushFrame(t);
    if (screen.queryByText(/game over/i)) return t;
  }
  throw new Error("run did not reach game over within the frame budget");
}

function hudScore(): string | null {
  return document.querySelector(".si-stat--score strong")?.textContent ?? null;
}

function gameSurface(): HTMLElement {
  return screen.getByRole("group", { name: /signal defense game surface/i });
}

describe("pause determinism (daily replay fidelity)", () => {
  it("pause/resume mid-run: the recorded log still re-simulates to the identical score/hash", () => {
    // The load-bearing shape of this scenario: the input CHANGES after the
    // resume (firing starts only then). If paused wall-time consumed ticks —
    // the pre-fix behavior — the post-resume delta would land, in the replay,
    // on a world that had kept marching through the pause window, and the
    // re-simulated score/hash would diverge (mutation-proven: reverting the
    // pause freeze flips this run to Unverified). A pause followed by only
    // unchanged input can be re-absorbed by the game-over fixed point, which
    // is why the discriminating input change matters.
    render(<SpaceInvaders />);
    fireEvent.click(screen.getByRole("button", { name: /daily run/i }));

    // Anchor the loop clock, then start the run with a short steer nudge.
    flushFrame(0);
    fireEvent.keyDown(gameSurface(), { key: "ArrowRight" });
    flushFrame(250);
    flushFrame(500);
    fireEvent.keyUp(gameSurface(), { key: "ArrowRight" });

    // Some live play before the pause.
    let t = 500;
    for (let i = 0; i < 12; i++) {
      t += 250;
      flushFrame(t);
    }
    expect(screen.queryByText(/game over/i)).toBeNull();

    // Pause. Large wall-time gaps then elapse while paused — under the fix
    // they consume ZERO engine ticks (the accumulator is dropped every frame).
    fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    expect(screen.getByRole("heading", { name: /relay paused/i })).toBeInTheDocument();
    for (let i = 0; i < 6; i++) {
      t += 10_000;
      flushFrame(t);
    }
    expect(screen.getByRole("heading", { name: /relay paused/i })).toBeInTheDocument();

    // Resume, then START FIRING — a fresh input delta recorded after the
    // pause window — and let the run play out to game over.
    fireEvent.click(screen.getByRole("button", { name: /^resume$/i }));
    fireEvent.keyDown(gameSurface(), { key: " " });
    driveToGameover(t);

    // The self-verify (simulateReplay over the recorded wire log vs the live
    // final state) must pass — the pause left no hole in the timeline.
    expect(screen.getByText(/verified locally/i)).toBeInTheDocument();
    expect(screen.queryByText(/verification pending/i)).toBeNull();
  });

  it("a paused game consumes no ticks: score and wave are byte-identical across a long pause", () => {
    render(<SpaceInvaders />);
    fireEvent.click(screen.getByRole("button", { name: /daily run/i }));
    flushFrame(0);
    fireEvent.keyDown(gameSurface(), { key: " " });
    let t = 0;
    for (let i = 0; i < 10; i++) {
      t += 250;
      flushFrame(t);
    }
    fireEvent.keyUp(gameSurface(), { key: " " });
    const hudBefore = hudScore();

    fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    for (let i = 0; i < 20; i++) {
      t += 60_000; // 20 minutes of wall time — would blow the 216k tick cap if it ticked
      flushFrame(t);
    }
    expect(hudScore()).toBe(hudBefore);
    expect(screen.getByRole("heading", { name: /relay paused/i })).toBeInTheDocument();

    // Resuming picks the run back up (no game over from the frozen stretch).
    fireEvent.click(screen.getByRole("button", { name: /^resume$/i }));
    t += 250;
    flushFrame(t);
    expect(screen.queryByText(/game over/i)).toBeNull();
  });

  it("pausing via the keyboard edge (p) freezes stepping the same way", () => {
    render(<SpaceInvaders />);
    fireEvent.click(screen.getByRole("button", { name: /daily run/i }));
    flushFrame(0);
    fireEvent.keyDown(gameSurface(), { key: "ArrowRight" });
    flushFrame(250);
    fireEvent.keyUp(gameSurface(), { key: "ArrowRight" });

    fireEvent.keyDown(gameSurface(), { key: "p" });
    flushFrame(500);
    expect(screen.getByRole("heading", { name: /relay paused/i })).toBeInTheDocument();
    const hud = hudScore();
    flushFrame(50_000);
    flushFrame(100_000);
    expect(hudScore()).toBe(hud);

    fireEvent.keyDown(gameSurface(), { key: "p" });
    flushFrame(100_250);
    expect(screen.queryByText(/paused/i)).toBeNull();
  });

  it("auto-pauses a daily run when hidden without creating a replay gap", () => {
    render(<SpaceInvaders />);
    fireEvent.click(screen.getByRole("button", { name: /daily run/i }));
    flushFrame(0);
    fireEvent.keyDown(gameSurface(), { key: "ArrowRight" });
    flushFrame(250);
    fireEvent.keyUp(gameSurface(), { key: "ArrowRight" });

    act(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByRole("heading", { name: /relay paused/i })).toBeInTheDocument();
    const score = hudScore();
    flushFrame(60_000);
    expect(hudScore()).toBe(score);

    act(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    fireEvent.click(screen.getByRole("button", { name: /resume defense/i }));
    driveToGameover(60_000);
    expect(screen.getByText(/verified locally/i)).toBeInTheDocument();
  });
});
