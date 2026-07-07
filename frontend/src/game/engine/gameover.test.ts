import { describe, it, expect } from "vitest";
import { isGameOver } from "./gameover";

describe("isGameOver", () => {
  it("is false when an empty cell exists", () => {
    expect(isGameOver([2, 4, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 0])).toBe(false);
  });
  it("is false when a horizontal merge is available", () => {
    expect(isGameOver([2, 2, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 128])).toBe(false);
  });
  it("is false when a vertical merge is available", () => {
    expect(isGameOver([2, 4, 8, 16, 2, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 128])).toBe(false);
  });
  it("is true for a full board with no adjacent equals", () => {
    expect(isGameOver([2, 4, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 128])).toBe(true);
  });
});
