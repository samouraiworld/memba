# Per-game Free play boards (D-boards)

Source-only integration boundary; the application does not inject this prop yet.
`GamePage.freePlayBoard` takes the existing A `client.board` reader, its exact
`target`, and the selected `game`, `rules`, `simVersion`. The page only mounts
it for a matching local game and session chain. Connect 4 is excluded. No
network, endpoint, rule/version default, auth adapter, feature flag, publication
or global board is introduced. A supplies the final active-runtime contract.

The shared reader validates every receipt. The UI additionally verifies that
its configured target/context matches the returned board, so a valid reader
for another network cannot render under this page's label. Context changes
remount the view and reset pagination. Page/client changes hide stale rows during
render. Cleanup aborts the request; aborted callbacks cannot update state even
if an injected transport ignores the signal. This also covers A → B → A.

Reads use pages of 20, offsets bounded to 100,000 (the shared API limit).
There is no invented total or background prefetch. A full page enables Next;
an empty next page is distinct from an unavailable read and permits Previous.
Rank numbers preserve the server's order. Each row exposes its full player,
score and a keyboard-accessible details element with the actual receipt's
network/realm/block/run, transaction when present, attester and hashes. No
explorer URL is guessed; a runtime-supplied proof link can be added later if
there is an approved network-aware resolver.

Tests prepared: loading/error/empty, context mismatch, cancellation and stale
responses including A → B → A, reader replacement, pagination/reset, all three
games, and GamePage exclusion of Connect 4 / wrong network / wrong game.
These source tests are not a live-chain proof or a completed runtime integration.

## Native injection and saved history

`ArcadeWindowProps` extends `NativeViewProps` locally (the shared native contract
is unchanged):

```ts
freePlayBoards?: Partial<Record<FreePlayGame, FreePlayBoardProps>>
savedRuns?: {
    storage: SnapshotStorage
    onOpenSavedRun(selection: { game: FreePlayGame; clientRunId: string }): void
    subscribe?: (refresh: () => void) => () => void
}
```

The native game page selects its own map entry; GamePage still checks game and
active chain. With no injection the existing lobby remains unchanged. Your runs
uses only A3's listFreePlaySnapshots/loadFreePlaySnapshot, with ten results per
page and the shared twenty-per-game index. Selection re-reads and validates the
canonical snapshot, then forwards its game and original ID. No Play action,
new run, publication, connection, credentials or network request is involved.
Stored scores and even stored confirmed receipts are explicitly local and not
rechecked. The game consumer owns authenticated recovery/readback.

Storage events are supplied by the host; subscribe returns its cleanup. Manual
refresh is always available and returns to page one. Replacing storage or game
immediately discards old rows. Corrupt/missing entries and unavailable storage
have explicit states. The index order is recent saves, not a ranking or an
invented completion timestamp.

## Future shared wiring inventory — not edited here

- `os/native/types.ts` / native registry boundary: agree with A on a typed Arcade
  runtime injection, or an Arcade provider; do not add a second client.
- `os/shell/WindowBody.tsx` (the shared native/classic boundary, re-exported from
  WindowFrame): pass the runtime board map and saved storage to ArcadeWindow.
- `os/shell/Shell.tsx` and `os/phone/PhoneShell.tsx`: own the shared recovery
  selection/lifetime across desktop and phone. Storage subscription must cover
  cross-tab events and same-tab saves where available; clear/rebind the reader
  on network/identity changes according to A's runtime contract.
- The classic game adapter routes the selected `{game, clientRunId}` to each
  game's recovery prop, with an explicit close callback. B already exposes
  `recovery: {clientRunId, onClose}`. Confirm A/C consumers before wiring; never
  invoke D1's Play intent or consume a launch to open an existing result.
- Compose this branch's `GamePage`/`native` additions with D1's launch props and
  D2 catalogue work in the final integration branch. No shared Shell or game
  consumer file is changed by this PR.

Validation: 44 focused tests pass (board 13, GamePage 7, history 9, native 15),
one worker; ESLint passes for changed TSX files. No full build, typecheck,
browser recipe or live-chain proof is claimed for this branch.
