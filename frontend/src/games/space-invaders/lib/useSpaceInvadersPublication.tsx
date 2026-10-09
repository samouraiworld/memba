import { useMemo } from "react";
import { useFreePlayRuntime, type FreePlayGameRuntime } from "../../arcade/freeplay/FreePlayRuntimeContext";
import { createFreePlaySnapshot, loadFreePlaySnapshot, saveFreePlaySnapshot, type FreePlaySnapshot } from "../../arcade/freeplay/snapshot";
import { createFreePlaySession, type FreePlaySession } from "../../arcade/freeplay/session";
import { FreePlayResult } from "../../arcade/freeplay/FreePlayResult";
import { createSpaceInvadersPublication, type SpaceInvadersPublication } from "./freePlayPublication";
import { SI_FREE_RULES, SI_FREE_VERSION } from "./freePlayCodec";

type ResultOwner = { kind: "local"; snapshot: FreePlaySnapshot; dispose(): void } | { kind: "service"; session: FreePlaySession; dispose(): void };

/** Only consumes A's configured dependencies. No client, auth or endpoint is created. */
export function createSpaceInvadersRuntimePublication(runtime: FreePlayGameRuntime): SpaceInvadersPublication | undefined {
  if (runtime.rules !== SI_FREE_RULES || runtime.simVersion !== SI_FREE_VERSION) return undefined;
  return createSpaceInvadersPublication({
    createSnapshot: createFreePlaySnapshot,
    createSession(snapshot): ResultOwner {
      if (!runtime.client) {
        const stored = loadFreePlaySnapshot(runtime.storage, snapshot.input.clientRunId);
        if (stored && JSON.stringify(stored.input) !== JSON.stringify(snapshot.input)) throw new Error("run_conflict");
        // Rebinding a terminal result must retain A's consent and saved receipt.
        const canonical = stored ?? snapshot;
        saveFreePlaySnapshot(runtime.storage, canonical);
        return { kind: "local", snapshot: canonical, dispose() {} };
      }
      const session = createFreePlaySession({ snapshot, client: runtime.client, storage: runtime.storage });
      return { kind: "service", session, dispose: () => session.dispose() };
    },
    renderSession: owner => owner.kind === "service" ? <FreePlayResult session={owner.session} /> : <section aria-label="Saved local score">
      <h3>Your score: {owner.snapshot.input.claimedScore.toLocaleString()}</h3>
      <p>Your score is saved locally. Publication is unavailable right now.</p>
      {owner.snapshot.result?.receipt && <p>Saved receipt — check it again when publication is available.</p>}
    </section>,
    recovery: { loadSnapshot: id => loadFreePlaySnapshot(runtime.storage, id), inputOf: snapshot => snapshot.input },
    connect: runtime.connect,
  });
}

/** Explicit props win; null opts out; undefined consumes the neutral provider. */
export function useSpaceInvadersPublication(explicit?: SpaceInvadersPublication | null): SpaceInvadersPublication | undefined {
  const runtime = useFreePlayRuntime()?.games["space-invaders"];
  return useMemo(() => explicit !== undefined ? explicit ?? undefined : runtime ? createSpaceInvadersRuntimePublication(runtime) : undefined, [explicit, runtime]);
}
