import { describe, it, expect } from "vitest";
import { buildShareText } from "./shareText";
describe("buildShareText", () => {
  it("puts the hook + url on line 1 and renders a 4x4 emoji grid", () => {
    const board = [2,4,8,16, 0,0,0,0, 0,0,0,0, 0,0,0,2048];
    const txt = buildShareText({ date: "2026-07-06", board, percentile: 91, streak: 5, modifier: "doubles", url: "https://x/game" });
    const lines = txt.split("\n");
    expect(lines[0]).toContain("beat me");
    expect(lines[0]).toContain("https://x/game");
    // 4 grid rows of 4 emoji each somewhere in the body
    const gridRows = lines.filter((l) => [...l].length === 4 && /[🟩🟦🟪🟨⬛]/u.test(l));
    expect(gridRows.length).toBe(4);
    expect(txt).toContain("Doubles Day");
    expect(txt).toContain("🔥5");
  });
});
