import type { ReactNode } from "react";
import { isSpaceInvadersEnabled } from "../../lib/config";
import { ComingSoonGate } from "./ComingSoonGate";

export function SpaceInvadersGate({ children }: { children: ReactNode }) {
  if (!isSpaceInvadersEnabled()) {
    return (
      <ComingSoonGate
        title="Space Invaders"
        icon="🛸"
        description="Defend the baseline. A classic arcade shooter, playable instantly in your browser."
        features={["Keyboard & touch controls", "Play instantly, no wallet", "Escalating waves", "Local high score"]}
      />
    );
  }
  return <>{children}</>;
}
