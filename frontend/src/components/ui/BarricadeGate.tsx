import type { ReactNode } from "react";
import { isBarricadeEnabled } from "../../lib/config";
import { ComingSoonGate } from "./ComingSoonGate";

export function BarricadeGate({ children }: { children: ReactNode }) {
  if (!isBarricadeEnabled()) {
    return (
      <ComingSoonGate
        title="MEMBA: BARRICADE"
        icon="🛠️"
        description="Hold the line against The Order — a 90-second daily stand where the rebel you own is the rebel you play."
        features={[
          "One shared daily seed — everyone faces the same waves",
          "Scrap choices between waves: repair, turret, or arm the crowd",
          "Your Memba's traits become abilities at full launch",
          "Verified runs — plays instantly, no wallet needed",
        ]}
      />
    );
  }
  return <>{children}</>;
}
