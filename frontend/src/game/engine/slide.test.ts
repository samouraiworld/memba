import { describe, it, expect } from "vitest";
import { slideLineLeft } from "./slide";

describe("slideLineLeft", () => {
  it("compacts toward index 0", () => {
    expect(slideLineLeft([0, 2, 0, 4])).toEqual({ line: [2, 4, 0, 0], gained: 0 });
  });
  it("merges a single pair once", () => {
    expect(slideLineLeft([2, 2, 0, 0])).toEqual({ line: [4, 0, 0, 0], gained: 4 });
  });
  it("merges two pairs, farthest-first, no double-merge", () => {
    expect(slideLineLeft([2, 2, 2, 2])).toEqual({ line: [4, 4, 0, 0], gained: 8 });
  });
  it("does not merge into a triple as an 8", () => {
    expect(slideLineLeft([4, 4, 2, 0])).toEqual({ line: [8, 2, 0, 0], gained: 8 });
  });
  it("leaves an unmergeable line only compacted", () => {
    expect(slideLineLeft([2, 4, 8, 16])).toEqual({ line: [2, 4, 8, 16], gained: 0 });
  });
});
