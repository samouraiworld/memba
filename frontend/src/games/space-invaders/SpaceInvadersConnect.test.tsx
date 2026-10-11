import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFreePlayClient } from "../../lib/arcadeFreePlay";
import { createFreePlaySnapshot, listFreePlaySnapshots, loadFreePlaySnapshot, saveFreePlaySnapshot, type SnapshotStorage } from "../arcade/freeplay/snapshot";
import { createSpaceInvadersRuntimePublication } from "./lib/useSpaceInvadersPublication";
import { SpaceInvadersSavedResult } from "./screens/SpaceInvadersSavedResult";
import { SI_FREE_RULES, type SpaceInvadersFreePlayInput } from "./lib/freePlayCodec";
import vectors from "./lib/testdata/freeplay_vectors.json";

const input = vectors.valid[0].input as SpaceInvadersFreePlayInput;
const fixture = vectors.valid[0];
const binding = { player: fixture.player, target: fixture.target };
const configured = (storage: SnapshotStorage, connect: () => void | Promise<void>) => ({ storage, connect, rules: SI_FREE_RULES, simVersion: 1 });
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("rechecks the latest canonical consent before Connect and recovers the same completed run after remount", async () => {
  const connect = vi.fn(() => {
    expect(loadFreePlaySnapshot(localStorage, input.clientRunId)).toEqual(canonical);
    expect(listFreePlaySnapshots(localStorage).snapshots[0]).toEqual(canonical);
  });
  const adapter = createSpaceInvadersRuntimePublication(configured(localStorage, connect))!;
  const prepared = await adapter.prepare(input);
  const view = render(<>{prepared.content}</>);
  expect(await screen.findByText(/After connecting, find this completed result/)).toBeVisible();
  expect(connect).not.toHaveBeenCalled();
  // The mounted local wrapper predates a binding and consent saved elsewhere.
  const canonical = { ...createFreePlaySnapshot(input), binding, result: { entry: { game: input.game, player: fixture.player, rules: input.rules, simVersion: input.simVersion, runID: fixture.runID, seed: input.seed, score: fixture.score, stateHash: fixture.stateHash, replayHash: fixture.replayHash }, payloadHash: fixture.payloadHash, status: "queued" as const }, publication: { payloadHash: fixture.payloadHash, quoteId: "a".repeat(64), nonce: "b".repeat(64) } };
  saveFreePlaySnapshot(localStorage, canonical);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Connect wallet for saved scores" })); });
  expect(connect).toHaveBeenCalledTimes(1);
  view.unmount(); prepared.dispose();
  render(<SpaceInvadersSavedResult publication={adapter} recovery={{ clientRunId: input.clientRunId, onClose: vi.fn() }} />);
  await screen.findByRole("button", { name: "Connect wallet for saved scores" });
  expect(screen.queryByRole("button", { name: "Connect account" })).toBeNull();
  expect(loadFreePlaySnapshot(localStorage, input.clientRunId)).toEqual(canonical);
  expect(connect).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: /play|verify|publish/i })).toBeNull();
});

it.each(["local", "service"] as const)("refuses Connect and offers export when index storage fails at the click: %s", async mode => {
  let fail = false;
  const storage: SnapshotStorage = {
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => { if (fail && key === "memba:arcade:freeplay:index:v1") throw new Error("quota"); localStorage.setItem(key, value); },
  };
  const connect = vi.fn(), request = vi.fn(), token = vi.fn();
  const client = mode === "service" ? createFreePlayClient({ origin: "https://example.invalid", target: fixture.target, auth: { identity: () => null, subscribe: () => () => {}, token }, fetch: request }) : undefined;
  const adapter = createSpaceInvadersRuntimePublication({ ...configured(storage, connect), client })!;
  const prepared = await adapter.prepare(input);
  const view = render(<>{prepared.content}</>);
  const button = await screen.findByRole("button", { name: "Connect wallet for saved scores" });
  expect(screen.getAllByRole("button", { name: "Connect wallet for saved scores" })).toHaveLength(1);
  fail = true;
  await act(async () => { fireEvent.click(button); });
  expect(connect).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
  expect(screen.getByText(/could not be saved for recovery/)).toBeVisible();
  expect(screen.queryByText(/After connecting, find this completed result/)).toBeNull();
  fireEvent.click(screen.getByText("Export completed result"));
  const exported = JSON.parse((screen.getByRole("textbox", { name: "Completed result export" }) as HTMLTextAreaElement).value);
  expect(exported.input).toEqual(input);
  view.unmount(); prepared.dispose();
});

