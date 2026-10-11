# Per-game Free play boards (D-boards)

Source preparation: Shell accepts an explicit nullable runtime configuration; no application caller supplies it yet.
`GamePage.freePlayBoard` takes the existing A `client.board` reader, its exact
`target`, and the selected `game`, `rules`, `simVersion`. The page only mounts
it for a matching local game and session chain. Connect 4 is excluded. No
network, endpoint, rule/version default, auth adapter, feature flag, publication
or global board default is introduced. A supplies the shared runtime and configuration contracts.

The shared reader validates every receipt. The UI additionally verifies that
its configured target/context matches the returned board, so a valid reader
for another network cannot render under this page's label. Context changes
remount the view and reset pagination. Page/client changes hide stale rows during
render. Cleanup aborts the request; aborted callbacks cannot update state even
if an injected transport ignores the signal. This also covers A → B → A. A reader generation changes on every client
transition, including null, so an already resolved result cannot become current
again when the same reader instance returns.

Reads use pages of 20, offsets bounded to 100,000 (the shared API limit).
There is no invented total or background prefetch. A full page enables Next;
an empty next page is distinct from an unavailable read and permits Previous.
Rank numbers preserve the server's order. Each row exposes its full player,
score and a keyboard-accessible details element with the actual receipt's
network/realm/block/run, transaction when present, attester and hashes. No
explorer URL is guessed; a runtime-supplied proof link can be added later if
there is an approved network-aware resolver.

Board tests cover: loading/error/empty, context mismatch, cancellation and stale
responses including A → B → A, reader replacement, pagination/reset, all three
games, and GamePage exclusion of Connect 4 / wrong network / wrong game.
These source tests are not a live-chain proof or a completed runtime integration.

## Native injection and saved history

`ArcadeWindowProps` extends `NativeViewProps` locally (the shared native contract
is unchanged):

```ts
freePlayBoards?: Partial<Record<FreePlayGame, FreePlayBoardProps>> | null
savedRuns?: {
    storage: SnapshotStorage
    onOpenSavedRun(selection: { game: FreePlayGame; clientRunId: string }): void
    subscribe?: (refresh: () => void) => () => void
} | null
```

The native game page selects its own map entry; GamePage still checks game and
active chain. Explicit props override the shared context, including null to disable. With neither props nor runtime the existing lobby remains unchanged. Your runs
uses only A3's listFreePlaySnapshots/loadFreePlaySnapshot, with ten results per
page and the shared twenty-per-game index. Selection re-reads and validates the
canonical snapshot, then forwards its game and original ID. No Play action,
new run, publication, connection, credentials or network request is involved.
Stored scores and even stored confirmed receipts are explicitly local and not
rechecked. SavedRunPanel owns a separate result session for authenticated recovery/readback; opening it does not mount or retarget a game engine.

Storage events are supplied by the host; subscribe returns its cleanup. Manual
refresh is always available and returns to page one. Replacing storage or game
immediately discards old rows. Corrupt/missing entries and unavailable storage
have explicit states. The index order is recent saves, not a ranking or an
invented completion timestamp.

## Workspace runtime and local recovery

Shell accepts `freePlayConfiguration`, defaulting to null, and owns one
`useArcadeFreePlayRuntime` instance. A stable FreePlayRuntimeProvider surrounds
the desktop/phone workspace. The hook validates A's explicit configuration
before constructing auth subscriptions after commit, shares clients by exact
origin/target, and shares storage notifications across configured games. It
refreshes identity after OS commits and disposes the owner on lock, EVM,
configuration or identity changes. Per-transition generations prevent a disposed
owner from returning after A → null → A. Disposed connect callbacks are inert.
No deployment flag, endpoint, rules, version or network is selected implicitly.

Arcade derives board entries and local history from the runtime. Selection lives
inside Your runs: it opens SavedRunPanel by the original game/ID and never calls
open, push or Play. The list remains mounted and hidden during recovery. The
panel creates its controller after commit, disposes and aborts it on replacement
or close, focuses its heading, and returns focus to the opener. Missing or
unreadable data does not start a new game. Local-only results remain readable;
network verification and publication require explicit result actions. Different
game storage instances produce an unavailable state instead of merging them.

WindowFrame, PhoneShell, ClassicPage, global native types/registry, NotesStages
and game consumers are unchanged by this delta. Compose native/GamePage and the
small Shell provider hunks with #1584's launch/Notes work in the final integration
branch; desktop/phone engine-preservation proof belongs to that composition.

## Validation

60 focused tests pass with one worker: board 15, GamePage 7, history 9, native 17,
owner 8 and panel 4. After type-only fixture corrections, native's 17 tests were
rechecked. ESLint passes all eight runtime delta files without warnings. A
TypeScript program rooted at those eight files, using project options and the
existing Vite/changelog/test declarations, reports zero diagnostics, including
transitive dependencies. This is not a full-project build or typecheck. No browser,
composed Shell engine or live-chain proof is claimed for this runtime delta.

## Completed-result recovery after connecting

The workspace's keyed SignerProvider and per-account desktop restoration can
remount or replace game windows when connecting or switching accounts. They stay
unchanged. The supported recovery contract preserves a completed result's original
UUID/input, binding, publication consent and receipt; it does not preserve a live
engine across connection or resume an unfinished game.

SavedRunPanel uses A's shared FreePlayResult/FreePlayConnect and
prepareFreePlayRecovery contract. Canonical data and index membership are confirmed
after mounting and again immediately before the explicit Connect callback. The
notice directs the user to Arcade → Your runs after connecting. There is no
implicit navigation, Play, verification or publication. Account B cannot rebind
account A's saved result. A storage failure offers a local JSON export and avoids
promising recovery. If session creation fails and no Connect callback is supplied,
the readable canonical snapshot remains exportable, including its binding,
publication consent and receipt.

The A8 integration composes shared commit 35c9e920. A separate 41-test pass covers
SavedRunPanel (9), real Shell composition (7), native Arcade (17) and runtime owner
(8), with one worker. ESLint and targeted TypeScript for the three changed files
and their dependencies pass. The seven Shell cases use the real signer/window
restoration and a mount-lifetime probe in place of WindowFrame's game engine:
guest→member with absent/present/empty destination desk, a direct link, account
A→B with desktop/direct-link restoration, and Your runs at a constant owner.
They document expected remounts and canonical recovery, not real-engine or phone
browser behavior. The earlier 60-test pass remains attributed to 954dd30a.
