import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SpaceInvadersGame from "../../pages/SpaceInvadersGame";
import { WindowActivityContext } from "../../os/page/WindowActivity";
import { FreePlayRuntimeProvider } from "../arcade/freeplay/FreePlayRuntimeProvider";
import type { FreePlayGameRuntime, FreePlayRecovery } from "../arcade/freeplay/FreePlayRuntimeContext";
import { createFreePlaySnapshot, listFreePlaySnapshots, loadFreePlaySnapshot, saveFreePlaySnapshot } from "../arcade/freeplay/snapshot";
import { createFreePlayClient, freePlayRunID, hashFreePlayFields, type FreePlayRun } from "../../lib/arcadeFreePlay";
import type { SpaceInvadersReplayResult } from "./lib/launch";
import { SpaceInvadersSavedResult } from "./screens/SpaceInvadersSavedResult";
import { createSpaceInvadersRuntimePublication, useSpaceInvadersPublication } from "./lib/useSpaceInvadersPublication";
import type { SpaceInvadersPublication } from "./lib/freePlayPublication";
import { SI_FREE_RULES, type SpaceInvadersFreePlayInput } from "./lib/freePlayCodec";
import vectors from "./lib/testdata/freeplay_vectors.json";
const input = vectors.valid[0].input as SpaceInvadersFreePlayInput;
const advance = vi.hoisted(() => vi.fn());
vi.mock("./lib/seed", () => ({ newRunSeed: () => 1 }));
vi.mock("./render/draw", () => ({ draw: vi.fn() }));
vi.mock("./hooks/usePlayfieldSize", () => ({ usePlayfieldSize: () => ({ width: 320, height: 400, availableHeight: 600, landscape: false }) }));
vi.mock("./hooks/useGameLoop", async original => {
  const actual = await original<typeof import("./hooks/useGameLoop")>();
  return { ...actual, advanceWithEvents: (...args: Parameters<typeof actual.advanceWithEvents>) => {
    const result = actual.advanceWithEvents(...args); advance(args, result.state); return result;
  } };
});
let frames: Map<number, FrameRequestCallback>, sequence: number;
function frame(time: number) { act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(cb => cb(time)); }); }
const runtime = (): FreePlayGameRuntime => ({ storage: localStorage, rules: SI_FREE_RULES, simVersion: 1 });
beforeEach(() => {
  localStorage.clear(); advance.mockClear(); frames = new Map(); sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++sequence, cb); return sequence; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 320, bottom: 400, width: 320, height: 400, toJSON: () => ({}) });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps the same active engine/run while Your runs opens an old result and requires resume on return", async () => {
  saveFreePlaySnapshot(localStorage, createFreePlaySnapshot(input));
  const games = { "space-invaders": runtime() }, consumed = vi.fn(), completed = vi.fn(), close = vi.fn();
  const launch = { id: "one-play", game: "space-invaders" as const, mode: "free" as const };
  const tree = (active: boolean, recovery?: FreePlayRecovery) => <FreePlayRuntimeProvider value={{ games, recovery }}>
    <WindowActivityContext.Provider value={active}><SpaceInvadersGame launch={launch} onLaunchConsumed={consumed} onReplayReady={completed} /></WindowActivityContext.Provider>
    <SpaceInvadersSavedResult />
  </FreePlayRuntimeProvider>;
  const view = render(tree(true)); frame(0); frame(250); frame(500);
  const canvas = view.container.querySelector("canvas"), saved = advance.mock.calls.at(-1)![1], count = advance.mock.calls.length;
  const identity = localStorage.getItem("memba:space-invaders:active-free:v1");
  expect(consumed).toHaveBeenCalledExactlyOnceWith("one-play");
  view.rerender(tree(false, { game: "space-invaders", clientRunId: input.clientRunId, onClose: close }));
  await screen.findByRole("region", { name: "Saved local score" }); frame(10_000);
  expect(view.container.querySelector("canvas")).toBe(canvas);
  expect(localStorage.getItem("memba:space-invaders:active-free:v1")).toBe(identity);
  expect(advance).toHaveBeenCalledTimes(count); expect(completed).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "Relay paused" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Back to saved results" })); expect(close).toHaveBeenCalledTimes(1);
  view.rerender(tree(true)); frame(20_000);
  expect(view.container.querySelector("canvas")).toBe(canvas);
  expect(screen.getByRole("heading", { name: "Relay paused" })).toBeVisible();
  expect(advance).toHaveBeenCalledTimes(count); expect(consumed).toHaveBeenCalledTimes(1);
  expect(listFreePlaySnapshots(localStorage, { game: "space-invaders" }).total).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Resume defense" })); frame(20_250);
  expect(advance.mock.calls[count][0][0]).toMatchObject({ seed: saved.seed, tick: saved.tick, score: saved.score, player: saved.player });
});

