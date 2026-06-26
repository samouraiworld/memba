# Memba Reviews / Web-of-Trust Realm — Design Spec

**Status:** Design APPROVED by user (2026-06-26). Spec-first; **no on-chain code until a security review passes**. Next step: `writing-plans` → implementation plan → build → security review → deploy via samcrew-deployer → wire frontend → flag.

**Origin:** Plan §12 "P3" (the last open item of the profile-pages feature). Brainstormed 2026-06-26. Supersedes the earlier "interactor-gated" framing (see §0).

---

## 0 · What changed from the original idea (read this first)

The original §12 framing was **interactor-gated**: only addresses that had interacted on-chain with a subject could review it. **The user explicitly dropped that.** Reviews are now **open to everyone** (Google-Maps style): you can rate/review any subject whether or not you ever transacted with them (e.g. "watched their monitoring, they're frequently down → 3/5"). **Trust is earned over time** through the reviewer's reputation — it weights/ranks which reviews are surfaced, it does **not** gate who can post.

A gno realm is deterministic and **cannot scan chain history or query an indexer**, so on-chain "did X interact with Y" was infeasible anyway — but the decision is a product choice, not a constraint workaround.

## 1 · Purpose & scope

An **open, on-chain rating + review system** for any Memba profile subject: validators, candidates, individuals, and orgs/DAOs. Anyone (connected wallet) can post one editable review per subject, react (like/dislike), and reply. An emergent **reputation layer** + a **verified-username badge** form the web of trust. **Hybrid moderation** (author delete + community flag + multisig hide) handles abuse on a permanent medium.

**In scope (v1):** the realm + frontend wiring of the existing `ReviewsSection` placeholder (currently "launching soon" in `ValidatorProfile.tsx` and `ProfilePage.tsx`).
**Out of scope (v1):** backend cache/indexer (add only if a single subject ever gets hundreds of reviews), nested/threaded replies beyond one level, notifications.

## 2 · Decisions (locked with user)

| Decision | Choice |
|---|---|
| Posting eligibility | **Open** — any connected wallet, no interaction proof |
| Trust model | **Hybrid**: reputation (net likes over time) drives ranking **+** verified-`@username` badge |
| Moderation | **Hybrid**: author edit/delete + community `Flag` + **multisig `Hide`** (soft-delete) |
| Architecture | **Fully on-chain** realm (running reputation counter) + **RPC reads** + client-side sort; no new backend in v1 |
| Storage | **On-chain** (immutable text; `hidden` flag omits from reads) |
| Subject key | Generic string: `g1…` address (validator/candidate/individual) **or** realm path (org/DAO, e.g. `gno.land/r/samcrew/memba_dao`) |
| Rating | **Required** 1–5 stars; body **optional** |
| Reactions | like/dislike, one per (account, target), toggleable; targets = reviews **and** comments |
| Replies | flat, one level (v1) |
| Self-likes | **Disallowed** (reputation integrity) |
| Writes | **User-signed via Adena** (non-custodial), always |

## 3 · On-chain data model (realm state)

```
Review {
  id           uint64
  subject      string        // g1… address OR realm path
  author       std.Address   // std.PreviousRealm().Address()
  rating       uint8         // 1..5 (required)
  body         string        // optional, immutable once posted (edit replaces)
  createdAt    int64         // block time
  editedAt     int64
  hidden       bool          // multisig soft-delete
  likes        uint64
  dislikes     uint64
  flagCount    uint64
}
Comment {
  id, reviewID, author, body, createdAt, editedAt, hidden, likes, dislikes, flagCount
}
Reaction:  (account, targetID) -> {none|like|dislike}   // one per account per target
Flag:      (account, targetID) -> bool                  // one per account per target
Reputation: author std.Address -> int64                 // running Σ(likes − dislikes) on their reviews+comments; may be negative
Indexes:   subject -> []reviewID ;  reviewID -> []commentID
moderators: the existing Memba multisig address (constructor/owner-set)
```

**Invariant:** at most one `Review` per `(author, subject)`. `PostReview` on an existing pair updates in place (the "editable" requirement). Reputation is updated **only** by `React` (O(1)); never trusts caller input.

## 4 · Realm API (exported functions)

**Writes** (caller = `std.PreviousRealm().Address()`):
- `PostReview(subject string, rating uint8, body string)` — create or replace caller's review for `subject`. Validates `1<=rating<=5`.
- `EditReview(reviewID uint64, rating uint8, body string)` — author-only.
- `DeleteReview(reviewID uint64)` — author-only.
- `React(targetID uint64, kind string)` — `"like"|"dislike"` on a review or comment; toggles (re-react removes / switches); updates target counters **and** the target author's `Reputation`. **Rejects self-reaction.**
- `Comment(reviewID uint64, body string)` / `EditComment` / `DeleteComment` (author-only).
- `Flag(targetID uint64)` — one per account; raises `flagCount` (moderation signal).
- `HideReview(id)` / `HideComment(id)` / `Unhide(id)` — **multisig-only** (asserts caller == moderator multisig).

