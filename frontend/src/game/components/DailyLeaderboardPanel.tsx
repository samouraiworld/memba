import { useQuery } from "@tanstack/react-query";
import { gameApi } from "../../lib/gameApi";
import "./panels.css";
export function DailyLeaderboardPanel({ date, scope = "default" }: { date: string; scope?: string }) {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["bp", "leaderboard", scope, date],
    queryFn: () => gameApi.getDailyLeaderboard(date, 50),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <section className="k-bp-panel k-bp-panel--state" aria-label="Daily leaderboard" aria-busy="true">
        <span className="k-bp-loader" aria-hidden="true" />
        <span role="status">Loading leaderboard…</span>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="k-bp-panel k-bp-panel--state k-bp-panel--error" aria-label="Daily leaderboard">
        <div role="alert">
          <strong>Leaderboard unavailable</strong>
          <span>Scores could not be loaded. This is not an empty board.</span>
        </div>
        <button className="k-bp-panel-action" type="button" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? "Retrying…" : "Retry leaderboard"}
        </button>
      </section>
    );
  }

  const entries = data?.entries ?? [];
  if (entries.length === 0) {
    return (
      <section className="k-bp-panel k-bp-panel--empty" aria-label="Daily leaderboard">
        <span className="k-bp-panel-kicker">Daily leaderboard</span>
        <strong>The signal is open</strong>
        <span>No verified scores yet today — yours could be first.</span>
      </section>
    );
  }

  return (
    <section className="k-bp-panel k-bp-lb" aria-labelledby="k-bp-lb-title">
      <div className="k-bp-panel-heading">
        <div>
          <span className="k-bp-panel-kicker">Today</span>
          <h2 id="k-bp-lb-title">Top signals</h2>
        </div>
        <span className="k-bp-lb-count">{entries.length} {entries.length === 1 ? "player" : "players"}</span>
      </div>
      <ol className="k-bp-lb-list">
        {entries.map((entry) => (
          <li key={`${entry.rank}-${entry.address}`} className="k-bp-lb-row">
            <span className="k-bp-lb-rank" aria-label={`Rank ${entry.rank}`}>#{entry.rank}</span>
            <span className="k-bp-lb-addr">
              <span aria-hidden="true">{entry.address.slice(0, 8)}…</span>
              <span className="sr-only">Player {entry.address}</span>
            </span>
            <strong className="k-bp-lb-score">{entry.score.toLocaleString("en-US")}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}
