import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdena } from "../hooks/useAdena";
import { useAuth } from "../hooks/useAuth";
import { useNetwork } from "../hooks/useNetwork";
import { buildTokenRequestInfo } from "../lib/loginChallenge";
import { humanizeLoginError } from "../lib/loginErrors";
import { useDailyChallenge } from "../game/hooks/useDailyChallenge";
import { useGame, type GameMode } from "../game/hooks/useGame";
import { useKeyboard } from "../game/hooks/useKeyboard";
import { Board } from "../game/components/Board";
import { ScoreBar } from "../game/components/ScoreBar";
import { ModifierBadge } from "../game/components/ModifierBadge";
import { GameOverSheet } from "../game/components/GameOverSheet";
import { ShareCard } from "../game/components/ShareCard";
import { DailyLeaderboardPanel } from "../game/components/DailyLeaderboardPanel";
import { StreakBadge } from "../game/components/StreakBadge";
import { getLocalBest, getLocalStreak } from "../game/lib/localStore";
import type { Modifier } from "../game/engine";
import "./blockparty.css";

const HINT_KEY = "bp:hinted";

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

export default function BlockPartyGame() {
  const adena = useAdena();
  const auth = useAuth();
  const network = useNetwork();
  const { data: challenge, isLoading: challengeLoading } = useDailyChallenge();

  const [mode, setMode] = useState<GameMode>("ranked");
  const [hinted, setHinted] = useState(true); // default true (hidden) until effect confirms first-session
  const [showHint, setShowHint] = useState(false);
  const [practiceSeed, setPracticeSeed] = useState<number>(() => randomSeed());
  const [authError, setAuthError] = useState<string | null>(null);
  const authBusyRef = useRef(false);

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
  const modifier: Modifier = ranked ? ((challenge?.modifier as Modifier) ?? "standard") : "standard";
  const moveBudget = ranked ? (challenge?.moveBudget ?? 0) : Infinity;
  const canPlayRanked = ranked && !!challenge?.ready;

  const { board, score, movesLeft, over, moveLog, play, restart } = useGame({
    seed,
    modifier,
    mode,
    moveBudget,
  });

  const prevMode = useRef(mode);
  useEffect(() => {
    if (prevMode.current !== mode) {
      prevMode.current = mode;
      if (mode === "practice") {
        const s = randomSeed();
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: re-seed practice board only on explicit mode switch
        setPracticeSeed(s);
        restart(s);
      } else if (challenge?.ready) {
        restart(challenge.seed);
      }
    }
  }, [mode, challenge, restart]);

  const onMove = useCallback(
    (m: Parameters<typeof play>[0]) => {
      dismissHint();
      play(m);
    },
    [dismissHint, play]
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

      await auth.getToken(infoJson, signature);
    } catch (err) {
      console.error("[Memba] Block Party login failed:", err);
      setAuthError(humanizeLoginError(err, "Sign-in failed"));
    } finally {
      authBusyRef.current = false;
    }
  }, [adena, auth, network.chainId]);

  const date = challenge?.date ?? "";
  const par = challenge?.par ?? 0;

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
      <header className="k-bp-header">
        <div className="k-bp-header-row">
          <h1 className="k-bp-title">Block Party{date ? ` #${date}` : ""}</h1>
          <ModifierBadge modifier={modifier} />
        </div>
        <div className="k-bp-modes" role="tablist" aria-label="Game mode">
          <button
            role="tab"
            aria-selected={mode === "ranked"}
            className={`k-bp-mode-btn ${mode === "ranked" ? "k-bp-mode-btn--active" : ""}`}
            onClick={() => setMode("ranked")}
          >
            Daily
          </button>
          <button
            role="tab"
            aria-selected={mode === "practice"}
            className={`k-bp-mode-btn ${mode === "practice" ? "k-bp-mode-btn--active" : ""}`}
            onClick={() => setMode("practice")}
          >
            Practice
          </button>
        </div>
      </header>

      {ranked && !challengeLoading && challenge && !challenge.ready && (
        <p className="k-bp-notice">
          Today's board mints shortly — try Practice while you wait.
          <button className="k-bp-btn" onClick={() => setMode("practice")}>
            Play Practice
          </button>
        </p>
      )}

      <div className="k-bp-board-wrap">
        <Board board={board} onMove={onMove} />
        {showHint && (
          <div className="k-bp-hint" aria-hidden="true">
            <span className="k-bp-hint-arrows">← ↑ → ↓</span>
            <span className="k-bp-hint-label">Swipe or use arrow keys</span>
          </div>
        )}
      </div>

      <ScoreBar score={score} par={par} movesLeft={movesLeft} />
      <div className="sr-only" aria-live="polite">
        Score {score}
      </div>

      {over && ranked && (
        <>
          <GameOverSheet
            date={date}
            score={score}
            par={par}
            moveLog={moveLog}
            board={board}
            modifier={modifier}
            wallet={walletForSheet}
            auth={authForSheet}
          />
          {authError && <p className="k-bp-error">{authError}</p>}
        </>
      )}

      {over && !ranked && (
        <div className="k-bp-over" role="dialog" aria-label="Practice round complete">
          <h2 className="k-bp-over-score">{score.toLocaleString()}</h2>
          <p className="k-bp-over-note">Local best: {getLocalBest("practice").toLocaleString()}</p>
          <ShareCard date={date} board={board} streak={getLocalStreak().current} modifier={modifier} />
          <button
            className="k-bp-btn"
            onClick={() => {
              const s = randomSeed();
              setPracticeSeed(s);
              restart(s);
            }}
          >
            Play again
          </button>
        </div>
      )}

      <div className="k-bp-panels">
        <DailyLeaderboardPanel date={date} />
        <StreakBadge
          address={adena.connected ? adena.address : undefined}
          localStreak={getLocalStreak().current}
        />
      </div>
    </div>
  );
}
