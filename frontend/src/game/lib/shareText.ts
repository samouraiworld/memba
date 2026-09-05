import { tierEmoji, rankFromPercentile } from "./tiers";

const MOD_LABEL: Record<string, string> = { standard: "Standard", doubles: "Doubles Day", rush: "Rush" };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(date: string): boolean {
  if (!ISO_DATE.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
}

/**
 * Build a stable result reference without implying that the route can replay
 * archived boards. Existing query strings and fragments are deliberately
 * dropped so wallet/session details can never leak into shared text.
 */
export function buildDatedResultUrl(baseUrl: string, date: string): string {
  try {
    const parsed = new URL(baseUrl);
    parsed.search = "";
    parsed.hash = "";
    if (validDate(date)) parsed.searchParams.set("result", date);
    return parsed.toString();
  } catch {
    return baseUrl;
  }
}

export function buildShareText(opts: {
  kind: "daily" | "practice"; date: string; board: number[]; percentile?: number; streak: number; modifier: string; url: string;
}): string {
  const { kind, date, board, percentile, streak, modifier, url } = opts;
  const grid = [0, 1, 2, 3].map((r) => board.slice(r * 4, r * 4 + 4).map(tierEmoji).join("")).join("\n");
  const verdict = percentile != null
    ? `${rankFromPercentile(percentile)}-rank · beat ${percentile}%`
    : kind === "daily" ? "saved locally · unsubmitted" : "practice";
  const resultUrl = buildDatedResultUrl(url, date);
  const headline = kind === "daily" && validDate(date)
    ? `Block Party result · ${date} · ${resultUrl}`
    : `Block Party practice result · ${resultUrl}`;
  return [
    headline,
    "",
    grid,
    "",
    `${MOD_LABEL[modifier] ?? modifier} · ${verdict} · 🔥${streak}`,
  ].join("\n");
}
