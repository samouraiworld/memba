import { describe, it, expect } from "vitest";
import { buildDatedResultUrl, buildShareText } from "./shareText";
describe("buildShareText", () => {
  it("puts a date-stable result reference on line 1 and renders a 4x4 emoji grid", () => {
    const board = [2,4,8,16, 0,0,0,0, 0,0,0,0, 0,0,0,2048];
    const txt = buildShareText({ kind: "daily", date: "2026-07-06", board, percentile: 91, streak: 5, modifier: "doubles", url: "https://x/game" });
    const lines = txt.split("\n");
    expect(lines[0]).toContain("Block Party result");
    expect(lines[0]).toContain("https://x/game?result=2026-07-06");
    // 4 grid rows of 4 emoji each somewhere in the body
    const gridRows = lines.filter((l) => [...l].length === 4 && /[🟩🟦🟪🟨⬛]/u.test(l));
    expect(gridRows.length).toBe(4);
    expect(txt).toContain("Doubles Day");
    expect(txt).toContain("🔥5");
  });

  it("drops existing query data and fragments from the result reference", () => {
    expect(buildDatedResultUrl("https://memba.example/pearl/game?token=secret#round", "2026-07-06"))
      .toBe("https://memba.example/pearl/game?result=2026-07-06");
  });

  it("does not attach an invalid date marker", () => {
    expect(buildDatedResultUrl("https://memba.example/game?token=secret#round", "2026-99-99"))
      .toBe("https://memba.example/game");
  });

  it("labels an undated practice result without an empty date", () => {
    const txt = buildShareText({
      kind: "practice", date: "", board: Array(16).fill(0), streak: 0, modifier: "standard", url: "https://x/game",
    });
    expect(txt.split("\n")[0]).toBe("Block Party practice result · https://x/game");
  });

  it("keeps an unsubmitted guest Daily result distinct from Practice", () => {
    const txt = buildShareText({
      kind: "daily", date: "2026-07-06", board: Array(16).fill(0), streak: 1, modifier: "rush", url: "https://x/game",
    });
    expect(txt).toContain("Block Party result · 2026-07-06");
    expect(txt).toContain("saved locally · unsubmitted");
    expect(txt).not.toContain("practice");
  });
});
