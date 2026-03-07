# v2.1a — Community Foundation (BRIEF)

> **Status**: ⬜ PLANNED | **Effort**: ~3 weeks | **Depends on**: v2.0-θ (✅)
> **Branch**: `feat/v2.1a-*` → `dev/v2`

---

## Objective

Build the **community layer** for Memba: Discord-like on-chain channels, $MEMBA GRC20 token, MembaDAO with candidature-based onboarding, and IPFS avatars.

## Scope

### ✅ In Scope

1. **Board v2 — Discord-like Channels**
   - New channel realm architecture (`{dao}_channels`)
   - Role-based read/write ACL (admin-configurable, like Discord)
   - 100% on-chain async messaging (Markdown, timestamps, author)
   - Gas sponsorship: abstract signing friction, DAO treasury or Memba sponsors tx costs
   - $MEMBA write-gate (minimum balance to post, anti-spam)
   - @mentions with notification triggers
   - Channel management UI (create/edit/archive/reorder/permissions)

2. **MembaDAO Setup**
   - $MEMBA GRC20 token deployment (10M initial supply)
   - Token allocation: 40% treasury, 30% community, 20% core team (4yr vest), 10% partnerships
   - Candidature flow: form (identity/philosophy/skills) → public DAO proposal → 2-member approval → 10 $MEMBA airdrop
   - 90-day transfer lock on airdropped tokens
   - Enterprise roles: Admin (zôÖma), Dev, Ops, Member — editable
   - Community channels: #General #Announcements(admin-write) #FeatureRequests #Support #Extensions #Partnerships
   - Extension Hub curation: MembaDAO votes on "Official" badge, others = "Untrusted"

3. **IPFS Avatars**
   - nft.storage / web3.storage client-side pinning (no backend)
   - Profile edit flow: upload image → pin to IPFS → store CID as avatarUrl
   - Fallback: Jazzicon/gradient for users without avatar

### ❌ Non-Goals (v2.1a)

- Audio/Video rooms (v3.5)
- Validator Dashboard (v2.1b)
- Notification Center (v2.1b)
- Gasless Onboarding faucet (v2.1b)
- Payroll, Bounties, Analytics (v2.2+)
- NFT marketplace (v3.0)

## Acceptance Criteria

- [ ] Any DAO can create text channels with role-based permissions
- [ ] Messages are 100% on-chain with gas abstracted from UX
- [ ] $MEMBA token exists on Gno with correct allocation
- [ ] Users can submit a candidature to MembaDAO
- [ ] 2-member approval triggers 10 $MEMBA airdrop with 90-day lock
- [ ] MembaDAO has 6 standard channels with correct permissions
- [ ] Profile avatars can be uploaded to IPFS and displayed everywhere
- [ ] All existing tests still pass (360+ unit, 93+ E2E)
- [ ] New features have unit tests + E2E coverage
- [ ] 11-perspective AUDIT.md completed
- [ ] CHANGELOG.md, ROADMAP.md, MASTER_ROADMAP.md updated

## Dependencies

| Dependency | Status | Impact |
|-----------|--------|--------|
| `r/sys/users` migration | 🟡 Pending | May need to update `getUserRegistryPath()` configs |
| gnodaokit `basedao` | ✅ Available | Used for DAO creation + member management |
| nft.storage API | ✅ Available | Free IPFS pinning, client-side |

## Technical Risk

| Risk | Mitigation |
|------|-----------|
| Gas sponsorship complexity on Gno | Research `MsgRun` proxy pattern or treasury-funded relay |
| 100% on-chain chat could be expensive | Rate limit by $MEMBA balance + gas caps |
| nft.storage may have size limits | Enforce image resize to 256×256 before upload |
| Channel ACL on-chain is complex | Start with simple role→channel mapping, iterate |
