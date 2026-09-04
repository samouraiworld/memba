import { useQuery } from "@tanstack/react-query";
import { gameApi } from "../../lib/gameApi";
import "./panels.css";
export function StreakBadge({ address, localStreak }: { address?: string; localStreak: number }) {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["bp", "streak", address],
    queryFn: () => gameApi.getStreak(address!),
    enabled: !!address,
  });

  if (address && isLoading) {
    return <span className="k-bp-streak k-bp-streak--muted" role="status">Loading streak…</span>;
  }

  if (address && isError) {
    return (
      <span className="k-bp-streak k-bp-streak--error">
        Streak unavailable
        <button type="button" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? "Retrying…" : "Retry"}
        </button>
      </span>
    );
  }

  const current = address ? (data?.streak?.current ?? 0) : localStreak;
  return (
    <span className="k-bp-streak" aria-label={`${current} day streak`}>
      <span aria-hidden="true">◆</span> {current} day streak
    </span>
  );
}
