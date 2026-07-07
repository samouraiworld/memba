import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/gameApi", () => ({
  gameApi: {
    getDailyChallenge: vi.fn().mockResolvedValue({
      date: "2026-07-06", seed: 12345, modifier: "standard",
      par: 1500n, moveBudget: 30, blockHeight: 42n, blockHash: "abc", ready: true,
    }),
  },
}));
import { useDailyChallenge } from "./useDailyChallenge";

const wrap = ({ children }: { children: ReactNode }) => {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={c}>{children}</QueryClientProvider>;
};

describe("useDailyChallenge", () => {
  beforeEach(() => localStorage.clear());
  it("returns a normalized challenge with number par/height and moveBudget", async () => {
    const { result } = renderHook(() => useDailyChallenge(), { wrapper: wrap });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data).toMatchObject({
      seed: 12345, modifier: "standard", par: 1500, moveBudget: 30, blockHeight: 42, ready: true,
    });
  });
});
