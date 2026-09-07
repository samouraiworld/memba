/**
 * SpaceInvadersCertify — the opt-in score-attestation control on the
 * daily game-over sheet. Rendered ONLY when the certify flags are on, the run
 * was a daily, and it self-verified (the shell re-simulated the recorded wire
 * log to the identical score + hash) — so the wallet hooks it pulls in
 * (useArcadeCertify) never load on the no-wallet play path. Mirror of
 * BarricadeCertify; the invaders submit body additionally carries finalTick
 * (the SI sim runs to a tick count, not a terminal phase).
 */
import { useArcadeCertify } from "../../hooks/useArcadeCertify";

export interface InvadersCertifyRun {
  seed: string; // daily seed string (invaders-YYYY-MM-DD)
  simVersion: number;
  events: number[][]; // wire tuples: [tick, move10, fire, pause]
  finalTick: number;
  claimedScore: number;
  claimedHash: string; // 8 lowercase hex chars, zero-padded
}

export default function SpaceInvadersCertify({ run }: { run: InvadersCertifyRun }) {
  const { certify, status, error } = useArcadeCertify();

  if (status === "certified") {
    return (
      <p className="si-hint si-certified" role="status">
        Run verified and queued ✓ It will appear on-chain after day-close attestation.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={status === "certifying"}
        onClick={() =>
          certify({
            seed: run.seed,
            simVersion: run.simVersion,
            events: run.events,
            finalTick: run.finalTick,
            claimedScore: run.claimedScore,
            claimedHash: run.claimedHash,
          })
        }
      >
        {status === "certifying" ? "Submitting…" : "Queue for on-chain board"}
      </button>
      {status === "error" && error && <p className="si-hint si-certify-error" role="alert">{error}</p>}
    </>
  );
}
