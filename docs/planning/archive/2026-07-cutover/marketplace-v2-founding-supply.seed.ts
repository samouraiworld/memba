// Memba Marketplace — Founding-Supply Seed Catalog
// -------------------------------------------------
// Curated template listings for the three marketplace lanes (NFT / Services / Tokens).
// These drive design fixtures now and convert to real on-chain listings at launch.
//
// Fees (informational, enforced on-chain by the marketplace realm, not stored here):
//   NFT      2%
//   Services 2%  (+5% cancellation fee routed to the freelancer)
//   Tokens   0.5% OTC block fills
//
// Prices are denominated in GNOT. Sellers are gno.land addresses (g1...) with a human handle.
// Reviews are purchase-gated on-chain, so `rating`/`reviewsCount` are intentionally null here.
// `seedTier` is a curation shelf (founding/featured/standard), NOT a review signal.
// `verified` / `foundingCreator` are curation flags applied by Memba, NOT usage signals.

export type Lane = 'nft' | 'service' | 'token';
export type SeedTier = 'founding' | 'featured' | 'standard'; // curation shelf, NOT a review signal

interface SeedSellerRef {
  handle: string;
  address: string;
  verified: boolean;
  foundingCreator?: boolean;
}

interface SeedBase {
  id: string; // stable slug, e.g. 'nft-gnomes-genesis'
  lane: Lane;
  title: string;
  category: string; // from the taxonomy below
  tagline: string; // one punchy line
  description: string; // 2-4 sentences, credible + aspirational
  seller: SeedSellerRef;
  tags: string[];
  seedTier: SeedTier;
  media: { kind: 'art' | 'monogram'; artHint?: string; monogramSeed?: string };
  // monogram = deterministic gradient tile keyed by monogramSeed (the sanctioned hardcoded-color exception);
  // art = a described real image (artHint = 1-line description a designer/generator could realize)
}

export interface SeedNft extends SeedBase {
  lane: 'nft';
  collectionName: string;
  floorGnot: number;
  volumeGnot: number;
  itemCount: number;
  royaltyBps: number; // <=1000 (10% cap)
  sampleTraits?: { trait: string; value: string }[];
  rating: null;
  reviewsCount: null;
}

export interface SeedService extends SeedBase {
  lane: 'service';
  gigTitle: string; // Fiverr-style "I will <do X>"
  sellerLevel: 'New' | 'Level 1' | 'Level 2' | 'Top Rated'; // curation, seed only
  packages: {
    name: 'Basic' | 'Standard' | 'Premium';
    priceGnot: number;
    deliveryDays: number;
    revisions: number | 'unlimited';
    summary: string;
  }[];
  skills: string[];
  rating: null;
  reviewsCount: null;
}

export interface SeedToken extends SeedBase {
  lane: 'token';
  symbol: string;
  amountAvailable: number;
  unitPriceGnot: number;
  minFillAmount: number;
  whyOtc: string; // why OTC beats an AMM here (size / price-certainty / launch allocation / vesting)
  vesting?: string; // e.g. '6-month linear', or omit
  rating: null;
  reviewsCount: null;
}

// ============================================================================
// NFT LANE — 12 listings (fee 2%)
// ============================================================================

