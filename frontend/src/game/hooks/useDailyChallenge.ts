import { useQuery } from "@tanstack/react-query";
import { gameApi } from "../../lib/gameApi";

export type DailyChallenge = {
  date: string; seed: number; modifier: string; par: number; moveBudget: number;
  blockHeight: number; blockHash: string; ready: boolean;
};

export function useDailyChallenge() {
  return useQuery<DailyChallenge>({
    queryKey: ["bp", "challenge"],
    queryFn: async () => {
      const r = await gameApi.getDailyChallenge("");
      const c: DailyChallenge = {
        date: r.date, seed: r.seed, modifier: r.modifier,
        par: Number(r.par), moveBudget: r.moveBudget,
        blockHeight: Number(r.blockHeight), blockHash: r.blockHash, ready: r.ready,
      };
      if (c.ready) localStorage.setItem(`bp:challenge:${c.date}`, JSON.stringify(c));
      return c;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
