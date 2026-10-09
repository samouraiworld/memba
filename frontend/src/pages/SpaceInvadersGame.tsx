import { useArcadeLaunchIntent } from "../games/arcade/LaunchContext";
import SpaceInvaders from "../games/space-invaders/SpaceInvaders";
import type { SpaceInvadersLaunchIntent, SpaceInvadersReplayResult } from "../games/space-invaders/lib/launch";

/** Explicit props take precedence over the transient Arcade host; no URL launch command. */
export default function SpaceInvadersGame({ launch, onReplayReady, onLaunchConsumed }: {
  launch?: SpaceInvadersLaunchIntent;
  onLaunchConsumed?: (id: string) => void;
  onReplayReady?: (result: SpaceInvadersReplayResult) => void;
}) {
  const host = useArcadeLaunchIntent();
  return <SpaceInvaders launch={launch ?? host.launch} onReplayReady={onReplayReady}
    onLaunchConsumed={onLaunchConsumed ?? (launch === undefined ? host.onLaunchConsumed : undefined)} />;
}
