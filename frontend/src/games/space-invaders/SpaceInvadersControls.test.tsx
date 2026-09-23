import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import SpaceInvaders from "./SpaceInvaders";
import { HOWTO_MIN_MS, WAVE_BANNER_MS } from "./lib/intro";

// Shell-level pins for SI-2: Enter/Esc, the wave banner, the one-time how-to
// and the audio cues. Everything here is presentation layered on step events;
// the engine input stays {move, fire, pause:false}.

const advanceSpy = vi.hoisted(() => vi.fn());
const audio = vi.hoisted(() => ({ play: vi.fn(), setDrone: vi.fn() }));

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
    createAudioEngine: () => ({
      muted: false,
      droning: false,
      unlock: vi.fn(),
      play: audio.play,
      setDrone: audio.setDrone,
      setMuted: vi.fn(),
      dispose: vi.fn(),
    }),
  };
});
vi.mock("./SpaceInvadersCertify", () => ({ default: () => null }));

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
  advanceSpy.mockClear();
  audio.play.mockClear();
  audio.setDrone.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

const surface = () => screen.getByRole("group", { name: /signal defense game surface/i });
const readyHeading = () => screen.queryByRole("heading", { name: /relay standing by/i });
const pausedHeading = () => screen.queryByRole("heading", { name: /relay paused/i });

describe("Enter", () => {
  it("picks the daily run from the menu, then launches it as a fire press", () => {
    render(<SpaceInvaders seed={7} />);
    surface().focus();
    fireEvent.keyDown(surface(), { key: "Enter" });
    expect(readyHeading()).toBeInTheDocument();
    expect(screen.getByText(/^daily signal ·/i)).toBeInTheDocument();

    flushFrame(0);
    flushFrame(100);
    expect(advanceSpy).not.toHaveBeenCalled(); // armed idle: no ticks

    fireEvent.keyDown(surface(), { key: "Enter" });
    fireEvent.keyUp(surface(), { key: "Enter" });
    // A zero-step frame must not swallow the launch.
    flushFrame(105);
    expect(advanceSpy).not.toHaveBeenCalled();
    flushFrame(140);
    expect(advanceSpy).toHaveBeenCalledWith(expect.anything(), expect.any(Number), { move: 0, fire: true, pause: false });
    expect(readyHeading()).not.toBeInTheDocument();

    // Consumed once: the next step is idle again.
    advanceSpy.mockClear();
    flushFrame(180);
    expect(advanceSpy).toHaveBeenCalledWith(expect.anything(), expect.any(Number), { move: 0, fire: false, pause: false });
  });

  it("restarts from game over, but a focused button keeps its own Enter", () => {
    render(<SpaceInvaders initialState={{ phase: "gameover", score: 120 } as never} />);
    const playAgain = screen.getByRole("button", { name: /play again/i });
    playAgain.focus();
    fireEvent.keyDown(playAgain, { key: "Enter" });
    // The shell ignored it (the browser's native click is the only activation).
    expect(screen.getByRole("heading", { name: /game over/i })).toBeInTheDocument();

    surface().focus();
    fireEvent.keyDown(surface(), { key: "Enter" });
    expect(screen.queryByRole("heading", { name: /game over/i })).not.toBeInTheDocument();
    expect(readyHeading()).toBeInTheDocument();
  });

  it("resumes a paused run", () => {
    render(<SpaceInvaders initialState={{ phase: "paused" } as never} />);
    surface().focus();
    fireEvent.keyDown(surface(), { key: "Enter" });
    expect(pausedHeading()).not.toBeInTheDocument();
  });
});

describe("Escape", () => {
  it("toggles pause like P and never reaches the engine", () => {
    render(<SpaceInvaders initialState={{ phase: "playing" } as never} />);
    surface().focus();
    fireEvent.keyDown(surface(), { key: "Escape" });
    flushFrame(0);
    expect(pausedHeading()).toBeInTheDocument();
    expect(advanceSpy).not.toHaveBeenCalled();

    fireEvent.keyUp(surface(), { key: "Escape" });
    fireEvent.keyDown(surface(), { key: "Escape" });
    flushFrame(20);
    expect(pausedHeading()).not.toBeInTheDocument();

    flushFrame(60);
    for (const call of advanceSpy.mock.calls) expect(call[2].pause).toBe(false);
  });

  it("resumes from the pause sheet's focused Resume button", () => {
    render(<SpaceInvaders initialState={{ phase: "paused" } as never} />);
    const resume = screen.getByRole("button", { name: /resume defense/i });
    resume.focus();
    fireEvent.keyDown(resume, { key: "Escape" });
    flushFrame(0);
    expect(pausedHeading()).not.toBeInTheDocument();
  });
});

