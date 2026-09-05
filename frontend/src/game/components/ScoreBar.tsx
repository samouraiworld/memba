import "./board.css";

export function ScoreBar({ score, par, movesLeft }: { score: number; par?: number; movesLeft: number }) {
  const hasMoveBudget = Number.isFinite(movesLeft);
  const hasTarget = par != null && Number.isFinite(par);
  const urgent = hasMoveBudget && movesLeft <= 5;
  const statCount = 1 + Number(hasTarget) + Number(hasMoveBudget);

  return (
    <dl className={`k-bp-scorebar k-bp-scorebar--${statCount}`} aria-label="Round status">
      <div className="k-bp-stat">
        <dt className="k-bp-eyebrow">Score</dt>
        <dd className="k-bp-stat-value k-bp-score">{score.toLocaleString()}</dd>
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
