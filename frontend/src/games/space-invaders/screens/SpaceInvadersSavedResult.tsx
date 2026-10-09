import { useFreePlayRuntime } from "../../arcade/freeplay/FreePlayRuntimeContext";
import type { SpaceInvadersPublication } from "../lib/freePlayPublication";
import { useSpaceInvadersPublication } from "../lib/useSpaceInvadersPublication";
import { SavedFreePlayResult } from "./SavedFreePlayResult";

/** Mount in Your runs, alongside the existing game windows, never in their place.
 * This component does not import or mount an engine or consume a Play intent. */
export function SpaceInvadersSavedResult({ publication, recovery }: {
  publication?: SpaceInvadersPublication | null;
  recovery?: { clientRunId: string; onClose(): void } | null;
}) {
  const runtime = useFreePlayRuntime();
  const adapter = useSpaceInvadersPublication(publication);
  const selected = recovery !== undefined ? recovery : runtime?.recovery?.game === "space-invaders" ? runtime.recovery : undefined;
  if (!selected) return null;
  return <SavedFreePlayResult key={selected.clientRunId} publication={adapter} clientRunId={selected.clientRunId} onClose={selected.onClose} />;
}
