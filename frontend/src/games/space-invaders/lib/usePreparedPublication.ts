import { useEffect, useMemo, useState } from "react";
import { freePlayInputFromResult, SpaceInvadersFreePlayError } from "./freePlayCodec";
import type { SpaceInvadersReplayResult } from "./launch";
import type { SpaceInvadersPreparedPublication, SpaceInvadersPublication } from "./freePlayPublication";

type Issue = "certification_limit" | "replay_not_verified" | "save_unavailable";
interface Request { publication: SpaceInvadersPublication | undefined; outcome: SpaceInvadersReplayResult | null }
interface Preparation {
  request: Request;
  prepared?: SpaceInvadersPreparedPublication;
  issue?: Issue;
}

/** Rebind an immutable terminal result when its configured owner changes.
 * Only A's snapshot/session preparation runs here, never verify/connect/readback. */
export function usePreparedPublication(publication: SpaceInvadersPublication | undefined, outcome: SpaceInvadersReplayResult | null) {
  const request = useMemo(() => ({ publication, outcome }), [publication, outcome]);
  const [view, setView] = useState<Preparation | null>(null);
  useEffect(() => {
    const { publication, outcome } = request;
    if (!publication || !outcome || outcome.mode !== "free") return;
    let closed = false;
    let prepared: SpaceInvadersPreparedPublication | undefined;
    void (async () => {
      try {
        if (!outcome.clientRunId) throw new Error("identity_unavailable");
        const result = await publication.prepare(freePlayInputFromResult(outcome.clientRunId, outcome));
        if (closed) { result.dispose(); return; }
        prepared = result;
        setView({ request, prepared });
      } catch (error) {
        if (closed) return;
        const issue = error instanceof SpaceInvadersFreePlayError && (error.code === "certification_limit" || error.code === "replay_not_verified") ? error.code : "save_unavailable";
        setView({ request, issue });
      }
    })();
    return () => { closed = true; prepared?.dispose(); };
  }, [request]);
  // Hide the old owner's controls during render, before passive-effect cleanup.
  const current = view && view.request === request ? view : null;
  return { prepared: current?.prepared ?? null, issue: current?.issue ?? null };
}
