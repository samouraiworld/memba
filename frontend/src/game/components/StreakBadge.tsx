import { useQuery } from "@tanstack/react-query";
import { gameApi } from "../../lib/gameApi";
export function StreakBadge({ address, localStreak }: { address?: string; localStreak: number }) {
  const { data } = useQuery({
    queryKey: ["bp", "streak", address],
    queryFn: () => gameApi.getStreak(address!),
    enabled: !!address,
  });
  const current = address ? (data?.streak?.current ?? 0) : localStreak;
  return <span className="k-bp-streak">🔥 {current}</span>;
}
