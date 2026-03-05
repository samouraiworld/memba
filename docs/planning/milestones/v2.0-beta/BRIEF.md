# v2.0-β Board — Milestone Brief

> **Read `SESSION_CONVENTIONS.md` before starting this milestone.**

## Scope

| Feature | Branch | Priority |
|---------|--------|----------|
| Board realm code generator | `feat/v2.0-beta/board-realm-template` | 🟢 |
| Board ABCI parser + UI | `feat/v2.0-beta/board-ui` | 🟢 |
| DAO Factory integration | (same branch) | 🟡 |

## Acceptance Criteria

- [ ] `boardTemplate.ts` generates per-DAO board realm using `gno.land/p/gnoland/boards`
- [ ] Board realm includes `#general` channel (auto-created)
- [ ] Token-gated writes: `MembersViewExtension.IsMember()` check in board realm
- [ ] Board ABCI parser: `plugins/board/parser.ts` (threads, posts, replies from `vm/qrender`)
- [ ] Board UI: `plugins/board/BoardView.tsx` — channel view, thread list, new post form
- [ ] Markdown rendering for post bodies
- [ ] Board read access: public (anyone can read)
- [ ] Rate limiting in board realm: max N posts per block per member
- [ ] DAO Factory wizard Step 3: optional Board deployment checkbox
- [ ] Board realm naming: `{daoname}_board` suffix convention
- [ ] All tests pass, E2E for board interactions
- [ ] 11-perspective cross-audit documented

## Key Technical Details

### Board content format
- **Markdown** (native to Gno `Post.Body` — string field rendered as Markdown by `Render()`)
- No image upload — images via URL in Markdown only
- Title (string) + Body (Markdown string) per thread
- Replies: Body only (no title)

### Boards package strategy
- Pin to current commit at start of milestone
- Abstract behind `BoardAdapter` interface for upstream compatibility
- Monitor `gno.land/p/gnoland/boards` HEAD weekly

### Rate limiting (on-chain, in board realm)
```go
var lastPostBlock avl.Tree  // address → int64 (last block height)
const MIN_POST_INTERVAL = 5 // blocks between posts

func CreatePost(cur realm, channel, title, body string) {
    addr := runtime.PreviousRealm().Address()
    assertIsMember(addr)
    assertRateLimit(addr)  // panic if posted too recently
    // ...
}
```

## Estimated Effort
~10 development days

## Dependencies
- v2.0-α must be merged (plugin architecture required)
- `gno.land/p/gnoland/boards` (pinned commit)
- gnodaokit `MembersViewExtension`
