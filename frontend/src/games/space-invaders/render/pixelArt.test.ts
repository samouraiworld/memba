import { describe, expect, it } from "vitest";
import type { Alien } from "../engine";
import { ALIEN_GLYPHS, drawAlienGlyph } from "./pixelArt";

function recordingContext(rects: number[][]): CanvasRenderingContext2D {
  return {
    fillRect(x: number, y: number, w: number, h: number) { rects.push([x, y, w, h]); },
    set fillStyle(_value: string) {},
    set globalAlpha(_value: number) {},
  } as unknown as CanvasRenderingContext2D;
}

describe("procedural pixel art", () => {
  it("provides a distinct, valid 8x6 signal glyph for every formation row", () => {
    expect(ALIEN_GLYPHS).toHaveLength(5);
    expect(new Set(ALIEN_GLYPHS.map((glyph) => glyph.join(""))).size).toBe(5);
    for (const glyph of ALIEN_GLYPHS) {
      expect(glyph).toHaveLength(6);
      expect(glyph.every((line) => line.length === 8 && /^[.#]+$/.test(line))).toBe(true);
    }
  });

  it("keeps every painted alien pixel inside its simulation bounds", () => {
    const alien: Alien = { x: 12, y: 20, w: 16, h: 12, alive: true, row: 3, col: 0 };
    const rects: number[][] = [];
    drawAlienGlyph(recordingContext(rects), alien, "body", "core", false);
    expect(rects.length).toBeGreaterThan(10);
    for (const [x, y, w, h] of rects) {
      expect(x).toBeGreaterThanOrEqual(alien.x);
      expect(y).toBeGreaterThanOrEqual(alien.y);
      expect(x + w).toBeLessThanOrEqual(alien.x + alien.w);
      expect(y + h).toBeLessThanOrEqual(alien.y + alien.h);
    }
  });
});
