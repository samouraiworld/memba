# Memba OS public beta guest QA

Status: Guest sweep complete; native Settings fix under review

## Environment and coverage

- Production build-info reported `ea32c07a` on both public sites when the sweep began. The public RPC reported `gnoland-1`.
- Direct navigation in Chrome covered `/os` plus Settings, DAOs, Wallet, Multisig, Feed, Store, Arcade, Validators, NFT, Quests, Explorer, Profile, News, Terminal, Learn, Live and Tokens at a 1440px desktop viewport. Each returned HTTP 200, opened the expected window, logged no page error, and fit the document width.
- Dark-theme checks covered Settings, Feed, Store, Arcade, Terminal and Live. Phone checks at 390px covered home, Settings, Feed, Store, Arcade and Terminal. These had no page error or document overflow.
- This was a public guest pass. It did not connect a wallet, inspect member-only data, sign, broadcast, or claim that a successful route proves its on-chain content is complete. A later interaction pass hit `net::ERR_NETWORK_CHANGED`; its affected checks are inconclusive and excluded from the findings.

## Findings by priority

### P1 — Classic Settings appearance does not change Memba OS theme

On the deployed `/os/settings`, open Appearance and select Dark. The classic preference `memba_theme` becomes `dark`, while `memba_os_theme` and the OS root `data-os-theme` stay `light`. The control looks successful but leaves the surrounding desktop unchanged. The native Settings branch replaces that control with the OS appearance preference and has an acceptance test for immediate and persistent theme changes.

### No additional confirmed guest defects

The route and layout sweep found no other reproducible failure. Store listings, Profile access, and wallet or member flows need their own data and account coverage; this guest pass is not evidence that those flows work end to end.

## Follow-up verification

- Run connected-member checks in a separately claimed lane with an approved test wallet and without broadcasting transactions.
- Recheck production after the native Settings PR deploys: immediate Light/Dark/System switching, wallpaper and icon persistence, narrow desktop and phone layout, and reset preservation of local drafts and send locks.
