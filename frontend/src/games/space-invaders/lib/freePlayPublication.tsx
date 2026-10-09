import type { ReactNode } from "react";
import { SI_FREE_CODEC, SI_FREE_RULES, SI_FREE_UUID, SI_FREE_VERSION, type SpaceInvadersFreePlayInput } from "./freePlayCodec";

export interface SpaceInvadersPreparedPublication { content: ReactNode; dispose(): void }
export interface SpaceInvadersPublication {
  /** Must persist the immutable terminal snapshot before exposing a handle. No API action. */
  prepare(input: SpaceInvadersFreePlayInput): SpaceInvadersPreparedPublication | Promise<SpaceInvadersPreparedPublication>;
  /** Open an existing A snapshot without creating a run or starting API work. */
  recover?: (clientRunId: string) => SpaceInvadersPreparedPublication | Promise<SpaceInvadersPreparedPublication>;
  /** Optional host-owned wallet connection, called only from an explicit click. */
  connect?: () => void;
}

/** Consume A's snapshot/session/result functions by injection, without another
 * transport, auth adapter, persistence controller or publication state machine.
 * See freePlay.md for the exact A3 binding. This factory is dormant until supplied. */
export function createSpaceInvadersPublication<Snapshot, Session extends { dispose(): void }>(options: {
  createSnapshot(input: SpaceInvadersFreePlayInput): Snapshot;
  createSession(snapshot: Snapshot): Session;
  renderSession(session: Session): ReactNode;
  connect?: () => void;
  recovery?: {
    /** A's bounded loader validates the complete stored snapshot. */
    loadSnapshot(clientRunId: string): Snapshot | null | Promise<Snapshot | null>;
    inputOf(snapshot: Snapshot): Pick<SpaceInvadersFreePlayInput, "clientRunId" | "simVersion"> & { game: string; rules: string; replayCodec: string };
  };
}): SpaceInvadersPublication {
  const prepareSnapshot = (snapshot: Snapshot): SpaceInvadersPreparedPublication => {
    const session = options.createSession(snapshot);
    try {
      return { content: options.renderSession(session), dispose: () => session.dispose() };
    } catch (error) { session.dispose(); throw error; }
  };
  const recovery = options.recovery;
  return {
    connect: options.connect,
    prepare: input => prepareSnapshot(options.createSnapshot(input)),
    ...(recovery ? { async recover(clientRunId: string) {
      if (clientRunId.length !== 36 || !SI_FREE_UUID.test(clientRunId)) throw new Error("invalid_run_identity");
      const snapshot = await recovery.loadSnapshot(clientRunId);
      if (!snapshot) throw new Error("saved_result_unavailable");
      const input = recovery.inputOf(snapshot);
      if (input.clientRunId !== clientRunId || input.game !== "space-invaders" || input.rules !== SI_FREE_RULES || input.simVersion !== SI_FREE_VERSION || input.replayCodec !== SI_FREE_CODEC) throw new Error("saved_result_unavailable");
      return prepareSnapshot(snapshot);
    } } : {}),
  };
}
