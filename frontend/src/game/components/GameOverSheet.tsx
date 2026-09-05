import { useCallback, useEffect, useRef, useState } from "react";
import { Code, ConnectError } from "@connectrpc/connect";
import { rankFromPercentile } from "../lib/tiers";
import { getLocalBest, setLocalBest, bumpLocalStreak } from "../lib/localStore";
import { gameApi } from "../../lib/gameApi";
import { ShareCard } from "./ShareCard";
import type { Token } from "../../gen/memba/v1/memba_pb";
import "./gameover.css";

type WalletLike = { installed: boolean; connect: () => Promise<unknown> };
type AuthLike = { isAuthenticated: boolean; token?: Token; address?: string; authenticate?: () => Promise<void> };

export function GameOverSheet(props: {
  date: string; score: number; par?: number; moveLog: string; board: number[]; modifier: string;
  wallet: WalletLike; auth: AuthLike;
}) {
  const { date, score, moveLog, wallet, auth } = props;
  const [result, setResult] = useState<{ percentile: number; streak: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<{ message: string; retryable: boolean } | null>(null);
  const [localStreak, setLocalStreakState] = useState(0);
  const submittedRef = useRef<string | null>(null);
  const submissionInFlightRef = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // guest local persistence (also runs for connected users as a fallback).
  // Empty date = the challenge never loaded (error path); the sheet must be
  // inert then — no "bp:best:" key, no `lastDate: ""` streak corruption, no
  // blank-date submit the server would reject anyway.
  useEffect(() => { if (date) setLocalBest(date, score); }, [date, score]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: sync local streak once per date change, not derivable from render
  useEffect(() => { if (date) setLocalStreakState(bumpLocalStreak(date).current); }, [date]);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const submitScore = useCallback(async (force = false) => {
    if (!date || !auth.isAuthenticated || !auth.token || submissionInFlightRef.current) return;
    const submissionKey = `${date}:${moveLog}`;
    if (!force && submittedRef.current === submissionKey) return;
    submittedRef.current = submissionKey;
    submissionInFlightRef.current = true;
    setSubmitting(true);
    setErr(null);
    try {
      const response = await gameApi.submitScore(auth.token, date, moveLog);
      setResult({ percentile: response.percentile, streak: response.streak?.current ?? 0 });
    } catch (error) {
      if (ConnectError.from(error).code === Code.AlreadyExists) {
        setErr({
          message: "A different replay was already accepted today. Your first verified result remains final.",
          retryable: false,
        });
      } else {
        setErr({
          message: "We couldn't verify this replay. Your local best is still saved on this device.",
          retryable: true,
        });
      }
    } finally {
      submissionInFlightRef.current = false;
      setSubmitting(false);
    }
  }, [auth.isAuthenticated, auth.token, date, moveLog]);

  // Auto-submit the exact replay once when an authenticated round completes.
  useEffect(() => {
    const timer = window.setTimeout(() => void submitScore(), 0);
    return () => window.clearTimeout(timer);
  }, [submitScore]);

  const hasTarget = props.par != null && Number.isFinite(props.par);
  const parDelta = hasTarget ? score - props.par! : null;
  const highestTile = Math.max(0, ...props.board);
  const modifierLabel = ({ standard: "Standard", doubles: "Doubles Day", rush: "Rush" } as Record<string, string>)[props.modifier] ?? props.modifier;
  const localBest = getLocalBest(date);

  return (
    <div className="k-bp-over" role="dialog" aria-labelledby="k-bp-result-title" aria-describedby="k-bp-result-summary">
      <span className="k-bp-over-kicker">Signal complete</span>
      <h2 id="k-bp-result-title" className="k-bp-over-title" ref={titleRef} tabIndex={-1}>Round complete</h2>
      <p className="k-bp-over-score"><span className="sr-only">Final score </span>{score.toLocaleString()}</p>
      {parDelta != null && (
        <p id="k-bp-result-summary" className="k-bp-over-par">
          {parDelta >= 0 ? `+${parDelta.toLocaleString()}` : parDelta.toLocaleString()} vs target
        </p>
      )}
      {parDelta == null && <p id="k-bp-result-summary" className="sr-only">Final result for {date || "this round"}.</p>}

      <dl className="k-bp-over-breakdown" aria-label="Round breakdown">
        <div><dt>Moves</dt><dd>{moveLog.length}</dd></div>
        <div><dt>High tile</dt><dd>{highestTile.toLocaleString()}</dd></div>
        <div><dt>Mode</dt><dd>{modifierLabel}</dd></div>
        <div><dt>Best</dt><dd>{Math.max(localBest, score).toLocaleString()}</dd></div>
      </dl>

      {result && (
        <div className="k-bp-over-rank" role="status" aria-live="polite">
          <span className="k-bp-over-grade" aria-label={`Rank ${rankFromPercentile(result.percentile)}`}>{rankFromPercentile(result.percentile)}</span>
          <span><strong>Replay verified</strong><small>Beat {result.percentile}% · {result.streak} day streak</small></span>
        </div>
      )}
      {submitting && <p className="k-bp-over-note k-bp-over-note--pending" role="status">Checking your replay…</p>}
      {err && (
        <div className="k-bp-over-submit-error" role="alert">
          <p>{err.message}</p>
          {err.retryable && (
            <button className="k-bp-btn" type="button" onClick={() => void submitScore(true)} disabled={submitting}>
              Retry verification
            </button>
          )}
        </div>
      )}

      {auth.isAuthenticated && (
        <p className="k-bp-over-policy">
          Ranked posting is first-write: your first verified replay today is your leaderboard entry. Later runs do not replace it.
        </p>
      )}

      {!auth.isAuthenticated && wallet.installed && (
        <button className="k-bp-btn k-bp-btn--accent" type="button" onClick={() => auth.authenticate?.()}>
          Connect to post today's score
        </button>
      )}
      {!auth.isAuthenticated && !wallet.installed && (
        <p className="k-bp-over-note">
          Saved locally · best {localBest.toLocaleString()} · {localStreak} day streak.<br />
          Posting to the leaderboard requires the Adena extension on desktop.
        </p>
      )}

      <ShareCard
        kind="daily"
        date={date}
        board={props.board}
        modifier={props.modifier}
        streak={result?.streak ?? localStreak}
        percentile={result?.percentile}
      />
    </div>
  );
}
