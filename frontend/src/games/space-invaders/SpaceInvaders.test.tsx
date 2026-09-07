import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import SpaceInvaders from "./SpaceInvaders";

const advanceSpy = vi.hoisted(() => vi.fn());
const audioSpies = vi.hoisted(() => ({ create: vi.fn(), dispose: vi.fn() }));
const drawSpy = vi.hoisted(() => vi.fn());
vi.mock("./hooks/useGameLoop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hooks/useGameLoop")>();
  return {
    ...actual,
    advanceWithEvents: (...args: Parameters<typeof actual.advanceWithEvents>) => {
      advanceSpy(...args);
      return actual.advanceWithEvents(...args);
    },
  };
});
vi.mock("./lib/audio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/audio")>();
  return {
    ...actual,
    createAudioEngine: () => {
      audioSpies.create();
      return {
        muted: false,
        unlock: vi.fn(),
        play: vi.fn(),
        setMuted: vi.fn(),
        dispose: audioSpies.dispose,
      };
    },
  };
});
vi.mock("./render/draw", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./render/draw")>();
  return {
    ...actual,
    draw: (...args: Parameters<typeof actual.draw>) => {
      drawSpy(...args);
      return actual.draw(...args);
    },
  };
});

// Deterministic rAF: callbacks queue up and only run when a test flushes them,
// so each test decides exactly how many frames elapse (and at what timestamps).
let rafQueue: FrameRequestCallback[] = [];

// Run every currently-queued frame callback at `time`. Callbacks scheduled by
// the flushed frame land in the queue for the NEXT flush, mirroring real rAF.
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
  advanceSpy.mockClear();
  audioSpies.create.mockClear();
  audioSpies.dispose.mockClear();
  drawSpy.mockClear();
});

describe("SpaceInvaders shell", () => {
  it("renders the HUD and a start prompt", () => {
    render(<SpaceInvaders />);
    expect(screen.getByRole("heading", { name: /space invaders/i })).toBeInTheDocument();
    expect(screen.getByText("Score")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /daily run/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/space invaders play area/i)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /signal defense game surface/i })).toHaveAttribute("tabindex", "0");
  });

  it("recreates and disposes audio cleanly under StrictMode", () => {
    const { unmount } = render(<StrictMode><SpaceInvaders /></StrictMode>);
    expect(audioSpies.create).toHaveBeenCalledTimes(2);
    expect(audioSpies.dispose).toHaveBeenCalledTimes(1);
    unmount();
    expect(audioSpies.dispose).toHaveBeenCalledTimes(2);
  });

  it("keeps a stable six-slot HUD when a combo becomes visible", () => {
    const { container } = render(<SpaceInvaders initialState={{ combo: 3 } as never} />);
    expect(container.querySelectorAll(".si-hud > *")).toHaveLength(6);
    expect(screen.getByText("Chain").closest(".si-combo")).not.toHaveClass("si-combo--idle");
  });

  it("shows a game-over sheet when the game ends", () => {
    render(<SpaceInvaders initialState={{ phase: "gameover", score: 90 } as never} />);
    expect(screen.getByText(/game over/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /play again/i })).toBeInTheDocument();
  });

  it("waits for a mode choice, then starts on input without ticking the menu or armed idle state", () => {
    render(<SpaceInvaders />);
    flushFrame(0);
    flushFrame(500);
    expect(advanceSpy).not.toHaveBeenCalled();

    const surface = screen.getByRole("group", { name: /signal defense game surface/i });
    fireEvent.click(screen.getByRole("button", { name: /free play/i }));
    expect(surface).toHaveFocus();
    expect(screen.getByText(/space fire/i)).toBeInTheDocument();

    flushFrame(750);
    expect(advanceSpy).not.toHaveBeenCalled();

    // hold ArrowRight (and tap Space) — the engine starts on first meaningful input
    fireEvent.keyDown(surface, { key: "ArrowRight" });
    fireEvent.keyDown(surface, { key: " " });

    // frame 1 anchors the loop clock (0 elapsed ms → 0 fixed steps);
    // frame 2 delivers ≥1 fixed step with the held input, starting the run
    flushFrame(800);

    expect(screen.queryByText(/space fire/i)).not.toBeInTheDocument();
    expect(advanceSpy).toHaveBeenCalled();
    expect(screen.queryByText(/game over/i)).not.toBeInTheDocument(); // playing, not dead
  });

  it("restores game-surface focus after mute and pause/resume controls", () => {
    render(<SpaceInvaders initialState={{ phase: "playing" } as never} />);
    const surface = screen.getByRole("group", { name: /signal defense game surface/i });

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(surface).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("heading", { name: /relay paused/i })).toBeInTheDocument();
    expect(surface).toHaveFocus();

    const resume = screen.getByRole("button", { name: /resume defense/i });
    resume.focus();
    fireEvent.click(resume);
    expect(screen.queryByRole("heading", { name: /relay paused/i })).not.toBeInTheDocument();
    expect(surface).toHaveFocus();
  });

  it("keeps focus and accepts move/fire after a keyboard-only pause and resume", () => {
    render(<SpaceInvaders initialState={{ phase: "playing" } as never} />);
    const surface = screen.getByRole("group", { name: /signal defense game surface/i });
    surface.focus();

    fireEvent.keyDown(surface, { key: "p" });
    flushFrame(0);
    expect(screen.getByRole("heading", { name: /relay paused/i })).toBeInTheDocument();
    expect(surface).toHaveFocus();

    fireEvent.keyUp(surface, { key: "p" });
    fireEvent.keyDown(surface, { key: "p" });
    flushFrame(20);
    expect(screen.queryByRole("heading", { name: /relay paused/i })).not.toBeInTheDocument();
    expect(surface).toHaveFocus();

    advanceSpy.mockClear();
    fireEvent.keyDown(surface, { key: "ArrowRight" });
    fireEvent.keyDown(surface, { key: " " });
    flushFrame(40);
    expect(advanceSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      { move: 1, fire: true, pause: false },
    );
  });

  it("does not steal focus back when an interruption auto-pauses the game", () => {
    render(<SpaceInvaders initialState={{ phase: "playing" } as never} />);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(screen.getByRole("heading", { name: /relay paused/i })).toBeInTheDocument();
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it("paints a static paused state once instead of redrawing every animation frame", () => {
    render(<SpaceInvaders initialState={{ phase: "paused" } as never} />);

    flushFrame(0);
    expect(drawSpy).toHaveBeenCalledTimes(1);
    flushFrame(1_000);
    flushFrame(10_000);
    expect(drawSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /resume defense/i }));
    flushFrame(10_020);
    flushFrame(10_040);
    expect(drawSpy).toHaveBeenCalledTimes(3);
  });
});
