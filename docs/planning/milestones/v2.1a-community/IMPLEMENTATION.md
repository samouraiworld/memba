# v2.1a — Community Foundation (IMPLEMENTATION)

> **Status**: ✅ APPROVED — 2026-03-07
> **Author**: Antigravity CTO (session 2026-03-07)
> **BRIEF**: [BRIEF.md](BRIEF.md)

---

## Goal

Implement the Community Foundation layer for Memba: evolve Boards from a basic forum into Discord-like channels with role-based ACL, deploy the $MEMBA GRC20 token, wire up MembaDAO candidature-based onboarding with token airdrops, and add IPFS avatar support — all 100% on-chain-first.

## User Review Required

> [!IMPORTANT]
> **Gas Sponsorship** — Deferred to v2.1b per user decision. v2.1a requires Adena signing for each message. Gas sponsorship via treasury-funded relay will be designed in v2.1b BRIEF.

> [!WARNING]
> **IPFS Providers** — Both nft.storage and web3.storage will be implemented as providers behind the `IpfsPinClient` interface. The user will create accounts on both. Primary: nft.storage. Fallback: web3.storage. Both are free tier.

> [!CAUTION]
> **$MEMBA token strategy** — Two-phase deployment:
> - **Dev/test11**: Deploy `$MEMBATEST` token first (safe to iterate, throwaway)
> - **Production/betanet/mainnet**: Deploy real `$MEMBA` when going live
> - Params confirmed: 6 decimals, 10M supply, 40/30/20/10 allocation

---

## Proposed Changes

Changes are organized by feature track, then by layer (realm → lib → UI → backend → tests).

---

### Feature 1: Board v2 — Discord-like Channels

#### Realm Layer (code generator)

##### [MODIFY] [boardTemplate.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/boardTemplate.ts)

**Current**: Generates a minimal board realm with threads, replies, rate limiting, and admin-only channels. Uses `{daoname}_board` suffix. Membership check is incomplete (TODO: cross-realm import).

**Changes**:
1. **Rename convention**: `{daoname}_board` → `{daoname}_channels` (new suffix for v2 boards, keeps backward compat detection for old `_board` realms)
2. **Role-based ACL state**:
   ```gno
   type ChannelACL struct {
       ReadRoles  []string  // roles that can read (empty = public)
       WriteRoles []string  // roles that can write
   }
   ```
   Each `Channel` gains an `ACL ChannelACL` field.
3. **New Gno functions** (generated):
   - `SetChannelACL(cur realm, channel string, readRoles string, writeRoles string)` — admin only, comma-separated role lists
   - `ArchiveChannel(cur realm, name string)` — admin only, soft-delete (sets `archived = true`)
   - `ReorderChannels(cur realm, order string)` — admin only, comma-separated ordered channel names
   - `EditMessage(cur realm, channel string, threadID int, replyID int, newBody string)` — original author only, within 10 blocks
   - `DeleteMessage(cur realm, channel string, threadID int, replyID int)` — admin or original author
4. **$MEMBA write-gate**: Add `minTokenBalance` config field; if > 0, generated code checks `grc20factory.BalanceOf("MEMBA", caller) >= minTokenBalance` before allowing writes
5. **@mentions**: Store `@g1...` patterns in message body; new `GetMentions(channel, threadID)` returns mentioned addresses (parsed at query time in `Render()`)
6. **Channel types**: Add `channelType` field: `"text"` (default), `"announcements"` (admin-write-only), `"readonly"` (no writes)
7. Update `BoardConfig` interface to include the new fields

##### [NEW] [channelTemplate.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/channelTemplate.ts)

Dedicated channel realm generator — superset of `boardTemplate.ts`. Contains:
- `ChannelConfig` interface (extends `BoardConfig` with ACL, token-gate, channel types)
- `generateChannelCode(config)` — produces the enhanced `.gno` code
- `buildDeployChannelMsg()`, `buildSetACLMsg()`, `buildArchiveChannelMsg()`, `buildReorderChannelsMsg()`, `buildEditMessageMsg()`, `buildDeleteMessageMsg()`
- Keep `boardTemplate.ts` for backward compat (existing DAOs with `_board` suffix)

