import { useQuery } from "@tanstack/react-query";
import { gameApi } from "../../lib/gameApi";
import "./panels.css";
export function DailyLeaderboardPanel({ date }: { date: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["bp", "leaderboard", date],
    queryFn: () => gameApi.getDailyLeaderboard(date, 50),
    staleTime: 60_000,
  });
  if (isLoading) return <div className="k-bp-panel">Loading…</div>;
  const entries = data?.entries ?? [];
  if (entries.length === 0) return <div className="k-bp-panel k-bp-panel--empty">No scores yet today — be first.</div>;
  return (
    <ol className="k-bp-panel k-bp-lb">
      {entries.map((e) => (
        <li key={e.address} className="k-bp-lb-row">
          <span className="k-bp-lb-rank">#{e.rank}</span>
          <span className="k-bp-lb-addr">{e.address.slice(0, 8)}…</span>
          <span className="k-bp-lb-score">{Number(e.score).toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}
