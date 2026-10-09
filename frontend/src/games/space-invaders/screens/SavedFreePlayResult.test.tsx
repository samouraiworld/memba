import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import SpaceInvadersGame from "../../../pages/SpaceInvadersGame";
import { createSpaceInvadersPublication } from "../lib/freePlayPublication";
import type { SpaceInvadersFreePlayInput } from "../lib/freePlayCodec";
import vectors from "../lib/testdata/freeplay_vectors.json";
vi.mock("../SpaceInvaders", () => ({ default: () => <div data-testid="live-game">Live game</div> }));
const input = vectors.valid[0].input as SpaceInvadersFreePlayInput;
it("opens A's existing snapshot without creating a run, confirming a stored receipt or consuming a launch", async () => {
  const snapshot = { input, receipt: "stored receipt" };
  const createSnapshot = vi.fn(() => snapshot), loadSnapshot = vi.fn(() => snapshot), dispose = vi.fn(), refresh = vi.fn(), connect = vi.fn(), close = vi.fn(), consume = vi.fn();
  const createSession = vi.fn((saved: typeof snapshot) => ({ saved, dispose }));
  const publication = createSpaceInvadersPublication({ createSnapshot, createSession,
    recovery: { loadSnapshot, inputOf: saved => saved.input }, connect,
    renderSession: () => <><p>Saved receipt — check it again.</p><button onClick={refresh}>Check saved result</button></>,
  });
  const props = { publication, recovery: { clientRunId: input.clientRunId, onClose: close }, launch: { id: "pending", game: "space-invaders" as const, mode: "free" as const }, onLaunchConsumed: consume };
  const view = render(<SpaceInvadersGame {...props} />);
  await screen.findByRole("button", { name: "Check saved result" });
  expect(screen.queryByTestId("live-game")).toBeNull();
  expect(createSnapshot).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
  expect(loadSnapshot).toHaveBeenCalledWith(input.clientRunId);
  expect(createSession).toHaveBeenCalledWith(snapshot);
  expect(screen.queryByText(/confirmed/i)).toBeNull();
  expect(refresh).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled();
  view.rerender(<SpaceInvadersGame {...props} recovery={{ ...props.recovery }} />);
  expect(createSession).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Check saved result" })); expect(refresh).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Connect account" })); expect(connect).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Back to saved results" })); expect(close).toHaveBeenCalledTimes(1);
  view.unmount(); expect(dispose).toHaveBeenCalledTimes(1);
});
it.each(["missing", "corrupt", "unsupported"])("keeps recovery errors local and never falls through to gameplay: %s", async kind => {
  const recover = kind === "unsupported" ? undefined : vi.fn(() => { throw new Error(kind); });
  const prepare = vi.fn();
  render(<SpaceInvadersGame publication={{ prepare, recover }} recovery={{ clientRunId: input.clientRunId, onClose: vi.fn() }} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be opened");
  expect(screen.queryByTestId("live-game")).toBeNull(); expect(prepare).not.toHaveBeenCalled();
});
it("disposes the previous recovered session when selecting another result", async () => {
  const dispose = vi.fn(), recover = vi.fn(() => ({ content: <p>Saved result</p>, dispose }));
  const publication = { prepare: vi.fn(), recover };
  const view = render(<SpaceInvadersGame publication={publication} recovery={{ clientRunId: input.clientRunId, onClose: vi.fn() }} />);
  await screen.findByText("Saved result");
  view.rerender(<SpaceInvadersGame publication={publication} recovery={{ clientRunId: vectors.valid[1].input.clientRunId, onClose: vi.fn() }} />);
  await screen.findByText("Saved result");
  expect(dispose).toHaveBeenCalledTimes(1); expect(recover).toHaveBeenCalledTimes(2);
  view.unmount(); expect(dispose).toHaveBeenCalledTimes(2);
});
it("rejects mismatched saved identities or game contracts before creating a session", async () => {
  const createSession = vi.fn(() => ({ dispose: vi.fn() }));
  const changed = [null, { ...input, clientRunId: vectors.valid[1].input.clientRunId }, { ...input, game: "barricade" }, { ...input, simVersion: 2 }, { ...input, replayCodec: "other" }, { ...input, rules: "si-daily-v1" }];
  for (const saved of changed) {
    const publication = createSpaceInvadersPublication({ createSnapshot: () => input, createSession, renderSession: () => null, recovery: { loadSnapshot: () => saved, inputOf: item => item } });
    await expect(publication.recover!(input.clientRunId)).rejects.toThrow("saved_result_unavailable");
  }
  const loadSnapshot = vi.fn(() => input);
  const publication = createSpaceInvadersPublication({ createSnapshot: () => input, createSession, renderSession: () => null, recovery: { loadSnapshot, inputOf: item => item } });
  await expect(publication.recover!("invalid")).rejects.toThrow("invalid_run_identity");
  expect(loadSnapshot).not.toHaveBeenCalled(); expect(createSession).not.toHaveBeenCalled();
});

it("disposes a late-loaded session after leaving recovery", async () => {
  const dispose = vi.fn();
  let resolve!: (value: { content: null; dispose(): void }) => void;
  const pending = new Promise<{ content: null; dispose(): void }>(done => { resolve = done; });
  const view = render(<SpaceInvadersGame publication={{ prepare: vi.fn(), recover: () => pending }} recovery={{ clientRunId: input.clientRunId, onClose: vi.fn() }} />);
  expect(screen.getByRole("status")).toHaveTextContent("Opening saved result");
  view.unmount();
  await act(async () => { resolve({ content: null, dispose }); await pending; });
  expect(dispose).toHaveBeenCalledTimes(1);
});