##### [MODIFY] [boardTemplate.test.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/boardTemplate.test.ts)

Add tests for:
- New `ChannelConfig` defaults
- ACL field generation
- Token-gate code generation
- Channel type rendering (announcements, readonly)

##### [NEW] [channelTemplate.test.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/channelTemplate.test.ts)

Full test suite for the new channel generator:
- Valid/invalid ACL configs
- Token-gate threshold validation
- @mention extraction in Render output
- Archive/reorder/edit/delete MsgCall builders
- Edge cases: empty roles, 0 token balance, max channel limit

---

#### Parser Layer

##### [MODIFY] [parser.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/plugins/board/parser.ts)

1. **New types**: `ChannelACL`, `ChannelType`, update `BoardChannel` to include `acl`, `type`, `archived` fields
2. **New parser**: `parseMentions(body: string): string[]` — extracts `@g1...` addresses
3. **Update `parseBoardHome`**: Parse new ACL/type info from enhanced Render output
4. **New query**: `getChannelACL()` — queries `Render("__acl/{channel}")` for ACL config
5. Maintain backward compat: detect old `_board` vs new `_channels` format

##### [MODIFY] [board.test.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/plugins/board/board.test.ts)

Add tests for ACL parsing, mention extraction, archive detection, backward-compat paths

---

#### UI Layer (Board v2 Plugin)

##### [MODIFY] [BoardView.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/plugins/board/BoardView.tsx)

**Major refactor** — split the 496-line monolith into composable views:

1. **Channel sidebar**: Discord-like vertical channel list with `#` prefix, unread indicators, channel type icons (📢 announcements, 🔒 readonly, 💬 text)
2. **Message composer**: Markdown editor with `@mention` autocomplete (searches DAO member list), character counter, $MEMBA balance indicator
3. **Message actions**: Edit (pencil icon, inline edit mode), Delete (trash, confirm modal), Quote-reply
4. **ACL feedback**: "You don't have write access to this channel" banner for restricted channels
5. **Unread tracking**: Evolve `getLastVisited()` to per-message granularity using block heights

##### [NEW] [ChannelSidebar.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/plugins/board/ChannelSidebar.tsx)

Extracted component — vertical channel list:
- `#channel-name` labels with type icons
- Unread dot indicator
- "Manage Channels" button (admin-only)
- Drag-to-reorder (dispatches `ReorderChannels` MsgCall)
- CSS: Discord-inspired dark sidebar (~200px wide)

##### [NEW] [MessageComposer.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/plugins/board/MessageComposer.tsx)

Rich message input:
- Markdown preview toggle
- `@mention` autocomplete (queries DAO member list)
- File attachment placeholder (future: IPFS)
- $MEMBA balance badge (shows "Requires X $MEMBA to post" if below threshold)
- Character limit indicator (8192 for threads, 4096 for replies)

##### [NEW] [ChannelManageModal.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/plugins/board/ChannelManageModal.tsx)

Admin channel management:
- Create channel form (name + type + ACL roles)
- Edit channel (rename, change type, update ACL)
- Archive channel (soft-delete with confirmation)
- Role assignment per channel (checkboxes from DAO role list)

---

#### Plugin Registry

##### [MODIFY] [registry.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/plugins/registry.ts)

Update board plugin entry:
- Version: `1.0.0` → `2.0.0`
- Name: `"Board"` → `"Channels"`
- Icon: `"💬"` → `"💬"` (keep)
- Description: `"Discord-like channels — async messaging, ACL, @mentions"`
- Discovery: check both `_channels` and `_board` realm existence for backward compat

---

### Feature 2: $MEMBA GRC20 Token

#### Configuration

##### [MODIFY] [config.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/config.ts)

