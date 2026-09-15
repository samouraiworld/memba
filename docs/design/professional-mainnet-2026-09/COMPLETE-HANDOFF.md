# Complete frontend design — consolidated review

Status: implementation and validation in progress. This document must be updated with final evidence before marking the consolidated PR ready for owner review.

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

Full validation results and screenshot index are pending.

## Release strategy

Review this consolidated PR against main. Earlier design PRs are superseded by its combined diff, but remain open until the owner decides how to land the work. Keep capability enablement, mainnet realm deployment and production flag activation in independently reviewed release changes. Before release, rebase/integrate current main, run the full checks, confirm asset/cache behavior, and perform the existing wallet rehearsal with the owner.

Netlify preview-context configuration follows [Netlify's file-based configuration](https://docs.netlify.com/build/configure-builds/file-based-configuration/).
