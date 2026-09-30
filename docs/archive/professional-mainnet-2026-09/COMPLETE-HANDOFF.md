# Complete frontend design — consolidated review

Status: implementation complete in [PR #1200](https://github.com/samouraiworld/memba/pull/1200). The PR checks are the authoritative record for its latest commit. Production activation remains a separate release decision.

## Scope

The approved Quiet Confidence direction and Folded M now extend from the Validators/governance pilot to Home, discovery, assets, creation, account, community, commerce, editorial and specialist workspaces. The route policy in `proApp.ts` assigns a deliberate workspace, form, reading, social or immersive measure without changing route resolution or authorization.

`VITE_ENABLE_PRO_APP=true` composes the existing shell, Validators and governance flags. Default builds retain the legacy presentation. Netlify Deploy Previews turn on this presentation flag only. Hidden feature surfaces use a separate browser fixture configuration; they are not activated in the hosted preview or production.

## Implementation boundaries

- `professional.css`: shared Black/Light tokens, typography, controls and family layouts. Black canvas and ordinary panels are #000. Advanced telemetry deliberately uses a true-black instrument panel in either theme; charts, collectible art and game canvases keep their intrinsic palettes.
- Legacy small text migrates to scoped type tokens with exact legacy fallbacks. Monospace remains for addresses, code and numerical instruments.
- Home: purposeful introduction, live network proof, responsive entry points and operational overview. DAO directory adds name/realm search and a keyboard-operable card title.
- Asset creation/review: larger fields, readable disclosure and review rows, responsive action groups. Signing, fees, threshold calculations and payload builders retain their existing behavior.
- Community/account/creator: shared collection grids, navigation, forms, drawers, unavailable states and readable content measures. Specialist controls inherit the shell without restyling gameplay art.
- Folded M: app loading state, favicon/touch icon, PWA and 1200 × 630 social card. Crawler metadata supplies route category and network; it never invents balances, live entity names or security claims.

## Evidence and limitations

The route matrix in `frontend/e2e/complete-design.spec.ts` checks every route family, missing resources, guarded screens, Black/Light and phone/desktop layouts. It captures review images and checks overflow, naming, form labels, nested controls and text contrast. The separate feature fixture build opens existing gated UI solely in local browser tests, with remote requests intercepted. The protected workflow fixture supplies a synthetic account; all wallet methods reject actions. These are interface checks, not evidence of deployment or live transaction readiness.

### Review evidence

- [Selected visual review](COMPLETE-REVIEW.md): Black/Light, desktop/mobile, populated governance, Validators and feed, synthetic account/transaction workflows, and guarded ecosystem surfaces. The linked HTML gallery supports area, theme and viewport filters. Screenshots preserve pixels and omit metadata chunks.
- [83-path coverage inventory](ROUTE-COVERAGE.md). The complete matrix exercises four theme/width combinations; dynamic resources and capability states are explicitly classified.
- [Hosted preview](https://deploy-preview-1200--memba-multisig.netlify.app/mainnet/validators). It uses the site's existing capability configuration; only the presentation flag is added by this PR.

### Validation performed

- Full frontend unit suite: **5,151 passed, one existing skip**. A subsequent unavailable-block-age display correction passed its **13-test** focused suite (including three new non-finite/invalid-age cases). CI reruns the complete suite on Node 20 and Node 22.
- Full lint and default production build passed. The full-design build also passed; its manifest references the matching 512px and maskable Folded M assets.
- Complete browser matrix: **53 passed**, including all 83 paths at 390/1600px in Black/Light and protected workflows in Chromium, Firefox and iPhone WebKit.
- Feature fixture matrix: **24 passed** initially; its sole failing Light transaction/profile contrast case was corrected and passed in the focused recheck. **10 final refresh checks passed** for Home/governance, protected workflows and populated Validators; **four populated feed checks passed** for both themes and widths. The final CI configurations include the additional populated cases (57 complete / 33 feature cases).
- Existing standalone Validators, shell and governance regression suites passed in the PR's four-browser preview job. Legacy mobile guardrails, backend Go/race checks, Gno tests, dependency review and security scans also passed on the integration push; all remain enabled on the final PR.
- Hosted crawler verification returned absolute Folded M PNG metadata and the correct network/route title. CSP, HSTS, frame protection and content-type protection remained present. Human requests, non-page paths and post-specific moderated feed cards preserve their downstream behavior.

This is presentation and read/fixture validation. Real wallet signing, broadcasts, treasury execution, production capability enablement and realm deployments are not claimed by these checks.

## Release strategy

Review this consolidated PR against main. Earlier design PRs are superseded by its combined diff, but remain open until the owner decides how to land the work. Keep capability enablement, mainnet realm deployment and production flag activation in independently reviewed release changes. Current main (`395230c0`) and the DAO status correction (`f2363775`) are integrated. Before production release, integrate any newer main changes, require passing checks, choose the production presentation flag deliberately, and perform the existing wallet rehearsal with the owner.

Netlify preview-context configuration follows [Netlify's file-based configuration](https://docs.netlify.com/build/configure-builds/file-based-configuration/).

## Maintainability and concurrent work

The complete rollout stays in `Memba-worktrees/professional-complete` on `feat/professional-complete`. Presentation tokens and route policies are isolated from capability policy; the browser-only synthetic session is never imported into application source. Further changes should name file ownership, preserve other sessions’ edits, and keep transaction/network/release changes separate. Do not automatically cherry-pick from an unfinished session.

Rebuild the selected gallery after browser verification with `python3 scripts/design/build-review-pack.py`. Test output directories remain ignored; only selected evidence is committed.
