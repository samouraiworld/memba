import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { GameOverScreen } from "./GameOverScreen";
import { summarizeRun } from "../lib/results";

const URL_ = "https://memba.example/gnoland1/game/space-invaders";

function props(over: Partial<ComponentProps<typeof GameOverScreen>> = {}): ComponentProps<typeof GameOverScreen> {
  return {
    mode: "daily",
    day: "2026-09-23",
    summary: summarizeRun({ score: 12340, wave: 7, lives: 0, shots: 100, hits: 82, combo: 0 }, 11),
    best: 12340,
    previousBest: 9000,
    verification: { day: "2026-09-23", verified: true },
    shareUrl: URL_,
    reducedMotion: true,
    onRestart: vi.fn(),
    onMenu: vi.fn(),
    ...over,
  };
}

const finalScore = () => screen.getByTestId("si-final-score").textContent;

let rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => rafQueue.push(cb));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GameOverScreen results card", () => {
  it("shows the run breakdown and keeps the daily verification line", () => {
    render(<GameOverScreen {...props()} />);
    expect(screen.getByRole("heading", { name: /game over/i })).toBeInTheDocument();
    expect(finalScore()).toBe((12340).toLocaleString());
    const stats = screen.getByLabelText("Run summary");
    expect(stats).toHaveTextContent(/wave\s*7/i);
    expect(stats).toHaveTextContent(/accuracy\s*82%/i);
    expect(stats).toHaveTextContent(/best chain\s*11\s*×4\.0/i);
    expect(stats).toHaveTextContent(/relays\s*0/i);
    const breakdown = screen.getByLabelText("Score breakdown");
    expect(breakdown).toHaveTextContent(/accuracy bonus\s*\+410/i);
    expect(breakdown).toHaveTextContent(/relay bonus\s*\+0/i);
    expect(screen.getByText(/daily · 2026-09-23/i)).toHaveTextContent(/replay checked on this device/i);
  });

  it("celebrates a new best against the best from BEFORE the run", () => {
    render(<GameOverScreen {...props({ previousBest: 9000 })} />);
    expect(screen.getByText(/new best/i)).toBeInTheDocument();
    expect(screen.getByText(`Previous best ${(9000).toLocaleString()}`)).toBeInTheDocument();
  });

  it("does not celebrate a tie, a lower score, or an unknown previous best", () => {
    const { rerender } = render(<GameOverScreen {...props({ previousBest: 12340 })} />);
    expect(screen.queryByText(/new best/i)).toBeNull();
    expect(screen.getByText(`Best signal ${(12340).toLocaleString()}`)).toBeInTheDocument();
    rerender(<GameOverScreen {...props({ previousBest: 20000, best: 20000 })} />);
    expect(screen.queryByText(/new best/i)).toBeNull();
    rerender(<GameOverScreen {...props({ previousBest: null })} />);
    expect(screen.queryByText(/new best/i)).toBeNull();
  });

  it("marks the first score on record", () => {
    render(<GameOverScreen {...props({ previousBest: 0 })} />);
    expect(screen.getByText(/new best/i)).toBeInTheDocument();
    expect(screen.getByText(/first score on record/i)).toBeInTheDocument();
  });

  it("shows the final score instantly when the OS asks for reduced motion", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    render(<GameOverScreen {...props({ reducedMotion: undefined })} />);
    expect(finalScore()).toBe((12340).toLocaleString());
    expect(rafQueue).toHaveLength(0);
  });

  it("counts the final score up when motion is allowed, with the real value for screen readers", () => {
    render(<GameOverScreen {...props({ reducedMotion: false })} />);
    expect(finalScore()).toBe("0");
    expect(screen.getByText((12340).toLocaleString(), { selector: ".si-sr-only" })).toBeInTheDocument();
    for (const t of [0, 300, 600, 900]) {
      const cbs = rafQueue;
      rafQueue = [];
      act(() => cbs.forEach((cb) => cb(t)));
    }
    expect(finalScore()).toBe((12340).toLocaleString());
  });

  it("wires Play again, Menu, and the certify slot", () => {
    const p = props({ certifySlot: <button type="button">slot control</button> });
    render(<GameOverScreen {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /play again/i }));
    fireEvent.click(screen.getByRole("button", { name: /^menu$/i }));
    expect(p.onRestart).toHaveBeenCalledTimes(1);
    expect(p.onMenu).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /slot control/i }).closest(".si-certify")).not.toBeNull();
  });

  it("hides the daily line on free play", () => {
    render(<GameOverScreen {...props({ mode: "free", day: "", verification: null })} />);
    expect(screen.queryByText(/daily ·/i)).toBeNull();
  });
});

describe("GameOverScreen sharing", () => {
  const dailyText = `Space Invaders · daily 2026-09-23\nScore 12,340 · Wave 7 · 82% accuracy\n${URL_}`;

  it("uses the native share sheet when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });
    render(<GameOverScreen {...props()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /share result/i })));
    expect(share).toHaveBeenCalledWith({ text: dailyText });
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Shared");
  });

  it("falls back to the clipboard with a visible Copied confirmation that clears", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<GameOverScreen {...props({ mode: "free", day: "", verification: null })} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /share result/i })));
    expect(writeText).toHaveBeenCalledWith(`Space Invaders · free play\nScore 12,340 · Wave 7 · 82% accuracy\n${URL_}`);
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
    act(() => vi.advanceTimersByTime(2500));
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("does not copy when the player dismisses the share sheet", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("dismissed", "AbortError"));
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });
    render(<GameOverScreen {...props()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /share result/i })));
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("copies when the share sheet fails for another reason", async () => {
    const share = vi.fn().mockRejectedValue(new Error("not allowed"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });
    render(<GameOverScreen {...props()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /share result/i })));
    expect(writeText).toHaveBeenCalledWith(dailyText);
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
  });

  it("shows the text for a manual copy when neither share nor clipboard works", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<GameOverScreen {...props()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /share result/i })));
    expect(screen.getByText(/sharing is not available here/i)).toBeInTheDocument();
    expect(screen.getByText(/82% accuracy/)).toBeInTheDocument();
  });
});
