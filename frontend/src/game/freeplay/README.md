# Block Party Free play consumer

The Practice page captures completed standard rounds and uses the common
snapshot/session/result UI. Without an injected runtime it saves locally and
provides an export; publication requires an explicitly configured client.
Daily gameplay and its existing publication flow are unchanged.

`useGame` exposes complete accepted `actionLog` (URDLZ) separately from legacy
`moveLog`, plus `roundId`, `roundMode`, and actual engine `roundOver`. Terminal
Undo and restart fork a new UUID, preserving earlier completed snapshots. UUID
entropy is independent of the engine RNG; unavailable entropy only disables
certification identity.

`BlockPartyGame` accepts optional `freePlay` and `recovery` props. Explicit
values take priority over the common FreePlayRuntimeProvider; null disables the
corresponding external integration. Recovery uses `{clientRunId,onClose}` and
loads the canonical common snapshot. The archive is a separate result panel:
the current engine remains mounted, its board and Undo history survive, and
keyboard/pointer game input is paused until close. No new run, wallet connection,
API read or publication follows merely from opening an archive.

The page and common recovery index never create another per-game result store.
Storage failure retains the complete local export. The common session owns
Verify → Review quote → explicit consent, exact-request retry after ambiguity,
and fresh authenticated receipt checks. Saved receipts are not confirmation.
The temporary game-specific auth adapter has been removed. The OS runtime owns
`createOsFreePlayAuth` from the common module, including its lifecycle; the game
only consumes the resulting common client. Mounted consumer tests use that real
bridge with a simulated provider/HTTP boundary.

Source integration only: no route/config/flag, Shell/Phone or backend activation
changes. Full browser/production integration remains separate from targeted
component and engine validation.
