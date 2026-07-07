export function ScoreBar({ score, par, movesLeft }: { score: number; par: number; movesLeft: number }) {
  return (
    <div className="k-bp-scorebar">
      <div><span className="k-bp-eyebrow">SCORE</span><strong className="k-bp-score">{score.toLocaleString()}</strong></div>
      <div><span className="k-bp-eyebrow">PAR</span><span>{par.toLocaleString()}</span></div>
      {Number.isFinite(movesLeft) && <div><span className="k-bp-eyebrow">MOVES</span><span>{movesLeft}</span></div>}
    </div>
  );
}
