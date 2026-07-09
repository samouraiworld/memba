import type { ReactNode } from "react";
import { isSpaceInvadersEnabled } from "../../lib/config";
import { ComingSoonGate } from "./ComingSoonGate";

export function SpaceInvadersGate({ children }: { children: ReactNode }) {
  if (!isSpaceInvadersEnabled()) {
    return (
      <ComingSoonGate
        title="Space Invaders"
        icon="👾"
        description="The arcade classic, rebuilt for Memba — rapid-fire waves, skill combos, a mystery UFO, and an on-chain leaderboard on the way."
        features={[
          "Skill scoring: no-miss combos & the 300-point UFO",
          "Rapid fire, destructible bunkers, escalating waves",
          "Sound, haptics & a bigger CRT screen",
          "Plays instantly — keyboard or thumbs, no wallet",
        ]}
      />
    );
  }
  return <>{children}</>;
}
