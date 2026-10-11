import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { usePreparedPublication } from "./usePreparedPublication";
import type { SpaceInvadersPublication, SpaceInvadersPreparedPublication } from "./freePlayPublication";
import type { SpaceInvadersReplayResult } from "./launch";
import vectors from "./testdata/freeplay_vectors.json";
const f = vectors.valid[0];
const outcome: SpaceInvadersReplayResult = Object.freeze({ game: "space-invaders", mode: "free", seed: f.engineSeed, clientRunId: f.input.clientRunId, simVersion: 1, finalTick: f.finalTick, events: f.events, score: f.score, hash: f.stateHash, verified: true });
function deferred() {
  let resolve!: (value: SpaceInvadersPreparedPublication) => void;
  const promise = new Promise<SpaceInvadersPreparedPublication>(done => { resolve = done; });
  return { promise, resolve };
}
it("disposes a late prepared owner without replacing the new owner's controls", async () => {
  const old = deferred(), stale = { content: "old", dispose: vi.fn() }, fresh = { content: "new", dispose: vi.fn() };
  const first = { prepare: vi.fn(() => old.promise) }, second = { prepare: vi.fn(() => fresh) };
  const view = renderHook(({ owner }: { owner?: SpaceInvadersPublication }) => usePreparedPublication(owner, outcome), { initialProps: { owner: first as SpaceInvadersPublication } });
  view.rerender({ owner: second });
  await waitFor(() => expect(view.result.current.prepared).toBe(fresh));
  await act(async () => { old.resolve(stale); await old.promise; });
  expect(stale.dispose).toHaveBeenCalledTimes(1); expect(view.result.current.prepared).toBe(fresh);
  expect(first.prepare).toHaveBeenCalledWith(f.input); expect(second.prepare).toHaveBeenCalledWith(f.input);
  view.unmount(); expect(fresh.dispose).toHaveBeenCalledTimes(1);
});
it("does not revive disposed controls when the same adapter returns after opt-out", async () => {
  const next = deferred(), original = { content: "old", dispose: vi.fn() }, restored = { content: "fresh", dispose: vi.fn() };
  const owner = { prepare: vi.fn<SpaceInvadersPublication["prepare"]>().mockReturnValueOnce(original).mockReturnValueOnce(next.promise) };
  const view = renderHook(({ owner }: { owner?: SpaceInvadersPublication }) => usePreparedPublication(owner, outcome), { initialProps: { owner: owner as SpaceInvadersPublication | undefined } });
  await waitFor(() => expect(view.result.current.prepared).toBe(original));
  view.rerender({ owner: undefined }); expect(original.dispose).toHaveBeenCalledTimes(1);
  view.rerender({ owner }); expect(view.result.current.prepared).toBeNull();
  await act(async () => { next.resolve(restored); await next.promise; });
  expect(view.result.current.prepared).toBe(restored);
});
it("disposes preparation that completes after the result owner unmounts", async () => {
  const pending = deferred(), prepared = { content: null, dispose: vi.fn() };
  const owner = { prepare: () => pending.promise };
  const view = renderHook(() => usePreparedPublication(owner, outcome));
  view.unmount();
  await act(async () => { pending.resolve(prepared); await pending.promise; });
  expect(prepared.dispose).toHaveBeenCalledTimes(1);
});
