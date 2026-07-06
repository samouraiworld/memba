export function milestoneLabel(v: number): string | null {
  if (v === 128) return "Initiate";
  if (v === 512) return "Builder";
  if (v === 2048) return "Gno Guardian";
  return null;
}
export function tierEmoji(v: number): string {
  if (v === 0) return "⬛";
  if (v <= 4) return "🟩";
  if (v <= 32) return "🟦";
  if (v <= 256) return "🟪";
  return "🟨";
}
export function rankFromPercentile(p: number): string {
  if (p >= 90) return "S";
  if (p >= 70) return "A";
  if (p >= 40) return "B";
  return "C";
}
