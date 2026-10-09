import SpaceInvaders from "../games/space-invaders/SpaceInvaders";
import type { SpaceInvadersLaunchIntent, SpaceInvadersReplayResult } from "../games/space-invaders/lib/launch";

/** Explicit local boundary for the future Arcade host; no URL launch command. */
export default function SpaceInvadersGame({ launch, onReplayReady, onLaunchConsumed }: {
  launch?: SpaceInvadersLaunchIntent;
  onLaunchConsumed?: (id: string) => void;
  onReplayReady?: (result: SpaceInvadersReplayResult) => void;
}) {
  return <SpaceInvaders launch={launch} onReplayReady={onReplayReady} onLaunchConsumed={onLaunchConsumed} />;
}
