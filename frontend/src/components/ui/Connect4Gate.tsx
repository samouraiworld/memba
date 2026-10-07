import type { ReactNode } from "react"
import { isConnect4Enabled, isConnect4Live } from "../../lib/config"
import { ComingSoonGate } from "./ComingSoonGate"

export function Connect4Gate({ children }: { children: ReactNode }) {
  if (!isConnect4Live()) {
    return (
      <ComingSoonGate
        preview="game"
        title="Connect 4"
        icon="🔴"
        description={isConnect4Enabled()
          ? "Connect 4 runs on the Onyx testnet only. Choose Onyx in the network menu to play."
          : "Staked two-player Connect 4 — both players put in the same GNOT and the winner takes the pot."}
        features={[
          "Post an offer or accept one from the lobby",
          "90 seconds of chain time per move",
          "Every move signed with your wallet",
        ]}
      />
    );
  }
  return <>{children}</>;
}
