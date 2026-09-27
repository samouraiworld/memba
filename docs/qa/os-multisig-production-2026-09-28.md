# Memba OS Multisig production QA

28 September 2026. This feature audit follows DAO PR #1351 in the ordered OS audit stack. Feed/Live and Tokens remain in their own active sessions.

## Production baseline and scope

Ten perspectives reviewed the Multisig app, account window, Classic hub and account page, native creation and import, proposal forms, signature collection, transaction review, and completion. A guest visited `https://memba.club/os/multisig`, `/os/multisig/create`, `/os/multisig/import`, and a direct account URL in the live browser. Each presented the expected Connect gate without account data. The live check was read-only: no wallet was connected and no signing or broadcast was attempted. Member, RPC failure, narrow viewport, and keyboard journeys used local chain and wallet fixtures.

`VITE_ENABLE_NATIVE_GNO_MULTISIG` is off in the released build. Native creation, signing and broadcasting still require the separate release ceremony described in `docs/NATIVE_MULTISIG.md`. A legacy multisig record is history in Memba and cannot be broadcast on Gno through this client.

## Ten QA perspectives

| Perspective | Main finding or evidence |
|---|---|
| Product journey and UX | A stored hash was called verified execution, raw signatures were shown as quorum, and completed rows could not open their full reader. |
| Gno chain integration | Native, unconfirmed, and legacy hash records need distinct states; an unknown broadcast outcome and concurrent sequence changes require release controls. |
| Accessibility | The transaction review lacked focus containment and return; Classic account rows and form controls needed keyboard names and focus styles. |
| Performance and availability | Transaction lists sent full signature and sign-body blobs; one failed list read hid the successful account and transaction reads. |
| Content and trust | A shared configuration link looked like an authenticated invitation; hidden formatting in names could mislead readers. |
| QA engineering | Strict amount parsing, partial reads, keyboard review, cross-chain signing, and narrow windows needed direct regression coverage. |
| Architecture and lifecycle | OS and Classic query caches needed refresh after successful create, import, proposal, sign, complete and rename actions. |
| Privacy and security | Unknown message types, cross-network signing and ambiguous amounts must fail closed before a wallet prompt. |
| Visual and responsive design | A resized Create window stacked its member controls poorly; long balances could overflow a phone-width window. |
| Cross-browser and device behavior | Chromium, Firefox and WebKit local fixture runs covered desktop, narrow windows, phone and landscape layouts. |

## Changes in this branch

- Distinguish verified native execution, unconfirmed native hashes, legacy hashes, read-only history, and native actions on hold. Keep every transaction row openable for full details, and distinguish submitted from verified signatures.
- Keep native creation and proposal actions unavailable while the release flag is off. Explain legacy history and shared configuration links without implying a live, authenticated invitation or executable account.
- Gate direct proposal URLs and the home signing inbox by the same native release state, so a legacy history record is not presented as an executable action.
- Reject malformed or overprecise GNOT and nonpositive token transfers, mint and burn amounts; retain zero token approvals for allowance revocation. Show exact review values before signing.
- Contain keyboard focus in signature and completion reviews; reject cross-chain and unknown-message signing. Refresh affected account and transaction reads after confirmed changes.
- Return signature metadata only in transaction lists while retaining full signatures and body bytes in the protected transaction detail read.
- Show partial account data with a retry path when one transaction list fails, disclose the list limits, and keep names, balances and member controls readable at narrow widths.

## Verification and release limits

The local browser session passed 16/16 Chromium and Firefox cases for connected member and guest paths against explicit backend, RPC and Adena fixtures. They include direct native transaction release gating and a malformed shared link. Another 125 focused frontend unit tests across 12 files passed. Focused Go service tests covered the lightweight list and full detail payloads. TypeScript, targeted lint, the production frontend build and Git diff checks passed. The production guest check establishes only the live public gate and route behavior; it does not establish a successful live signature or broadcast. An uncertain RPC response now reports the deterministic expected hash for manual chain checking. A durable, scoped intent must be stored before sending native bytes and reconciled before any retry; stale account sequences also require a fresh check. Keep the native flag off until those two controls and a successful signing ceremony are verified.
