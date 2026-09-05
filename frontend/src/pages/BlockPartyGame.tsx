import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Code, ConnectError } from "@connectrpc/connect";
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
import { getLocalBest, getLocalStreak } from "../game/lib/localStore";
import { seedScoreCeiling, type Modifier } from "../game/engine";
import "./blockparty.css";

const HINT_KEY = "bp:hinted";

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
  const [hinted, setHinted] = useState(true); // default true (hidden) until effect confirms first-session
  const [showHint, setShowHint] = useState(false);
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

  // First-session ghost-swipe hint: read localStorage only in an effect.
  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(HINT_KEY) === "1";
    } catch {
      /* localStorage unavailable — don't show the hint */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: localStorage is only readable in an effect, gates first-session hint
    setHinted(seen);
    setShowHint(!seen);
  }, []);

  const dismissHint = useCallback(() => {
    setShowHint(false);
    if (!hinted) {
      try {
        localStorage.setItem(HINT_KEY, "1");
      } catch {
        /* no-op */
      }
      setHinted(true);
    }
  }, [hinted]);

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
  const reachablePar = ranked && challenge?.ready && challenge.par <= seedCeiling
    ? challenge.par
    : undefined;

  const { board, score, movesLeft, over, moveLog, play, restart } = useGame({
    seed,
    modifier,
    mode,
    moveBudget,
  });

  const appliedRound = useRef<string | null>(null);
  useEffect(() => {
    const key = ranked
      ? (challenge?.ready ? `daily:${challenge.date}:${challenge.seed}:${challenge.modifier}` : null)
      : `practice:${practiceSeed}:${practiceModifier}`;
    if (key && appliedRound.current !== key) {
      appliedRound.current = key;
      restart(seed);
    }
  }, [ranked, challenge, practiceSeed, practiceModifier, restart, seed]);

  const onMove = useCallback(
    (m: Parameters<typeof play>[0]) => {
      if (ranked && !canPlayRanked) return;
      dismissHint();
      play(m);
    },
    [ranked, canPlayRanked, dismissHint, play]
  );

  useKeyboard(onMove, !over && (ranked ? canPlayRanked : true));

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
        <p className="k-bp-kicker">Pearl signal lab · daily merge protocol</p>
        <div className="k-bp-header-row">
          <div>
            <h1 className="k-bp-title">Block Party</h1>
            <p className="k-bp-date">{ranked ? `${date} · resets 00:00 UTC` : "Practice · unranked sandbox"}</p>
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
            <p><strong>Route matching signals.</strong> Equal nodes fuse; every accepted move emits one new signal.</p>
            <span>{ranked ? `${challenge?.moveBudget ?? "—"} moves` : "No move limit"}</span>
          </div>

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
                  ? "The public game route is open, but ranked play is disabled at the service. Practice is still available."
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

          <div className={`k-bp-board-wrap ${ranked && !canPlayRanked ? "k-bp-board-wrap--locked" : ""}`}>
            <Board board={board} onMove={onMove} disabled={ranked && !canPlayRanked} />
            {showHint && (!ranked || canPlayRanked) && (
              <div className="k-bp-hint" aria-hidden="true">
                <span className="k-bp-hint-arrows">← ↑ → ↓</span>
                <span className="k-bp-hint-label">Swipe or use arrow keys</span>
              </div>
            )}
          </div>

          <ScoreBar score={score} par={reachablePar} movesLeft={movesLeft} />
          {ranked && challenge?.ready && reachablePar == null && (
            <p className="k-bp-target-note">Target hidden: the legacy value exceeds this board's mathematical score ceiling.</p>
          )}
          <div className="sr-only" aria-live="polite">Score {score}. {Number.isFinite(movesLeft) ? `${movesLeft} moves remaining.` : "Practice has no move limit."}</div>

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
              />
              {authError && <p className="k-bp-error" role="alert">{authError}</p>}
            </>
          )}

          {over && !ranked && (
            <div className="k-bp-over" role="dialog" aria-label="Practice round complete">
              <span className="k-bp-over-kicker">Sandbox complete</span>
              <h2 className="k-bp-over-title">Practice result</h2>
              <p className="k-bp-over-score">{score.toLocaleString()}</p>
              <p className="k-bp-over-note">Local best: {getLocalBest("practice").toLocaleString()}</p>
              <ShareCard kind="practice" date={date} board={board} streak={getLocalStreak().current} modifier={modifier} />
              <button
                className="k-bp-btn"
                onClick={() => {
                  setPracticeSeed(randomSeed());
                  setPracticeModifier("standard");
                }}
              >
                New practice board
              </button>
            </div>
          )}
        </section>

        <aside className="k-bp-side" aria-label="Daily details">
          <div className="k-bp-rules">
            <p className="k-bp-panel-kicker">How it works</p>
            <h2>Build the strongest signal</h2>
            <ol>
              <li>Swipe or use arrow keys to route every node.</li>
              <li>Matching values fuse and add their result to your score.</li>
              <li>Daily counts accepted moves and resets at 00:00 UTC.</li>
            </ol>
            {ranked && <p>Ranked policy: one authenticated, server-verified replay per UTC day. The first accepted replay is final.</p>}
          </div>
          <div className="k-bp-panels">
            {challenge?.ready && (
              <SeedProof height={challenge.blockHeight} hash={challenge.blockHash} />
            )}
            {ranked && <DailyLeaderboardPanel date={date} scope={network.chainId} />}
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
