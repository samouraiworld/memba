# memba_reviews_v2 — subject canonicalization (spec)

> **Status: SPEC / not built.** Frontend bridge for the same problem shipped separately
> (union-read across operator + signing addresses). This realm is the durable fix; it
> requires a **team/multisig deploy**. Author the realm, get it security-reviewed, deploy,
> migrate, repoint the frontend, then retire the bridge.

## Problem

The reviews realm keys each review by an arbitrary `subject` address string. For a
validator that string is **not stable**:

- Before a validator registers a valoper, the profile page keys reviews to its **signing
  / consensus address** (the only address it has).
- After it registers, the canonical identity becomes the **operator address**, and the
  page redirects signing→operator and keys reviews there.

So reviews posted before registration are **orphaned** under the old signing address.
This happened live: `samourai-crew-1` (operator `g1n9y62…`, signing `g1k7asng8…`) had 2
reviews stranded under the signing address after the valoper was registered.

`gno.land/r/samcrew/memba_reviews_v1` is **immutable** (deployed gno realm, no admin
re-key / alias function), so this cannot be patched in place — it needs a v2.

## Goal

The realm itself owns a **canonical subject** so reviews follow a validator across
signing-key rotation and the genesis→valoper transition, with no frontend gymnastics.

## Design

New realm `gno.land/r/samcrew/memba_reviews_v2`, same API surface as v1 plus:

1. **Canonical-alias map (moderator-maintained).**
   ```
   var subjectAlias avl.Tree // aliasAddr (string) -> canonicalAddr (string)

   // moderator multisig only
   func SetSubjectAlias(cur realm, alias, canonical string) { assertModerator(); ... }
   func RemoveSubjectAlias(cur realm, alias string)         { assertModerator(); ... }
   ```
   The samcrew moderator multisig maps a validator's signing address(es) → its operator
   address. (Kept admin-set rather than auto-derived: the reviews realm shouldn't take a
   hard cross-realm dependency on `r/gnops/valopers`'s operator/signing model, and aliases
   are rare + high-trust.)

2. **Canonicalize on every subject use.**
   ```
   func canonical(subject string) string {
       if v, ok := subjectAlias.Get(subject); ok { return v.(string) }
       return subject
   }
   ```
   `PostReview`, `GetReviewsJSON`, `GetSubjectSummaryJSON`, the author+subject pair key —
   all resolve through `canonical(subject)`. A review posted under a signing address that
   has an alias is stored under the operator address; reads under either address return
   the same canonical set. Idempotent (operator address aliases to itself / not present).

3. **One-time migration of v1 data.** v1 has only a handful of reviews. Options, cheapest
   first:
   - **Admin re-import (recommended).** A moderator-only `ImportReview(cur realm, subject,
     author, rating int, body string, createdAtV1 int64)` that seeds a review under the
     *canonical* subject, preserving author + original block height (so dates stay
     correct). Run once per v1 review from a migration script; then `SetSubjectAlias` for
     the signing→operator pairs. Idempotent guard (skip if author already has a canonical
     review).
   - **Accept loss.** The current reviews are test data (3 total) — if the team is fine
     re-posting, skip migration entirely and just deploy v2 + set aliases.

4. **Reputation / web-of-trust** carries over unchanged (it's per-author, subject-agnostic
   except via reviews).

## Frontend changes (after v2 is live)

- Repoint `MEMBA_DAO.reviewsPath` → `gno.land/r/samcrew/memba_reviews_v2`.
- **Retire the union-read bridge** in `ReviewsSection` (drop `aliasSubjects`; the realm now
  canonicalizes, so a single `subject` read suffices). Keep the optimistic-insert + rating
  hint + connecting guard — those are realm-independent.
- Gating: respect the existing `VITE_ENABLE_REVIEWS` flag and the `SAFETY_GATED_FLAGS`
  rules (don't flip prod env until v2 is deployed + migrated). See the prod-deploy notes in
  memory (Netlify-native, `assertSafeFlags`).

## Deploy sequence (team / multisig)

1. Author `memba_reviews_v2.gno` (v1 + the 3 additions above) in `samcrew-deployer`; port
   the v1 test suite + add canonicalization + migration tests; security review.
2. Deploy v2 to test13 (deployer / multisig).
3. Run the migration script: `ImportReview` for each v1 review, then `SetSubjectAlias` for
   `g1k7asng8… → g1n9y62…` (and any other known signing→operator pairs).
4. Verify reads under both addresses return the merged canonical set.
5. Repoint the frontend + retire the bridge (one PR, behind the flag).
6. Confirm on a deploy-preview, then enable in prod.

## Risks

- **Cross-realm coupling avoided** by the admin-alias approach (no hard dep on valopers).
- **Alias trust:** only the moderator multisig can set aliases — a wrong alias could merge
  two unrelated validators' reviews, so the migration script's pairs must be verified
  against `r/gnops/valopers` (operator↔signing) before signing.
- **Immutability:** v2 is itself immutable; get canonicalization + the admin surface right
  before deploy (no v3 do-over for a logic bug).

## Why the frontend bridge ships first

The bridge (union-read of operator + signing) makes the orphaned reviews visible **today**
with zero realm risk and is fully reversible. v2 is the clean long-term home; the bridge is
removed in step 5 above once v2 is live.
