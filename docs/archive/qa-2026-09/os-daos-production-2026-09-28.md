# Memba OS DAOs production QA

28 September 2026. The DAO audit follows Settings PR #1350, Wallet/Send PR #1349 and shell PR #1345 in that merge order. Feed/Live and Tokens have separate active sessions.

## Production baseline and scope

Ten independent perspectives reviewed the DAOs app, DAO folder (Overview, Proposals, Members, Treasury), proposal detail and vote, Create DAO wizard, New proposal wizard, and signing/recovery. A guest visited `https://memba.club/os/daos` and the GovDAO and Memba DAO folders on production, including GovDAO proposal #6 and member/treasury sections, at desktop and 320 px phone widths. The production check was read-only: no wallet was connected and no proposal, vote or deploy was submitted. Member, signature, failure and recovery journeys ran against local chain and Adena fixtures.

GovDAO proposal #6 showed `0 yes · 0 no` in its folder list but `Yes 1 · No 0` in its detail. The list summary is not a reliable tally, so the folder now shows status and leaves vote counts to the detail read.

## Ten QA perspectives

| Perspective | Main finding or evidence |
|---|---|
| Product journey and UX | DAO actions were unclear for older and weighted contracts; loading errors could look like an empty proposal list. |
| Gno chain integration | Version-2 voter lookup stopped at 50 votes, and proposal confirmation searched only the newest 20 proposals. |
| Accessibility | DAO tabs lacked arrow-key navigation and panel association; wizard and review radio groups needed keyboard operation. |
| Performance and state lifecycle | React Query invalidation could still serve the proposal loader's 30-second cache; voting deadlines could become stale while a window stayed open. |
| Content and trust | A concluded vote could still say “voting ends”; successful receipt copy and network fee context needed clarification. |
| QA engineering | Version-2 voting, recovery, deadline, mobile editor, and failure states lacked browser coverage. |
| Architecture | DAO-kind routing and cache keys needed to distinguish full version-2 config from classic light reads. |
| Visual and responsive design | GovDAO folder overflowed on a 320 px phone; the Create DAO member editor became cramped in narrow windows. |
| Privacy and security | Chain-supplied profile links, invisible text in identities and review titles, and indefinitely retained drafts needed controls. |
| Cross-browser and device behavior | WebKit desktop/touch samples passed; a narrow desktop window required a container-based member editor layout. |

## Changes in this branch

- Page through version-2 vote records for the member's choice and confirmation, including voters after position 50. Clear verified vote receipts, retain confirmed proposal IDs through reload until the member explicitly starts another, and refresh the proposal loader cache after signing.
- Confirm a new proposal ID only from this transaction's result in both OS and Classic forms. A hash without a returned ID stays in recovery; a same-title chain row cannot prove its ownership. Derive voting availability from the current time and show a retryable read error.
- Make DAO navigation reflect contract capability, link weighted DAOs to their workspace, and prevent unreliable list tallies from contradicting proposal detail.
- Link accepted version-2 and passed GovDAO proposals to the working execution action on the DAO page.
- Show invisible formatting in DAO member identities and vote review titles; restrict chain-rendered profile links to Gno profile routes.
- Support keyboard DAO tabs, wizard option groups and signing options; focus the next wizard step. Keep member inputs usable in phone and resized desktop windows.
- Show the DAO gas limit and tell members Adena shows the final network fee. Let members discard saved DAO and proposal drafts, and say when browser storage is unavailable.

## Verification and limits

The DAO and wizard browser suites passed 38 cases in Chromium and Firefox with local chain and wallet fixtures. WebKit desktop/touch samples passed 12 read-only cases, then 20 phone, resized-window, draft, vote, execution-link, recovery and landscape cases after the layout change. Focused unit tests passed across DAO parsing, pagination, confirmation, recovery and signing. The production frontend build, TypeScript, targeted lint and diff check passed. PR CI is recorded with the PR after it finishes. Production did not provide a connected account for a live signature or transaction. Accepted proposal execution remains on the existing DAO page, reached from the OS proposal. Treasury remains the stated contract-v3 target. A wallet that returns only a hash cannot automatically open the newly created proposal until hash-correlated proposal evidence is available.
