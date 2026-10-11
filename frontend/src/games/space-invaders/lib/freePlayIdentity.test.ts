import { expect, it } from "vitest";
import { createFreePlayIdentity, persistFreePlayIdentity } from "./freePlayIdentity";
it("creates one secure UUID/seed identity and persists only its public metadata", () => {
  let sequence = 0;
  const crypto = { getRandomValues: <T extends ArrayBufferView | null>(value: T): T => { if (!(value instanceof Uint8Array)) throw new Error("expected bytes"); value.fill(++sequence); return value; } };
  const first = createFreePlayIdentity(0, crypto), next = createFreePlayIdentity(0, crypto);
  expect(first.clientRunId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(next.clientRunId).not.toBe(first.clientRunId);
  const saved: Record<string, string> = {};
  persistFreePlayIdentity({ setItem: (key, value) => { saved[key] = value; } }, first);
  expect(JSON.parse(Object.values(saved)[0])).toEqual({ schemaVersion: 1, game: "space-invaders", clientRunId: first.clientRunId, seed: "si1:00000000", rules: "si-free-standard-v1", simVersion: 1 });
  expect(Object.keys(saved)).toHaveLength(1);
});
it("never falls back to an invented identity or hides failed persistence", () => {
  expect(() => createFreePlayIdentity(7, { getRandomValues: () => { throw new Error("no crypto"); } })).toThrow("no crypto");
  const identity = { clientRunId: "00000000-0000-4000-8000-000000000000", seed: 7 };
  expect(() => persistFreePlayIdentity({ setItem: () => { throw new Error("quota"); } }, identity)).toThrow("quota");
  expect(identity.clientRunId).toBe("00000000-0000-4000-8000-000000000000");
});
