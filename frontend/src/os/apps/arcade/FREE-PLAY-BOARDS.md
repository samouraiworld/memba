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
