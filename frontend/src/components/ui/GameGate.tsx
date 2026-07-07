import type { ReactNode } from "react";
import { isGameEnabled } from "../../lib/config";
import { ComingSoonGate } from "./ComingSoonGate";

export function GameGate({ children }: { children: ReactNode }) {
  if (!isGameEnabled()) {
    return (
      <ComingSoonGate
        title="Block Party"
        icon="🎮"
        description="A daily block puzzle from an unpredictable Gno block — same board for everyone, every day."
        features={["One shared board a day", "Play instantly, no wallet", "Streaks & a daily leaderboard", "Provably un-rigged from a Gno block"]}
      />
    );
  }
  return <>{children}</>;
}
