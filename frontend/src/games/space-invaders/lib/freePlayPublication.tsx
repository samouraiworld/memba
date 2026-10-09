import type { ReactNode } from "react";
import type { SpaceInvadersFreePlayInput } from "./freePlayCodec";

export interface SpaceInvadersPreparedPublication { content: ReactNode; dispose(): void }
export interface SpaceInvadersPublication {
  /** Must persist the immutable terminal snapshot before returning. No API action. */
  prepare(input: SpaceInvadersFreePlayInput): SpaceInvadersPreparedPublication;
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
}): SpaceInvadersPublication {
  return {
    connect: options.connect,
    prepare(input) {
      const session = options.createSession(options.createSnapshot(input));
      try {
        return { content: options.renderSession(session), dispose: () => session.dispose() };
      } catch (error) { session.dispose(); throw error; }
    },
  };
}