describe("wave banner and how-to", () => {
  it("announces WAVE 1 on launch and hides after its moment", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<SpaceInvaders seed={7} />);
    fireEvent.click(screen.getByRole("button", { name: /free play/i }));
    fireEvent.keyDown(surface(), { key: "ArrowRight" });
    flushFrame(0);
    flushFrame(50);
    expect(screen.getByTestId("si-wave-banner")).toHaveTextContent(/wave 1/i);
    act(() => {
      vi.advanceTimersByTime(WAVE_BANNER_MS + 10);
    });
    expect(screen.queryByTestId("si-wave-banner")).not.toBeInTheDocument();
  });

  it("announces the next wave when the swarm is cleared", () => {
    render(<SpaceInvaders initialState={{ phase: "playing", aliens: [] } as never} />);
    expect(screen.queryByTestId("si-wave-banner")).not.toBeInTheDocument();
    flushFrame(0);
    flushFrame(50);
    expect(screen.getByTestId("si-wave-banner")).toHaveTextContent(/wave 2/i);
  });

  it("hides the banner while paused", () => {
    render(<SpaceInvaders initialState={{ phase: "playing", aliens: [] } as never} />);
    flushFrame(0);
    flushFrame(50);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.queryByTestId("si-wave-banner")).not.toBeInTheDocument();
  });

  it("shows the how-to once, dismisses it on the first input after it is readable", () => {
    render(<SpaceInvaders seed={7} />);
    fireEvent.click(screen.getByRole("button", { name: /free play/i }));
    fireEvent.keyDown(surface(), { key: " " });
    flushFrame(0);
    flushFrame(50);
    expect(screen.getByTestId("si-howto")).toBeInTheDocument();

    // Still holding fire, but too early to count as a dismissal.
    flushFrame(50 + HOWTO_MIN_MS / 2);
    expect(screen.getByTestId("si-howto")).toBeInTheDocument();
    fireEvent.keyUp(surface(), { key: " " });
    flushFrame(60 + HOWTO_MIN_MS);
    expect(screen.getByTestId("si-howto")).toBeInTheDocument(); // idle: stays up

    fireEvent.keyDown(surface(), { key: "a" });
    flushFrame(80 + HOWTO_MIN_MS);
    expect(screen.queryByTestId("si-howto")).not.toBeInTheDocument();
    expect(localStorage.getItem("memba.space-invaders.howto-seen")).toBe("1");
  });

  it("does not show the how-to again once seen", () => {
    localStorage.setItem("memba.space-invaders.howto-seen", "1");
    render(<SpaceInvaders seed={7} />);
    fireEvent.click(screen.getByRole("button", { name: /free play/i }));
    fireEvent.keyDown(surface(), { key: " " });
    flushFrame(0);
    flushFrame(50);
    expect(screen.queryByTestId("si-howto")).not.toBeInTheDocument();
  });
});

describe("audio cues from game state", () => {
  const ufo = { x: 100, y: 22, w: 24, h: 10, dir: 1, alive: true };

  it("drones while a UFO crosses a running game and stops on pause", () => {
    render(<SpaceInvaders initialState={{ phase: "playing", ufo } as never} />);
    flushFrame(0);
    flushFrame(20);
    expect(audio.setDrone).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    flushFrame(40);
    expect(audio.setDrone).toHaveBeenLastCalledWith(false);
  });

  it("plays the game-over cue exactly on the transition", () => {
    render(<SpaceInvaders initialState={{ phase: "playing", lives: 0 } as never} />);
    flushFrame(0);
    flushFrame(20);
    expect(screen.getByRole("heading", { name: /game over/i })).toBeInTheDocument();
    expect(audio.play.mock.calls.filter(([id]) => id === "gameOver")).toHaveLength(1);
    flushFrame(40);
    expect(audio.play.mock.calls.filter(([id]) => id === "gameOver")).toHaveLength(1);
    expect(audio.setDrone).toHaveBeenLastCalledWith(false);
  });
});