it("persists a local result through A's shared index even without a service client", async () => {
  const adapter = createSpaceInvadersRuntimePublication(runtime())!;
  expect(listFreePlaySnapshots(localStorage).total).toBe(0);
  const prepared = await adapter.prepare(input);
  render(<>{prepared.content}</>);
  expect(screen.getByRole("region", { name: "Saved local score" })).toHaveTextContent("510");
  expect(screen.queryByRole("button", { name: "Verify score" })).toBeNull();
  expect(screen.queryByText(/confirmed/i)).toBeNull();
  expect(listFreePlaySnapshots(localStorage).snapshots[0].input.clientRunId).toBe(input.clientRunId);
  prepared.dispose();
});

function Probe({ publication }: { publication?: SpaceInvadersPublication | null }) {
  const adapter = useSpaceInvadersPublication(publication);
  return <button disabled={!adapter} onClick={() => adapter?.prepare(input)}>Prepare test result</button>;
}
it("uses explicit publication first, null opts out, undefined falls back, and no provider stays off", () => {
  const prepare = vi.fn(), games = { "space-invaders": runtime() };
  const tree = (publication?: SpaceInvadersPublication | null) => <FreePlayRuntimeProvider value={{ games }}><Probe publication={publication} /></FreePlayRuntimeProvider>;
  const view = render(tree({ prepare }));
  fireEvent.click(screen.getByRole("button")); expect(prepare).toHaveBeenCalledTimes(1); expect(localStorage.length).toBe(0);
  view.rerender(tree(null)); expect(screen.getByRole("button")).toBeDisabled();
  view.rerender(tree()); fireEvent.click(screen.getByRole("button")); expect(listFreePlaySnapshots(localStorage).total).toBe(1);
  view.rerender(<Probe />); expect(screen.getByRole("button")).toBeDisabled();
});
it("does not open another game's selection, respects null recovery and rejects unsupported rules", () => {
  const games = { "space-invaders": runtime() };
  const view = render(<FreePlayRuntimeProvider value={{ games, recovery: { game: "barricade", clientRunId: input.clientRunId, onClose: vi.fn() } }}><SpaceInvadersSavedResult /></FreePlayRuntimeProvider>);
  expect(screen.queryByRole("heading")).toBeNull();
  view.rerender(<FreePlayRuntimeProvider value={{ games, recovery: { game: "space-invaders", clientRunId: input.clientRunId, onClose: vi.fn() } }}><SpaceInvadersSavedResult recovery={null} /></FreePlayRuntimeProvider>);
  expect(screen.queryByRole("heading")).toBeNull();
  expect(createSpaceInvadersRuntimePublication({ ...runtime(), rules: "unsupported" })).toBeUndefined();
  expect(createSpaceInvadersRuntimePublication({ ...runtime(), simVersion: 2 })).toBeUndefined();
});