Add new section 8:
```typescript
// ── 8. MembaDAO Token ────────────────────────────────────────
export const MEMBA_TOKEN_DEV = {
    symbol: "MEMBATEST",
    name: "Memba Governance Token (Testnet)",
    decimals: 6,
    totalSupply: "10000000000000", // 10M * 10^6
    factoryPath: GRC20_FACTORY_PATH,
} as const

export const MEMBA_TOKEN_PROD = {
    symbol: "MEMBA",
    name: "Memba Governance Token",
    decimals: 6,
    totalSupply: "10000000000000",
    factoryPath: GRC20_FACTORY_PATH,
} as const

/** Active token config — MEMBATEST for dev, MEMBA for production. */
export const MEMBA_TOKEN = import.meta.env.PROD
    ? MEMBA_TOKEN_PROD
    : MEMBA_TOKEN_DEV

export const MEMBA_DAO = {
    realmPath: "gno.land/r/samcrew/memba_dao",
    channelsPath: "gno.land/r/samcrew/memba_dao_channels",
    deployFee: 10_000_000, // 10 GNOT in ugnot
} as const
```

##### [MODIFY] [grc20.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/grc20.ts)

1. **Update fee**: `calculateFee()` → change from 5% to 2.5% (as per BRIEF)
2. **New helper**: `buildCreateMembaTokenMsgs()` — specialized builder that uses `MEMBA_TOKEN` config
3. **Token lock**: `buildSetTransferLockMsg()` — MsgCall to a new realm function that locks transfers for N days
4. **Balance query**: `getMembaBalance(rpcUrl, address)` — convenience wrapper

##### [MODIFY] [grc20.test.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/grc20.test.ts)

Add tests for 2.5% fee, Memba token builders, transfer lock msg

---

#### Token UI

##### [NEW] [MembaTokenCard.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/components/memba/MembaTokenCard.tsx)

Dashboard card showing:
- $MEMBA balance
- Token allocation pie chart (40/30/20/10)
- Lock status indicator
- "View on Explorer" link

##### [MODIFY] [TokenView.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/pages/TokenView.tsx)

Add MembaDAO-specific section: allocation breakdown, vesting schedule visualization, governance power indicator

---

### Feature 3: MembaDAO Candidature Flow

#### Realm Layer

##### [NEW] [candidatureTemplate.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/candidatureTemplate.ts)

Generates `memba_dao_candidature` realm code:
```gno
type Candidature struct {
    Applicant   std.Address
    Name        string
    Philosophy  string   // "Why Memba?"
    Skills      string   // comma-separated
    Status      string   // "pending", "approved", "rejected"
    ApprovedBy  []std.Address
    CreatedAt   int64
}
```
Functions:
- `SubmitCandidature(cur realm, name, philosophy, skills string)` — public, 1 per address
- `ApproveCandidature(cur realm, applicant string)` — DAO member only, 2 approvals needed
- `RejectCandidature(cur realm, applicant string)` — admin only
- `GetCandidatures()` — returns all pending
- `Render(path)` — displays candidature list / detail

On approval (2nd member approves):
- Auto-add applicant to DAO members (cross-realm call to parent DAO)
- Auto-airdrop 10 $MEMBA from community allocation (cross-realm call to GRC20)
- Set 90-day transfer lock on airdropped tokens

##### [NEW] [candidatureTemplate.test.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/candidatureTemplate.test.ts)

Tests for:
- Valid/invalid candidature submission
- Approval flow (requires exactly 2 unique members)
- Rejection by admin
- Duplicate submission prevention
- Airdrop msg generation
- Transfer lock msg generation

---

#### Candidature UI

##### [NEW] [CandidaturePage.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/pages/CandidaturePage.tsx)

Public-facing candidature form:
- Identity fields: Display Name, Philosophy ("Why Memba?"), Skills (multi-select tags)
- Wallet connection required
- Preview card showing how the candidature will look to DAO members
- Submit button → `SubmitCandidature` MsgCall via Adena
- Confirmation: "Your candidature is pending review by 2 MembaDAO members"

##### [NEW] [CandidatureReview.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/components/memba/CandidatureReview.tsx)

DAO member-only review panel (embedded in MembaDAO home):
- List of pending candidatures with applicant info
- "Approve" / "Reject" actions
- Approval count indicator (1/2, 2/2)
- History of approved/rejected candidatures

##### [MODIFY] [DAOHome.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/pages/DAOHome.tsx)

Add conditional rendering: if current DAO is MembaDAO (`realmPath === MEMBA_DAO.realmPath`), show the `CandidatureReview` panel in the overview section.

---

#### Routing

##### [MODIFY] [App.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/App.tsx)