it("does not expose a prepared result when the initial index write silently fails", () => {
  const storage: SnapshotStorage = {
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => { if (key !== "memba:arcade:freeplay:index:v1") localStorage.setItem(key, value); },
  };
  const connect = vi.fn();
  const adapter = createSpaceInvadersRuntimePublication(configured(storage, connect))!;
  expect(() => adapter.prepare(input)).toThrow("storage_unavailable");
  expect(connect).not.toHaveBeenCalled();
  expect(listFreePlaySnapshots(storage).total).toBe(0);
});

it("keeps account A's binding after reopening with another identity and does not call the API", async () => {
  const canonical = { ...createFreePlaySnapshot(input), binding };
  saveFreePlaySnapshot(localStorage, canonical);
  const token = vi.fn(), request = vi.fn(), connect = vi.fn();
  const client = createFreePlayClient({ origin: "https://example.invalid", target: fixture.target,
    auth: { identity: () => ({ player: "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq", chainId: fixture.target.chainId, revision: "B" }), subscribe: () => () => {}, token }, fetch: request });
  const adapter = createSpaceInvadersRuntimePublication({ ...configured(localStorage, connect), client })!;
  render(<SpaceInvadersSavedResult publication={adapter} recovery={{ clientRunId: input.clientRunId, onClose: vi.fn() }} />);
  const verify = await screen.findByRole("button", { name: "Verify score" });
  expect(request).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(verify); });
  expect(screen.getByText(/Reconnect the wallet and network used for this result/)).toBeVisible();
  expect(loadFreePlaySnapshot(localStorage, input.clientRunId)).toEqual(canonical);
  expect(request).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
});


it.each(["quota", "silent-index"] as const)("exports the loaded canonical archive if recovery persistence fails: %s", async failure => {
  const canonical = { ...createFreePlaySnapshot(input), binding,
    result: { entry: { game: input.game, player: fixture.player, rules: input.rules, simVersion: input.simVersion, runID: fixture.runID, seed: input.seed, score: fixture.score, stateHash: fixture.stateHash, replayHash: fixture.replayHash }, payloadHash: fixture.payloadHash, status: "confirmed" as const,
      receipt: { target: fixture.target, entry: { game: input.game, player: fixture.player, rules: input.rules, simVersion: input.simVersion, runID: fixture.runID, seed: input.seed, score: fixture.score, stateHash: fixture.stateHash, replayHash: fixture.replayHash }, height: 123, attester: fixture.player, schemaVersion: 2 as const } },
    publication: { payloadHash: fixture.payloadHash, quoteId: "a".repeat(64), nonce: "b".repeat(64) } };
  saveFreePlaySnapshot(localStorage, canonical);
  // The canonical record remains readable; its required index cannot be restored.
  localStorage.removeItem("memba:arcade:freeplay:index:v1");
  const storage: SnapshotStorage = { getItem: key => localStorage.getItem(key), setItem: (key, value) => {
    if (key === "memba:arcade:freeplay:index:v1") { if (failure === "quota") throw new Error("quota"); return; }
    localStorage.setItem(key, value);
  } };
  const connect = vi.fn(), request = vi.fn(), token = vi.fn();
  const client = createFreePlayClient({ origin: "https://example.invalid", target: fixture.target, auth: { identity: () => null, subscribe: () => () => {}, token }, fetch: request });
  const adapter = createSpaceInvadersRuntimePublication({ ...configured(storage, connect), client })!;
  render(<SpaceInvadersSavedResult publication={adapter} recovery={{ clientRunId: input.clientRunId, onClose: vi.fn() }} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("recovery could not be saved");
  fireEvent.click(screen.getByText("Export completed result"));
  expect(JSON.parse((screen.getByRole("textbox", { name: "Completed result export" }) as HTMLTextAreaElement).value)).toEqual(canonical);
  expect(screen.queryByRole("button", { name: /connect|verify|publish|check saved/i })).toBeNull();
  expect(screen.queryByText(/After connecting/)).toBeNull();
  expect(connect).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
  expect(loadFreePlaySnapshot(localStorage, input.clientRunId)).toEqual(canonical);
});
