import { useCallback, useEffect, useRef, useState } from "react";

export type ShareStatus = "copied" | "shared" | "fallback" | null;

const STATUS_MS = 2000;

/** Share a result: the native share sheet when the browser has one, else the
 *  clipboard. Never throws — when both are unavailable the status becomes
 *  "fallback" so the caller can show the text for a manual copy. */
export function useShareResult(text: string): { share: () => Promise<void>; status: ShareStatus } {
  const [status, setStatus] = useState<ShareStatus>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const share = useCallback(async () => {
    const flash = (next: "copied" | "shared") => {
      setStatus(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setStatus(null), STATUS_MS);
    };
    setStatus(null);
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (nav && typeof nav.share === "function") {
      try {
        await nav.share({ text });
        flash("shared");
        return;
      } catch (error) {
        // Dismissing the share sheet is a choice, not a failure — don't
        // surprise the player by writing to their clipboard instead.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      if (!nav?.clipboard?.writeText) throw new Error("clipboard unavailable");
      await nav.clipboard.writeText(text);
      flash("copied");
    } catch {
      setStatus("fallback");
    }
  }, [text]);

  return { share, status };
}
