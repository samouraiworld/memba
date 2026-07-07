import { tierEmoji, rankFromPercentile } from "./tiers";

const MOD_LABEL: Record<string, string> = { standard: "Standard", doubles: "Doubles Day", rush: "Rush" };

export function buildShareText(opts: {
  date: string; board: number[]; percentile?: number; streak: number; modifier: string; url: string;
}): string {
  const { date, board, percentile, streak, modifier, url } = opts;
  const grid = [0, 1, 2, 3].map((r) => board.slice(r * 4, r * 4 + 4).map(tierEmoji).join("")).join("\n");
  const verdict = percentile != null ? `${rankFromPercentile(percentile)}-rank · beat ${percentile}%` : "practice";
  return [
    `Block Party ${date} · beat me · ${url}`,
    "",
    grid,
    "",
    `${MOD_LABEL[modifier] ?? modifier} · ${verdict} · 🔥${streak}`,
  ].join("\n");
}
