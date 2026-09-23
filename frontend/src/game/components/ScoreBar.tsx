import { useEffect, useRef, useState } from "react";
import "./board.css";

const TICK_MS = 260;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The score counts up to its new value instead of jumping. Decreases (a new
 * round) and reduced-motion users get the new value on the next frame. The
 * real score is announced by the page's live region, never by this number.
 */
function useTickingNumber(target: number): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);

  useEffect(() => {
    const from = shownRef.current;
    if (from === target || typeof requestAnimationFrame !== "function") {
      shownRef.current = target;
      return;
    }
    const instant = target < from || prefersReducedMotion();
    let start: number | null = null;
    let frame = 0;
    const tick = (now: number) => {
      start ??= now;
      const t = instant ? 1 : Math.min(1, (now - start) / TICK_MS);
      const value = t >= 1 ? target : Math.round(from + (target - from) * (1 - (1 - t) ** 3));
      shownRef.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  // Without rAF (non-visual environments) there is nothing to animate.
  return typeof requestAnimationFrame === "function" ? shown : target;
}

export function ScoreBar({ score, par, movesLeft }: { score: number; par?: number; movesLeft: number }) {
  const hasMoveBudget = Number.isFinite(movesLeft);
  const hasTarget = par != null && Number.isFinite(par);
  const urgent = hasMoveBudget && movesLeft <= 5;
  const statCount = 1 + Number(hasTarget) + Number(hasMoveBudget);
  const shownScore = useTickingNumber(score);

  // "+N" popup for each scoring move, keyed so back-to-back gains restart it.
  const [scored, setScored] = useState({ score, pop: null as null | { id: number; gain: number } });
  if (scored.score !== score) {
    setScored({
      score,
      pop: score > scored.score ? { id: (scored.pop?.id ?? 0) + 1, gain: score - scored.score } : null,
    });
  }

  return (
    <dl className={`k-bp-scorebar k-bp-scorebar--${statCount}`} aria-label="Round status">
      <div className="k-bp-stat k-bp-stat--score">
        <dt className="k-bp-eyebrow">Score</dt>
        <dd className="k-bp-stat-value k-bp-score">
          {shownScore.toLocaleString()}
          {scored.pop && (
            <span key={scored.pop.id} className="k-bp-score-pop" aria-hidden="true">
              +{scored.pop.gain.toLocaleString()}
            </span>
          )}
        </dd>
      </div>
      {hasTarget && (
        <div className="k-bp-stat">
          <dt className="k-bp-eyebrow">Target</dt>
          <dd className="k-bp-stat-value">{par.toLocaleString()}</dd>
        </div>
      )}
      {hasMoveBudget && (
        <div className="k-bp-stat">
          <dt className="k-bp-eyebrow">Moves</dt>
          <dd className={`k-bp-stat-value ${urgent ? "k-bp-moves--urgent" : ""}`}>
            {movesLeft}<span className="sr-only"> remaining</span>
          </dd>
        </div>
      )}
    </dl>
  );
}
