// Compact, plain-text result for the share sheet / clipboard. Network-neutral
// on purpose: the link carries the network, the text never names one.
import type { RunMode } from "../screens/types";

export interface ShareResultInput {
  mode: RunMode;
  /** UTC day (YYYY-MM-DD) of a daily run; ignored for free play. */
  day?: string;
  score: number;
  wave: number;
  accuracyPct: number;
  url: string;
}

const fmt = new Intl.NumberFormat("en-US");

export function buildShareText({ mode, day, score, wave, accuracyPct, url }: ShareResultInput): string {
  const label = mode === "daily" && day ? `daily ${day}` : "free play";
  const lines = [
    `Space Invaders · ${label}`,
    `Score ${fmt.format(Math.max(0, score))} · Wave ${wave} · ${accuracyPct}% accuracy`,
  ];
  if (url) lines.push(url);
  return lines.join("\n");
}

/** The game's own page — origin + path (which carries the network prefix),
 *  with any query string or fragment dropped. */
export function shareUrlFromLocation(loc: Pick<Location, "origin" | "pathname"> | undefined): string {
  if (!loc) return "";
  return `${loc.origin}${loc.pathname}`;
}
