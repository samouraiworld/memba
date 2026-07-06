import { useEffect, useRef, useState } from "react";
import { rankFromPercentile } from "../lib/tiers";
import { getLocalBest, setLocalBest, bumpLocalStreak } from "../lib/localStore";
import { gameApi } from "../../lib/gameApi";
import type { Token } from "../../gen/memba/v1/memba_pb";
import "./gameover.css";

type WalletLike = { installed: boolean; connect: () => Promise<unknown> };
type AuthLike = { isAuthenticated: boolean; token?: Token; address?: string; authenticate?: () => Promise<void> };

export function GameOverSheet(props: {
  date: string; score: number; par: number; moveLog: string; board: number[]; modifier: string;
  wallet: WalletLike; auth: AuthLike; onShare: () => void;
}) {
  const { date, score, par, moveLog, wallet, auth, onShare } = props;
  const [result, setResult] = useState<{ percentile: number; streak: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [localStreak, setLocalStreakState] = useState(0);
  const submittedRef = useRef(false);

  // guest local persistence (also runs for connected users as a fallback)
  useEffect(() => { setLocalBest(date, score); }, [date, score]);

  useEffect(() => { setLocalStreakState(bumpLocalStreak(date).current); }, [date]);

  // auto-submit when authenticated
  useEffect(() => {
    if (!auth.isAuthenticated || !auth.token || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    gameApi.submitScore(auth.token, date, moveLog)
      .then((r) => setResult({ percentile: r.percentile, streak: r.streak?.current ?? 0 }))
      .catch(() => setErr("Couldn't verify your score. Your local best is saved."))
      .finally(() => setSubmitting(false));
  }, [auth.isAuthenticated, auth.token, date, moveLog]);

  const parDelta = score - par;

  return (
    <div className="k-bp-over" role="dialog" aria-label="Round complete">
      <h2 className="k-bp-over-score">{score.toLocaleString()}</h2>
      <p className="k-bp-over-par">{parDelta >= 0 ? `+${parDelta}` : parDelta} vs par</p>

      {result && (
        <p className="k-bp-over-rank">
          Rank {rankFromPercentile(result.percentile)} · beat {result.percentile}% · 🔥{result.streak}
        </p>
      )}
      {submitting && <p className="k-bp-over-note">Verifying your score…</p>}
      {err && <p className="k-bp-over-note">{err}</p>}

      {!auth.isAuthenticated && wallet.installed && (
        <button className="k-bp-btn k-bp-btn--accent" onClick={() => auth.authenticate?.()}>
          Connect to post today's score
        </button>
      )}
      {!auth.isAuthenticated && !wallet.installed && (
        <p className="k-bp-over-note">
          Best today: {getLocalBest(date).toLocaleString()} · 🔥{localStreak} ·
          Leaderboard needs the Adena extension (desktop).
        </p>
      )}

      <button className="k-bp-btn" onClick={onShare}>Share</button>
    </div>
  );
}
