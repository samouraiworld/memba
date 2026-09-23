import type { ReactNode } from "react";
import type { DailyVerification, RunMode } from "./types";

/** The end-of-run sheet: final score, best, daily verification, and actions. */
export function GameOverScreen({
  mode,
  score,
  best,
  verification,
  certifySlot,
  onRestart,
  onMenu,
}: {
  mode: RunMode;
  score: number;
  best: number;
  verification: DailyVerification | null;
  // The lazily loaded certify control, rendered only when it applies.
  certifySlot?: ReactNode;
  onRestart: () => void;
  onMenu: () => void;
}) {
  return (
    <div className="si-overlay si-gameover">
      <p className="si-overlay-kicker">Signal lost</p>
      <h2>Game Over</h2>
      <div className="si-result-score"><span>Final score</span><strong>{score.toLocaleString()}</strong></div>
      <p className="si-result-best">Best signal {best.toLocaleString()}</p>
      {mode === "daily" && verification && (
        <p className={`si-verification ${verification.verified ? "si-verification--ok" : "si-verification--pending"}`}>
          <span aria-hidden="true">{verification.verified ? "✓" : "…"}</span>
          Daily · {verification.day} · {verification.verified ? "Replay checked on this device" : "Replay check pending"}
        </p>
      )}
      <div className="si-mode-row">
        <button className="si-button si-button--primary" type="button" onClick={onRestart}>Play again</button>
        <button className="si-button si-button--secondary" type="button" onClick={onMenu}>Menu</button>
      </div>
      {certifySlot && <div className="si-certify">{certifySlot}</div>}
    </div>
  );
}
