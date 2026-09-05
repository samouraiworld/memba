import { useEffect, useRef, useState } from "react";
import { buildShareText } from "../lib/shareText";

type ShareStatus = "copied" | "shared" | "error" | null;

export function ShareCard(props: {
  kind: "daily" | "practice"; date: string; board: number[]; percentile?: number; streak: number; modifier: string;
}) {
  const [status, setStatus] = useState<ShareStatus>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const url = `${window.location.origin}${window.location.pathname}`;
  const text = buildShareText({ ...props, url });

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const showTransientStatus = (next: Exclude<ShareStatus, "error" | null>) => {
    setStatus(next);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus(null), 1800);
  };

  const share = async () => {
    setStatus(null);
    if (navigator.share) {
      try {
        await navigator.share({ text });
        showTransientStatus("shared");
        return;
      } catch (error) {
        // Closing the platform share sheet is an intentional cancellation, not
        // a reason to surprise the player by writing to their clipboard.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      showTransientStatus("copied");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="k-bp-share">
      <button className="k-bp-btn k-bp-btn--accent" type="button" onClick={share}>
        Share result
      </button>
      {status === "copied" && <span className="k-bp-share-toast" role="status">Result copied</span>}
      {status === "shared" && <span className="k-bp-share-toast" role="status">Result shared</span>}
      {status === "error" && <span className="k-bp-share-error" role="alert">Sharing is unavailable in this browser. Please try again.</span>}
    </div>
  );
}