**Reads** (`Render(path)` for gnoweb + machine-readable query funcs via RPC `qeval`):
- `GetReviews(subject string, offset, limit int) []Review` — paginated, excludes `hidden` by default.
- `GetComments(reviewID uint64, offset, limit int) []Comment`.
- `GetReputation(addr std.Address) int64`.
- `GetFlagged(offset, limit int)` — moderation dashboard (flagged + visible).
All list funcs **paginated** to bound gas/response size (DoS guard).

## 5 · Trust / web-of-trust (frontend)

- **Ranking:** a subject's reviews sorted by author `Reputation` desc, then recency. Computed client-side (v1 volumes are small).
- **Verified badge:** each author address → resolve `r/sys/users` `@username` (reuse existing `lib/profile.ts` / profile resolution). Show a "verified" badge + the username when present.
- **Per-review display:** stars, body, author (username or truncated addr + reputation), like/dislike counts + toggle, reply control, flag control, "edited" marker, and (for the author) edit/delete; (for multisig) hide/unhide.
- **Summary:** average rating + count at the top of the Reviews section.

## 6 · Anti-spam / sybil

- One review per (author, subject) → can't flood a subject.
- One reaction per (account, target) → no like-stuffing a single review.
- **Gas per write** (every action is a signed tx) → natural rate limit + sybil cost.
- Reputation can go **negative** → bad actors sink below the fold.
- Self-likes disallowed.
- Residual risk: a determined attacker can spin up many funded accounts to like their own content via *other* accounts. Mitigated (not eliminated) by gas cost, visible reviewer identity/reputation, and the verified-badge weighting. Accepted for v1; revisit if abused.

## 7 · Frontend integration

- New `frontend/src/lib/reviews.ts`: types; reads (RPC `qeval` to the query funcs, parsed) ; writes (Adena tx to the realm funcs, via the existing tx helper); reputation + verified-username join.
- Replace the `ReviewsSection` placeholder in `ValidatorProfile.tsx` (and the equivalent in `ProfilePage.tsx`) with the live UI from §5. Connect-wallet gate on the write form (read is public).
- Gate the whole feature behind **`VITE_ENABLE_REVIEWS`** (default off; note the build-time safety gate / `assertSafeFlags` — only flip on after the realm is live + reviewed).

## 8 · Deployment & SECURITY (mandatory gate)

- New realm package, e.g. `gno.land/r/samcrew/memba_reviews_v1`, deployed via **samcrew-deployer** (gno paths are immutable → version the path).
- The moderator multisig address is set at construction (reuse the existing Memba multisig).
- **Security review BEFORE deploy (hard requirement):**
  - **Auth:** author-only on edit/delete; multisig-only on hide/unhide (assert exact moderator addr); caller via `std.PreviousRealm().Address()` (not a passed-in param).
  - **Reputation integrity:** updated only inside `React`; self-react rejected; toggling correctly reverses prior delta; no path lets a caller set reputation directly; overflow/underflow safe (int64).
  - **Gas / DoS:** all list reads paginated; no unbounded loops in writes; map growth acceptable.
  - **Immutability / legal:** body is permanent on-chain; `Hide` is the only takedown (omits from reads, can't erase) — document this for users; ensure the multisig can always hide.
  - **Input limits:** cap `body`/`comment` length; validate `rating` range; sanitize on render (frontend already DOMPurifies markdown).
  - Run the Samourai Gno Security Guard analyzer + a manual review pass; capture findings before deploy.

## 9 · Build order (for writing-plans)

1. Realm package + unit tests (gno) — model, API, auth, reputation, pagination.
2. Security review (analyzer + manual) → fix → re-review.
3. Deploy to test13 via samcrew-deployer (versioned path).
4. `lib/reviews.ts` (reads first, then Adena writes) + tests.
5. Wire `ReviewsSection` (ValidatorProfile + ProfilePage) behind `VITE_ENABLE_REVIEWS`.
6. Live-verify on a deploy-preview against the deployed realm; flip the flag.

## 10 · Open sub-points (recommended defaults, user can override at plan time)

- Body length cap: ~2000 chars; comment cap ~1000. (Pick at plan time.)
- Delete = hard delete vs tombstone: **tombstone** (keep id, clear body, mark deleted) to keep comment threads coherent. (Confirm at plan time.)
- Whether comments count toward reputation: **yes** (reactions on comments also move the comment author's reputation).
