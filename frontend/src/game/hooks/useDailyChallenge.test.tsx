import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const getDailyChallenge = vi.hoisted(() => vi.fn());
vi.mock("../../lib/gameApi", () => ({ gameApi: { getDailyChallenge } }));

import { useDailyChallenge } from "./useDailyChallenge";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  return ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const response = {
  date: "2026-07-06", seed: 12345, modifier: "standard",
  par: 1500n, moveBudget: 30, blockHeight: 42n, blockHash: "abc", ready: true,
};

describe("useDailyChallenge", () => {
  beforeEach(() => {
    localStorage.clear();
    getDailyChallenge.mockReset().mockResolvedValue(response);
  });

  it("returns and caches a normalized, scoped challenge", async () => {
    const { result } = renderHook(() => useDailyChallenge("pearl-1", "2026-07-06"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(getDailyChallenge).toHaveBeenCalledWith("2026-07-06");
    expect(result.current.data).toMatchObject({
      seed: 12345, modifier: "standard", par: 1500, moveBudget: 30,
      blockHeight: 42, ready: true, source: "network",
    });
    expect(localStorage.getItem("bp:challenge:v1:pearl-1:2026-07-06")).toContain('"seed":12345');
  });

  it("does not reuse another network's cache", async () => {
    const first = renderHook(() => useDailyChallenge("pearl-1", "2026-07-06"), { wrapper: wrapper() });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    getDailyChallenge.mockReset().mockRejectedValue(new Error("offline"));

    const second = renderHook(() => useDailyChallenge("portal-loop", "2026-07-06"), { wrapper: wrapper() });
    await waitFor(() => expect(second.result.current.isError).toBe(true));
    expect(second.result.current.data).toBeUndefined();
  });

  it("serves a validated same-scope cache while an offline revalidation fails", async () => {
    const online = renderHook(() => useDailyChallenge("pearl-1", "2026-07-06"), { wrapper: wrapper() });
    await waitFor(() => expect(online.result.current.data?.source).toBe("network"));
    online.unmount();
    getDailyChallenge.mockReset().mockRejectedValue(new Error("offline"));

    const offline = renderHook(() => useDailyChallenge("pearl-1", "2026-07-06"), { wrapper: wrapper() });
    expect(offline.result.current.data).toMatchObject({ seed: 12345, source: "cache" });
    await waitFor(() => expect(offline.result.current.isError).toBe(true));
    expect(getDailyChallenge).toHaveBeenCalledTimes(3);
    expect(offline.result.current.data?.source).toBe("cache");
  });

  it("rejects malformed successful responses instead of caching them", async () => {
    getDailyChallenge.mockResolvedValue({ ...response, moveBudget: 0 });
    const { result } = renderHook(() => useDailyChallenge("pearl-1", "2026-07-06"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(localStorage.length).toBe(0);
  });

  it("represents a not-ready response without persisting it", async () => {
    getDailyChallenge.mockResolvedValue({ date: "2026-07-06", ready: false });
    const { result } = renderHook(() => useDailyChallenge("pearl-1", "2026-07-06"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ date: "2026-07-06", ready: false, source: "network" });
    expect(localStorage.length).toBe(0);
  });
});
