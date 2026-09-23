import { describe, it, expect } from "vitest";
import { buildShareText, shareUrlFromLocation } from "./shareText";

describe("buildShareText", () => {
  it("formats a daily run as three compact lines", () => {
    expect(
      buildShareText({
        mode: "daily",
        day: "2026-09-23",
        score: 12340,
        wave: 7,
        accuracyPct: 82,
        url: "https://example.org/gnoland1/game/space-invaders",
      }),
    ).toBe(
      "Space Invaders · daily 2026-09-23\nScore 12,340 · Wave 7 · 82% accuracy\nhttps://example.org/gnoland1/game/space-invaders",
    );
  });

  it("labels free play runs (and ignores a stray day)", () => {
    const text = buildShareText({ mode: "free", day: "2026-09-23", score: 90, wave: 1, accuracyPct: 0, url: "https://x.test/a" });
    expect(text.split("\n")[0]).toBe("Space Invaders · free play");
    expect(text).not.toMatch(/daily/);
  });

  it("omits the link line when no URL is known", () => {
    const text = buildShareText({ mode: "daily", day: "2026-09-23", score: 1, wave: 1, accuracyPct: 100, url: "" });
    expect(text.split("\n")).toHaveLength(2);
  });

  it("stays network-neutral: the text itself never names a network", () => {
    const text = buildShareText({ mode: "daily", day: "2026-09-23", score: 5, wave: 2, accuracyPct: 50, url: "" });
    expect(text).toBe("Space Invaders · daily 2026-09-23\nScore 5 · Wave 2 · 50% accuracy");
    expect(text).not.toMatch(/network|chain/i);
  });
});

describe("shareUrlFromLocation", () => {
  it("keeps origin + network path and drops query and hash", () => {
    const loc = new URL("https://memba.example/gnoland1/game/space-invaders?ref=abc#top");
    expect(shareUrlFromLocation(loc)).toBe("https://memba.example/gnoland1/game/space-invaders");
  });

  it("returns an empty string without a location", () => {
    expect(shareUrlFromLocation(undefined)).toBe("");
  });
});