export const seedNfts: SeedNft[] = [
  {
    id: 'nft-gnomes-genesis',
    lane: 'nft',
    title: 'Gnomes Genesis',
    category: 'PFPs & Avatars',
    tagline: 'The founding faces of the Gno commons.',
    description:
      'Gnomes Genesis is the first hand-crafted PFP set for the gno.land community — 512 pointy-hatted characters assembled from layered on-chain traits and rendered as grc721 tokens. Holding a Genesis Gnome flags you as an early builder in the realm directory and unlocks the founder channel in Memba. Traits are pinned and provenance is verifiable end-to-end on test13.',
    seller: {
      handle: 'gnomeworks',
      address: 'g1gn0mewrks7pfp5aht2qc9djv0zra84mkxw3rf6t',
      verified: true,
      foundingCreator: true,
    },
    tags: ['pfp', 'grc721', 'founder', 'avatar', 'gno-native'],
    seedTier: 'founding',
    media: {
      kind: 'art',
      artHint:
        'Vector PFP of a pointy-hatted gnome with a circuit-etched beard, three-quarter portrait on a soft radial backdrop.',
    },
    collectionName: 'Gnomes Genesis',
    floorGnot: 24,
    volumeGnot: 0,
    itemCount: 512,
    royaltyBps: 500,
    sampleTraits: [
      { trait: 'Hat', value: 'Validator Crimson' },
      { trait: 'Beard', value: 'Circuit Etched' },
      { trait: 'Aura', value: 'Testnet Glow' },
    ],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'nft-onchain-lattice',
    lane: 'nft',
    title: 'Lattice — Fully On-Chain Generative',
    category: 'On-chain/Generative Art',
    tagline: 'Every pixel computed by the realm, nothing pinned off-chain.',
    description:
      'Lattice is a generative series whose artwork is produced deterministically inside a Gno realm — the token id seeds a flow-field renderer that emits SVG at read time, so there is no IPFS dependency and no server to trust. Each of the 256 outputs is unique, reproducible forever, and survives as long as the chain does. A reference implementation of on-chain art the ecosystem can fork.',
    seller: {
      handle: 'deterministic',
      address: 'g1d3term1n1st1cv3ct0r9art7flow5f13ld8xk2q',
      verified: true,
      foundingCreator: true,
    },
    tags: ['generative', 'fully-onchain', 'svg', 'realm-rendered', 'gno-native'],
    seedTier: 'founding',
    media: {
      kind: 'art',
      artHint:
        'Monochrome flow-field of thousands of thin curved strokes forming a lattice knot, plotter-style on off-white.',
    },
    collectionName: 'Lattice',
    floorGnot: 40,
    volumeGnot: 0,
    itemCount: 256,
    royaltyBps: 750,
    sampleTraits: [
      { trait: 'Field', value: 'Perlin Drift' },
      { trait: 'Density', value: 'High' },
      { trait: 'Palette', value: 'Ink on Bone' },
    ],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'nft-cartography-1of1',
    lane: 'nft',
    title: 'Cartography of a Testnet',
    category: 'Art',
    tagline: 'A 1/1 map of everywhere the chain has been.',
    description:
      'A single-edition digital painting that renders the transaction topology of test13 as a hand-inked coastline — validators as harbors, realms as inland cities, bridges as trade routes. Signed by the artist and delivered as a high-resolution grc721 with an archival print redeemable on transfer. A collector piece for anyone who was here early.',
    seller: {
      handle: 'inkmaps',
      address: 'g1inkm4ps9c4rt0gr4phy1of1p41nt3r6zw8t2q5xn',
      verified: true,
    },
    tags: ['1-of-1', 'fine-art', 'illustration', 'collector', 'physical-redeem'],
    seedTier: 'featured',
    media: {
      kind: 'art',
      artHint:
        'Antique-style ink map with harbors and trade routes labeled in tiny serif type, sepia parchment texture.',
    },
    collectionName: 'Cartography',
    floorGnot: 480,
    volumeGnot: 0,
    itemCount: 1,
    royaltyBps: 1000,
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'nft-nightshift-photo',
    lane: 'nft',
    title: 'Night Shift — Street Photography',
    category: 'Photography',
    tagline: 'Twelve cities after midnight, editioned small.',
    description:
      'Night Shift is a curated photo series of neon-lit streets shot on 35mm and editioned to 25 prints each. Every token carries embedded EXIF provenance and a signed capture statement, so provenance travels with the image. Understated, collectible, and priced for the wall as much as the wallet.',
    seller: {
      handle: 'lux.after.dark',
      address: 'g1lux4ft3rd4rk9str33t7ph0t039mm5n1ght2sh8f',
      verified: false,
    },
    tags: ['photography', '35mm', 'editions', 'street', 'exif-provenance'],
    seedTier: 'standard',
    media: {
      kind: 'art',
      artHint:
        'Rain-slick neon crosswalk at night, long-exposure light trails, single figure with umbrella, cinematic teal-magenta.',
    },
    collectionName: 'Night Shift',
    floorGnot: 8,
    volumeGnot: 0,
    itemCount: 300,
    royaltyBps: 500,
    sampleTraits: [
      { trait: 'City', value: 'Osaka' },
      { trait: 'Edition', value: '25' },
      { trait: 'Film', value: 'Portra 800' },
    ],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'nft-blockbeats-audio',
    lane: 'nft',
    title: 'Block Beats Vol. 1',
    category: 'Music & Audio',
    tagline: 'Loops minted per bar, licensed for your build.',
    description:
      'Block Beats Vol. 1 is a pack of 64 original lo-fi and synth loops, each minted as a grc721 with a permissive on-chain license for use in games, dApps, and streams built on gno.land. Buy the loop, own the stem, ship it in your realm — the license terms travel with the token. Producer-signed WAV masters are unlockable to holders.',
    seller: {
      handle: 'chainwave',
      address: 'g1ch41nw4v39mus1c7l00ps5synth3b34ts8vol1x',
      verified: true,
      foundingCreator: true,
    },
    tags: ['music', 'audio', 'loops', 'license-included', 'creator-economy'],
    seedTier: 'featured',
    media: {
      kind: 'monogram',
      monogramSeed: 'blockbeats-vol1',
    },
    collectionName: 'Block Beats',
    floorGnot: 5,
    volumeGnot: 0,
    itemCount: 64,
    royaltyBps: 600,
    sampleTraits: [
      { trait: 'Mood', value: 'Lo-Fi' },
      { trait: 'BPM', value: '84' },
      { trait: 'License', value: 'Commercial' },
    ],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'nft-realm-founders-pass',
    lane: 'nft',
    title: 'Realm Founders Pass',
    category: 'Memberships & Passes',
    tagline: 'One key. Every founder perk, for good.',
    description:
      'The Realm Founders Pass is a transferable membership that unlocks reduced marketplace fees, early access to new lanes, and a permanent seat in the Memba founders DAO. Utility is enforced by the membership realm, so perks are gated by ownership rather than a database flag. Supply is capped at 1,000 and never reissued.',
    seller: {
      handle: 'memba.labs',
      address: 'g1memb4l4bs9f0und3rs7p4ss5m3mb3rsh1p8k3y2x',
      verified: true,
      foundingCreator: true,
    },
    tags: ['membership', 'pass', 'utility', 'dao-access', 'fee-discount'],
    seedTier: 'founding',
    media: {
      kind: 'monogram',
      monogramSeed: 'founders-pass',
    },
    collectionName: 'Founders Pass',
    floorGnot: 60,
    volumeGnot: 0,
    itemCount: 1000,
    royaltyBps: 250,
    sampleTraits: [
      { trait: 'Tier', value: 'Founder' },
      { trait: 'Fee Discount', value: '50%' },
      { trait: 'DAO Seat', value: 'Yes' },
    ],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'nft-contributor-badge-s1',
    lane: 'nft',
    title: 'Core Contributor Badge — Season 1',
    category: 'Community/Contributor Badges',
    tagline: 'Proof you shipped, minted to your address.',
    description:
      'A non-transferable-by-default recognition badge awarded to contributors who merged code, wrote docs, or ran validators during Season 1. Each badge encodes the contribution type and season on-chain, giving reputation a portable, verifiable home. Soulbound by design; a curation signal, not a tradeable asset.',
    seller: {
      handle: 'gno.commons',
      address: 'g1gn0c0mm0ns9c0ntr1but0r7b4dg35s34s0n1x2q8',
      verified: true,
    },
    tags: ['soulbound', 'badge', 'reputation', 'contributor', 'gno-native'],
    seedTier: 'featured',
    media: {
      kind: 'monogram',
      monogramSeed: 'contributor-s1',
    },
    collectionName: 'Contributor Badges',
    floorGnot: 2,
    volumeGnot: 0,
    itemCount: 750,
    royaltyBps: 0,
    sampleTraits: [
      { trait: 'Season', value: '1' },
      { trait: 'Role', value: 'Core Dev' },
      { trait: 'Transfer', value: 'Soulbound' },
    ],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'nft-gno-names',
    lane: 'nft',
    title: 'gno.name — Human-Readable Addresses',
    category: 'Domains & Names',
    tagline: 'Turn g1… into yourname.gno.',
    description:
      'gno.name mints a human-readable name that resolves to your gno.land address through a registry realm — send to alice.gno instead of a 40-character string. Names are renewable, transferable, and resolve consistently across Memba, wallets, and any realm that reads the registry. Premium three-letter names are reserved for the founding release.',
    seller: {
      handle: 'gnoname.registry',
      address: 'g1gn0n4m39r3g1stry7hum4n5r34d4bl38n4m3sx2q',
      verified: true,
      foundingCreator: true,
    },
    tags: ['names', 'identity', 'registry', 'resolver', 'gno-native'],
    seedTier: 'founding',
    media: {
      kind: 'monogram',
      monogramSeed: 'gno-name',
    },
    collectionName: 'gno.name',
    floorGnot: 12,
    volumeGnot: 0,
    itemCount: 10000,
    royaltyBps: 300,
    sampleTraits: [
      { trait: 'Length', value: '4 chars' },
      { trait: 'Category', value: 'Premium' },
      { trait: 'Renewal', value: 'Annual' },
    ],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'nft-questforge-heroes',
    lane: 'nft',
    title: 'QuestForge Heroes',
    category: 'Collectibles/Gaming',
    tagline: 'On-chain heroes that level up as you play.',
    description:
      'QuestForge Heroes are game-ready character NFTs whose stats and gear live in a realm and update as you complete on-chain quests — your progress is the asset. Heroes are composable across any game that reads the QuestForge registry, so the same character can adventure in multiple realms. Founding heroes ship with a rare starting class.',
    seller: {
      handle: 'questforge',
      address: 'g1qu3stf0rg39h3r03s7g4m1ng5ch4r4ct3rs8x2q4',
      verified: false,
    },
    tags: ['gaming', 'composable', 'stats-onchain', 'collectible', 'rpg'],
    seedTier: 'standard',
    media: {
      kind: 'art',
      artHint:
        'Chibi RPG hero in isometric armor holding a glowing sigil, painterly game-asset style on a stone tile.',
    },
    collectionName: 'QuestForge Heroes',
    floorGnot: 6,
    volumeGnot: 0,
    itemCount: 2048,
    royaltyBps: 500,
    sampleTraits: [
      { trait: 'Class', value: 'Realm Warden' },
      { trait: 'Rarity', value: 'Rare' },
      { trait: 'Level', value: '1' },
    ],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'nft-glyph-abstracts',
    lane: 'nft',
    title: 'Glyph — Abstract Editions',
    category: 'Art',
    tagline: 'Quiet color fields for busy chains.',
    description:
      'Glyph is a series of 120 abstract color-field editions exploring negative space and restrained palettes — art meant to sit calmly in a crowded gallery view. Each piece is signed and editioned, with masters delivered at print resolution. An accessible entry point into collecting original work in the Memba marketplace.',
    seller: {
      handle: 'field.studio',
      address: 'g1f13ldstud109gl7ph84bstr4ct5c0l0r7f13ldsx',
      verified: false,
    },
    tags: ['abstract', 'editions', 'fine-art', 'minimal', 'affordable'],
    seedTier: 'standard',
    media: {
      kind: 'art',
      artHint:
        'Soft two-tone color field with a single hard vertical seam, matte grain, muted ochre against slate.',
    },
    collectionName: 'Glyph',
    floorGnot: 3,
    volumeGnot: 0,
    itemCount: 120,
    royaltyBps: 700,
    sampleTraits: [
      { trait: 'Palette', value: 'Ochre / Slate' },
      { trait: 'Seam', value: 'Vertical' },
      { trait: 'Edition', value: '1/8' },
    ],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'nft-validator-crest',
    lane: 'nft',
    title: 'Validator Crest',
    category: 'Community/Contributor Badges',
    tagline: 'A heraldic mark for the nodes that keep the lights on.',
    description:
      'Validator Crest is a limited heraldic badge minted to addresses that operated a validator across a full testnet epoch. Each crest is generated from the operator address, producing a unique coat of arms that doubles as a verifiable service record. Worn as a PFP or displayed in the validator directory as a mark of uptime.',
    seller: {
      handle: 'gnops.guild',
      address: 'g1gn0psgu1ld9v4l1d4t0r7cr3st5h3r4ldry8x2q4',
      verified: true,
    },
    tags: ['validator', 'badge', 'heraldry', 'generative', 'gno-native'],
    seedTier: 'featured',
    media: {
      kind: 'art',
      artHint:
        'Generative heraldic shield with quartered field, node-and-edge sigil, ribbon banner, engraving line-art.',
    },
    collectionName: 'Validator Crest',
    floorGnot: 18,
    volumeGnot: 0,
    itemCount: 180,
    royaltyBps: 400,
    sampleTraits: [
      { trait: 'Epoch', value: 'test13' },
      { trait: 'Uptime', value: '99.9%' },
      { trait: 'Charge', value: 'Node Sigil' },
    ],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'nft-relics-collectibles',
    lane: 'nft',
    title: 'Chain Relics',
    category: 'Collectibles/Gaming',
    tagline: 'Trading cards for milestone blocks.',
    description:
      'Chain Relics is a collectible card set commemorating landmark moments in gno.land history — genesis, the first realm, the first DAO vote — each rendered as an illustrated card with the block height sealed on-chain. Cards come in three rarities and are built to trade, gift, and display. A playful piece of ecosystem memory.',
    seller: {
      handle: 'relichunter',
      address: 'g1r3l1chunt3r9ch41n7r3l1cs5c4rds8m1l3st0n3',
      verified: false,
    },
    tags: ['collectible', 'trading-cards', 'history', 'rarities', 'gno-native'],
    seedTier: 'standard',
    media: {
      kind: 'art',
      artHint:
        'Ornate trading card frame around an illustrated block-genesis scene, foil-corner treatment, rarity gem at top.',
    },
    collectionName: 'Chain Relics',
    floorGnot: 2,
    volumeGnot: 0,
    itemCount: 900,
    royaltyBps: 500,
    sampleTraits: [
      { trait: 'Moment', value: 'Genesis Block' },
      { trait: 'Rarity', value: 'Legendary' },
      { trait: 'Block', value: '#1' },
    ],
    rating: null,
    reviewsCount: null,
  },
];

