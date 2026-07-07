export function getLocalBest(date: string): number {
  return Number(localStorage.getItem(`bp:best:${date}`) ?? 0);
}
export function setLocalBest(date: string, score: number) {
  if (score > getLocalBest(date)) localStorage.setItem(`bp:best:${date}`, String(score));
}
type LocalStreak = { current: number; lastDate: string };
export function getLocalStreak(): LocalStreak {
  try { return JSON.parse(localStorage.getItem("bp:streak") ?? "") as LocalStreak; }
  catch { return { current: 0, lastDate: "" }; }
}
function dayGap(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
export function bumpLocalStreak(date: string): LocalStreak {
  const s = getLocalStreak();
  let current = 1;
  if (s.lastDate) {
    const g = dayGap(s.lastDate, date);
    if (g === 0) current = s.current;
    else if (g === 1) current = s.current + 1;
    else current = 1;
  }
  const next = { current, lastDate: date };
  localStorage.setItem("bp:streak", JSON.stringify(next));
  return next;
}
