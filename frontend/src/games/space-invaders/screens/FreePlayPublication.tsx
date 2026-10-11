import { useState } from "react";
import type { SpaceInvadersReplayResult } from "../lib/launch";
import { SI_FREE_CODEC, SI_FREE_RULES } from "../lib/freePlayCodec";
import type { SpaceInvadersPreparedPublication } from "../lib/freePlayPublication";
import { MAX_CERTIFY_EVENTS } from "../lib/wire";

/** The shared A panel owns verification/quotes/publication/receipts. This layer
 * only retains an exportable game result if its snapshot cannot be prepared. */
export function FreePlayPublication({ result, prepared, issue }: {
  result: SpaceInvadersReplayResult;
  prepared: SpaceInvadersPreparedPublication | null;
  issue: "certification_limit" | "replay_not_verified" | "save_unavailable" | null;
}) {
  const [copy, setCopy] = useState("");
  const exportReplay = () => {
    const text = JSON.stringify({ schemaVersion: 1, rules: SI_FREE_RULES, replayCodec: SI_FREE_CODEC, recordingComplete: result.events.length <= MAX_CERTIFY_EVENTS, result }, null, 2);
    if (typeof URL.createObjectURL !== "function") { setCopy(text); return; }
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    try {
      const link = document.createElement("a");
      link.href = url; link.download = `space-invaders-${result.clientRunId ?? "local"}.json`;
      link.click();
    } finally { URL.revokeObjectURL(url); }
  };
  return <section className="si-freeplay-publication" aria-label="Anchor this Space Invaders score">
    <h3>Anchor this score</h3>
    {issue && <p role="status">{issue === "certification_limit"
      ? "This run exceeds the service replay limits. Your local score is kept; an incomplete recording cannot be published."
      : issue === "replay_not_verified"
        ? "This replay did not pass the local check. Your score is kept locally and is not ready to publish."
        : "The publication snapshot could not be saved. Your local result is still here; export it before leaving."}</p>}
    {prepared?.content}
    <button type="button" className="si-button si-button--secondary" onClick={exportReplay}>Export replay</button>
    {copy && <label>Copy your replay<textarea readOnly value={copy} aria-label="Replay export" /></label>}
  </section>;
}