Add route:
```tsx
<Route path="/memba/join" element={<CandidaturePage />} />
```

---

### Feature 4: IPFS Avatars

#### IPFS Client

##### [NEW] [ipfs.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/ipfs.ts)

Provider-agnostic IPFS pinning client:
```typescript
export interface IpfsPinClient {
    pin(file: File): Promise<string>  // returns CID
    getUrl(cid: string): string       // returns gateway URL
}

export function createNftStorageClient(apiKey: string): IpfsPinClient
export function createWeb3StorageClient(apiKey: string): IpfsPinClient
export function getIpfsGatewayUrl(cid: string): string  // ipfs.io gateway
```

Image preprocessing:
- Resize to 256×256 max before upload
- Convert to WebP for size optimization
- File size cap: 512KB
- MIME validation: image/jpeg, image/png, image/webp, image/gif

##### [NEW] [ipfs.test.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/ipfs.test.ts)

Tests for:
- Image resize logic (canvas mock)
- MIME validation  
- CID URL generation
- Error handling (network failure, size exceeded)

---

#### Profile Integration

##### [MODIFY] [ProfilePage.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/pages/ProfilePage.tsx)

1. Add avatar upload zone in edit mode: click to upload, preview circle, "Change Avatar" label
2. Upload flow: select image → resize to 256×256 → pin to IPFS → save CID to profile via backend
3. Display: if `avatarUrl` starts with `ipfs://` or is a CID, resolve via IPFS gateway
4. Fallback: keep existing Jazzicon/gradient for users without avatar

##### [MODIFY] [profile_rpc.go](file:///Users/zxxma/Desktop/Code/Gno/Memba/backend/internal/service/profile_rpc.go)

Add `avatar_cid` field to profile storage. Validate CID format on update (bafybeig... pattern).

---

#### Avatar Component

##### [NEW] [Avatar.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/components/ui/Avatar.tsx)

Reusable avatar component:
```tsx
<Avatar address="g1..." cid="bafybei..." size={40} />
```
- If `cid` provided: render IPFS image via gateway
- If no `cid`: render Jazzicon deterministic from address
- Loading skeleton: circular shimmer
- Error fallback: gradient circle with first 2 chars of address

##### [NEW] [AvatarUpload.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/components/ui/AvatarUpload.tsx)

Upload component for profile edit:
- Dropzone / click-to-select
- Image preview (cropped circle)
- Upload progress indicator
- IPFS CID display after successful pin

---

### Feature 5: MembaDAO Bootstrap

##### [NEW] [membaDAO.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/membaDAO.ts)

MembaDAO configuration and deployment orchestration:
```typescript
export const MEMBA_DAO_CONFIG: DAOCreationConfig = {
    name: "MembaDAO",
    description: "The governing DAO of the Memba platform",
    realmPath: MEMBA_DAO.realmPath,
    members: [{ address: ZOOMA_ADDRESS, power: 1, roles: ["admin"] }],
    threshold: 66,
    quorum: 50,
    roles: ["admin", "dev", "ops", "member"],
    proposalCategories: ["governance", "treasury", "membership", "operations"],
}

export const MEMBA_CHANNELS: string[] = [
    "general",
    "announcements",       // admin-write-only
    "feature-requests",
    "support",
    "extensions",
    "partnerships",
]
```

Functions:
- `deployMembaDAO()` — orchestrates full deployment (DAO → channels → candidature realms)
- `getMembaDAOStatus()` — checks which components are deployed
- `isMembaDAOMember(rpcUrl, address)` — ABCI query

---

### ~~Feature 6: Gas Sponsorship~~ → Deferred to v2.1b

---

### Cross-Cutting: Documentation & Config

##### [MODIFY] [CHANGELOG.md](file:///Users/zxxma/Desktop/Code/Gno/Memba/CHANGELOG.md)

Add v2.1a section with all features

##### [MODIFY] [ROADMAP.md](file:///Users/zxxma/Desktop/Code/Gno/Memba/ROADMAP.md)

Update v2.1a status to ✅

##### [MODIFY] [MASTER_ROADMAP.md](file:///Users/zxxma/Desktop/Code/Gno/Memba/docs/planning/MASTER_ROADMAP.md)

