# NFT Gallery — Activation Plan

> **Status:** Gated behind `VITE_ENABLE_NFT=true`
> **Current code:** `frontend/src/pages/NFTGallery.tsx` (fully implemented UI)
> **On-chain realm:** `nftTemplate.ts` generates GRC721 realms

## Overview

Browse, mint, and trade GRC721 NFTs on gno.land. The gallery discovers
NFT collections via seed addresses and on-chain `Render()` parsing.

## Prerequisites

1. **GRC721 standard finalized** — The GRC721 interface in Gno is still evolving.
   Current `grc721.ts` helpers may need updates when upstream stabilizes.
2. **Seed collections deployed** — `SEED_COLLECTIONS` in `NFTGallery.tsx` references
   `gno.land/r/demo/nft` which needs to exist on the target network.
3. **IPFS gateway** — NFT metadata images need a reliable IPFS gateway for rendering.

## Implementation Steps

### Phase 1 — Read-Only Gallery (enable the flag)
1. Verify `SEED_COLLECTIONS` are deployed on testnet
2. Test `grc721.ts` helpers against live chain data
3. Set `VITE_ENABLE_NFT=true` in production
4. Collection browsing with metadata display

### Phase 2 — Minting
1. Mint form component (collection selection, metadata, IPFS upload)
2. Integration with Adena wallet for MsgCall signing
3. Post-mint gallery refresh

### Phase 3 — DAO NFT Treasury
1. Display DAO-owned NFTs in Treasury page
2. NFT transfer proposals in DAO governance
3. Collection creation via DAO proposal

## Test Plan

- [ ] E2E test: gallery page renders seed collections
- [ ] Unit tests for GRC721 ABCI query parsing
- [ ] Test with missing/broken IPFS metadata (graceful fallback)
- [ ] Verify responsive layout on mobile viewports

## Rollout Criteria

- [ ] At least 1 GRC721 collection deployed and queryable on target network
- [ ] Gallery renders collection metadata without errors
- [ ] IPFS gateway configured and responsive
- [ ] All existing E2E tests pass with flag enabled
