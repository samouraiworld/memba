import { useEffect, useState } from "react";
import { formatClock, formatSpoken, msUntilNextUtcMidnight } from "../lib/countdown";

/**
 * Live "next board" clock. The ticking digits are hidden from assistive
 * technology; a minute-precision sentence carries the same information
 * without a once-a-second announcement.
 */
export function NextBoardCountdown({ label = "Next Daily board in" }: { label?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = msUntilNextUtcMidnight(now);

  return (
    <p className="k-bp-next">
      <span className="k-bp-next-label" aria-hidden="true">{label}</span>
      <span className="k-bp-next-clock" aria-hidden="true" data-testid="bp-next-clock">{formatClock(remaining)}</span>
      <span className="sr-only">{label} {formatSpoken(remaining)}, at midnight UTC.</span>
    </p>
  );
}