// ============================================================================
// SERVICES LANE — 12 listings (fee 2%, +5% cancel fee to freelancer)
// ============================================================================

export const seedServices: SeedService[] = [
  {
    id: 'svc-realm-development',
    lane: 'service',
    title: 'Custom Gno Realm Development',
    category: 'Smart Contract/Realm Dev',
    tagline: 'From spec to deployed realm on your testnet.',
    description:
      'I design and build production-grade Gno realms — grc20/grc721 tokens, DAOs, marketplaces, and custom app logic — with gnomod-managed packages and a full test suite. You get idiomatic Gno, gas-aware storage patterns, and a deploy handoff to your chosen testnet. Clear scope, versioned deliverables, and a walkthrough at the end.',
    seller: {
      handle: 'realmsmith',
      address: 'g1r34lmsm1th9gn07d3v5r34lm8bu1ld3r7c0d3x2q',
      verified: true,
      foundingCreator: true,
    },
    tags: ['gno', 'realm', 'grc20', 'grc721', 'smart-contract'],
    seedTier: 'founding',
    media: { kind: 'monogram', monogramSeed: 'realm-dev' },
    gigTitle: 'I will build and deploy a custom Gno realm to your testnet',
    sellerLevel: 'Top Rated',
    packages: [
      {
        name: 'Basic',
        priceGnot: 120,
        deliveryDays: 5,
        revisions: 2,
        summary: 'A single-file realm (one grc20 or grc721) with unit tests and a testnet deploy.',
      },
      {
        name: 'Standard',
        priceGnot: 320,
        deliveryDays: 10,
        revisions: 3,
        summary: 'Multi-file realm with custom logic, Render() view, test suite, and deploy script.',
      },
      {
        name: 'Premium',
        priceGnot: 750,
        deliveryDays: 21,
        revisions: 'unlimited',
        summary: 'Full app realm (token + DAO + marketplace hooks), CI, docs, and a launch handoff call.',
      },
    ],
    skills: ['Gno', 'gnomod', 'grc20', 'grc721', 'Go', 'testnet deploys'],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'svc-realm-security-audit',
    lane: 'service',
    title: 'Gno Realm Security Audit',
    category: 'Security Audits',
    tagline: 'Find the fund-drain before mainnet does.',
    description:
      'A focused security review of your Gno realm covering the classics that bite hardest on-chain — origin-vs-caller confusion, unguarded value transfers, reentrancy across realm boundaries, and access-control gaps. You receive a severity-ranked report with reproducible findings and concrete fixes, plus a re-check on remediation. I audit only Gno; I know where the bodies are buried.',
    seller: {
      handle: 'sentinel.gno',
      address: 'g1s3nt1n3lgn09s3cur1ty7aud1t5r34lm8r3v13w',
      verified: true,
      foundingCreator: true,
    },
    tags: ['audit', 'security', 'gno', 'access-control', 'reentrancy'],
    seedTier: 'founding',
    media: { kind: 'monogram', monogramSeed: 'security-audit' },
    gigTitle: 'I will audit your Gno realm for fund-drain and access-control bugs',
    sellerLevel: 'Top Rated',
    packages: [
      {
        name: 'Basic',
        priceGnot: 200,
        deliveryDays: 4,
        revisions: 1,
        summary: 'Single-realm review (<300 LOC): severity-ranked findings + fix notes, one re-check.',
      },
      {
        name: 'Standard',
        priceGnot: 550,
        deliveryDays: 8,
        revisions: 2,
        summary: 'Multi-realm review with call-graph analysis, threat model, and remediation re-audit.',
      },
      {
        name: 'Premium',
        priceGnot: 1400,
        deliveryDays: 18,
        revisions: 'unlimited',
        summary: 'Full protocol audit, invariant checks, PoC exploits where relevant, and a public report.',
      },
    ],
    skills: ['Gno', 'security auditing', 'threat modeling', 'access control', 'gosec'],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'svc-dao-setup-governance',
    lane: 'service',
    title: 'DAO Setup & Governance Ops',
    category: 'DAO Setup & Governance Ops',
    tagline: 'Stand up a DAO your community will actually use.',
    description:
      'I bootstrap on-chain DAOs on gno.land — membership, proposal and voting flows, treasury controls, and role-based permissions — then hand you a runbook for day-to-day governance. Whether you need a lightweight multisig or a full proposal lifecycle, I configure the realm and document the operating procedures. Governance that is legible to both devs and non-devs.',
    seller: {
      handle: 'quorum.works',
      address: 'g1qu0rumw0rks9d40s3tup7g0v3rn4nc305ps8x2q4',
      verified: true,
      foundingCreator: true,
    },
    tags: ['dao', 'governance', 'treasury', 'voting', 'gno-native'],
    seedTier: 'founding',
    media: { kind: 'monogram', monogramSeed: 'dao-ops' },
    gigTitle: 'I will set up your on-chain DAO with treasury and governance ops',
    sellerLevel: 'Level 2',
    packages: [
      {
        name: 'Basic',
        priceGnot: 90,
        deliveryDays: 4,
        revisions: 2,
        summary: 'Multisig-style DAO: membership + treasury + a governance runbook.',
      },
      {
        name: 'Standard',
        priceGnot: 260,
        deliveryDays: 9,
        revisions: 3,
        summary: 'Full proposal lifecycle (create/vote/execute), roles, and a governance playbook.',
      },
      {
        name: 'Premium',
        priceGnot: 620,
        deliveryDays: 20,
        revisions: 'unlimited',
        summary: 'Custom governance realm, tokenized voting, treasury policy, and an ops onboarding session.',
      },
    ],
    skills: ['DAO design', 'Gno', 'governance', 'tokenomics', 'operations'],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'svc-tokenomics-design',
    lane: 'service',
    title: 'Tokenomics & Launch Design',
    category: 'DAO Setup & Governance Ops',
    tagline: 'A token model that survives contact with the market.',
    description:
      'I design token models for gno.land projects — supply schedules, emissions, vesting, fee routing, and incentive alignment — grounded in what your realm actually needs rather than a copied template. Deliverables include a written model, a supply/vesting spreadsheet, and a grc20 configuration ready to deploy. Built to pass a skeptical CTO review.',
    seller: {
      handle: 'mechanism.lab',
      address: 'g1m3ch4n1sml4b9t0k3n0m1cs7l4unch5d3s1gn8x2',
      verified: true,
    },
    tags: ['tokenomics', 'vesting', 'grc20', 'incentives', 'gno-native'],
    seedTier: 'featured',
    media: { kind: 'monogram', monogramSeed: 'tokenomics' },
    gigTitle: 'I will design your token model, vesting, and launch allocation',
    sellerLevel: 'Level 2',
    packages: [
      {
        name: 'Basic',
        priceGnot: 110,
        deliveryDays: 5,
        revisions: 2,
        summary: 'Supply + vesting model and a one-page tokenomics brief.',
      },
      {
        name: 'Standard',
        priceGnot: 300,
        deliveryDays: 10,
        revisions: 3,
        summary: 'Full model with emissions, fee routing, incentive design, and grc20 config.',
      },
      {
        name: 'Premium',
        priceGnot: 700,
        deliveryDays: 18,
        revisions: 'unlimited',
        summary: 'End-to-end launch design incl. OTC block strategy, cliff schedules, and a review call.',
      },
    ],
    skills: ['tokenomics', 'incentive design', 'grc20', 'financial modeling', 'Gno'],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'svc-realm-testing-ci',
    lane: 'service',
    title: 'Gno Test Suites & CI Pipelines',
    category: 'Smart Contract/Realm Dev',
    tagline: 'Green checks before you ship, every time.',
    description:
      'I write comprehensive Gno test suites and wire them into CI so regressions never reach your testnet. Coverage includes edge-case fuzzing, gas snapshots, and a lint/compile gate that mirrors production. You get a repo that fails loudly on bad commits and a maintainer guide for keeping it that way. Reliability as a deliverable.',
    seller: {
      handle: 'greenchecks',
      address: 'g1gr33nch3cks9gn07t3st7c17p1p3l1n35d3v8x2q',
      verified: false,
    },
    tags: ['testing', 'ci', 'gno', 'coverage', 'quality'],
    seedTier: 'standard',
    media: { kind: 'monogram', monogramSeed: 'gno-ci' },
    gigTitle: 'I will write Gno test suites and set up your CI pipeline',
    sellerLevel: 'Level 1',
    packages: [
      {
        name: 'Basic',
        priceGnot: 70,
        deliveryDays: 4,
        revisions: 2,
        summary: 'Unit tests for one realm plus a basic lint/compile CI gate.',
      },
      {
        name: 'Standard',
        priceGnot: 180,
        deliveryDays: 8,
        revisions: 3,
        summary: 'Full coverage across your realms, gas snapshots, and a CI matrix.',
      },
      {
        name: 'Premium',
        priceGnot: 420,
        deliveryDays: 15,
        revisions: 'unlimited',
        summary: 'Fuzzing, integration tests, release gating, and a maintainer handbook.',
      },
    ],
    skills: ['Gno', 'testing', 'CI/CD', 'GitHub Actions', 'fuzzing'],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'svc-brand-identity-design',
    lane: 'service',
    title: 'Brand Identity for Web3 Projects',
    category: 'Graphics & Design',
    tagline: 'A logo and system your community rallies behind.',
    description:
      'I craft complete brand identities for crypto-native projects — logo, color system, type scale, and a usage kit that keeps everything consistent across your realm, docs, and socials. Every deliverable ships as production-ready source files with a mini brand guide. Distinctive, legible, and built to scale from a tweet to a testnet launch.',
    seller: {
      handle: 'markmakers',
      address: 'g1m4rkm4k3rs9br4nd7id3nt1ty5d3s1gn8w3b3x2q',
      verified: true,
    },
    tags: ['branding', 'logo', 'design-system', 'identity', 'visual'],
    seedTier: 'featured',
    media: { kind: 'monogram', monogramSeed: 'brand-identity' },
    gigTitle: 'I will design a complete brand identity for your web3 project',
    sellerLevel: 'Level 2',
    packages: [
      {
        name: 'Basic',
        priceGnot: 60,
        deliveryDays: 4,
        revisions: 2,
        summary: 'Primary logo, one color palette, and export in PNG/SVG.',
      },
      {
        name: 'Standard',
        priceGnot: 160,
        deliveryDays: 8,
        revisions: 3,
        summary: 'Logo suite, color + type system, and a mini brand guide.',
      },
      {
        name: 'Premium',
        priceGnot: 380,
        deliveryDays: 14,
        revisions: 'unlimited',
        summary: 'Full identity: logo, system, social kit, favicon, and source files.',
      },
    ],
    skills: ['branding', 'logo design', 'typography', 'color', 'Figma'],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'svc-fullstack-dapp',
    lane: 'service',
    title: 'Full-Stack dApp Frontend',
    category: 'Programming & Tech',
    tagline: 'A polished UI wired straight to your realm.',
    description:
      'I build React/TypeScript frontends that talk to gno.land realms — wallet connect, ABCI queries, transaction signing, and a clean component system that does not look like a template. You get a responsive, themeable UI, typed data hooks, and a deploy to your host of choice. The kind of front door that makes a realm feel like a product.',
    seller: {
      handle: 'frontier.dev',
      address: 'g1fr0nt13rd3v9fullst4ck7d4pp5fr0nt3nd8x2q4',
      verified: true,
    },
    tags: ['react', 'typescript', 'dapp', 'frontend', 'gno-native'],
    seedTier: 'featured',
    media: { kind: 'monogram', monogramSeed: 'dapp-frontend' },
    gigTitle: 'I will build a React frontend wired to your Gno realm',
    sellerLevel: 'Level 2',
    packages: [
      {
        name: 'Basic',
        priceGnot: 130,
        deliveryDays: 6,
        revisions: 2,
        summary: 'Single-page UI with wallet connect and read/query from one realm.',
      },
      {
        name: 'Standard',
        priceGnot: 360,
        deliveryDays: 12,
        revisions: 3,
        summary: 'Multi-view app with tx signing, typed hooks, theming, and a deploy.',
      },
      {
        name: 'Premium',
        priceGnot: 820,
        deliveryDays: 24,
        revisions: 'unlimited',
        summary: 'Production dApp: auth, state management, tests, CI, and a design system.',
      },
    ],
    skills: ['React', 'TypeScript', 'ABCI queries', 'wallet integration', 'Vite'],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'svc-technical-writing',
    lane: 'service',
    title: 'Technical Docs & Whitepapers',
    category: 'Writing & Translation',
    tagline: 'Docs people finish reading.',
    description:
      'I write developer documentation, whitepapers, and README-to-guide upgrades for Gno projects — turning tribal knowledge into onboarding that actually converts contributors. Every piece is structured, example-driven, and technically accurate because I read the realm before I write. Deliverables ship in Markdown, ready to drop into your repo or docs site.',
    seller: {
      handle: 'plainwords',
      address: 'g1pl41nw0rds9t3chn1c4l7d0cs5wh1t3p4p3r8x2q',
      verified: false,
    },
    tags: ['docs', 'whitepaper', 'writing', 'developer-experience', 'markdown'],
    seedTier: 'standard',
    media: { kind: 'monogram', monogramSeed: 'tech-writing' },
    gigTitle: 'I will write clear developer docs or a whitepaper for your project',
    sellerLevel: 'Level 1',
    packages: [
      {
        name: 'Basic',
        priceGnot: 45,
        deliveryDays: 3,
        revisions: 2,
        summary: 'A polished README or single guide (up to 1,000 words) with code examples.',
      },
      {
        name: 'Standard',
        priceGnot: 140,
        deliveryDays: 7,
        revisions: 3,
        summary: 'Full docs set (quickstart + API reference) or a 3,000-word whitepaper.',
      },
      {
        name: 'Premium',
        priceGnot: 340,
        deliveryDays: 14,
        revisions: 'unlimited',
        summary: 'Complete docs site content, tutorials, and a technical whitepaper.',
      },
    ],
    skills: ['technical writing', 'documentation', 'Markdown', 'developer relations', 'editing'],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'svc-community-growth',
    lane: 'service',
    title: 'Community Growth & Management',
    category: 'Marketing & Community',
    tagline: 'From empty Discord to living ecosystem.',
    description:
      'I build and run communities for web3 projects — Discord/Telegram structure, contributor onboarding, event cadence, and quest programs that reward real participation instead of farming. You get a growth plan, moderation guardrails, and hands-on management if you want it. Community as infrastructure, not vanity metrics.',
    seller: {
      handle: 'campfire.dao',
      address: 'g1c4mpf1r3d409c0mmun1ty7gr0wth5m4n4g38x2q4',
      verified: false,
    },
    tags: ['community', 'growth', 'discord', 'quests', 'moderation'],
    seedTier: 'standard',
    media: { kind: 'monogram', monogramSeed: 'community-growth' },
    gigTitle: 'I will grow and manage your web3 community',
    sellerLevel: 'Level 1',
    packages: [
      {
        name: 'Basic',
        priceGnot: 55,
        deliveryDays: 5,
        revisions: 2,
        summary: 'Community setup: server structure, roles, rules, and a 30-day content plan.',
      },
      {
        name: 'Standard',
        priceGnot: 180,
        deliveryDays: 15,
        revisions: 3,
        summary: 'Setup plus two weeks of hands-on management and a quest program design.',
      },
      {
        name: 'Premium',
        priceGnot: 460,
        deliveryDays: 30,
        revisions: 'unlimited',
        summary: 'Full month of managed growth: events, onboarding, moderation, and reporting.',
      },
    ],
    skills: ['community management', 'growth', 'Discord', 'events', 'moderation'],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'svc-explainer-animation',
    lane: 'service',
    title: 'Explainer Videos & Motion',
    category: 'Video & Animation',
    tagline: 'Explain your protocol in 60 seconds flat.',
    description:
      'I produce short animated explainers that make complex on-chain mechanics click — scripted, storyboarded, and animated with clean motion design and a licensed soundtrack. Perfect for a launch announcement, a realm walkthrough, or a docs hero video. You get the final render plus source project files for future edits.',
    seller: {
      handle: 'motionforge',
      address: 'g1m0t10nf0rg39v1d30s7expl41n3r54n1m4t38x2q',
      verified: false,
    },
    tags: ['video', 'motion-design', 'explainer', 'animation', 'launch'],
    seedTier: 'standard',
    media: { kind: 'monogram', monogramSeed: 'motion-video' },
    gigTitle: 'I will animate a 60-second explainer video for your protocol',
    sellerLevel: 'Level 1',
    packages: [
      {
        name: 'Basic',
        priceGnot: 90,
        deliveryDays: 6,
        revisions: 2,
        summary: '30-second animated explainer with script, voiceover, and one revision round.',
      },
      {
        name: 'Standard',
        priceGnot: 240,
        deliveryDays: 12,
        revisions: 3,
        summary: '60-second explainer with storyboard, custom motion, and licensed music.',
      },
      {
        name: 'Premium',
        priceGnot: 560,
        deliveryDays: 20,
        revisions: 'unlimited',
        summary: '90-second premium production, character motion, sound design, and source files.',
      },
    ],
    skills: ['motion design', 'After Effects', 'storyboarding', 'scriptwriting', 'sound design'],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'svc-onchain-analytics',
    lane: 'service',
    title: 'On-Chain Analytics & Dashboards',
    category: 'AI & Data',
    tagline: 'Turn your realm state into decisions.',
    description:
      'I build data pipelines and dashboards over gno.land realm state — indexing events, modeling metrics, and shipping a live dashboard your team actually checks. Deliverables include an indexer, a queryable dataset, and visualizations tuned for signal over noise. Optional anomaly alerts flag issues before they become incidents.',
    seller: {
      handle: 'ledgerlens',
      address: 'g1l3dg3rl3ns90nch41n7an4lyt1cs5d4sh8b04rd',
      verified: true,
    },
    tags: ['analytics', 'data', 'indexer', 'dashboards', 'gno-native'],
    seedTier: 'featured',
    media: { kind: 'monogram', monogramSeed: 'analytics' },
    gigTitle: 'I will build an on-chain analytics dashboard for your realm',
    sellerLevel: 'Level 2',
    packages: [
      {
        name: 'Basic',
        priceGnot: 100,
        deliveryDays: 6,
        revisions: 2,
        summary: 'Single-realm indexer and a dashboard with core metrics.',
      },
      {
        name: 'Standard',
        priceGnot: 280,
        deliveryDays: 12,
        revisions: 3,
        summary: 'Multi-realm pipeline, modeled metrics, and a live shared dashboard.',
      },
      {
        name: 'Premium',
        priceGnot: 640,
        deliveryDays: 20,
        revisions: 'unlimited',
        summary: 'Full analytics stack with anomaly alerts, exports, and a metrics review call.',
      },
    ],
    skills: ['data engineering', 'indexing', 'SQL', 'dashboards', 'anomaly detection'],
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'svc-realm-migration-upgrade',
    lane: 'service',
    title: 'Realm Migration & Testnet Upgrade',
    category: 'Smart Contract/Realm Dev',
    tagline: 'Move your realm to the new testnet without breaking state.',
    description:
      'I migrate live Gno realms across testnet upgrades and stdlib changes — reconciling interrealm API moves, banker signatures, and gnomod pins so your realm compiles and behaves identically on the target chain. You get a diff-reviewed migration, a re-run test suite, and a verified redeploy with a rollback plan. The unglamorous work that keeps a launched realm alive.',
    seller: {
      handle: 'porter.gno',
      address: 'g1p0rt3rgn09r34lm7m1gr4t10n5upgr4d38t3st2q',
      verified: true,
      foundingCreator: true,
    },
    tags: ['migration', 'upgrade', 'gno', 'testnet', 'stdlib'],
    seedTier: 'featured',
    media: { kind: 'monogram', monogramSeed: 'realm-migration' },
    gigTitle: 'I will migrate your Gno realm to a new testnet or stdlib version',
    sellerLevel: 'Level 2',
    packages: [
      {
        name: 'Basic',
        priceGnot: 80,
        deliveryDays: 4,
        revisions: 2,
        summary: 'Single-realm migration: API reconciliation, recompile, and a verified redeploy.',
      },
      {
        name: 'Standard',
        priceGnot: 220,
        deliveryDays: 9,
        revisions: 3,
        summary: 'Multi-realm migration with state reconciliation, test re-run, and a rollback plan.',
      },
      {
        name: 'Premium',
        priceGnot: 520,
        deliveryDays: 18,
        revisions: 'unlimited',
        summary: 'Full-stack migration incl. frontend repointing, CI gate updates, and a cutover runbook.',
      },
    ],
    skills: ['Gno', 'realm migration', 'stdlib', 'gnomod', 'testnet deploys'],
    rating: null,
    reviewsCount: null,
  },
];