Update milestone #9 status, quality gates, key decisions

##### [MODIFY] [index.css](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/index.css)

Add CSS variables and classes for:
- Channel sidebar (dark sidebar panel, `#channel-name` styling)
- Message composer (markdown editor, mention chip)
- Avatar components (circle, skeleton, upload zone)
- Candidature card styles

---

## Feature Branches

| Branch | Scope |
|--------|-------|
| `feat/v2.1a-channel-realm` | Feature 1: Channel realm code gen + parser + UI |
| `feat/v2.1a-memba-token` | Feature 2: $MEMBATEST token config + GRC20 helpers |
| `feat/v2.1a-candidature` | Feature 3: Candidature flow (realm + UI) |
| `feat/v2.1a-ipfs-avatars` | Feature 4: IPFS client (nft.storage + web3.storage) + avatar components |
| `feat/v2.1a-memba-bootstrap` | Feature 5: MembaDAO config + channels + deployment |

All branches squash-merge to `dev/v2`. NEVER push to `main`.

---

## Verification Plan

### Automated Tests

#### Unit Tests (existing + new)

```bash
# Run full unit test suite (must stay at 360+ passing)
cd /Users/zxxma/Desktop/Code/Gno/Memba/frontend && npm test -- --run
```

New test files to add (target: +75 tests):
- `channelTemplate.test.ts` — ~25 tests (realm code gen, ACL, token-gate, channel types)
- `candidatureTemplate.test.ts` — ~15 tests (submission, approval, rejection, airdrop)
- `ipfs.test.ts` — ~10 tests (resize, MIME, CID, errors, both providers)
- `grc20.test.ts` additions — ~10 tests (2.5% fee, MEMBATEST builders, lock)
- `board.test.ts` additions — ~10 tests (ACL parsing, mentions, archive detect)
- `registry.test.ts` additions — ~5 tests (updated board manifest, backward compat)

#### E2E Tests (existing + new)

```bash
# Run full E2E suite (must stay at 186+ passing)
cd /Users/zxxma/Desktop/Code/Gno/Memba/frontend && npx playwright test --reporter=list
```

New E2E additions:
- `e2e/channels.spec.ts` — navigate to channels plugin, verify sidebar, send message, verify @mention
- `e2e/candidature.spec.ts` — visit /memba/join, fill form, submit (mock)
- `e2e/avatar.spec.ts` — profile edit, avatar upload zone visible, fallback display

#### TypeScript + Lint + Build

```bash
cd /Users/zxxma/Desktop/Code/Gno/Memba/frontend && npx tsc --noEmit  # 0 errors
cd /Users/zxxma/Desktop/Code/Gno/Memba/frontend && npm run lint       # 0 errors
cd /Users/zxxma/Desktop/Code/Gno/Memba/frontend && npm run build      # clean, < 500KB
```

#### Backend

```bash
cd /Users/zxxma/Desktop/Code/Gno/Memba/backend && go test -race -count=1 ./...
cd /Users/zxxma/Desktop/Code/Gno/Memba/backend && go build ./...
```

### Manual Verification

1. **Channel UI smoke test**: Navigate to any DAO → Channels tab → verify sidebar renders, click channel, verify thread list, compose & preview a message
2. **Avatar upload**: Go to Profile → Edit → upload an image → verify IPFS CID is generated → verify avatar renders in profile and DAO member lists
3. **Candidature page**: Navigate to `/memba/join` → verify form renders with all fields → submit with wallet connected
4. **MembaDAO detection**: Navigate to MembaDAO home → verify candidature review panel appears for members → verify token card shows balance

> [!TIP]
> Defer to the user for live on-chain verification (deploying realms to test11) since it requires wallet signing and GNOT tokens.

---

## Execution Order

1. **Feature 1** (Channel Realm) — foundation for everything else
2. **Feature 4** (IPFS Avatars) — independent, small, shippable alone
3. **Feature 2** ($MEMBATEST Token) — needed before candidature
4. **Feature 3** (Candidature Flow) — depends on token + channels
5. **Feature 5** (MembaDAO Bootstrap) — ties it all together

Estimated total: ~3 weeks as stated in BRIEF.
