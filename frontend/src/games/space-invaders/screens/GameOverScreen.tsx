import type { ReactNode } from "react";
import { comboMultiplier10 } from "../engine";
import { useCountUp } from "../hooks/useCountUp";
import { useShareResult } from "../hooks/useShareResult";
import { prefersReducedMotion } from "../lib/motion";
import { isNewBest, type RunSummary } from "../lib/results";
import { buildShareText } from "../lib/shareText";
import type { DailyVerification, RunMode } from "./types";

const fmt = (n: number) => n.toLocaleString();

/** The end-of-run results card: counted-up final score, a NEW BEST moment,
 *  the run breakdown, daily verification, sharing, and the certify slot. */
export function GameOverScreen({
  mode,
  day,
  summary,
  best,
  previousBest,
  verification,
  certifySlot,
  shareUrl,
  reducedMotion,
  onRestart,
  onMenu,
}: {
  mode: RunMode;
  /** UTC day of a daily run ("" for free play). */
  day: string;
  summary: RunSummary;
  best: number;
  /** The stored best BEFORE this run was saved; null when unknown. */
  previousBest: number | null;
  verification: DailyVerification | null;
  // The lazily loaded certify control, rendered only when it applies.
  certifySlot?: ReactNode;
  shareUrl: string;
  reducedMotion?: boolean;
  onRestart: () => void;
  onMenu: () => void;
}) {
  const still = reducedMotion ?? prefersReducedMotion();
  const shown = useCountUp(summary.score, { reducedMotion: still });
  const counting = shown !== summary.score;
  const newBest = isNewBest(summary.score, previousBest);
  const shareText = buildShareText({
    mode,
    day,
    score: summary.score,
    wave: summary.wave,
    accuracyPct: summary.accuracyPct,
    url: shareUrl,
  });
  const { share, status } = useShareResult(shareText);
  const chainMult = (comboMultiplier10(summary.bestChain) / 10).toFixed(1);

  return (
    <div className={`si-overlay si-gameover${newBest ? " si-gameover--best" : ""}`}>
      <div className="si-result-card">
        <p className="si-overlay-kicker">Signal lost</p>
        <h2>Game Over</h2>
        {newBest && (
          <p className="si-new-best">
            <span aria-hidden="true">★</span> New best <span aria-hidden="true">★</span>
          </p>
        )}
        <div className={`si-result-score${counting ? " si-result-score--counting" : ""}`}>
          <span>Final score</span>
          <strong aria-hidden="true" data-testid="si-final-score">{fmt(shown)}</strong>
          <span className="si-sr-only">{fmt(summary.score)}</span>
        </div>
        <p className="si-result-best">
          {newBest
            ? previousBest && previousBest > 0 ? `Previous best ${fmt(previousBest)}` : "First score on record"
            : `Best signal ${fmt(best)}`}
        </p>

        <dl className="si-result-stats" aria-label="Run summary">
          <div><dt>Wave</dt><dd>{summary.wave}</dd></div>
          <div><dt>Accuracy</dt><dd>{summary.shots > 0 ? `${summary.accuracyPct}%` : "—"}</dd></div>
          <div>
            <dt>Best chain</dt>
            <dd>{summary.bestChain}{summary.bestChain >= 2 && <small> ×{chainMult}</small>}</dd>
          </div>
          <div><dt>Relays</dt><dd>{summary.livesLeft}</dd></div>
        </dl>
        <dl className="si-result-breakdown" aria-label="Score breakdown">
          <div><dt>Combat</dt><dd>{fmt(summary.combatScore)}</dd></div>
          <div><dt>Accuracy bonus</dt><dd>+{fmt(summary.accuracyBonus)}</dd></div>
          <div><dt>Relay bonus</dt><dd>+{fmt(summary.relayBonus)}</dd></div>
        </dl>

        {mode === "daily" && verification && (
          <p className={`si-verification ${verification.verified ? "si-verification--ok" : "si-verification--pending"}`}>
            <span aria-hidden="true">{verification.verified ? "✓" : "…"}</span>
            Daily · {verification.day} · {verification.verified ? "Replay checked on this device" : "Replay check pending"}
          </p>
        )}
        <div className="si-mode-row">
          <button className="si-button si-button--primary" type="button" onClick={onRestart}>Play again</button>
          <button className="si-button si-button--secondary" type="button" onClick={() => void share()}>Share result</button>
          <button className="si-button si-button--secondary" type="button" onClick={onMenu}>Menu</button>
        </div>
        <p className="si-share-status" role="status">
          {status === "copied" ? "Copied" : status === "shared" ? "Shared" : ""}
        </p>
        {status === "fallback" && (
          <div className="si-share-fallback">
            <p>Sharing is not available here. Copy your result:</p>
            <pre>{shareText}</pre>
          </div>
        )}
        {certifySlot && <div className="si-certify">{certifySlot}</div>}
      </div>
    </div>
  );
}
