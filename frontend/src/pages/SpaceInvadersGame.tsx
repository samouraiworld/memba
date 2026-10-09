import type { SpaceInvadersPublication } from "../games/space-invaders/lib/freePlayPublication";
import { SavedFreePlayResult } from "../games/space-invaders/screens/SavedFreePlayResult";
import SpaceInvaders from "../games/space-invaders/SpaceInvaders";
import type { SpaceInvadersLaunchIntent, SpaceInvadersReplayResult } from "../games/space-invaders/lib/launch";

/** Explicit local boundary for the future Arcade host; no URL launch command. */
export default function SpaceInvadersGame({ launch, onReplayReady, onLaunchConsumed, publication, recovery }: {
  publication?: SpaceInvadersPublication;
  /** Explicit host selection from A's shared saved-results index; not a launch. */
  recovery?: { clientRunId: string; onClose(): void };
  launch?: SpaceInvadersLaunchIntent;
  onLaunchConsumed?: (id: string) => void;
  onReplayReady?: (result: SpaceInvadersReplayResult) => void;
}) {
  if (recovery) return <SavedFreePlayResult key={recovery.clientRunId} clientRunId={recovery.clientRunId} publication={publication} onClose={recovery.onClose} />;
  return <SpaceInvaders publication={publication} launch={launch} onReplayReady={onReplayReady} onLaunchConsumed={onLaunchConsumed} />;
}
