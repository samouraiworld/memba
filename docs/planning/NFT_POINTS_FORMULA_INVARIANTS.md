# NFT Points — Frozen Formula Invariants (v1)

_Status: FROZEN 2026-06-17. These are declared irreversible in NFT_MARKETPLACE_PHASE3_PLUS_PLAN.md §5.5. Coefficients may stay private; these INVARIANTS may not change once accrual begins. formulaVersion = "1"._

1. **Royalty-weighted volume.** Points volume for a sale = realized royalty rate × price-derived base, NOT nominal price. A sale whose `royalty == 0` (RoyaltyInfo returned 0 — many collections) contributes ~0 points. Rationale: enforced royalty is the only on-chain wash-tax; rewarding nominal volume makes the marketplace a profitable wash-farming venue subsidized by the points program.
2. **Maker/taker via→role mapping.** `via="buy"` → maker = seller (lister), taker = buyer. `via="offer"` (v3 per-token AND offers_v1 floor) → maker = buyer (offerer), taker = seller (accepter). `via="auction"` / `via="sweep"` roles are defined when those engines ship (append-only). pkg_path scopes attribution; the role rule is uniform per `via`.
3. **Denom normalization unit = ugnot.** Only ugnot exists today; a versioned denom→ugnot rate policy is frozen now so Phase-4 GRC20 volume is recomputable.
4. **Accrual start-block.** `accrual_start_block` = the v3 deploy block (seq-43/44 deploy height on test13). The v3 `Sale` gap (events emitted before the Task-3 handler shipped) is backfilled into the raw ledger from chain before accrual is declared authoritative.
5. **Self/cluster exclusion.** `buyer == seller` excluded on-chain; cluster wash excluded off-chain using the engine's offer-age signal (`OfferAccepted.offerCreatedBlk`) + per-wallet/recipient graph heuristics. Coefficients private.
6. **Per-wallet caps + reputation multipliers** apply; **terms are non-binding, subject to clawback, with no guaranteed conversion** to $MEMBA. This is published wherever points are surfaced.
7. **Recompute determinism.** points = pure function of (raw ledger up to the confirmed `indexed_through` watermark, formulaVersion). Same input → byte-identical output.
