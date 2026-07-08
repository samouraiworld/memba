import { describe, it, expect, beforeEach } from "vitest";
import { loadBest, saveBest } from "./highScore";

beforeEach(() => localStorage.clear());

describe("highScore", () => {
  it("returns 0 when nothing stored", () => {
    expect(loadBest()).toBe(0);
  });
  it("persists a new best", () => {
    saveBest(120);
    expect(loadBest()).toBe(120);
  });
  it("does not lower an existing best", () => {
    saveBest(200);
    saveBest(50);
    expect(loadBest()).toBe(200);
  });
  it("ignores corrupt values", () => {
    localStorage.setItem("memba.space-invaders.best", "not-a-number");
    expect(loadBest()).toBe(0);
  });
});
