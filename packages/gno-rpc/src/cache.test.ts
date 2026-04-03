import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  QueryCache,
  cacheKey,
  TTL_PROPOSAL,
  TTL_VOTES,
  TTL_TREASURY,
} from "./cache.js";

describe("QueryCache", () => {
  let cache: QueryCache;

  beforeEach(() => {
    cache = new QueryCache(100);
  });

  it("stores and retrieves values", () => {
    cache.set("key1", "value1", 60_000);
    expect(cache.get("key1")).toBe("value1");
  });

  it("returns undefined for missing keys", () => {
    expect(cache.get("missing")).toBeUndefined();
  });

  it("returns undefined for expired entries", () => {
    vi.useFakeTimers();
    cache.set("key1", "value1", 1_000);
    expect(cache.get("key1")).toBe("value1");

    vi.advanceTimersByTime(1_001);
    expect(cache.get("key1")).toBeUndefined();
    vi.useRealTimers();
  });

  it("never expires infinite TTL entries", () => {
    vi.useFakeTimers();
    cache.set("permanent", "data", Infinity);
    vi.advanceTimersByTime(999_999_999);
    expect(cache.get("permanent")).toBe("data");
    vi.useRealTimers();
  });

  it("caches null values", () => {
    cache.set("nullval", null, 60_000);
    expect(cache.get("nullval")).toBeNull();
  });

  it("evicts oldest entry when at capacity", () => {
    const small = new QueryCache(3);
    small.set("a", "1", 60_000);
    small.set("b", "2", 60_000);
    small.set("c", "3", 60_000);
    small.set("d", "4", 60_000);
    expect(small.get("a")).toBeUndefined();
    expect(small.get("d")).toBe("4");
  });

  it("has() works correctly", () => {
    cache.set("exists", "yes", 60_000);
    expect(cache.has("exists")).toBe(true);
    expect(cache.has("nope")).toBe(false);
  });

  it("delete() removes entries", () => {
    cache.set("key", "val", 60_000);
    cache.delete("key");
    expect(cache.get("key")).toBeUndefined();
  });

  it("clear() removes all entries", () => {
    cache.set("a", "1", 60_000);
    cache.set("b", "2", 60_000);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe("cacheKey", () => {
  it("builds deterministic keys", () => {
    expect(cacheKey("render", "gno.land/r/gov/dao", "42")).toBe(
      "render:gno.land/r/gov/dao:42"
    );
  });
});

describe("TTL constants", () => {
  it("has expected values", () => {
    expect(TTL_PROPOSAL).toBe(Infinity);
    expect(TTL_VOTES).toBe(60_000);
    expect(TTL_TREASURY).toBe(30_000);
  });
});
