import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { Canvas } from "./Canvas";
import { newGame } from "../engine";

// jsdom canvas has no 2d context; stub it so the draw path runs without throwing.
beforeEach(() => {
  const ctx = {
    clearRect: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
    fillStyle: "", set globalAlpha(_v: number) {},
  } as unknown as CanvasRenderingContext2D;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as never;
});

describe("Canvas", () => {
  it("renders a canvas and draws without throwing", () => {
    const { container } = render(<Canvas state={{ ...newGame(1), phase: "playing" }} />);
    expect(container.querySelector("canvas")).not.toBeNull();
  });
});
