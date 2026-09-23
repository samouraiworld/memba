import { useQuery } from "@tanstack/react-query";
import { gameApi } from "../../lib/gameApi";
import "./panels.css";
/**
 * Today's top 50. `you` is the connected or signed-in address: its row is
 * highlighted and its rank summarised above the list when it made the cut.
 */
export function DailyLeaderboardPanel({ date, scope = "default", you }: { date: string; scope?: string; you?: string }) {
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
  const me = you?.trim().toLowerCase() || null;
  const mine = me ? entries.find((entry) => entry.address.toLowerCase() === me) : undefined;
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
      {mine && (
        <p className="k-bp-lb-you" data-testid="bp-lb-you">
          You're <strong>#{mine.rank}</strong> today with {mine.score.toLocaleString("en-US")} points.
        </p>
      )}
      {me && !mine && (
        <p className="k-bp-lb-you k-bp-lb-you--out">
          {entries.length >= 50 ? "You're outside today's top 50." : "You're not on today's leaderboard yet."}
        </p>
      )}
      <ol className="k-bp-lb-list">
        {entries.map((entry) => {
          const isYou = entry === mine;
          return (
          <li
            key={`${entry.rank}-${entry.address}`}
            className={`k-bp-lb-row${isYou ? " k-bp-lb-row--you" : ""}`}
            aria-current={isYou ? "true" : undefined}
          >
            <span className="k-bp-lb-rank" aria-label={`Rank ${entry.rank}`}>#{entry.rank}</span>
            <span className="k-bp-lb-addr">
              {isYou && <span className="k-bp-lb-you-tag">You</span>}
              <span aria-hidden="true">{entry.address.slice(0, 8)}…</span>
              <span className="sr-only">{isYou ? "You, " : "Player "}{entry.address}</span>
            </span>
            <strong className="k-bp-lb-score">{entry.score.toLocaleString("en-US")}</strong>
          </li>
          );
        })}
      </ol>
    </section>
  );
}
