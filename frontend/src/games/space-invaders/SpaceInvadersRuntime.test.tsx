import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SpaceInvadersGame from "../../pages/SpaceInvadersGame";
import { WindowActivityContext } from "../../os/page/WindowActivity";
import { FreePlayRuntimeProvider } from "../arcade/freeplay/FreePlayRuntimeProvider";
import type { FreePlayGameRuntime, FreePlayRecovery } from "../arcade/freeplay/FreePlayRuntimeContext";
import { createFreePlaySnapshot, listFreePlaySnapshots, saveFreePlaySnapshot } from "../arcade/freeplay/snapshot";
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

it("persists a local result through A's shared index even without a service client", () => {
  const adapter = createSpaceInvadersRuntimePublication(runtime())!;
  expect(listFreePlaySnapshots(localStorage).total).toBe(0);
  const prepared = adapter.prepare(input);
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
