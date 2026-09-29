# Memba OS Profile and WYSIWYG Editor — implementation proposal

**Date:** 2026-09-28
**Updated:** 2026-09-29
**Status:** The public Profile and visual editor foundation merged in [PR #1380](https://github.com/samouraiworld/memba/pull/1380) (`cb0134d5`). On-chain publishing remains off by default behind `VITE_ENABLE_OS_PROFILE_PUBLISH`; the full WYSIWYG release gates below remain open.

## 1. Product outcome

Give every Gno address a useful, public Profile window in Memba OS. A member can make it their own with a smooth visual editor, see the real published result before signing, and share a stable link. A guest can explore people and try the editor without connecting; connection is requested only to publish. The profile is an identity and activity home, not a wallet balance page or an arbitrary HTML website.

**Definition of complete:** A guest opens an address or `@username` link and sees a legible, source-labelled profile on desktop and phone. The owner can edit identity fields, image, links, section order, visibility, and a constrained visual template; preview matches the published renderer. The OS shows the exact public changes, chain, gas estimate, and destination before each explicit wallet approval. The UI verifies chain state after submission and survives an unknown wallet outcome without sending again blindly. Public reading and publishing existing text or media references work if Memba's backend is unavailable; new IPFS uploads may need its upload service. Classic links and other OS apps resolve to the same person.

This proposal covers the **person profile**. Validator operator details, DAO profiles, collection creator pages, Feed author pages, blog publishing, on-chain friends, and a fully freeform personal website keep their own data and authority; they should link to this identity, not silently inherit its edit rights.

## 2. Evidence and corrections to the notes

| Evidence | Consequence for the plan |
|---|---|
| Owner backlog N14 asks for an on-chain profile, templates, and smooth WYSIWYG; it proposes `r/demo/profile` fields and a `memba.theme` string. (Memba OS backlog N14, workspace note) | Keep the product intent, but verify storage capabilities before promising saved themes. |
| The OS design plan puts native Profile **view** in wave 1 and **edit/username signing** in wave 3 S4, after the OS review sheet. (Memba OS design plan, workspace note) | Build reading and composition first; use the shared signing path for publishing. |
| Before PR #1380, Memba at `c8495980` (v7.7.0) routed Profile through the classic page in an OS window. The classic page wrote SQLite via `updateBackendProfile`; `fetchUserProfile` merged username, Gnolove, and backend data. [Profile page](../frontend/src/pages/ProfilePage.tsx), [data layer](../frontend/src/lib/profile.ts), [OS routes](../frontend/src/os/apps.ts) | Replace the classic view with a native Profile surface and make the canonical source of each field explicit. Preserve existing public deep links. |
| The backend profile has bio, company, title, avatar, Twitter, GitHub, and website. GitHub is verified only through OAuth; arbitrary profile saves cannot set it. [RPC](../backend/internal/service/profile_rpc.go), [schema](../backend/internal/db/migrations/002_profiles.sql) | Migrate only owner controlled fields. Never turn a typed link into a verified identity claim. |
| The live mainnet `gno.land/r/demo/profile` source was read through `vm/qfile` on 2026-09-28 (SHA-256 `ff71a8f9b53049bcfbbe19b46244b0561c64dfcccdb80ab486208c473597cedb`). Its `SetStringField` accepts an arbitrary field string and keys it to the immediate caller; a `GetStringField` query returned an existing Unicode Bio. Memba's **vendored non-mainnet copy** checks an allowlist and rejects unknown keys. [Config](../frontend/src/lib/config.ts); vendored source: `samcrew-deployer/deps/demo/profile/profile.gno` in the sibling deployment repository. | **Revised storage decision:** one bounded client-side `memba.profile.v1` JSON field can store title, company, links and layout in the live mainnet realm. Gate that key off on other networks until their deployed source proves support. The live realm does not enforce document byte limits, URL rules, or revisions; readers must reject unsafe data. A shared realm remains a later hardening option, not a dependency for mainnet v1. |
| The older mockup says edits are stored by Memba and nothing is broadcast. (Memba OS mockup v4, workspace note) | Rewrite this copy. Publishing a profile is a public on-chain transaction; IPFS media is also public. |
| The 2026-09-07 decentralization note proposes a new `memba_profiles` realm, while N14 prefers reusing `r/demo/profile`. [Decentralization note](PROGRESSIVE_DECENTRALIZATION.md) | Reuse live mainnet storage for v1. Revisit a shared realm if enforceable limits, optimistic concurrency and indexed events become necessary. |

**Audit basis:** local notes, mockup, and the pre-merge code at `c8495980`. The web reader could not access `memba.club/os` during this audit, so this is a source and design audit, not a claimed production walkthrough. The production guest/member, desktop/phone, narrow-window, and light/dark walkthrough remains a release gate.

## 3. Six-perspective expert audit

| Perspective | Finding | Severity | Proposed response |
|---|---|---|---|
| Product | The current page is a collection of identity, assets, quests, votes, and social cards, but there is no coherent public “this is me” composition or direct share/edit journey. | Important | Native Profile has a clear identity header and owner-controlled sections. Keep activity modules as verified system facts. |
| UX | The current edit form saves backend fields; the mockup's save language hides publication and cost. A guest editor would currently be stopped by the own-profile gate. | Critical | Two modes: try with sample content as a guest; edit your own draft as a member. “Preview” is local, “Publish on Gno” is an explicit reviewed action. Preserve drafts across connection, wallet cancel, and window close. |
| UI | A theme picker alone does not satisfy WYSIWYG. Unrestricted custom CSS/HTML would make profiles inconsistent and unsafe. | Important | Direct manipulation of a shared Profile canvas: choose a template, crop/position cover and avatar, change approved accent, move/hide allowed blocks, edit text in place, inspect desktop/phone previews. One renderer serves preview and public page. |
| Frontend/data | Current `fetchUserProfile` makes backend fields appear canonical; mainnet and the vendored test realm have different setter behavior. Multiple field writes could create mixed old/new state. | Critical | Typed schema and per-field provenance; chain first for on-chain fields, verified OAuth only for GitHub, cache only for search. Gate custom fields by network, stage publication as an exact diff, and read back every field. |
| Security/trust | Profile text, links, media and visual JSON are untrusted public content. A preview can be used to hide links, impersonate badges, or inject CSS/HTML if arbitrary values reach rendering. | Critical | No arbitrary HTML, CSS, embeds or scripts. Bounded enums and sizes in contract and client; safe URL policy, media proxy/gateway policy, neutral external-link treatment, and protected official badges. Preview with the same parser as public rendering. |
| Accessibility/performance | Drag-only editing, fixed desktop columns, heavy images, and color-only themes would make the feature unusable for some members and in OS phone sheets. | Important | Move up/down controls and keyboard reordering, labelled fields, focus management, undo, reduced-motion support, AA contrast across themes, image limits, 360/420 px layouts, lazy activity modules. |

### Product boundary decisions

1. **An `@username` is registered separately** through the existing registrar and its actual current price. DisplayName is an editable profile label, never a verified username or badge.
2. **The member's on-chain core** uses standard fields: DisplayName, Bio, Avatar, Homepage, and Location. Do not use Age or GravatarEmail by default; both can expose unnecessary personal data.
3. **Verified facts** (address, username registration, GitHub OAuth, DAO membership, votes, assets, reviews, quest state) are read-only modules with source and freshness labels. The owner may choose whether to display optional modules, but cannot alter their values.
4. **Editable extensions** (title, company, extra links, cover, layout, accent, section order) are public in one versioned custom field on the live mainnet profile realm. They remain unavailable for publication on other networks until the deployed realm supports that field. Existing backend fields remain labelled as legacy until an owner explicitly imports them.
5. **No per-user AddPackage.** The backlog estimates ~21 GNOT per home realm and notes a publication hold. One reviewed shared realm serves all users if richer on-chain profiles are approved.

## 4. Proposed experience

### Public Profile window

- Open by address or `@username`, in the native OS Profile app on desktop and as a full-height sheet on phone. Keep old `/:network/profile/:address` and `/u/:username` routes compatible.
- Header: avatar, DisplayName, `@username` if registered, shortened/copyable address, concise bio, location, homepage, and source-aware badges. The owner gets **Edit profile**; guests can view everyone, including addresses with no profile fields.
- Sections: About, links, DAOs, votes, public assets/credentials, Feed activity, and reviews where enabled and available. Empty sections disappear or explain their source; unavailable data is never presented as zero.
- Public share link resolves to the address so a username change does not break it. Username links redirect to the same canonical identity. For account switches, show the viewed address and signer address clearly.

### Editor

- Entry from own Profile. On a guest sample profile, **Try the editor** opens a local demo draft; publishing asks to connect and then loads the actual wallet's current profile before allowing a merge. Never submit the demo address/content as though it were the member's.
- Canvas and controls are side by side in a wide window; a narrow OS window or phone uses **Edit / Preview** tabs. The canvas is the actual public renderer. Inline edits update the draft immediately, with field limits and an undo stack. Autosave only to browser storage, scoped by chain and address, with an explicit “Local draft” indicator.
- Offer three initial templates: **Simple** (identity and links), **Builder** (projects and contributions), **Community** (DAO/Feed activity). Templates are starting layouts, not badges or content claims. The member can reorder/hide supported modules with keyboard buttons, select a bounded accent palette, choose a cover image URL, and reset to a template. Keep a one-click “View published” comparison. Avatar upload uses the existing image crop/resize path.
- Publishing panel lists changed fields and exact on-chain destinations, estimated network fee, image CIDs, publicly visible data, and any unsupported/off-chain legacy fields. If nothing changed, no transaction. During review, re-read chain state and detect conflicts; offer merge or reload rather than overwriting a newer edit silently.
- On cancel, keep the draft. On confirmed readback, mark it Published, clear only the matching local draft revision, refresh all profile surfaces and search. On unknown outcome, lock repeat publish until tx/hash and field reads settle or the member explicitly reviews the latest chain state.

## 5. Storage and source-of-truth design

| Data | Canonical source | Write path | Read/fallback |
|---|---|---|---|
| Address | Wallet / chain | None | Never editable |
| `@username` | `r/sys/namereg/v0` | Existing registration flow; price fetched before signing | Resolve by address; do not infer from DisplayName |
| DisplayName, Bio, Avatar, Homepage, Location | Live `r/demo/profile` after source/ABI proof | `SetStringField`, address implicit from caller; only changed fields | Query getters; if no chain value, show clearly labelled legacy backend or Gnolove fallback |
| Title, company, extra links, cover, template/layout/visibility | Mainnet `r/demo/profile` custom field `memba.profile.v1`; later shared realm only if needed | One versioned JSON field per owner, within a changed-field call batch | Chain document; strict client-side parser and safe default template if absent/invalid |
| GitHub verified link and contribution data | Existing OAuth / Gnolove sources | Existing OAuth flow | Read-only verified label only when proof exists |
| Search and discovery index | Backend projection of chain events/reads | Indexer only, never authoritative for writes | Stale indicator; direct chain read still works |
| Local draft | Browser storage, chain+address scoped | Editor only | Never public or treated as published |

**Mainnet v1 document:** `memba.profile.v1` is a JSON string with schema version 1, template and accent enums, title/company/cover, up to five HTTPS links, section order and visibility. The client caps it at 4 KiB and strictly validates reads before rendering or signing. The deployed realm does **not** enforce these bounds or offer compare-and-swap, so another client may write invalid or oversized content to its own profile; Memba shows a safe default. Its caller-keyed setter prevents one address from editing another address's field. The client rereads changed values immediately before signing to detect ordinary concurrent edits, but that check is not an atomic contract guarantee. A future shared realm could add enforced bounds, revisions and compact change events.

The client sends only changed `SetStringField` calls in one reviewed transaction and verifies each field by reading the realm. A wallet/chain rehearsal must establish gas and multi-message behavior before release. If only some values appear, the UI keeps an uncertain state; it does not automatically retry. Do not automatically mirror on-chain fields back with a second authenticated backend write: an indexer/projection should consume confirmed chain state, so a backend outage cannot undo a profile publish.

**Migration:** preserve the SQLite row and current public profile while the new reader is rolled out. For each owner, offer “Import your current Memba details” when the corresponding on-chain fields are empty. Show the source, destination, public permanence, and gas. Import never overwrites a nonempty on-chain value. Keep GitHub OAuth separate. Once parity and recovery are proven, stop backend `UpdateProfile` for fields that moved on-chain; keep read compatibility for older clients during a defined sunset.

## 6. Implementation sequence and reviewable slices

| Slice | Work | Exit gate / evidence | Relative size |
|---|---|---|---|
| 0. Reality and schema spike | Read the live mainnet source and getter; production guest/member walkthrough (desktop, phone, 420 px window, light/dark); rehearse calls with a test wallet where the deployed realm matches mainnet; measure gas and batch behavior. | Source hash recorded above; screenshots, wallet outcome and gas measurements remain release gates. | S |
| 1. Native public Profile | Native route/window, address and username resolution, source-aware read model, public/empty/error states, responsive sections, share links, integration from Feed, DAO, Wallet, Explorer, validators, reviews and NFTs where relevant. | Guest can open/share a profile without backend auth; no fake data; old links map correctly; 360/420 px and light/dark pass. | M |
| 2. On-chain core editor | Local draft, inline identity editing, avatar IPFS workflow, exact preview, diff, validation, OS review sheet, changed-field `SetStringField` calls, chain readback, unknown-outcome recovery, explicit legacy import. | Two-wallet rehearsal on a representative network; a nonowner cannot write; reload and cancellation preserve drafts; backend down does not block chain read/publish. | M |
| 3. Full WYSIWYG | Three templates, block move/hide, cover and palette controls, desktop/phone canvas, keyboard equivalents, undo/reset, same renderer for preview/public, mainnet document publish and reconciliation. | Published page content parity with preview, malformed chain JSON falls back safely, no layout or contrast break, signing states tested. | M–L |
| 4. Optional hardened realm | If scale or policy requires, specify and audit enforced size/ownership/revisions/events; migrate reads and writes only after deployed-source review and owner approval. | Contract tests including malformed/oversized documents and cross-user writes; deployed source and readback match reviewed artifact. | L, publication dependent |
| 5. Rollout and re-audit | Flag by network/cohort, read-only first, owner canary, measure failures/gas/indexer lag, migrate existing members, update help/copy, production six-perspective re-audit. | No P0/P1 profile issues, owner and guest paths pass on prod, search reflects a confirmed change with stated lag, rollback leaves chain content readable. | M |

On mainnet, slices 1–3 can ship without a new realm because the verified live setter accepts the versioned document key. On other networks, custom layout controls remain preview-only until the deployed realm supports that key. No backend saved theme is presented as on-chain.

**Code ownership:** `frontend/src/os/profile/` for the read model, editor, signer request and shared renderer; `frontend/src/os/apps/profile/` for the native Profile app; reuse the existing OS route mapping and avatar uploader. A later search projection can live in the backend. Coordinate with the independent signing review before release.

## 7. Nonnegotiable release checks

- **Correctness:** mainnet realm ABI verified, wallet account and network rechecked immediately before sign, only the intended address can be changed, exact messages shown, gas measured in a wallet rehearsal, chain readback before success.
- **Content safety:** client-side schema and byte limits because the live contract lacks them; safe parsing of untrusted reads; no raw HTML/CSS, unsafe URL protocols, hidden official badges, or remote embeds. IPFS images have size/type validation and graceful fallback.
- **Accessibility:** keyboard completion of every editor action, visible focus, labels and status announcements, screen-reader order consistent with visual order, 200% zoom, reduced motion, AA contrast on every offered palette.
- **Regression:** old classic profile/username links, GitHub verification, validator profile, Feed author links, reviews, assets, quests, and wallet switching still resolve correctly. A profile is public even when its owner has not connected in the current browser.
- **Operational:** observe transaction outcomes, gas failures, read/index lag and upload failure rate without logging profile draft content; documented rollback is a UI flag plus preserved chain reads, never deletion of historical on-chain data.

## 8. Decisions for owner review

1. **Owner confirmed:** title, company and additional links become public on-chain, with explicit import of existing backend values.
2. **Owner confirmed:** public assets and credentials appear by default. Visibility controls change Memba presentation only; on-chain holdings remain public.
3. **Owner confirmed:** use the verified live mainnet profile realm for the v1 document; reserve a shared realm for later contract-enforced limits and revisions.
4. **Release gate:** obtain wallet rehearsal, gas measurements, desktop/phone accessibility review and production read checks before enabling `VITE_ENABLE_OS_PROFILE_PUBLISH`. No production contract action is proposed in this document.

**Recommendation:** deliver slices 0–3 as one dedicated Profile track on mainnet, then evaluate the optional hardened realm. Treat the WYSIWYG editor as delivered only when customizations are chain persisted, preview/public parity is proven, and the production re-audit passes.

## 9. Merged foundation (2026-09-29)

[PR #1380](https://github.com/samouraiworld/memba/pull/1380) merged as `cb0134d5`. It delivered the native public Profile window, chain-first read model, guest sample editor, local owner drafts, three layout templates, accent and section controls, a shared public/preview canvas, username links and registration review, explicit legacy import, and a guarded profile publish request. Public assets and credentials appear by default. The custom title, company, links, and layout document are prepared as one versioned public field for the verified mainnet realm. `VITE_ENABLE_OS_PROFILE_PUBLISH` remains **off** by default; the merge did not enable profile transactions.

| Evidence | Result |
|---|---|
| Focused Profile E2E in Chromium and Firefox | 14 passed after integrating main through `c8495980`, including address and username links, phone layout, editor preview, and light/dark accessibility scans. |
| Frontend typecheck, full lint, production builds, bundle gates, full unit suite | Passed after integrating main through `c8495980`: 732 unit files and 7,430 tests passed, with one file/test skipped. Both default and OS-enabled production builds passed; the default build's Three and OS isolation gates passed. The unit suite used the repository's pinned Gno toolchain. |
| Broad OS E2E | 400 passed, 10 skipped in Chromium and Firefox on isolated test ports before integrating #1378. Focused Profile and Terminal tests passed after #1378; the focused Profile suite passed after integrating `c8495980`. |
| Standard E2E | 634 passed, 14 skipped across Chromium, Firefox, iPhone, and Pixel after integrating main through `c8495980`, under the repository's two-worker CI settings. The validator link assertion now waits for its sort URL, the directory refresh test waits for the intercepted refetch, and Barricade's introduction fits short portrait phones. |
| Backend | `go test -race -count=1 ./...` and `go build ./...` passed after integrating main through `c8495980`. The race suite needed localhost access for its test servers. |
| GitHub merge gate | All 28 checks on head `a1ceb2fe` completed without failure (26 successful, 2 neutral); PR #1380 merged into `main` as `cb0134d5`. |

**Next delivery gates before calling the WYSIWYG feature complete:**

1. Rehearse a real wallet publish on the verified mainnet realm, recording fee, batched calls, readback, cancellation, and uncertain outcomes before enabling the flag.
2. Finish direct canvas editing and cover/avatar positioning, then verify preview and published content match.
3. Validate keyboard flow and 200% zoom with people; complete the production owner/guest walkthrough and six-perspective re-audit.

## 10. Address-owned Home and activity view (2026-09-29)

The shared Profile realm and an address-owned /home realm are separate public sources. Profile now starts on Overview, discovers a Home at the viewed address, displays a bounded plain-text excerpt, and links to the complete original realm. Home content is labelled owner-authored; its claims do not become verified roles or credentials.

The Home, DAOs, Contributions, and Feed tabs organize read-only signals around the same address. DAO membership, roles, tiers and voting power come only from rosters in Memba's bounded known directory, with checked and unavailable counts and no claim of chain-wide coverage. Published packages and linked GitHub activity are attributed to Gnolove; ranks remain withheld until a source supplies an account, metric and period. Feed posts and replies are separated, with links back to their threads and a recent-sample notice. Existing editor layout and section visibility controls continue to apply, and this change does not enable profile publishing.
