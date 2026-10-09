import { useMemo } from "react";
import { useFreePlayRuntime, type FreePlayGameRuntime } from "../../arcade/freeplay/FreePlayRuntimeContext";
import { createFreePlaySnapshot, loadFreePlaySnapshot, prepareFreePlayRecovery, type FreePlaySnapshot } from "../../arcade/freeplay/snapshot";
import { createFreePlaySession, type FreePlaySession } from "../../arcade/freeplay/session";
import { FreePlayConnect } from "../../arcade/freeplay/FreePlayConnect";
import { FreePlayResult } from "../../arcade/freeplay/FreePlayResult";
import { createSpaceInvadersPublication, type SpaceInvadersPublication } from "./freePlayPublication";
import { SI_FREE_RULES, SI_FREE_VERSION } from "./freePlayCodec";

type ResultOwner = { kind: "local"; snapshot: FreePlaySnapshot; prepareRecovery(): FreePlaySnapshot; dispose(): void } | { kind: "service"; session: FreePlaySession; dispose(): void };

/** Only consumes A's configured dependencies. No client, auth or endpoint is created. */
export function createSpaceInvadersRuntimePublication(runtime: FreePlayGameRuntime): SpaceInvadersPublication | undefined {
  if (runtime.rules !== SI_FREE_RULES || runtime.simVersion !== SI_FREE_VERSION) return undefined;
  return createSpaceInvadersPublication({
    createSnapshot: createFreePlaySnapshot,
    createSession(snapshot): ResultOwner {
      if (!runtime.client) {
        // A prefers the canonical binding/consent and confirms both snapshot and index.
        let canonical = prepareFreePlayRecovery(runtime.storage, snapshot);
        let disposed = false;
        return { kind: "local", snapshot: canonical, prepareRecovery() {
          if (disposed) throw new Error("saved_result_unavailable");
          canonical = prepareFreePlayRecovery(runtime.storage, canonical);
          return canonical;
        }, dispose() { disposed = true; } };
      }
      const session = createFreePlaySession({ snapshot, client: runtime.client, storage: runtime.storage });
      return { kind: "service", session, dispose: () => session.dispose() };
    },
    renderSession: owner => owner.kind === "service" ? <FreePlayResult session={owner.session} connect={runtime.connect} /> : <section aria-label="Saved local score">
      <h3>Your score: {owner.snapshot.input.claimedScore.toLocaleString()}</h3>
      <p>Publication is unavailable right now.</p>
      {runtime.connect && <FreePlayConnect snapshot={owner.snapshot} prepare={owner.prepareRecovery} connect={runtime.connect} />}
      {owner.snapshot.result?.receipt && <p>Saved receipt — check it again when publication is available.</p>}
    </section>,
    recovery: {
      loadSnapshot: id => loadFreePlaySnapshot(runtime.storage, id), inputOf: snapshot => snapshot.input,
      renderUnavailable: snapshot => <section aria-label="Saved result export">
        <p role="alert">This completed result was loaded, but recovery could not be saved. Export it before leaving.</p>
        <details><summary>Export completed result</summary><textarea aria-label="Completed result export" readOnly value={JSON.stringify(snapshot, null, 2)} /></details>
      </section>,
    },
  });
}

/** Explicit props win; null opts out; undefined consumes the neutral provider. */
export function useSpaceInvadersPublication(explicit?: SpaceInvadersPublication | null): SpaceInvadersPublication | undefined {
  const runtime = useFreePlayRuntime()?.games["space-invaders"];
  return useMemo(() => explicit !== undefined ? explicit ?? undefined : runtime ? createSpaceInvadersRuntimePublication(runtime) : undefined, [explicit, runtime]);
}
