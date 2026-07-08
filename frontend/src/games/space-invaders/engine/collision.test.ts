import { describe, it, expect } from "vitest";
import { aabb } from "./collision";

describe("aabb", () => {
  it("detects overlap", () => {
    expect(aabb({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });
  it("returns false when separated", () => {
    expect(aabb({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(false);
  });
  it("treats edge-touching as non-overlap", () => {
    expect(aabb({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });
});
