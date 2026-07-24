# Contract: MembaReviews.sol

## Purpose

MembaReviews is a subject-agnostic reputation/rating engine. Users post reviews (1-5 stars + text body) about any subject (validator, service, app), react (like/dislike), comment, flag for moderation, and edit/delete their own reviews. Reputation scores are aggregated per subject.

Port of the Gno `memba_reviews_v1` realm.

## Gno Source Reference

- **Realm**: `gno.land/r/samcrew/memba_reviews_v1` (deployed on test13, topaz-1)
- **Frontend**: `frontend/src/lib/reviews.ts` (371 lines, 15KB)
- **Key functions**: `PostReview(subject, rating, body)`, `EditReview(id, rating, body)`, `DeleteReview(id)`, `React(id, isLike)`, `Comment(reviewId, body)`, `Flag(id, reason)`
- **Subject-agnostic**: Same engine used for validator reviews and App Store reviews (different realm instances)

## Solidity Requirements

### Storage
```solidity
struct Review {
    uint256 id;
    string subject;              // subject identifier (address, pkg path, etc.)
    address author;
    uint8 rating;                // 1-5
    string body;
    uint256 createdAt;
    uint256 editedAt;
    bool deleted;
    uint256 likes;
    uint256 dislikes;
    uint256 flags;
}

struct Comment {
    uint256 id;
    uint256 reviewId;
    address author;
    string body;
    uint256 createdAt;
    bool deleted;
}

struct SubjectSummary {
    uint256 count;
    uint256 sum;                 // sum of ratings (for average = sum/count)
}
```

### Functions
| Function | Visibility | Description |
|---|---|---|
| `postReview(string subject, uint8 rating, string body)` | `external` | Post a review |
| `editReview(uint256 id, uint8 rating, string body)` | `external` | Edit own review |
| `deleteReview(uint256 id)` | `external` | Soft-delete own review |
| `react(uint256 id, bool isLike)` | `external` | Like or dislike |
| `comment(uint256 reviewId, string body)` | `external` | Add comment |
| `flag(uint256 id, string reason)` | `external` | Flag for moderation |
| `getReviews(string subject)` | `external view` | Reviews for subject |
| `getSummary(string subject)` | `external view` | Aggregated rating |
| `getReputation(address author)` | `external view` | Author reputation score |

### Test Cases (minimum: 10)
1. Post review → verify stored with correct rating/body/subject
2. Edit review → verify updated body/rating + editedAt timestamp
3. Delete review → soft deleted, excluded from summary
4. Only author can edit/delete → revert for others
5. React (like) → increment likes
6. React (dislike) → increment dislikes
7. Cannot react on own review → revert
8. Comment on review → verify stored
9. Flag review → increment flags
10. Subject summary → correct average rating

## Dependencies
- OZ v5: `UUPSUpgradeable`, `PausableUpgradeable`
