# Verified Badge — Curation Process (Phase 1, v1)

The "Verified" badge is a **trust signal, not a gate**. A verified collection is one the Memba team has reviewed against the published checklist below. Verification never restricts who can launch, list, mint, or trade — unverified collections are fully functional; the badge only helps buyers discriminate.

This is **team-curated for v1**. Moving curation to a `memba_dao` proposal/vote is a deliberate later step, once collection volume makes team review unscalable.

## How it works on-chain
The badge is the `verified` key in a collection's extensible meta, set on the canonical registry:
```
SetCollectionMeta(collectionID, "verified", "true")   // grant
SetCollectionMeta(collectionID, "verified", "")        // revoke
```
`SetCollectionMeta` is **platformAdmin-only** (the Samouraï multisig → later the memba_dao executor). The frontend reads `GetCollectionMeta(id, "verified")` and shows the badge + a "Verified only" filter. The builder is `buildSetVerifiedMsg` (`lib/launchpad.ts`); the platform runs it via the multisig (same `--commerce-v2` signer flow as other admin calls).

## Eligibility checklist (public criteria)
A collection qualifies for review when:
1. **Creator identity is linked** — a builder identity / known account tied to the creator address (trust layer, not a gate).
2. **Metadata is stable** — token URIs resolve and are not expected to change misleadingly after mint.
3. **Not a clone** — name/symbol/artwork are not impersonating an existing collection (anti-spoof; slugs are already namespaced by creator on-chain).
4. **Disclosed economics** — supply and royalty are set and disclosed.
5. **No active abuse** — not flagged for wash-trading or other manipulation.

## Process
1. **Apply** — creator requests review (public form / channel) referencing their `collectionID`.
2. **Review** — team checks the collection against the checklist. Target SLA: published alongside the form.
3. **Label** — on pass, the multisig runs `SetCollectionMeta(id,"verified","true")`. The badge appears once the indexer/frontend reads the flag.
4. **Appeal** — a rejected creator may appeal via the public channel; the *existence of recourse* is the trust feature. Decisions and their rationale are recorded publicly.
5. **Revoke** — if a collection later rugs or violates the criteria, the multisig runs `SetCollectionMeta(id,"verified","")`; the badge disappears on next read.

## Boundaries (anti-capture)
- Criteria are public; decisions are recorded; there is an appeal path. These rails matter more than who holds the key in v1.
- The badge is **purely informational**. It must never become a precondition for listing/trading, and (until explicitly decided and disclosed) must not feed points/rewards multipliers — to avoid turning curation into a governance-capture or pay-to-verify incentive.

## Status
Frontend (badge display + "Verified only" filter) + `buildSetVerifiedMsg` builder are built and gated behind `isNftLaunchpadValid()` — they activate when `memba_collections` is deployed. No collections can be verified until the registry is live and real collections exist to curate.
