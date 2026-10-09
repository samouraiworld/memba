# Block Party Free play consumer preparation

Source only; not mounted by BlockPartyGame and not enabled. The page and shared
live auth source require the pilot's reservation before their files are edited.

`useGame` now exposes the complete accepted `actionLog` (URDLZ) separately from
legacy `moveLog`, plus `roundId`, `roundMode`, and actual engine `roundOver`.
`blockPartyFreePlaySnapshot` captures only reviewed terminal standard Practice.
Undo after terminal forks the UUID while retaining the transcript; an earlier
saved result therefore remains immutable. Restart also allocates a new UUID.
Entropy failure only disables certification identity; local play remains usable.

`createBlockPartyFreePlayAuth(source)` adapts a synchronous shared live source to
A3. It reuses walletBearer and never reads token storage, connects, authenticates
or signs. The source must emit every wallet/network/session transition and expose
a revision that catches A→B→A even before React renders. walletVerified must turn
false immediately during revalidation, not after the provider request completes.
A React-effect-only ref is insufficient. This source is not wired yet: tests of
an injected source alone do not establish correctness of the real wallet bridge.

Next consumer wiring uses the common snapshot/session/result components and the
shared recovery index from A3 (listFreePlaySnapshots filtered to block-party).
Do not create a per-game result store. Keep a local export if persistence fails.
Mounted UI must cover Verify→Quote→explicit consent→Publish, duplicate clicks,
exact retry, storage quota, wallet/network changes during I/O and A→B→A through
the actual shared source. Saved receipts require refresh before confirmation.
The consumer now mounts the common result/session and offers local export plus
recovery through the shared index. It is still not mounted in the page.21 targeted
tests (11 existing useGame,5 journal,5 mounted consumer) pass with maxWorkers1;
scoped new source/tests TypeScript and ESLint pass. No browser or full build was
run. The mounted tests use the real common client and this injected auth adapter,
with a simulated transport/source; they do not prove the live OS bridge. Shared
auth will move to the reserved common module before D wires Shell/PhoneShell.
