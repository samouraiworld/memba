import { useEffect, useRef, useState, type RefObject } from "react";

/** The browser API runs only in the button's trusted click, never at launch. */
export function FullscreenButton({ root, onChange, onError }: { root: RefObject<HTMLElement | null>; onChange: () => void; onError: (message: string) => void }) {
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);
  const changeRef = useRef(onChange);
  useEffect(() => { changeRef.current = onChange; }, [onChange]);
  useEffect(() => {
    const changed = () => {
      setActive(document.fullscreenElement === root.current);
      changeRef.current();
    };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, [root]);
  const supported = document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function";
  // The game owns one in-flow, dismissible alert outside its playfield.
  const reportError = onError;
  const toggle = async () => {
    reportError("");
    if (!supported) { reportError("Fullscreen is unavailable in this browser."); return; }
    const target = root.current;
    if (!target) return;
    setPending(true);
    try {
      if (document.fullscreenElement === target) await document.exitFullscreen();
      else await target.requestFullscreen();
    } catch {
      reportError("Fullscreen could not be changed. Try again, use portrait, or enlarge the window.");
    } finally { setPending(false); }
  };
  return <div className="si-fullscreen-control">
    <button type="button" className="si-icon-button si-fullscreen-button" onClick={() => void toggle()} disabled={pending}
      aria-label={active ? "Exit game fullscreen" : "Game fullscreen"} aria-pressed={active}
      title={supported ? (active ? "Exit fullscreen" : "Fullscreen") : "Fullscreen unavailable in this browser"}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--si-text-bright)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={active ? "M3 9h6V3M21 9h-6V3M3 15h6v6M21 15h-6v6" : "M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6"} />
      </svg>
    </button>
  </div>;
}
