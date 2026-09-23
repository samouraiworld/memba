import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Code, ConnectError } from "@connectrpc/connect";
import { useQueryClient } from "@tanstack/react-query";
import { useAdena } from "../hooks/useAdena";
import { useAuth } from "../hooks/useAuth";
import { useTabListKeyboard } from "../hooks/useTabListKeyboard";
import { useNetwork } from "../hooks/useNetwork";
import { buildTokenRequestInfo } from "../lib/loginChallenge";
import { useDailyChallenge } from "../game/hooks/useDailyChallenge";
import { useGame, type GameMode } from "../game/hooks/useGame";
import { useKeyboard } from "../game/hooks/useKeyboard";
import { Board } from "../game/components/Board";
import { ScoreBar } from "../game/components/ScoreBar";
import { ModifierBadge } from "../game/components/ModifierBadge";
import { GameOverSheet } from "../game/components/GameOverSheet";
import { SeedProof } from "../game/components/SeedProof";
import { ShareCard } from "../game/components/ShareCard";
import { DailyLeaderboardPanel } from "../game/components/DailyLeaderboardPanel";
import { StreakBadge } from "../game/components/StreakBadge";
import { FirstRunIntro } from "../game/components/FirstRunIntro";
import { NextBoardCountdown } from "../game/components/NextBoardCountdown";
import { getLocalBest, getLocalStreak } from "../game/lib/localStore";
import { clearRun, loadRun, saveRun } from "../game/lib/runStore";
import { haptic, HAPTIC_GAME_OVER, HAPTIC_MERGE } from "../game/lib/haptics";
import { seedScoreCeiling, type Modifier } from "../game/engine";
import "./blockparty.css";

// First-visit intro, shown once per browser. Versioned: the pre-mainnet
// "bp:hinted" arrow hint did not explain Daily vs Practice.
const INTRO_KEY = "bp:intro:v1";

// Mode tabs in display order — shared by the tablist markup and the keyboard hook.
const MODE_TAB_KEYS = ["ranked", "practice"] as const;

// Encode Uint8Array to base64 string (protojson format for bytes fields) —
// mirrors components/layout/Layout.tsx's login flow exactly.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/** Undo shortcut: `U`, or Ctrl/Cmd+Z. Never while typing in a field. */
function isUndoKey(e: KeyboardEvent): boolean {
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || t.closest("input, select, textarea"))) return false;
  if (e.altKey || e.shiftKey) return false;
  if (e.ctrlKey || e.metaKey) return e.key === "z" || e.key === "Z";
  return e.key === "u" || e.key === "U";
}

function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function useUtcDate(): string {
  const [date, setDate] = useState(() => utcDate());
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = new Date();
      const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      timeout = setTimeout(() => {
        setDate(utcDate());
        schedule();
      }, Math.max(1_000, next - now.getTime() + 250));
    };
    schedule();
    return () => clearTimeout(timeout);
  }, []);
  return date;
}

