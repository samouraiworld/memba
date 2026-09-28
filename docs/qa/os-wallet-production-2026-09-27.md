# Memba OS Wallet and Send production QA

27 September 2026. This is the Wallet/Send feature audit in the one-PR-per-feature programme. The branch `fix/os-wallet-production-qa` starts at shell PR #1345 and is intended to merge after it. Feed/Live and Tokens have separate active lanes.

## Production baseline and scope

The live routes `https://memba.club/os/wallet` and `/os/wallet/send` loaded as a guest. Wallet and Send both showed a connect gate; Connect opened the Adena choice and correctly detected that Adena is absent in the in-app browser. The guest Send deep link was checked at desktop, 375 px, 320 px and landscape widths without horizontal overflow. The ten perspectives below inspected production guest behavior, repository flows and mocked member E2E. No real wallet was connected and no production transaction was signed or broadcast.

The feature inventory covers: guest connection and missing-wallet guidance; account and network scoped balance; Receive/copy; GNOT and unavailable token asset state; direct and `@name` recipients; recent and saved recipients; amount, Max, memo and fee; review and Adena handoff; chain receipt and notification state; cancellation, uncertain outcome and reload recovery; account switching, cross-tab behavior, keyboard access and phone layouts.

## Ten QA perspectives

| Perspective | Main finding or evidence |
|---|---|
| Product journey | Unknown/stale balance appeared as zero; Receive looked like a panel but only copied; uncertain transfer had no status path. |
| Accessibility | Field errors/hints lacked input associations; recipient chips exposed truncated addresses; a one-choice asset used radio semantics. |
| Security | An empty wallet hash could be reported sent; two tabs could overwrite/clear each other's recovery lock; fee could differ from review. |
| Resilience | Old account RPC responses could overwrite a new account; RPC failure retained stale funds; wallet cancellation could be called unknown. |
| Cross-browser/device | Baseline mocked send passed Chromium, Firefox and WebKit; guest deep links fit narrow screens. Phone/Firefox Adena guidance was inaccurate. |
| QA engineering | Existing five E2E cases missed cross-tab collision, malformed hash, balance race and mobile member review. |
| Chain protocol | Adena's synchronous broadcast return is submission, not block confirmation; `/tx` needs matching hash, height and delivery result. Zero coins have an explicit bank response. |
| Visual and interaction | Unknown-outcome screen lacked a direct transaction check; Receive label hid its copy behavior. |
| Privacy | Recent counterparties persisted locally even when the Saved checkbox was off, with no clear control. |
| Recovery | The unknown-outcome advice pointed to a stale balance; lock ownership and reload diagnosis were incomplete. |

## Changes in this branch

- Scope balance results to the requested address and ignore old responses. An initial, failed or malformed RPC read now leaves the amount unknown; an explicit empty coin response remains zero. Wallet and Send display unknown or loading instead of authorizing Max from stale data. Wallet includes Refresh balance.
- Reject internal whitespace and underscores in GNOT amounts. Keep the checked fee fixed in Adena and re-read network gas price before signing; a higher or unreadable quote stops the send for a new review.
- Serialize same-wallet sends across tabs with Web Locks and a durable, attempt-owned local record. Recheck the record at final signing; another attempt cannot overwrite or clear it. Storage changes update open Send forms.
- Accept a wallet return as submitted only with a valid transaction hash. Check `/tx` for matching hash, positive height and a clean delivery result before saying Confirmed, remembering the recipient or clearing the lock. A missing receipt stays Submitted and recoverable; an empty/malformed hash stays unknown. The recovery screen exposes the full hash, network link, Check status and balance refresh.
- Classify explicit Adena cancellation as cancelled. Clarify Receive as Copy receive address, expose full recipient addresses to assistive technology, associate form errors and hints, and replace the one-choice radio group with static asset cards.
- Explain local recipient retention and add a per-wallet Clear recipients control. Correct absent-Adena guidance for phone and supported desktop browsers.
- Keep the recipient and Save choice with an unresolved send so a confirmation checked after reload completes the recipient record. Require an explicit successful chain execution result; classic and OS activation now offer balance retry when RPC fails.

## Verification

| Check | Result |
|---|---|
| Live guest Wallet/Send, connect and absent-Adena flow | Passed; no member wallet available in that browser. |
| Focused hook, broadcaster, signer and Wallet unit tests | 138 passed across seven files before reviewer fixes; 34 directly affected tests passed after them, including malformed receipt and activation retry. |
| Expanded Wallet E2E with stub Adena | Nine Wallet and five phone-shell cases passed in each of Chromium and Firefox (28/28). The final two-tab test uses a held wallet response to prove overlap and passed separately in both engines. Eight Wallet cases passed in WebKit before the reviewer fixes. |
| Production build, TypeScript, lint and `git diff --check` | Passed. CTO and SWE code re-reviews approved the fixes. |
| Full frontend Vitest | 7,091 passed; one new balance race test needed a deterministic wait and was fixed. A separate Gno toolchain probe failed identically on the untouched shell branch because local toolchain lacks `chain/runtime/unsafe`. Final focused balance test passed. |

The remaining production limitation is an authenticated Adena session and an actual on-chain receipt. This branch intentionally does not spend user funds to manufacture that evidence. After merge and deployment, recheck the guest routes and, with a consenting test wallet and funded test environment, verify the complete submitted-to-confirmed path.
