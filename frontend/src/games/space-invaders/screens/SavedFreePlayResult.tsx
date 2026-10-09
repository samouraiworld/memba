import "../space-invaders.css";
import { useEffect, useState } from "react";
import type { SpaceInvadersPreparedPublication, SpaceInvadersPublication } from "../lib/freePlayPublication";

/** A owns the stored snapshot, controller and receipt/readback state. This view
 * never mounts the game, replays inputs, creates an identity or calls refresh. */
export function SavedFreePlayResult({ clientRunId, publication, onClose }: {
  clientRunId: string;
  publication?: SpaceInvadersPublication;
  onClose(): void;
}) {
  const [view, setView] = useState<{ owner: SpaceInvadersPublication | undefined; id: string; prepared?: SpaceInvadersPreparedPublication } | null>(null);
  useEffect(() => {
    let prepared: SpaceInvadersPreparedPublication | undefined;
    let closed = false;
    void (async () => {
      try {
        const result = await publication?.recover?.(clientRunId);
        if (closed) { result?.dispose(); return; }
        prepared = result;
        setView({ owner: publication, id: clientRunId, prepared });
      } catch {
        // Preserve A's storage and offer a way back, including async loaders.
        if (!closed) setView({ owner: publication, id: clientRunId });
      }
    })();
    return () => { closed = true; prepared?.dispose(); };
  }, [clientRunId, publication]);
  const current = view && view.owner === publication && view.id === clientRunId ? view : null;
  return <section className="si-root si-saved-result" aria-label="Saved Space Invaders result">
    <h1>Saved Space Invaders result</h1>
    {!current ? <p role="status">Opening saved result…</p> : current.prepared ? <>
      {publication?.connect && <button type="button" className="si-button si-button--secondary" onClick={publication.connect}>Connect account</button>}
      {current.prepared.content}
    </> : <p role="alert">This saved result could not be opened. Return to your saved results and try again. No new game has started.</p>}
    <button type="button" className="si-button si-button--secondary" onClick={onClose}>Back to saved results</button>
  </section>;
}