export default function BlockPartyGame() {
  const adena = useAdena();
  const auth = useAuth();
  const network = useNetwork();
  const queryClient = useQueryClient();
  const today = useUtcDate();
  const {
    data: challenge,
    isLoading: challengeLoading,
    isError: challengeError,
    isFetching: challengeFetching,
    error: challengeFailure,
    refetch: refetchChallenge,
  } = useDailyChallenge(network.chainId, today);

  const [mode, setMode] = useState<GameMode>("ranked");
  const [practiceSeed, setPracticeSeed] = useState<number>(() => randomSeed());
  const [practiceModifier, setPracticeModifier] = useState<Modifier>("standard");
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);

  const selectMode = useCallback((next: GameMode) => {
    if (next === "practice" && mode !== "practice") {
      setPracticeSeed(randomSeed());
      setPracticeModifier("standard");
    }
    setMode(next);
  }, [mode]);

  // APG tabs keyboard contract (roving tabindex, arrows, Home/End) — the
  // shared hook Directory extracted; the mode switch had no keyboard support.
  const { tabProps } = useTabListKeyboard<GameMode>({
    keys: MODE_TAB_KEYS,
    active: mode,
    onSelect: selectMode,
    idFor: (k) => `bp-mode-tab-${k}`,
  });
  const [introSeen, setIntroSeen] = useState(true); // default true (hidden) until effect confirms first visit
  const [showIntro, setShowIntro] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const authBusyRef = useRef(false);

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  // First-visit intro: read localStorage only in an effect.
  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(INTRO_KEY) === "1";
    } catch {
      /* localStorage unavailable — don't show the intro */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: localStorage is only readable in an effect, gates the first-visit intro
    setIntroSeen(seen);
    setShowIntro(!seen);
  }, []);

  const dismissIntro = useCallback(() => {
    setShowIntro(false);
    if (!introSeen) {
      try {
        localStorage.setItem(INTRO_KEY, "1");
      } catch {
        /* no-op */
      }
      setIntroSeen(true);
    }
  }, [introSeen]);

  const ranked = mode === "ranked";
  const seed = ranked ? (challenge?.seed ?? 0) : practiceSeed;
  const modifier: Modifier = ranked ? ((challenge?.modifier as Modifier) ?? "standard") : practiceModifier;
  const moveBudget = ranked ? (challenge?.moveBudget ?? 0) : Infinity;
  const canPlayRanked = ranked && !!challenge?.ready && challenge.source === "network" && !challengeError;
  const cachedChallenge = ranked && challenge?.ready && challenge.source === "cache";
  const featurePaused = challengeError && ConnectError.from(challengeFailure).code === Code.Unimplemented;
  const seedCeiling = challenge?.ready
    ? seedScoreCeiling(challenge.seed, challenge.modifier as Modifier, challenge.moveBudget)
    : 0;
  // A paused service must not strand players on a locked board: fall into
  // Practice once per visit. Choosing Daily again still shows the paused notice.
  const autoPracticed = useRef(false);
  useEffect(() => {
    if (featurePaused && mode === "ranked" && !autoPracticed.current) {
      autoPracticed.current = true;
      selectMode("practice");
    }
  }, [featurePaused, mode, selectMode]);
  const reachablePar = ranked && challenge?.ready && challenge.par <= seedCeiling
    ? challenge.par
    : undefined;

  const { board, score, movesLeft, over, moveLog, roundSeed, roundModifier, canUndo, play, restart, undo } = useGame({
    seed,
    modifier,
    mode,
    moveBudget,
  });

  // A locked Daily board has no budget to show — "0 remaining" reads as spent.
  const shownMovesLeft = ranked && !canPlayRanked ? Infinity : movesLeft;

  const chainId = network.chainId;
  const dailyKey = challenge?.ready
    ? `daily:${chainId}:${challenge.date}:${challenge.seed}:${challenge.modifier}`
    : null;
  const appliedRound = useRef<string | null>(null);
  // The log a Daily round was restored with; a finished restored run is not auto-posted.
  const [restoredLog, setRestoredLog] = useState<string | null>(null);
  useEffect(() => {
    const key = ranked ? dailyKey : `practice:${practiceSeed}:${practiceModifier}`;
    if (key && appliedRound.current !== key) {
      appliedRound.current = key;
      // A Daily run in progress (or finished but not yet posted) survives a
      // refresh or a trip to Practice: reloading must never deal a fresh try.
      const saved = ranked && challenge?.ready
        ? loadRun(chainId, { date: challenge.date, seed: challenge.seed, modifier: challenge.modifier })
        : null;
      const restored = restart(seed, saved ?? "");
      if (!restored && challenge?.ready) clearRun(chainId, challenge.date);
      setRestoredLog(restored && saved ? saved : null);
    }
  }, [ranked, dailyKey, chainId, challenge, practiceSeed, practiceModifier, restart, seed]);

  // Persist every accepted Daily move, once the hook holds the round for THIS
  // challenge. Re-entering with the challenge already in memory can briefly
  // save the pre-restore log; the next commit rewrites the restored one.
  useEffect(() => {
    if (!ranked || !canPlayRanked || !challenge?.ready || appliedRound.current !== dailyKey) return;
    if (roundSeed !== challenge.seed || roundModifier !== challenge.modifier) return;
    saveRun(chainId, { date: challenge.date, seed: challenge.seed, modifier: challenge.modifier }, moveLog);
  }, [ranked, canPlayRanked, challenge, dailyKey, chainId, roundSeed, roundModifier, moveLog]);

  // Haptics only for a move just played — not for a restored or restarted board.
  const hapticPrev = useRef({ log: moveLog, score, seed: roundSeed });
  useEffect(() => {
    const prev = hapticPrev.current;
    hapticPrev.current = { log: moveLog, score, seed: roundSeed };
    if (roundSeed !== prev.seed || moveLog.length !== prev.log.length + 1 || !moveLog.startsWith(prev.log)) return;
    if (over) haptic(HAPTIC_GAME_OVER);
    else if (score > prev.score) haptic(HAPTIC_MERGE);
  }, [moveLog, score, over, roundSeed]);

  const onMove = useCallback(
    (m: Parameters<typeof play>[0]) => {
      if (ranked && !canPlayRanked) return;
      dismissIntro();
      play(m);
    },
    [ranked, canPlayRanked, dismissIntro, play]
  );

  useKeyboard(onMove, !over && (ranked ? canPlayRanked : true));

  // Practice-only undo. Ranked never registers the shortcut.
  useEffect(() => {
    if (ranked) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isUndoKey(e)) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ranked, undo]);

  const refreshAfterVerify = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["bp", "leaderboard"] });
    void queryClient.invalidateQueries({ queryKey: ["bp", "streak"] });
  }, [queryClient]);
  const you = auth.address || (adena.connected ? adena.address : "") || undefined;

  // ── Auth bridge: same challenge-response pattern as components/layout/Layout.tsx ──
  const authenticate = useCallback(async () => {
    if (authBusyRef.current) return;
    authBusyRef.current = true;
    setAuthError(null);
    try {
      if (!adena.connected) {
        const ok = await adena.connect();
        if (!ok) return;
      }
      if (auth.isAuthenticated) return;

      const challengeRes = await auth.getChallenge(adena.pubkeyJSON || undefined, network.chainId);
      if (!challengeRes) throw new Error("Failed to get challenge");

      const nonceB64 = bytesToBase64(challengeRes.nonce);
      const signed = await adena.signLoginChallenge(network.chainId, nonceB64);
      let signature = "";
      let pubkey = adena.pubkeyJSON || "";
      if (signed) {
        signature = signed.signature;
        if (signed.pubKey) pubkey = signed.pubKey;
      }

      if (!pubkey && !adena.address) {
        throw new Error("Wallet address unavailable — reconnect your wallet to sign in.");
      }

      const info = buildTokenRequestInfo({
        nonceB64,
        expiration: challengeRes.expiration,
        serverSignatureB64: bytesToBase64(challengeRes.serverSignature),
        boundPubkeyHash: challengeRes.boundPubkeyHash || "",
        chainId: challengeRes.chainId || network.chainId,
        ...(pubkey ? { userPubkeyJson: pubkey } : { userAddress: adena.address }),
      });
      const infoJson = JSON.stringify(info);

      const token = await auth.getToken(infoJson, signature);
      // getToken returns null on ordinary rejections (session-account rejections
      // throw with human copy) — without this check a failed sign-in was a
      // silent no-op on this surface.
      if (!token) throw new Error("Sign-in failed — please try again.");
    } catch (err) {
      console.error("[Memba] Block Party login failed:", err);
      setAuthError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      authBusyRef.current = false;
    }
  }, [adena, auth, network.chainId]);

  const date = challenge?.date ?? today;

  const playCachedPractice = useCallback(() => {
    if (!challenge?.ready) return;
    setPracticeSeed(challenge.seed);
    setPracticeModifier(challenge.modifier as Modifier);
    setMode("practice");
  }, [challenge]);

  const authForSheet = useMemo(
    () => ({
      isAuthenticated: auth.isAuthenticated,
      token: auth.token ?? undefined,
      address: auth.address,
      authenticate,
    }),
    [auth.isAuthenticated, auth.token, auth.address, authenticate]
  );

  const walletForSheet = useMemo(
    () => ({ installed: adena.installed, connect: adena.connect }),
    [adena.installed, adena.connect]
  );

  return (
    <div className="k-bp-page">
      <div className="k-bp-orbit k-bp-orbit--one" aria-hidden="true" />
      <div className="k-bp-orbit k-bp-orbit--two" aria-hidden="true" />
      <header className="k-bp-header">
        <p className="k-bp-kicker">Gno signal lab · daily merge protocol</p>
        <div className="k-bp-header-row">
          <div>
            <h1 className="k-bp-title">Block Party</h1>
            <p className="k-bp-date">{ranked ? `${date} · resets 00:00 UTC` : "Practice · not ranked · no move limit"}</p>
          </div>
          <ModifierBadge modifier={modifier} />
        </div>
        <div className="k-bp-modes" role="tablist" aria-label="Game mode">
          <button
            {...tabProps("ranked")}
            className={`k-bp-mode-btn ${mode === "ranked" ? "k-bp-mode-btn--active" : ""}`}
            onClick={() => selectMode("ranked")}
          >
            Daily
          </button>
          <button
            {...tabProps("practice")}
            className={`k-bp-mode-btn ${mode === "practice" ? "k-bp-mode-btn--active" : ""}`}
            onClick={() => selectMode("practice")}
          >
            Practice
          </button>
        </div>
      </header>

      <div className="k-bp-layout">
        <section className="k-bp-play" aria-label={ranked ? "Daily game" : "Practice game"}>
          <div className="k-bp-mission">
            <span className="k-bp-mission-mark" aria-hidden="true">⌁</span>
            <p><strong>Slide the tiles.</strong> Equal numbers merge and add to your score.</p>
            <span>{ranked ? `${challenge?.moveBudget ?? "—"} moves` : "No move limit"}</span>
          </div>

          {!ranked && featurePaused && (
            <p className="k-bp-live-status k-bp-live-status--paused" role="status">
              <span aria-hidden="true" /> Daily ranked play is paused · Practice is open
            </p>
          )}

          {ranked && challengeLoading && !challenge && (
            <div className="k-bp-notice" role="status" aria-live="polite" aria-busy="true">
              <span className="k-bp-pulse" aria-hidden="true" />
              Contacting today's seed source…
            </div>
          )}

          {ranked && !challengeLoading && challenge && !challenge.ready && (
            <div className="k-bp-notice" role="status">
              <strong>Today's board is still minting.</strong>
              <span>The first post-midnight block has not arrived yet.</span>
              <button className="k-bp-btn" onClick={() => selectMode("practice")}>Play Practice</button>
            </div>
          )}

          {ranked && challengeError && !cachedChallenge && (
            <div className="k-bp-notice k-bp-notice--error" role="alert">
              <strong>{featurePaused ? "Daily play is paused" : online ? "Daily seed unavailable" : "You're offline"}</strong>
              <span>
                {featurePaused
                  ? "Today's ranked board is switched off for now. Practice plays the same way, with no move limit."
                  : online
                    ? "We couldn't verify today's board. Ranked input stays locked to protect the leaderboard."
                    : "Reconnect to verify today's board. Ranked input stays locked while offline."}
              </span>
              <div className="k-bp-notice-actions">
                <button className="k-bp-btn" onClick={() => void refetchChallenge()} disabled={challengeFetching}>
                  {challengeFetching ? "Retrying…" : "Retry Daily"}
                </button>
                <button className="k-bp-btn k-bp-btn--accent" onClick={() => selectMode("practice")}>Play Practice</button>
              </div>
            </div>
          )}

          {cachedChallenge && (
            <div className="k-bp-notice k-bp-notice--cached" role="alert">
              <strong>Saved board — not ranked</strong>
              <span>We found a validated copy for {challenge.date}, but could not confirm it live. It cannot be submitted.</span>
              <div className="k-bp-notice-actions">
                <button className="k-bp-btn" onClick={() => void refetchChallenge()} disabled={challengeFetching}>
                  {challengeFetching ? "Checking…" : "Check live board"}
                </button>
                <button className="k-bp-btn k-bp-btn--accent" onClick={playCachedPractice}>Practice this board</button>
              </div>
            </div>
          )}

          {canPlayRanked && (
            <p className="k-bp-live-status" role="status">
              <span aria-hidden="true" /> Live daily · first verified replay is final
            </p>
          )}

          {showIntro && (!ranked || canPlayRanked) && <FirstRunIntro onDismiss={dismissIntro} />}

          <div className={`k-bp-board-wrap ${ranked && !canPlayRanked ? "k-bp-board-wrap--locked" : ""}`}>
            <Board board={board} moveLog={moveLog} onMove={onMove} disabled={ranked && !canPlayRanked} />
          </div>

          <ScoreBar score={score} par={reachablePar} movesLeft={shownMovesLeft} />
          {!ranked && (
            <div className="k-bp-tools">
              <button
                type="button"
                className="k-bp-btn k-bp-undo"
                onClick={undo}
                disabled={!canUndo}
                aria-keyshortcuts="U Control+Z Meta+Z"
              >
                <span aria-hidden="true">↶</span> Undo
              </button>
              <span className="k-bp-tools-note">Practice only · press U</span>
            </div>
          )}
          {ranked && challenge?.ready && reachablePar == null && (
            <p className="k-bp-target-note">Target hidden: the legacy value exceeds this board's mathematical score ceiling.</p>
          )}
          <div className="sr-only" aria-live="polite">Score {score}. {Number.isFinite(shownMovesLeft) ? `${shownMovesLeft} moves remaining.` : ranked ? "Daily is locked." : "Practice has no move limit."}</div>

          {over && ranked && canPlayRanked && (
            <>
              <GameOverSheet
                date={date}
                score={score}
                par={reachablePar}
                moveLog={moveLog}
                board={board}
                modifier={modifier}
                wallet={walletForSheet}
                auth={authForSheet}
                onVerified={refreshAfterVerify}
                autoSubmit={restoredLog == null || moveLog !== restoredLog}
              />
              {authError && <p className="k-bp-error" role="alert">{authError}</p>}
            </>
          )}

          {over && !ranked && (
            <div className="k-bp-over" role="dialog" aria-label="Practice round complete">
              <span className="k-bp-over-kicker">Practice · not ranked</span>
              <h2 className="k-bp-over-title">No moves left</h2>
              <p className="k-bp-over-score"><span className="sr-only">Final score </span>{score.toLocaleString()}</p>
              <p className="k-bp-over-note">Your best practice score: {Math.max(score, getLocalBest("practice")).toLocaleString()}</p>
              <ShareCard kind="practice" date={date} board={board} streak={getLocalStreak().current} modifier={modifier} />
              <div className="k-bp-over-actions">
                <button className="k-bp-btn" type="button" onClick={undo} disabled={!canUndo}>
                  Undo last move
                </button>
                <button
                  className="k-bp-btn"
                  type="button"
                  onClick={() => {
                    setPracticeSeed(randomSeed());
                    setPracticeModifier("standard");
                  }}
                >
                  New practice board
                </button>
              </div>
              <NextBoardCountdown />
            </div>
          )}
        </section>

        <aside className="k-bp-side" aria-label="Daily details">
          <div className="k-bp-rules">
            <p className="k-bp-panel-kicker">How it works</p>
            <h2>Build the biggest tile</h2>
            <ol>
              <li>Swipe, or press the arrow keys, to slide every tile at once.</li>
              <li>Two tiles with the same number merge into one, and its value is added to your score.</li>
              <li>A new tile appears after every move. The game ends when nothing can move or your moves run out.</li>
            </ol>
            {ranked
              ? <p>Daily: everyone gets the same board and the same number of moves. Sign in with your wallet and your first finished run of the day is checked and posted. A new board arrives at 00:00 UTC.</p>
              : <p>Practice: a random board, no move limit, and undo. Nothing is posted.</p>}
          </div>
          <div className="k-bp-panels">
            {challenge?.ready && (
              <SeedProof height={challenge.blockHeight} hash={challenge.blockHash} />
            )}
            {ranked && !featurePaused && <DailyLeaderboardPanel date={date} scope={network.chainId} you={you} />}
            <StreakBadge
              address={adena.connected ? adena.address : undefined}
              localStreak={getLocalStreak().current}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