// ============================================================================
// TOKEN LANE — 10 listings (OTC Block Desk, fee 0.5%)
// ============================================================================

export const seedTokens: SeedToken[] = [
  {
    id: 'tok-memba-community',
    lane: 'token',
    title: 'MEMBA Community Token — Founding Block',
    category: 'Community/Social Tokens',
    tagline: 'A founding stake in the Memba community.',
    description:
      'MEMBA is the community token that powers reputation, quests, and fee discounts across the Memba platform. This founding block is offered OTC to early supporters who want a meaningful position without moving a thin launch market. Fills are settled peer-to-peer on-chain with a fixed price and a 0.5% desk fee.',
    seller: {
      handle: 'memba.treasury',
      address: 'g1memb4tr34sury9c0mmun1ty7t0k3n5f0und38x2q',
      verified: true,
      foundingCreator: true,
    },
    tags: ['community', 'grc20', 'founding', 'utility', 'gno-native'],
    seedTier: 'founding',
    media: { kind: 'monogram', monogramSeed: 'memba-token' },
    symbol: 'MEMBA',
    amountAvailable: 250000,
    unitPriceGnot: 0.12,
    minFillAmount: 5000,
    whyOtc:
      'A 250k block would sweep several price levels on an AMM and slip badly; OTC gives both sides one clean fill at a fixed price with no MEV or front-running.',
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'tok-gnodao-governance',
    lane: 'token',
    title: 'GNODAO Governance — Strategic Block',
    category: 'DAO Governance',
    tagline: 'Voting weight for the people who show up.',
    description:
      'GNODAO is the governance token for a flagship gno.land protocol DAO, granting proposal and voting rights on treasury and parameter changes. This strategic block is placed OTC to onboard aligned long-term voters rather than short-term flippers. Delivery is direct to your address on fill, ready to delegate.',
    seller: {
      handle: 'gnodao.core',
      address: 'g1gn0d40c0r39g0v3rn4nc37t0k3n5str4t3g38x2q',
      verified: true,
      foundingCreator: true,
    },
    tags: ['governance', 'dao', 'voting', 'grc20', 'gno-native'],
    seedTier: 'founding',
    media: { kind: 'monogram', monogramSeed: 'gnodao-gov' },
    symbol: 'GNODAO',
    amountAvailable: 80000,
    unitPriceGnot: 0.85,
    minFillAmount: 2000,
    whyOtc:
      'The DAO wants voters, not a liquid flip market; an OTC placement lets the treasury pick aligned counterparties and set price certainty instead of dumping into shallow AMM depth.',
    vesting: '12-month linear',
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'tok-realmfi-fairlaunch',
    lane: 'token',
    title: 'RLM Fair-Launch Allocation',
    category: 'New/Fair-Launch Allocations',
    tagline: 'Get in at the launch price, not the launch chaos.',
    description:
      'RLM powers RealmFi, a DeFi primitive launching on gno.land with a no-presale, no-VC fair distribution. This allocation is offered OTC at the fixed launch price so early participants can size in calmly before public trading opens. Equal terms for everyone; no whitelist games.',
    seller: {
      handle: 'realmfi.launch',
      address: 'g1r34lmf1l4unch9f41r7t0k3n5rlm8d1str1b8x2q',
      verified: true,
    },
    tags: ['fair-launch', 'defi', 'launch', 'grc20', 'gno-native'],
    seedTier: 'featured',
    media: { kind: 'monogram', monogramSeed: 'realmfi-launch' },
    symbol: 'RLM',
    amountAvailable: 500000,
    unitPriceGnot: 0.04,
    minFillAmount: 10000,
    whyOtc:
      'Before a public pool exists there is no AMM price to trade against; an OTC fixed-price allocation is the only fair way to distribute the launch tranche without a bonding-curve land grab.',
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'tok-whale-block-gnot-adjacent',
    lane: 'token',
    title: 'FORGE Large Block — Desk Placement',
    category: 'Large Blocks/OTC',
    tagline: 'Institutional size, one settlement.',
    description:
      'A large block of FORGE, the utility token of a tooling protocol, offered as a single OTC placement for buyers who need real size. Splitting this across an AMM would move price against you and leak intent to the mempool; the desk settles it in one on-chain fill at an agreed price. Minimum fill is set to keep the desk for serious counterparties.',
    seller: {
      handle: 'forge.otc',
      address: 'g1f0rg30tc9l4rg37bl0ck5d3sk8pl4c3m3nt7x2q4',
      verified: true,
    },
    tags: ['otc', 'large-block', 'utility', 'institutional', 'grc20'],
    seedTier: 'featured',
    media: { kind: 'monogram', monogramSeed: 'forge-block' },
    symbol: 'FORGE',
    amountAvailable: 1200000,
    unitPriceGnot: 0.031,
    minFillAmount: 100000,
    whyOtc:
      'At 1.2M tokens, market-buying would climb the curve for double-digit slippage and telegraph the order; a negotiated OTC block gives price certainty and zero mempool leakage.',
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'tok-vesting-locked-seed',
    lane: 'token',
    title: 'AXIS Seed Tranche — Vested',
    category: 'Vesting/Locked',
    tagline: 'Seed-round terms, on-chain vesting enforced.',
    description:
      'AXIS is the token of an infrastructure protocol offering a seed tranche with on-chain vesting: tokens unlock on a cliff-and-linear schedule enforced by the realm, not a promise. This suits buyers who want early pricing and are comfortable with a lockup. The vesting contract is public and auditable before you fill.',
    seller: {
      handle: 'axis.protocol',
      address: 'g14x1spr0t0c0l9s33d7tr4nch35v3st3d8l0ck2q4',
      verified: true,
    },
    tags: ['vesting', 'seed', 'locked', 'grc20', 'gno-native'],
    seedTier: 'featured',
    media: { kind: 'monogram', monogramSeed: 'axis-vested' },
    symbol: 'AXIS',
    amountAvailable: 400000,
    unitPriceGnot: 0.06,
    minFillAmount: 8000,
    whyOtc:
      'Vested, locked tokens simply cannot exist on an AMM — there is no liquid asset to pool; OTC with an on-chain vesting schedule is the only venue for a seed tranche with a cliff.',
    vesting: '6-month cliff, then 18-month linear',
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'tok-creator-social',
    lane: 'token',
    title: 'LUMEN Creator Coin — Supporter Block',
    category: 'Community/Social Tokens',
    tagline: 'Back the creator, unlock the perks.',
    description:
      'LUMEN is a creator coin that gates a well-known Gno builders early access, private streams, and holder-only drops. This supporter block is offered OTC so the creator can onboard true fans directly instead of watching bots snipe a thin pool. Holding LUMEN unlocks perks enforced by the creators realm.',
    seller: {
      handle: 'lumen.creator',
      address: 'g1lum3ncr34t0r9s0c14l7c01n5supp0rt3r8bl2q4',
      verified: true,
    },
    tags: ['social-token', 'creator', 'perks', 'grc20', 'community'],
    seedTier: 'standard',
    media: { kind: 'monogram', monogramSeed: 'lumen-creator' },
    symbol: 'LUMEN',
    amountAvailable: 60000,
    unitPriceGnot: 0.09,
    minFillAmount: 500,
    whyOtc:
      'A thin creator-coin pool is trivially sniped by bots at launch; OTC lets the creator place tokens directly with genuine supporters at a fair fixed price.',
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'tok-stable-pair-settle',
    lane: 'token',
    title: 'gUSD Stable Block — Settlement Pair',
    category: 'Stable pairs',
    tagline: 'Move size in and out without moving the peg.',
    description:
      'A block of gUSD, a gno.land-native stable unit, offered OTC for treasuries and desks that need to convert between GNOT and stable value at scale. Large stable conversions on an AMM drag the peg and cost slippage on both legs; the desk settles at a tight fixed rate in a single on-chain fill. Ideal for payroll runs, treasury rebalancing, and OTC settlement.',
    seller: {
      handle: 'gusd.desk',
      address: 'g1gusdd3sk9st4bl37bl0ck5s3ttl3m3nt7p41r8x2',
      verified: true,
    },
    tags: ['stable', 'settlement', 'treasury', 'grc20', 'gno-native'],
    seedTier: 'featured',
    media: { kind: 'monogram', monogramSeed: 'gusd-stable' },
    symbol: 'gUSD',
    amountAvailable: 300000,
    unitPriceGnot: 0.98,
    minFillAmount: 20000,
    whyOtc:
      'Large stable swaps drag the peg and eat slippage on both legs of an AMM; an OTC block converts size at a tight fixed rate with predictable settlement.',
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'tok-utility-gas-credits',
    lane: 'token',
    title: 'RELAY Utility Credits — Bulk Block',
    category: 'Utility',
    tagline: 'Prepay your relayer bill at a bulk rate.',
    description:
      'RELAY credits pay for message-relaying and automation on a gno.land infrastructure service, redeemable inside the relayer realm. This bulk block lets high-volume dApps prepay usage at a discount to the retail rate. OTC keeps a predictable per-credit cost so teams can budget without watching a spot market.',
    seller: {
      handle: 'relay.infra',
      address: 'g1r3l4y1nfr49ut1l1ty7cr3d1ts5bulk8bl0ck2q4',
      verified: false,
    },
    tags: ['utility', 'credits', 'infrastructure', 'grc20', 'gno-native'],
    seedTier: 'standard',
    media: { kind: 'monogram', monogramSeed: 'relay-credits' },
    symbol: 'RELAY',
    amountAvailable: 750000,
    unitPriceGnot: 0.015,
    minFillAmount: 25000,
    whyOtc:
      'Usage credits are a budgeting instrument, not a trading asset; a fixed-price OTC block lets teams prepay at a bulk discount with a locked-in per-credit cost, which a volatile AMM cannot offer.',
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'tok-dao-treasury-diversify',
    lane: 'token',
    title: 'PRISM DAO Treasury — Diversification Block',
    category: 'DAO Governance',
    tagline: 'A DAO diversifying its treasury, in the open.',
    description:
      'The PRISM DAO is diversifying part of its native holdings into GNOT and has approved an OTC block via governance. Selling this size on-market would tank its own token; an OTC placement lets the treasury transact transparently at an agreed price without self-inflicted slippage. Every fill is verifiable against the on-chain proposal.',
    seller: {
      handle: 'prism.dao',
      address: 'g1pr1smd409tr34sury7d1v3rs1fy5bl0ck8x2q4z',
      verified: true,
    },
    tags: ['dao', 'treasury', 'governance', 'grc20', 'gno-native'],
    seedTier: 'featured',
    media: { kind: 'monogram', monogramSeed: 'prism-treasury' },
    symbol: 'PRISM',
    amountAvailable: 180000,
    unitPriceGnot: 0.22,
    minFillAmount: 5000,
    whyOtc:
      'A DAO cannot sell a large slice of its own token into its own AMM pool without crashing the price it governs; OTC lets the treasury diversify at a governance-approved fixed price, on the record.',
    rating: null,
    reviewsCount: null,
  },
  {
    id: 'tok-newlaunch-strategic-round',
    lane: 'token',
    title: 'NOVA Strategic Round — Fair Allocation',
    category: 'New/Fair-Launch Allocations',
    tagline: 'A strategic slice before NOVA goes public.',
    description:
      'NOVA is a new gno.land-native protocol opening a small strategic round ahead of its public launch. This OTC allocation is priced at the round terms with a short lock to align incentives, giving early backers a real position without a presale scramble. Terms and unlock schedule are enforced on-chain and visible before you commit.',
    seller: {
      handle: 'nova.labs',
      address: 'g1n0v4l4bs9str4t3g1c7r0und5f41r7all0c8x2q4',
      verified: true,
    },
    tags: ['launch', 'strategic', 'fair-allocation', 'grc20', 'gno-native'],
    seedTier: 'featured',
    media: { kind: 'monogram', monogramSeed: 'nova-round' },
    symbol: 'NOVA',
    amountAvailable: 350000,
    unitPriceGnot: 0.05,
    minFillAmount: 7000,
    whyOtc:
      'There is no public NOVA market yet, so price discovery has to be negotiated; an OTC strategic round with an on-chain lock distributes the pre-launch tranche fairly at fixed terms.',
    vesting: '3-month cliff, then 9-month linear',
    rating: null,
    reviewsCount: null,
  },
];

// ============================================================================
// Aggregate export
// ============================================================================

export const foundingSupply = {
  nft: seedNfts,
  service: seedServices,
  token: seedTokens,
};
