import { useArcadeLaunchIntent } from "../games/arcade/LaunchContext";
import type { SpaceInvadersPublication } from "../games/space-invaders/lib/freePlayPublication";
import { useSpaceInvadersPublication } from "../games/space-invaders/lib/useSpaceInvadersPublication";
import SpaceInvaders from "../games/space-invaders/SpaceInvaders";
import type { SpaceInvadersLaunchIntent, SpaceInvadersReplayResult } from "../games/space-invaders/lib/launch";

/** Explicit launch props take precedence over the transient Arcade host.
 * Saved results are inspected separately in Your runs, without retargeting the engine. */
export default function SpaceInvadersGame({ launch, onReplayReady, onLaunchConsumed, publication }: {
  publication?: SpaceInvadersPublication | null;
  launch?: SpaceInvadersLaunchIntent;
  onLaunchConsumed?: (id: string) => void;
  onReplayReady?: (result: SpaceInvadersReplayResult) => void;
}) {
  const host = useArcadeLaunchIntent();
  const adapter = useSpaceInvadersPublication(publication);
  return <SpaceInvaders publication={adapter} launch={launch ?? host.launch} onReplayReady={onReplayReady}
    onLaunchConsumed={onLaunchConsumed ?? (launch === undefined ? host.onLaunchConsumed : undefined)} />;
}