it("rebinds a real terminal run from local to service and another client without replaying or automatic I/O", async () => {
  const completed = vi.fn<(result: SpaceInvadersReplayResult) => void>();
  const tree = (configured: FreePlayGameRuntime) => <FreePlayRuntimeProvider value={{ games: { "space-invaders": configured } }}><SpaceInvadersGame onReplayReady={completed} /></FreePlayRuntimeProvider>;
  const view = render(tree(runtime()));
  fireEvent.click(screen.getByRole("button", { name: /free play/i }));
  act(() => { for (let n = 0; n < 600; n++) { const pending = [...frames.values()]; frames.clear(); pending.forEach(cb => cb(n * 250)); } });
  await screen.findByRole("region", { name: "Saved local score" });
  const outcome = completed.mock.calls[0][0], canvas = view.container.querySelector("canvas");
  const canonical = loadFreePlaySnapshot(localStorage, outcome.clientRunId!)!;
  expect(Object.isFrozen(outcome)).toBe(true); expect(Object.isFrozen(outcome.events)).toBe(true);
  const identity = { player: vectors.valid[0].player, chainId: vectors.valid[0].target.chainId, revision: "one" };
  const unsubscribe = vi.fn(), token = vi.fn(async () => ({ token: "offline", identity }));
  const request = vi.fn(async () => {
    const i = canonical.input, target = vectors.valid[0].target;
    const runID = await freePlayRunID({ player: identity.player, target }, i);
    const replayHash = await hashFreePlayFields("memba:free-replay:v1", i.game, i.rules, String(i.simVersion), i.seed, i.replayCodec, i.replay);
    const payloadHash = await hashFreePlayFields("memba:free-anchor:v1", target.chainId, target.realm, runID, identity.player, i.game, i.rules, String(i.simVersion), i.seed, String(i.claimedScore), outcome.hash, replayHash);
    const run: FreePlayRun = { target, entry: { game: i.game, player: identity.player, rules: i.rules, simVersion: i.simVersion, runID, seed: i.seed, score: i.claimedScore, stateHash: outcome.hash, replayHash }, clientRunId: i.clientRunId, payloadHash, replayCodec: i.replayCodec, replay: i.replay, status: "verified" };
    return new Response(JSON.stringify(run), { status: 200 });
  });
  const options = { origin: "https://example.invalid", target: vectors.valid[0].target, auth: { identity: () => identity, subscribe: () => unsubscribe, token }, fetch: request };
  view.rerender(tree({ ...runtime(), client: createFreePlayClient(options) }));
  const verify = await screen.findByRole("button", { name: "Verify score" });
  expect(verify).not.toBeDisabled(); expect(request).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
  expect(view.container.querySelector("canvas")).toBe(canvas); expect(completed).toHaveBeenCalledTimes(1);
  expect(loadFreePlaySnapshot(localStorage, outcome.clientRunId!)!.input).toEqual(canonical.input);
  fireEvent.click(verify);
  await screen.findByRole("button", { name: "Review publication" });
  expect(request).toHaveBeenCalledTimes(1);
  view.rerender(tree({ ...runtime(), client: createFreePlayClient(options) }));
  await screen.findByRole("button", { name: "Verify score" });
  expect(unsubscribe).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(1);
  expect(view.container.querySelector("canvas")).toBe(canvas);
  expect(localStorage.getItem("memba:space-invaders:active-free:v1")).toContain(outcome.clientRunId!);
  expect(completed).toHaveBeenCalledTimes(1);
  view.unmount(); expect(unsubscribe).toHaveBeenCalledTimes(2);
});

it("retains canonical consent and receipt when rebinding a service result to local, and rejects conflicting input", async () => {
  const f = vectors.valid[0];
  const entry = { game: input.game, player: f.player, rules: input.rules, simVersion: 1, runID: f.runID, seed: input.seed, score: f.score, stateHash: f.stateHash, replayHash: f.replayHash };
  const snapshot = { ...createFreePlaySnapshot(input), binding: { player: f.player, target: f.target }, result: { entry, payloadHash: f.payloadHash, status: "confirmed" as const, receipt: { target: f.target, entry, height: 123, attester: f.player, schemaVersion: 2 as const } }, publication: { payloadHash: f.payloadHash, quoteId: "a".repeat(64), nonce: "b".repeat(64) } };
  saveFreePlaySnapshot(localStorage, snapshot);
  const request = vi.fn(), unsubscribe = vi.fn();
  const client = createFreePlayClient({ origin: "https://example.invalid", target: f.target, auth: { identity: () => null, subscribe: () => unsubscribe, token: vi.fn() }, fetch: request });
  const service = await createSpaceInvadersRuntimePublication({ ...runtime(), client })!.prepare(input);
  service.dispose(); expect(unsubscribe).toHaveBeenCalledTimes(1);
  const local = createSpaceInvadersRuntimePublication(runtime())!;
  const prepared = await local.prepare(input);
  render(<>{prepared.content}</>);
  expect(loadFreePlaySnapshot(localStorage, input.clientRunId)).toEqual(snapshot);
  expect(screen.getByText(/Saved receipt/)).toBeVisible(); expect(screen.queryByText(/confirmed/i)).toBeNull();
  expect(() => local.prepare({ ...input, claimedScore: input.claimedScore + 1 })).toThrow("run_conflict");
  expect(loadFreePlaySnapshot(localStorage, input.clientRunId)).toEqual(snapshot);
  expect(request).not.toHaveBeenCalled(); prepared.dispose();
});
