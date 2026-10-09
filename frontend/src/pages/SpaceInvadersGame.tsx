import type { SpaceInvadersPublication } from "../games/space-invaders/lib/freePlayPublication";
import { useSpaceInvadersPublication } from "../games/space-invaders/lib/useSpaceInvadersPublication";
import SpaceInvaders from "../games/space-invaders/SpaceInvaders";
import type { SpaceInvadersLaunchIntent, SpaceInvadersReplayResult } from "../games/space-invaders/lib/launch";

/** The engine stays mounted when the provider's saved-result selection changes.
 * Mount SpaceInvadersSavedResult separately in Your runs to inspect an archive. */
export default function SpaceInvadersGame({ launch, onReplayReady, onLaunchConsumed, publication }: {
  publication?: SpaceInvadersPublication | null;
  launch?: SpaceInvadersLaunchIntent;
  onLaunchConsumed?: (id: string) => void;
  onReplayReady?: (result: SpaceInvadersReplayResult) => void;
}) {
  const adapter = useSpaceInvadersPublication(publication);
  return <SpaceInvaders publication={adapter} launch={launch} onReplayReady={onReplayReady} onLaunchConsumed={onLaunchConsumed} />;
}
