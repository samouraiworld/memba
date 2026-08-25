/**
 * Centralized environment configuration for the Memba frontend.
 *
 * Sections:
 * 1. App Identity — version, OAuth
 * 2. Backend API — base URL
 * 3. Gno Networks — chain configs, RPC, explorer
 * 4. Address Constants — bech32, units
 * 5. External Services — gnolove, DAO realm
 * 6. GnoSwap DEX — per-chain contract paths
 * 7. RPC Security — domain allowlist
 *
 * All env vars read from Vite's import.meta.env with sensible defaults.
 */

// nftConfig is dependency-free (zero imports), so this edge is cycle-safe and
// keeps the v3 market path single-sourced for the isNftMarketV3Valid() predicate.
import { NFT_MARKETPLACE_V3_PATH } from "./nftConfig"

// ── 1. App Identity ──────────────────────────────────────────
export const APP_VERSION = __APP_VERSION__

/**
 * Treasury spend kill-switch (AAA-0 A1.a — CRITICAL fund safety).
 *
 * When false (default): hides "Propose Spend" UI, replaces deposit-inviting
 * copy with a fund-safety warning, and blocks deep-links to /treasury/propose.
 *
 * WHY: ExecuteProposal in the DAO template has no banker code — spends never
 * execute, but the UI invites deposits that are permanently irrecoverable.
 * This flag stays false until A1.c implements the real banker treasury.
 *
 * @see docs/planning/MEMBA_AAA_IMPLEMENTATION_PLAN.md §5/A1
 */
export const TREASURY_SPEND_ENABLED = import.meta.env.VITE_ENABLE_TREASURY_SPEND === "true"

/**
 * Agent credit deposit kill-switch (AAA-0 A5.ui — fail-closed).
 *
 * When false (default): disables "Deposit Credits" and "Refund Credits"
 * actions in the Marketplace CreditSection. The agent_registry realm's
 * UseCredit was historically unguarded, and depositing into an undeployed
 * or misconfigured registry would lose funds permanently.
 *
 * @see docs/planning/MEMBA_AAA_IMPLEMENTATION_PLAN.md §5/A5
 */
export const AGENT_CREDITS_ENABLED = import.meta.env.VITE_ENABLE_AGENT_CREDITS === "true"

/** GitHub OAuth App Client ID (must be set via VITE_GITHUB_CLIENT_ID env var). */
export const GITHUB_OAUTH_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID || ""

// ── 2. Backend API ───────────────────────────────────────────

/** Backend API base URL.
 * In dev: empty string → uses Vite proxy.
 * In production: must be set via VITE_API_URL build arg, or falls back to Fly.io. */
export const API_BASE_URL =
    import.meta.env.VITE_API_URL ||
    (import.meta.env.PROD ? "https://memba-backend.fly.dev" : "")

// ── 3. Gno Networks ──────────────────────────────────────────

/** Network configuration type. */
interface NetworkConfig {
    chainId: string
    rpcUrl: string
    fallbackRpcUrls: string[]
    /** Well-connected nodes to poll for network telemetry (peer topology via
     *  /net_info, consensus state). `/net_info` is node-local, so the primary
     *  RPC — often behind sentries — sees only a partial peer set; these nodes
     *  see more and are unioned by getAggregatedNetPeers. Must be trusted
     *  domains. Optional; falls back to rpcUrl + fallbackRpcUrls. */
    telemetryRpcUrls?: string[]
    /** Official tx-indexer GraphQL endpoint for recent on-chain activity. Optional —
     *  when absent (e.g. networks without a public indexer) the activity feed hides. */
    indexerUrl?: string
    /** The key gnomonitoring knows this network by, when it differs from `chainId`.
     *
     *  These are NOT the same namespace: `chainId` is the on-chain genesis id that
     *  transactions are signed with, while this is a label chosen by whoever
     *  registered the network with the monitoring service — an admin-editable,
     *  un-versioned registry on gnomonitoring's own VPS, not something Memba
     *  controls or can assume is stable.
     *
     *  ⚠️ This value is NOT settled fact — it has flipped for topaz twice within
     *  24h of each other (2026-07-22: gnomonitoring registered `topaz-1` as
     *  `topaz`, needing an override here; 2026-07-23: it flipped back, so the
     *  override became wrong and was removed). Before trusting or changing a
     *  `monitoringChain` value, re-verify live:
     *    GET https://monitoring.gnolove.world/uptime?chain=<candidate>
     *  (use `/uptime`, not `/Participation` — the latter 400s with "Missing
     *  period" unless you also pass `period=current_month`, which reads like
     *  a chain-id rejection if you're not expecting it.) A 200 with real
     *  monikers means that value is currently correct; a `"invalid chain ID"`
     *  body means it isn't. Do not assume this file is in sync with
     *  gnomonitoring's live registry.
     *  Optional; defaults to `chainId`. */
    monitoringChain?: string
    label: string
    userRegistryPath: string
    faucetUrl: string
    /** gnoweb base URL — on gno this one host is both the block explorer and the
     *  namespace-discovery endpoint, so it serves `getExplorerBaseUrl()` and
     *  `lib/gnoweb`'s lookups alike.
     *
     *  Declared per network rather than derived. It used to be built as
     *  `https://${chainId}.testnets.gno.land`, which is only correct where the
     *  network KEY and the chain id coincide. On topaz (key `topaz`, chain id
     *  `topaz-1`) that produced `https://topaz-1.testnets.gno.land` — a host
     *  that does not resolve — silently breaking every explorer link in the app
     *  from the cutover until 2026-07-31. Verify a candidate against one of our
     *  OWN realms (`/r/samcrew/memba_dao`), not just `/`: mainnet `gno.land`
     *  answers 200 at the root and 404s our realms, so a root check passes on
     *  exactly the wrong host. */
    explorerUrl: string
    /** When true, the network is reachable by URL/env but hidden from the selector. */
    hidden?: boolean
    /** True for experimental test chains. Drives disclosures that only make sense
     *  off a production chain — e.g. Team Hub's "Data: mainnet" note, which says
     *  the gnolove roster comes from a mainnet-backed source rather than the chain
     *  you are on. Betanet is deliberately NOT a testnet here: `gnolove-team-hub`
     *  e2e encodes "gnoland1 = real chain → no chip", and that product decision is
     *  preserved. This replaces a `networkKey === "test13"` literal that silently
     *  dropped the disclosure on topaz at the cutover. */
    isTestnet?: boolean
    /** When false, Memba's realms are NOT deployed on this network — the app shows
     *  a notice instead of letting DAO/channel features fail with 404s. Omitted
     *  (or true) means the realms are deployed. */
    realmsDeployed?: boolean
}

/** Available Gno networks for the chain selector. */
export const NETWORKS: Record<string, NetworkConfig> = {
    // Testnet 13 — the official Gno testnet (gno v0.9 / pre-interrealm-v2).
    // On-wire chainId is "test-13" (HYPHEN) — it is embedded in the ADR-036 sign
    // doc, so it MUST match the chain exactly or every login fails "invalid user
    // signature". The map KEY ("test13") stays identifier-safe.
    //
    // Canonical RPC is gno-core's official node (rpc.test13.testnets.gno.land,
    // verified live). Kept env-overridable (VITE_TEST13_RPC_URL); onbloc's node
    // (Adena's GetNetwork() default since v1.19.5 #856) remains the fallback — both
    // CSP- and TRUSTED_RPC_DOMAINS-covered. (aeddi's rpc.test-13-aeddi-1 node is on
    // the deprecating *.test-13.gnoland.network family per gno core (2026-06-24) —
    // dropped as a generic fallback; kept below only as a telemetry full-topology
    // source until gno core names a replacement.)
    //
    // RETIRED (2026-07-26): test13 was wound down by gno core — its RPCs and
    // indexer refuse connections. Kept in NETWORKS (hidden) so deep links and
    // stored selections resolve instead of crash-looping the /:network
    // redirects; remove the entry once nothing references it.
    test13: {
        chainId: "test-13",
        hidden: true,
        isTestnet: true,
        rpcUrl: import.meta.env.VITE_TEST13_RPC_URL || "https://rpc.test13.testnets.gno.land:443",
        fallbackRpcUrls: [
            "https://test13.rpc.onbloc.xyz:443",
        ],
        // Telemetry sources for the Validators monitoring view. The canonical RPC
        // and onbloc sit behind sentries and each see only ~5 /net_info peers
        // (not even the validator nodes). aeddi-1 (gno-core, what gnockpit uses)
        // sees the full ~13-node topology; samourai-dev-sentry-1 is our own
        // well-connected node. Unioned by getAggregatedNetPeers so the peer list
        // matches the real network. Both are TRUSTED_RPC_DOMAINS-covered.
        // NOTE: aeddi-1 is on the deprecating *.test-13.gnoland.network family
        // (gno core, 2026-06-24) with no official full-topology replacement yet, so
        // it is kept here (it degrades gracefully when retired — getAggregatedNetPeers
        // simply unions whatever responds). Revisit when gno core names the successor.
        telemetryRpcUrls: [
            "https://rpc.test-13-aeddi-1.gnoland.network:443",
            "https://rpc.testnet13.samourai.live:443",
        ],
        // Official test13 tx-indexer (gno-core, 2026-06-24). Env-overridable.
        indexerUrl: import.meta.env.VITE_TEST13_INDEXER_URL || "https://indexer.test13.testnets.gno.land/graphql/query",
        label: "Testnet 13",
        userRegistryPath: "gno.land/r/sys/users",
        faucetUrl: "https://faucet.gno.land",
        // Retired with the rest of test13 (host no longer resolves). Kept so an
        // old deep link renders a dead link rather than a wrong one pointing at
        // another chain. Env override retained.
        explorerUrl: import.meta.env.VITE_TEST13_EXPLORER_URL || "https://test13.testnets.gno.land",
    },
    // ── Topaz (topaz-1) ──────────────────────────────────────────────────
    // RETIRED (2026-08-12): the chain was decommissioned — both public RPCs
    // (official + onbloc) stopped answering — after Adena v1.20.3 had already
    // dropped topaz-1 and migrated wallet state to sapphire-1. Memba's realm
    // set (32 artifacts incl. the 2026-07-21 and 2026-07-31 ceremonies) remains
    // published on the dead chain; realm-versions.json keeps the chain-verified
    // record. Kept in NETWORKS (hidden) for the same reason as test13: deep
    // links and stored selections must resolve to the honest degraded view and
    // the switcher escape, not crash-loop the /:network redirects. Remove the
    // entry once nothing references it.
    topaz: {
        chainId: "topaz-1",
        hidden: true,
        isTestnet: true,
        // No monitoringChain override: gnomonitoring's registry currently
        // resolves "topaz-1" directly (verified live 2026-07-23). It briefly
        // needed an override to "topaz" (#988, 2026-07-22) — that flipped back
        // within 24h. See the monitoringChain doc-comment above before
        // re-adding one; re-verify live first, don't restore #988's value from
        // memory.
        rpcUrl: import.meta.env.VITE_TOPAZ_RPC_URL || "https://rpc.topaz.testnets.gno.land:443",
        // Our own sentry (rpc.topaz.samourai.live) was retired 2026-08-10 — the
        // host was repurposed to sapphire-1, the DNS record deleted, and it now
        // serves a cert for rpc.sapphire.samourai.live. Replaced with onbloc's
        // topaz-1 node (verified live 2026-08-10: network topaz-1, catching_up
        // false, serves abci_query, archive depth reaches height 100000) so
        // topaz keeps a second node instead of going single-homed.
        fallbackRpcUrls: [
            "https://topaz.rpc.onbloc.xyz:443",
        ],
        // No full-topology telemetry node identified yet for topaz-1;
        // Validators view will show partial data. Revisit when gno core
        // or our infra team stands up a full-topology sentry.
        telemetryRpcUrls: [],
        // Official topaz tx-indexer (live-verified 2026-07-26, GraphQL POST 200).
        // Env-overridable like the other networks.
        indexerUrl: import.meta.env.VITE_TOPAZ_INDEXER_URL || "https://indexer.topaz.testnets.gno.land/graphql/query",
        label: "Topaz",
        userRegistryPath: "gno.land/r/sys/users",
        faucetUrl: "https://faucet.gno.land",
        // Live-verified 2026-07-31: 200 on `/`, `/r/sys/users` AND
        // `/r/samcrew/memba_dao` (our own realm — the check that actually
        // proves it is the right chain's gnoweb). NOT `topaz-1.…`, which is
        // what the old chainId-derived construction produced and does not exist.
        explorerUrl: import.meta.env.VITE_TOPAZ_EXPLORER_URL || "https://topaz.testnets.gno.land",
    },
    // ── Sapphire (sapphire-1) ────────────────────────────────────────────
    // Memba's LIVE default network since the cutover release. The move was
    // forced, not chosen: Adena v1.20.3 (Chrome Web Store, 2026-08-10) dropped
    // `topaz-1` and its v024 storage migration wiped topaz-scoped wallet state,
    // and topaz-1 itself was decommissioned on 2026-08-12 — so the wallet, the
    // chain, and this app all had to land on sapphire-1 together.
    //
    // The entry shipped DARK first (#1063: hidden, realmsDeployed:false, empty
    // allowlist) so this cutover could be a small reviewable flag flip instead
    // of a big-bang PR. The flip pairs with three backend moves that MUST land
    // in the same window (see docs/OPS_RUNBOOK.md): the Fly chain/RPC secrets,
    // FEED_START_BLOCK (a sapphire height — topaz heights are meaningless
    // here), and the mandatory feed-state reset (the DB cursor beats the env
    // floor; stale topaz rows silently poison it).
    //
    // Live-verified before the flip: both RPCs report `sapphire-1`,
    // catching_up false, matching heights; indexer latestBlockHeight tracks;
    // faucet answers the standard gno JSON-RPC 2.0 shape.
    sapphire: {
        chainId: "sapphire-1",
        hidden: false,
        // Flipped to true by the cutover PR AFTER the phase-1 ceremony
        // published the realm set (deps + gnodaokit + 11 funds-free Memba
        // realms) — per-artifact vm/qfile records live in realm-versions.json's
        // `sapphire` section. While this was false it bought the honest
        // RealmsNotDeployedBanner instead of a silently-empty app (the F-28
        // failure shape); topaz/test13 now rely on the chain-health degraded
        // view instead, since their realms ARE deployed — the chains are gone.
        realmsDeployed: true,
        isTestnet: true,
        // No monitoringChain override: gnomonitoring resolves `sapphire-1`
        // directly (live-verified 2026-08-11, GET /uptime?chain=sapphire-1 →
        // 200). Per the monitoringChain doc-comment above, re-verify live before
        // ever adding one — do not restore a value from memory.
        rpcUrl: import.meta.env.VITE_SAPPHIRE_RPC_URL || "https://rpc.sapphire.testnets.gno.land:443",
        // Onbloc's sapphire node — this is also the RPC Adena itself ships for
        // sapphire-1 (chains.json), so it is the path of least surprise.
        fallbackRpcUrls: [
            "https://sapphire.rpc.onbloc.xyz:443",
        ],
        // No full-topology telemetry node identified for sapphire-1 yet, same as
        // topaz. Validators view will show partial data until one exists.
        telemetryRpcUrls: [],
        indexerUrl: import.meta.env.VITE_SAPPHIRE_INDEXER_URL || "https://indexer.sapphire.testnets.gno.land/graphql/query",
        label: "Sapphire",
        userRegistryPath: "gno.land/r/sys/users",
        // The chain-specific faucet subdomain is an API-only endpoint — a
        // browser GET answers 405 (owner-observed 2026-08-16, mid-activation).
        // Send people to the faucet HUB like every other network entry does;
        // its "Sapphire Faucet" card is the actual web UI.
        faucetUrl: "https://faucet.gno.land",
        // Live-verified 2026-08-11 with a WORKING NEGATIVE CONTROL, which is the
        // part that makes this trustworthy: 200 on `/` and on `/r/sys/users`
        // (so it really is a gno chain's gnoweb), 404 on
        // `/r/samcrew/memba_dao` — while the SAME path on topaz's gnoweb returns
        // 200. The 404 is therefore genuine absence, not a broken probe: we have
        // deployed nothing to sapphire yet (see W3-3b — `p/samcrew/avl` is also
        // absent here and must lead the publish order).
        explorerUrl: import.meta.env.VITE_SAPPHIRE_EXPLORER_URL || "https://sapphire.testnets.gno.land",
    },
    pearl: {
        // Pearl — the next testnet, released as an RC, launching
        // 2026-08-26 14:00 UTC; it SUPERSEDES sapphire-1. Pre-registered
        // 2026-08-23 so the cutover is a flag flip, not a new block: see
        // docs/PEARL_CUTOVER_PLAN.md.
        //
        // chainId is CONFIRMED, not conventional: pearl's genesis is generated
        // with CHAIN_ID=pearl-1 (gnolang/gno branch chain/pearl,
        // misc/deployments/pearl.gno.land/gen-genesis.sh:52, corroborated by
        // that directory's VALIDATOR.md and govdao-exec.sh). That script MAKES
        // the chain, so it outranks any announce — but it still is not the
        // running node, so re-assert against the LAUNCHED node (GET
        // <rpc>/status → .result.node_info.network) in the cutover PR. Until
        // then this entry stays `hidden` (never in the selector, never restored
        // from storage, only resolvable by explicit URL) and
        // `realmsDeployed: false` buys the honest RealmsNotDeployedBanner for
        // anyone who lands on it. Auth is fail-closed anyway: a wrong chainId
        // here can only produce a token the server refuses
        // (AUTH-CHAINID-MISMATCH-01), never a wrong-chain tx.
        chainId: "pearl-1",
        hidden: true,
        // Flip to true in the cutover PR AFTER the combined Pearl ceremony
        // (core set + commerce set) has per-artifact vm/qfile records in
        // realm-versions.json's `pearl` section — same rule as sapphire's flip.
        realmsDeployed: false,
        isTestnet: true,
        // ⛔ This hostname RESOLVES TODAY AND LIES. As of 2026-08-25 it answers
        // 200 OK with node_info.network = "sapphire-1", build_version =
        // "chain/sapphire", frozen at height 395317 since 2026-08-24T20:00:14Z
        // while real sapphire runs ~20k blocks ahead — pre-provisioned infra
        // waiting for the pearl genesis, reproduced across three distinct pool
        // instances. So DNS resolution and an HTTP 200 are BOTH false positives
        // for "Pearl is up"; the only valid liveness test is
        // node_info.network == "pearl-1". Env overrides exist so a preview can
        // point at whatever the launch actually exposes without a code change.
        rpcUrl: import.meta.env.VITE_PEARL_RPC_URL || "https://rpc.pearl.testnets.gno.land:443",
        // Empty on purpose: verified 2026-08-25 that NEITHER candidate exists
        // yet — pearl.rpc.onbloc.xyz and rpc.pearl.samourai.live are both
        // NXDOMAIN, and infra_gno-validator has no chain/pearl branch (only
        // sapphire, test-13, test11). Fill once a second real node exists; the
        // two-node rule matters most for the feed tailer, which must not share
        // an endpoint with the app.
        fallbackRpcUrls: [],
        telemetryRpcUrls: [],
        indexerUrl: import.meta.env.VITE_PEARL_INDEXER_URL || "https://indexer.pearl.testnets.gno.land/graphql/query",
        label: "Pearl",
        userRegistryPath: "gno.land/r/sys/users",
        // Hub, not the per-chain subdomain (API-only — browser GET → 405, the
        // sapphire lesson): activation needs gas, so verify Pearl is listed on
        // the hub before the flag flip.
        faucetUrl: "https://faucet.gno.land",
        explorerUrl: import.meta.env.VITE_PEARL_EXPLORER_URL || "https://pearl.testnets.gno.land",
    },
    gnoland1: {
        chainId: "gnoland1",
        rpcUrl: "https://rpc.gnoland1.samourai.live:443",
        fallbackRpcUrls: [
            "https://rpc.gnoland1.moul.p2p.team",
            "https://rpc.gnoland1.aeddi.org",
            "https://rpc.betanet.testnets.gno.land",
        ],
        label: "Betanet (gnoland1)",
        userRegistryPath: "gno.land/r/sys/users",
        faucetUrl: "",
        // Hidden from the selector, and declared realm-free (F-28/F-29).
        // Memba deploys NOTHING to Betanet — FEATURED_DAO_REALM.gnoland1 is
        // null — yet it was the one selectable network with no REALM_ALLOWLIST
        // entry, and isRealmValidOn fails OPEN on a missing entry. Every
        // commerce predicate therefore returned true here, so
        // /gnoland1/marketplace/nfts rendered a live marketplace with a "Launch
        // a collection" CTA on a chain with no realms (verified on production
        // 2026-07-31). Auth fails the other way: this chain has never been in
        // MEMBA_ACCEPTED_CHAIN_IDS, so a login succeeds and then every call
        // 401s with no self-heal (F-29). Until both are properly fixed, do not
        // offer it: `hidden` removes the selector path, `realmsDeployed:false`
        // gives anyone on an old deep link the honest banner instead of a
        // fake-live marketplace, and the allowlist entry below closes the
        // fail-open. Deep links still RESOLVE — same treatment as test13.
        hidden: true,
        realmsDeployed: false,
        // Live-verified 2026-07-31: serves `<meta name="chainid" content="gnoland1">`,
        // i.e. this really is Betanet's gnoweb. Both previous values were wrong in
        // different directions — `getExplorerBaseUrl` returned `betanet.gno.land`
        // (does not resolve) and `lib/gnoweb` returned `gno.land` (MAINNET, which
        // answers 200 for shared paths like `/u/<name>` and would show a different
        // chain's data with no visible failure).
        explorerUrl: "https://betanet.testnets.gno.land",
    },
}

/** Networks shown in the selector (all non-hidden ones). NETWORKS stays the
 *  full map for resolution by URL/env/localStorage. */
export const VISIBLE_NETWORKS: Record<string, NetworkConfig> = Object.fromEntries(
    Object.entries(NETWORKS).filter(([, n]) => !n.hidden),
)

/** The networks a switcher must offer while `activeKey` is active — always
 *  including the ACTIVE one, even when it is hidden.
 *
 *  A hidden network stays reachable by explicit URL, but a <select> whose only
 *  option is a DIFFERENT network cannot fire onChange — the control would display
 *  the wrong network and switching away would be impossible. Prepending the active
 *  network keeps the escape hatch open, and it is this — not the storage self-heal
 *  — that guarantees a hidden network is always leavable (see
 *  `resolveDefaultNetwork`, where the heal can legitimately be inert).
 *
 *  Lives here, not in a component: it was duplicated verbatim in TopBar and
 *  MobileTabBar, and drifting copies of exactly this rule are what produced F-28. */
export function selectableNetworksFor(activeKey: string): Record<string, NetworkConfig> {
    return NETWORKS[activeKey] && !VISIBLE_NETWORKS[activeKey]
        ? { [activeKey]: NETWORKS[activeKey], ...VISIBLE_NETWORKS }
        : VISIBLE_NETWORKS
}


/**
 * Resolves the default network key from VITE_GNO_CHAIN_ID, validated against
 * NETWORKS. A stale/removed env value (e.g. a retired "test12" left in a Netlify
 * build var) must NOT become the default: an invalid default makes the /:network
 * redirects (RootRedirect/LegacyRedirect/NetworkGate) loop forever, prepending the
 * bad key (/test12/test12/…) until the browser throttles replaceState and the app
 * crashes — hit on mobile / private browsing, where localStorage holds no valid
 * network to override it. Exported for tests.
 *
 * Membership in NETWORKS is the ONLY requirement — a `hidden` network is a valid
 * default and is deliberately allowed through. Pinning one is how the pinned-flag
 * e2e servers work: root `.env.e2e` sets `VITE_GNO_CHAIN_ID=test13`, and
 * `marketplace-gating.spec.ts` (:5174) depends on landing there, because its
 * live-vs-gated lane expectations are built on test13's REALM_ALLOWLIST — on
 * topaz neither `memba_nft_market_v3_2` nor `escrow_v3` is allowlisted, so both
 * "live" lanes would gate and the spec's default landing lane would vanish.
 *
 * Consequence, stated plainly: in such a build DEFAULT_NETWORK is hidden, so
 * `resolveStoredNetworkKey` below heals one hidden network to another and layer 1
 * is inert. That is SAFE and is not what prevents stranding — `selectableNetworksFor`
 * is. It always prepends the ACTIVE network to the switcher, so a hidden active
 * network still has an option and can still be left. Do not add a `!hidden` check
 * here without moving that e2e contract first.
 */
export function resolveDefaultNetwork(envKey: string | undefined): string {
    return envKey && NETWORKS[envKey] ? envKey : "sapphire"
}

/** Default network key (always a valid NETWORKS entry — see resolveDefaultNetwork). */
export const DEFAULT_NETWORK = resolveDefaultNetwork(import.meta.env.VITE_GNO_CHAIN_ID)

/** Resolve active network from localStorage or env.
 *  WARNING: shared.ts and profile.ts compute USER_REGISTRY at module load time.
 *  useNetwork.ts MUST call window.location.reload() on network switch to re-initialize.
 */
/** Resolve a STORED network selection, self-healing away from hidden networks.
 *
 *  A stored key must also be VISIBLE. Hidden networks stay resolvable by
 *  explicit URL (deep links keep working) but must never be restored from
 *  localStorage, because a hidden network has no option in the switcher — and
 *  when only one network is visible, a single-option <select> cannot fire
 *  `onChange` at all. A user whose stored key was hidden would be pinned to it
 *  with no in-app way out, on this visit and every future one.
 *
 *  PRECISELY what this guarantees: the stored key itself is never restored when
 *  it is hidden. It does NOT guarantee a visible result — the fallback is
 *  DEFAULT_NETWORK, which is visible in every shipped build (prod, deploy
 *  previews, CI) but is deliberately HIDDEN on the pinned-flag e2e servers, where
 *  `.env.e2e` sets test13. See `resolveDefaultNetwork` for why that stays. The
 *  guarantee that nobody is stranded comes from `selectableNetworksFor`, which
 *  always offers the active network; this heal is defence in depth on top of it.
 *
 *  Used by the NAVIGATION resolvers (`useNetwork`, `RootRedirect`,
 *  `LegacyRedirect`) only — NOT by `getActiveNetworkKey` below, which must honour
 *  a stored hidden key so deep links initialise on the right network. See that
 *  function's comment. */
export function resolveStoredNetworkKey(stored: string | null | undefined): string {
    if (stored && NETWORKS[stored] && !NETWORKS[stored].hidden) return stored
    return DEFAULT_NETWORK
}

/** Module-load active network. Deliberately does NOT self-heal away from a
 *  hidden network — unlike the navigation resolvers.
 *
 *  This value initialises every RPC/realm constant in this file BEFORE the
 *  router mounts, so it is the only signal a deep link has. Self-healing it
 *  broke `/test13/*` visits: config would initialise on topaz while the URL said
 *  test13, so NetworkSync reloaded and the realm-gated UI rendered the wrong
 *  network's state (it took out the CreateToken e2e specs).
 *
 *  Stranding is prevented elsewhere and does not need this: RootRedirect no
 *  longer restores a hidden key, so `/` goes to the default; the switcher always
 *  lists the ACTIVE network, so you can leave one you reached by URL; and
 *  NetworkSync writes the URL network to storage, so the one-time bounce
 *  through a hidden network converges after a single reload. */
function getActiveNetworkKey(): string {
    try {
        const stored = localStorage.getItem("memba_network")
        if (stored && NETWORKS[stored]) return stored
    } catch { /* SSR or missing localStorage */ }
    return DEFAULT_NETWORK
}

const _activeNetwork = getActiveNetworkKey()

/** The network key ALL module-load config in this file was computed with
 *  (GNO_CHAIN_ID, GNO_RPC_URL, …). NetworkSync compares the /:network URL param
 *  against THIS — not raw localStorage — so a reload only happens when the
 *  loaded config actually differs (a first visit landing on the default network
 *  persists the key silently instead of double-loading the whole app). */
export const ACTIVE_NETWORK_KEY = _activeNetwork

/**
 * Returns the user registry realm path for the active network.
 * On test13/betanet this is `gno.land/r/sys/users` (upstream migration).
 */
export function getUserRegistryPath(): string {
    return NETWORKS[_activeNetwork]?.userRegistryPath || "gno.land/r/sys/users"
}

/**
 * Whether Memba's realms are deployed on the given network. A network may be
 * official and reachable (e.g. test13) while Memba's own contracts are not yet
 * deployed there — in that case DAO/channel features would 404. Returns false
 * only when the network explicitly sets `realmsDeployed: false`; unknown
 * networks default to true (don't gate the whole UI on a typo'd key).
 *
 * NOTE the deliberate asymmetry with `isRealmValidOn` below, which fails CLOSED
 * on an unknown network. This one is a coarse banner signal, not a gate: it
 * decides whether to show "realms not deployed here", and defaulting it closed
 * would put that banner on every network we forgot to enumerate. The per-realm
 * predicate is the one that gates fund-custody UI, and that is the one that must
 * fail closed. Betanet is covered by BOTH (`realmsDeployed: false` + an explicit
 * empty allowlist) — it does not rely on either default.
 */
export function networkHasRealms(networkKey: string): boolean {
    return NETWORKS[networkKey]?.realmsDeployed !== false
}

/** Whether Memba's realms are deployed on the currently active network. */
export function areRealmsDeployed(): boolean {
    return networkHasRealms(_activeNetwork)
}

/**
 * Per-realm validity allowlist, keyed by network. `networkHasRealms` is coarse
 * (all-or-nothing); test13 is the first "partial" network where some realms are
 * deployed & valid (interrealm-v2) while others are stale v1 packages the v2 VM
 * can't evaluate (calls throw "unexpected node …:0:0") or simply absent. List
 * here ONLY the realms confirmed callable on that network; a network with no
 * entry gates EVERYTHING (fail closed — see isRealmValidOn). When a realm is
 * (re)deployed to a new valid path, add that path here.
 *
 * ⚠️ Adding a path here DE-GATES that lane on that network — `isRealmValidOn` is
 * the only gate most of them have. This is not bookkeeping: only add a path once
 * the realm is verified live on the chain.
 *
 * HELD BACK from every live network (this governed topaz until its 2026-08-12
 * retirement and governs sapphire identically — see #1039/#1040, closed as
 * superseded with this substance preserved):
 *   - escrow_v3, memba_token_otc_v2 — CUSTODY FUNDS (`OriginSend` in,
 *     `SendCoins` out). Their listing was blocked on an unverified ceremony
 *     precondition ("old realms paused + reconciliation-drained") that the
 *     deployer never checked; that check must become a deployer preflight gate
 *     before the sapphire commerce ceremony lists them.
 *   - memba_nft_v2, memba_collections, memba_nft_market_v2,
 *     memba_nft_market_v3_1, memba_nft_market_v3_2 — the NFT stack CUSTODIES
 *     FUNDS and moves as ONE unit (partial listing gives inconsistent
 *     surfaces). VITE_ENABLE_NFT is back in SAFETY_GATED_FLAGS (this release),
 *     so the allowlist is no longer its only structural gate.
 *   - memba_market_config — does NOT custody funds (its three files carry no
 *     banker/coin references; the only writes are the admin.gno setters), but
 *     it SETS the fee/treasury the trading engines read, so it ships with the
 *     commerce ceremony, not before. Classification comes from realm source,
 *     not from this comment's history (an earlier revision misfiled it as
 *     custodial).
 */
const REALM_ALLOWLIST: Record<string, readonly string[] | undefined> = {
    // Betanet: Memba deploys nothing here. An EXPLICIT empty list, not an
    // absent key — absent means "no allowlist", which isRealmValidOn used to
    // read as "everything is valid" (F-28).
    gnoland1: [],
    // Pearl: NOTHING deployed yet (pre-registered 2026-08-23, hidden). An
    // EXPLICIT empty list for the same F-28 reason as gnoland1. The cutover PR
    // fills it with the combined-ceremony set — the 24 core artifacts PLUS the
    // ceremony-verified commerce set (escrow_v3, memba_token_otc_v2,
    // tokenfactory_v2, memba_collections, memba_market_config,
    // memba_nft_market_v3_2 — the NFT stack as one unit; the legacy v2 pair and
    // v3_1 are NOT deployed on pearl, so never listed) — every entry backed by a
    // realm-versions.json `pearl` record first (merge-blocking rule above).
    pearl: [],
    test13: [
        "gno.land/r/samcrew/memba_dao",
        "gno.land/r/samcrew/memba_dao_candidature_v2", // paused; kept so the 2 legacy applicants can still Withdraw
        "gno.land/r/samcrew/memba_dao_candidature_v3", // IsUserCall-guarded successor (P0 fund-drain fix) — canonical
        "gno.land/r/samcrew/memba_dao_channels_v2",
        "gno.land/r/samcrew/agent_registry", // v1 (unguarded UseCredit); superseded by agent_registry_v2, empty on test13 — kept defensively
        "gno.land/r/samcrew/agent_registry_v2", // IsUserCall-guarded successor — canonical (active agentRegistryPath)
        // Commerce realms redeployed to interrealm-v2 _v2 paths (2026-06-16).
        "gno.land/r/samcrew/tokenfactory_v2",
        "gno.land/r/samcrew/escrow_v2", // superseded by escrow_v3; empty on test13, kept allowlisted defensively (no UI targets it)
        "gno.land/r/samcrew/escrow_v3", // IsUserCall-guarded successor — canonical (active escrowPath)
        "gno.land/r/samcrew/gnobuilders_badges_v2",
        "gno.land/r/samcrew/memba_feedback_v2",
        // NFT realms deployed 2026-06-16.
        "gno.land/r/samcrew/memba_nft_v2",
        "gno.land/r/samcrew/memba_nft_market_v2",
        // Phase 2 canonical launchpad registry — deployed 2026-06-17 (multisig
        // seq 43). isNftLaunchpadValid() now flips true so /nft/create,
        // /nft/collection/:id and /nft/creator/:address surface, along with the
        // verified-collection badge (both key off this registry).
        "gno.land/r/samcrew/memba_collections",
        "gno.land/r/samcrew/memba_reviews_v1",
        // ── Marketplace W1 go-live ────────────────────────────────────────────
        // The v3.1 trading engine — DEPLOYED + REGISTERED on test13 (2026-06-27,
        // multisig seq 51-53; sole registered market on memba_collections). The
        // engine reads its DAO fee/treasury from memba_market_config. isNftMarketV3Valid()
        // keys off this path; the trade surface ALSO requires VITE_ENABLE_NFT=true, so
        // prod stays dark (flag is force-false there) until the deploy-preview G1 verify.
        // v3.1 stays allowlisted through the wind-down: it is PAUSED (no new trades)
        // but 2 open offers hold escrow — value-exits (CancelOffer/ClaimExpiredOffer)
        // must remain callable. Remove once its escrow drains to zero.
        // ⚠️ When you do: `config.test.ts`'s held-back block anchors the topaz
        // gating assertions on "this path is valid on test13", so dropping this
        // entry reds that test with a message about a typo. Remove the path from
        // that test's anchor loop in the same commit — do not delete the anchor.
        "gno.land/r/samcrew/memba_nft_market_v3_1",
        // The ACTIVE engine since the 2026-07-10 ceremony (deployed, registered,
        // salesLog seeded from v3.1 and SEALED; solvency getters live).
        "gno.land/r/samcrew/memba_nft_market_v3_2",
        // ── Phase 11 Token OTC ────────────────────────────────────────────────
        // v2 = the IsUserCall-guarded Fill successor — deployed + live on test13.
        // v1's unguarded OriginSend Fill was never deployed and is mainnet-blocked
        // by the deployer fund-safety gate, so the lane targets the guarded realm.
        "gno.land/r/samcrew/memba_token_otc_v2",
    ],
    // Topaz (topaz-1) — ceremony scope (2026-07-21): 9 Memba realms. Chain
    // RETIRED 2026-08-12; the list stays truthful about what is published on
    // the (dead) chain for as long as the hidden entry resolves.
    topaz: [
        "gno.land/r/samcrew/memba_dao",
        "gno.land/r/samcrew/memba_dao_candidature_v3",
        "gno.land/r/samcrew/memba_dao_channels_v2",
        "gno.land/r/samcrew/agent_registry_v2",
        "gno.land/r/samcrew/memba_reviews_v1",
        "gno.land/r/samcrew/memba_quest_attestation_v1",
        "gno.land/r/samcrew/memba_feed_v1",
        "gno.land/r/samcrew/memba_appstore_v1",
        "gno.land/r/samcrew/memba_appstore_v2",
        // ── commerce-v2 ceremony (2026-07-31), FUNDS-FREE realms only ─────────
        // 13 artifacts went live on topaz-1 in that ceremony; only these three are
        // listed here. Each was verified funds-free on BOTH sides before listing:
        // the realm source contains no `banker.NewBanker`, no `unsafe.OriginSend()`
        // and no `SendCoins`, and the frontend client attaches no coins
        // (`grc20.ts` sends ""). The remaining commerce realms — the NFT stack,
        // escrow_v3 and memba_token_otc_v2 — DO custody funds and are deliberately
        // held back to separate PRs; see the note above this map.
        "gno.land/r/samcrew/tokenfactory_v2",   // de-gates isTokenFactoryValid
        "gno.land/r/samcrew/memba_feedback_v2", // de-gates isFeedbackValid
        // INERT — listed defensively, changes no behaviour today. The badges
        // reader (lib/badges.ts) uses its own BADGE_REALM_PATH constant and is
        // guarded by NO isRealmValid predicate, so it already queried this realm on
        // topaz. Listed so the allowlist stays a truthful record of what is
        // deployed, and so adding a guard later cannot silently gate it off.
        "gno.land/r/samcrew/gnobuilders_badges_v2",
    ],
    // Sapphire (sapphire-1) — phase-1 cutover scope: the FUNDS-FREE set only,
    // published by the multisig ceremony that precedes this PR's merge.
    // Per-artifact chain proof (vm/qfile fileCount, height, tx) lives in
    // realm-versions.json's `sapphire` section; every entry below must have a
    // record there BEFORE this list merges — an entry here without one is a
    // merge-blocking review finding, not a nit.
    //
    // Funds-free discipline (same three-sided check the topaz block above
    // records): realm source has no `banker.NewBanker`, no
    // `unsafe.OriginSend()`, no `SendCoins`; the frontend client attaches no
    // coins; the artifact is chain-verified at the listed path.
    //
    // DELIBERATE EXCLUSIONS:
    //   - tokenfactory_v2 — deployable but NOT deployed in phase 1 (owner
    //     decision D3(b), 2026-08-15): its applyFee mints 2.5% of every Mint()
    //     to a hardcoded recipient with no setter, and redeploying bakes that
    //     into an immutable path. isTokenFactoryValid therefore stays false on
    //     sapphire — token creation is gated dark until the fee config is
    //     ruled on.
    //   - the fund-custody set (NFT stack, escrow_v3, memba_token_otc_v2,
    //     memba_market_config) — sapphire commerce ceremony, see the map
    //     header.
    sapphire: [
        "gno.land/r/samcrew/memba_dao",
        "gno.land/r/samcrew/memba_dao_candidature_v3",
        "gno.land/r/samcrew/memba_dao_channels_v2",
        "gno.land/r/samcrew/agent_registry_v2",
        "gno.land/r/samcrew/memba_reviews_v1",
        "gno.land/r/samcrew/memba_quest_attestation_v1",
        "gno.land/r/samcrew/memba_feed_v1",
        "gno.land/r/samcrew/memba_appstore_v1",
        "gno.land/r/samcrew/memba_appstore_v2",
        "gno.land/r/samcrew/memba_feedback_v2", // de-gates isFeedbackValid
        // INERT defensively-listed badges realm — same rationale as the topaz
        // entry: the badges reader keys off BADGE_REALM_PATH with no
        // isRealmValid predicate, so listing keeps the record truthful and
        // future-proofs a guard.
        "gno.land/r/samcrew/gnobuilders_badges_v2",
    ],
}

/**
 * Is a realm callable on the given network? Networks without an allowlist entry
 * gate everything — this fails CLOSED (see the body for why).
 */
export function isRealmValidOn(networkKey: string, realmPath: string): boolean {
    const allow = REALM_ALLOWLIST[networkKey]
    // FAIL CLOSED. This read `!allow || allow.includes(...)`, so a network with
    // no allowlist entry declared EVERY realm valid — and since these
    // predicates gate the commerce lanes (escrow, OTC, NFT market, token
    // factory), forgetting an entry silently un-gated fund-custody UI on that
    // network. That is exactly what happened to Betanet. An unknown network is
    // now treated as "we have deployed nothing there", which is the true
    // statement for any network we have not explicitly provisioned.
    if (!allow) return false
    return allow.includes(realmPath)
}

/**
 * Is a realm callable on the currently active network? Use this to hide
 * features whose backing realm is missing or invalid on the active chain,
 * instead of letting a maketx fail with a raw VM error.
 */
export function isRealmValid(realmPath: string): boolean {
    return isRealmValidOn(_activeNetwork, realmPath)
}


/** Gno chain ID for all RPC calls. */
export const GNO_CHAIN_ID = NETWORKS[_activeNetwork]?.chainId || "topaz-1"

/** The key gnomonitoring knows the active network by — NOT the on-chain chain id.
 *  Defaults to chainId, which is right wherever the two coincide (test-13,
 *  gnoland1). Use this for gnomonitoring API calls ONLY; anything that reaches
 *  the chain or the wallet must keep using GNO_CHAIN_ID. */
export const GNO_MONITORING_CHAIN =
    NETWORKS[_activeNetwork]?.monitoringChain || GNO_CHAIN_ID

/**
 * Network-scope a storage key for CHAIN-DERIVED state (W2.2). Anything cached
 * from chain reads (faucet claims, resolved usernames, wallet-RPC trust) must
 * not survive a test12↔test13 switch under the same key — stale cross-network
 * data would be served as current. Chain-agnostic UI state (page-visit
 * counters, UX dismissals) should NOT use this.
 */
export function networkScopedKey(base: string): string {
    return `${base}::${GNO_CHAIN_ID}`
}

/**
 * Normal Gno RPC endpoint for standard ABCI queries and broadcasting.
 * Defaults to the active network's RPC URL.
 */
export const GNO_RPC_URL = NETWORKS[_activeNetwork]?.rpcUrl || "https://rpc.sapphire.testnets.gno.land:443"

/** Fallback RPC URLs for the active network (tried in order if primary fails). */
export const GNO_FALLBACK_RPC_URLS: string[] = NETWORKS[_activeNetwork]?.fallbackRpcUrls || []

/**
 * Samourai Sentry RPC URL (Dual-RPC Strategy).
 * Used optionally by Hacker Mode for direct, high-frequency, uncached consensus telemetry
 * (e.g. /net_info, /dump_consensus_state) when available on gnoland1.
 */
export const SAMOURAI_SENTRY_RPC_URL = import.meta.env.VITE_SAMOURAI_SENTRY_RPC_URL || ""

/**
 * Retrieves the optimal RPC URL for Hacker Mode telemetry.
 *
 * Security: validates the sentry URL against TRUSTED_RPC_DOMAINS before use.
 * If the sentry URL is not trusted (misconfigured env var), logs a warning
 * and falls back to the standard public RPC.
 *
 * Priority: SAMOURAI_SENTRY_RPC_URL (trusted) → GNO_RPC_URL
 */
export function getTelemetryRpcUrl(): string {
    if (SAMOURAI_SENTRY_RPC_URL) {
        if (isTrustedRpcDomain(SAMOURAI_SENTRY_RPC_URL)) {
            return SAMOURAI_SENTRY_RPC_URL
        }
        // Untrusted sentry URL — warn and fall back (security hardening S4)
        console.warn(
            `[Memba] VITE_SAMOURAI_SENTRY_RPC_URL is not a trusted domain: ${SAMOURAI_SENTRY_RPC_URL}. ` +
            "Falling back to GNO_RPC_URL. Add the domain to TRUSTED_RPC_DOMAINS in config.ts if intentional."
        )
    }
    // Prefer the best-connected telemetry node (fresher consensus state) over the
    // sentry-fronted primary; falls back to GNO_RPC_URL if none configured.
    return getTelemetryRpcUrls()[0] || GNO_RPC_URL
}

/**
 * Ordered, deduped list of TRUSTED RPC nodes to poll for network telemetry.
 *
 * `/net_info` is node-local, so a single RPC gives a partial peer view. This
 * unions the env sentry override, the network's dedicated telemetry nodes, the
 * primary RPC, and the fallbacks — letting getAggregatedNetPeers reconstruct the
 * full topology. Untrusted entries are dropped (the env override warns).
 *
 * Priority: VITE_SAMOURAI_SENTRY_RPC_URL → network.telemetryRpcUrls →
 *           GNO_RPC_URL → GNO_FALLBACK_RPC_URLS
 */
export function getTelemetryRpcUrls(): string[] {
    const net = NETWORKS[_activeNetwork]
    const candidates = [
        SAMOURAI_SENTRY_RPC_URL,
        ...(net?.telemetryRpcUrls || []),
        GNO_RPC_URL,
        ...GNO_FALLBACK_RPC_URLS,
    ]
    const out: string[] = []
    const seen = new Set<string>()
    for (const url of candidates) {
        if (!url || seen.has(url)) continue
        if (!isTrustedRpcDomain(url)) {
            if (url === SAMOURAI_SENTRY_RPC_URL) {
                console.warn(
                    `[Memba] VITE_SAMOURAI_SENTRY_RPC_URL is not a trusted domain: ${url}. ` +
                    "Excluding it from telemetry. Add the domain to TRUSTED_RPC_DOMAINS if intentional."
                )
            }
            continue
        }
        seen.add(url)
        out.push(url)
    }
    return out
}

/** External faucet URL for the active network (empty = no faucet). */
export const GNO_FAUCET_URL = NETWORKS[_activeNetwork]?.faucetUrl || ""

/**
 * Realm the wallet-activation flow calls to register a fresh wallet's pubkey
 * on-chain (issue #1078). Any first transaction registers the key; this one is
 * chosen because Adena's DoContract only accepts VM message types (the old
 * bank/MsgSend self-send was rejected wholesale), and this vendored realm's
 * SetStringField writes a per-CALLER field — no cross-user effect, dust gas —
 * and ships in the same ceremony manifest as the rest of Memba, so it exists
 * on every chain the app serves by construction (sapphire: seq/height in
 * realm-versions.json; signature + field schema read back from the deployed
 * source via vm/qfile 2026-08-16). NOTE the realm validates field names — the
 * activation call must use a field from ITS schema ("Bio"), never an invented
 * key ("unknown string profile field" panic, caught live in Adena's gas sim).
 */
export const ACTIVATION_PROFILE_REALM =
    import.meta.env.VITE_ACTIVATION_REALM_PATH || "gno.land/r/samcrew/deps/demo/profile"

/** Explorer base URL for the active network (for user profile links, realm links, etc). */
export function getExplorerBaseUrl(): string {
    return getExplorerBaseUrlFor(_activeNetwork)
}

/** True when the given network KEY is an experimental test chain. Unknown keys
 *  are treated as NOT a testnet — the conservative answer for a disclosure, and
 *  it keeps a stale stored key from flipping UI on. */
export function isTestnetNetwork(networkKey: string): boolean {
    return NETWORKS[networkKey]?.isTestnet === true
}

/** Explorer base URL for an explicit network KEY (not a chain id). Falls back to
 *  the default network so an unknown key can never yield `undefined` in a
 *  template literal — the failure mode that produced `https://undefined/r/...`
 *  links. */
export function getExplorerBaseUrlFor(networkKey: string): string {
    return NETWORKS[networkKey]?.explorerUrl || NETWORKS[DEFAULT_NETWORK].explorerUrl
}

/** GraphQL endpoint the frontend POSTs indexer queries to. The browser cannot
 *  call the public tx-indexer directly (it sends no CORS headers), so requests go
 *  through the backend proxy (`/api/indexer`), which forwards them server-side and
 *  inherits the backend's CORS. Returns null when the active network has no indexer
 *  configured — the activity feed then hides itself. */
export function getIndexerUrl(): string | null {
    if (!NETWORKS[_activeNetwork]?.indexerUrl) return null
    return `${API_BASE_URL}/api/indexer`
}

/** Bech32 human-readable part (HRP) for Gno addresses. */
export const GNO_BECH32_HRP = import.meta.env.VITE_GNO_BECH32_PREFIX || "g"

/** @deprecated Use GNO_BECH32_HRP for HRP or BECH32_PREFIX for address validation. */
export const GNO_BECH32_PREFIX = GNO_BECH32_HRP

// ── 4. Address Constants ─────────────────────────────────────

/** Full bech32 address prefix (HRP + separator) used for address validation. */
export const BECH32_PREFIX = GNO_BECH32_HRP + "1"

/** Conversion factor: 1 GNOT = 1,000,000 ugnot. */
export const UGNOT_PER_GNOT = 1_000_000

// ── 5. External Services ─────────────────────────────────────

/** DAO realm path on-chain. Update when the DAO realm is deployed. */
export const DAO_REALM_PATH = import.meta.env.VITE_DAO_REALM_PATH || "gno.land/r/samcrew/memba_dao"

/** Gnolove API base URL for profile enrichment and contribution data. */
export const GNOLOVE_API_URL = import.meta.env.VITE_GNOLOVE_API_URL || "https://backend.gnolove.world"

/** Gnomonitoring API base URL for validator metrics (monikers, uptime, participation).
 *  Serves Memba's /validators dashboard. Public, no auth required.
 *  Override via VITE_GNO_MONITORING_API_URL if you run your own instance. */
/** Trusted domains for the monitoring API. */
const TRUSTED_MONITORING_DOMAINS = ["gnolove.world", "monitoring.gnolove.world", "localhost"]

function isTrustedMonitoringDomain(url: string): boolean {
    try {
        const hostname = new URL(url).hostname.toLowerCase()
        return TRUSTED_MONITORING_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`))
    } catch { return false }
}

export const GNO_MONITORING_API_URL = (() => {
    const url = import.meta.env.VITE_GNO_MONITORING_API_URL || "https://monitoring.gnolove.world"
    if (url !== "https://monitoring.gnolove.world" && !isTrustedMonitoringDomain(url)) {
        console.warn(`[Memba] Untrusted monitoring API URL: ${url}. Falling back to default.`)
        return "https://monitoring.gnolove.world"
    }
    return url
})()

/** Clerk publishable key for alerting feature auth.
 *  Shared Clerk app instance for Memba alerting.
 *  Only loaded by the /alerts route (lazy). No impact on other pages. */
export const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || ""

// ── 6. GnoSwap DEX Integration ───────────────────────────────

/** GnoSwap realm paths per chain. */
export interface GnoSwapPaths {
    pool: string
    router: string
    position: string
    /** GNS token realm — has working Render() for availability checks. */
    gns: string
}

/** Per-chain GnoSwap contract paths. Empty strings = not deployed on that chain. */
export const GNOSWAP_PATHS: Record<string, GnoSwapPaths> = {
    test13: { pool: "", router: "", position: "", gns: "" },
    topaz: { pool: "", router: "", position: "", gns: "" },
    gnoland1: { pool: "", router: "", position: "", gns: "" },
}

/** Get GnoSwap paths for the active chain. Returns null if not deployed. */
export function getGnoSwapPaths(): GnoSwapPaths | null {
    const paths = GNOSWAP_PATHS[_activeNetwork]
    if (!paths || !paths.gns) return null
    return paths
}

// ── 7. RPC Domain Security ───────────────────────────────────

/**
 * Trusted RPC domain patterns. Only these domains are considered safe.
 * A malicious RPC with a valid chain ID (e.g. https://test13.evil.com)
 * would pass chain ID checks but could intercept/manipulate queries.
 *
 * Samourai Coop sentry nodes are included as trusted for Hacker View telemetry.
 */
export const TRUSTED_RPC_DOMAINS = [
    "gno.land",
    "testnets.gno.land", // covers rpc.test13.testnets.gno.land (official test13) + others
    "rpc.gno.land",
    "gnoland.network", // test-13 indexer/gnoweb + gnoland1 fallbacks, suffix-matched
    "onbloc.xyz",      // test-13 canonical RPC (test13.rpc.onbloc.xyz) — Adena moved here in v1.19.5 (#856)
    // Samourai Coop sentry/validator nodes — trusted for Hacker View dual-RPC strategy.
    // Convention: https://rpc.{chain}.samourai.live
    //   - gnoland1:  https://rpc.gnoland1.samourai.live  (live)
    //   - testnet13: https://rpc.testnet13.samourai.live (live)
    "samourai.live",
    "p2p.team",       // moul's infra + team nodes (gnoland1.moul.p2p.team etc.)
    "aeddi.org",      // aeddi's gnoland1 validator node
    "gnoland1.io",    // gnoland1 betanet official
    "163.172.33.181", // gno core team bare-metal node
    "localhost",      // local devnet
]

/**
 * Check if an RPC URL belongs to a trusted domain.
 * Returns true if the URL's hostname is or ends with a trusted domain.
 *
 * Examples:
 *   isTrustedRpcDomain("https://rpc.test11.testnets.gno.land:443") → true
 *   isTrustedRpcDomain("https://rpc.gno.land:443") → true
 *   isTrustedRpcDomain("https://test11.malicious.land:443") → false
 *   isTrustedRpcDomain("https://fakegno.land:443") → false
 */
export function isTrustedRpcDomain(url: string): boolean {
    try {
        const hostname = new URL(url).hostname.toLowerCase()
        return TRUSTED_RPC_DOMAINS.some(domain => {
            const d = domain.toLowerCase()
            // Exact match or subdomain match (preceded by a dot)
            return hostname === d || hostname.endsWith("." + d)
        })
    } catch {
        return false // invalid URL = untrusted
    }
}

/**
 * Validate that the active network config uses a trusted RPC domain.
 * Returns an error message if untrusted, or null if safe.
 */
export function validateActiveRpcDomain(): string | null {
    if (!isTrustedRpcDomain(GNO_RPC_URL)) {
        return `Untrusted RPC domain detected: ${GNO_RPC_URL}. Expected a *.gno.land domain.`
    }
    return null
}

// ── 8. MembaDAO Token ────────────────────────────────────────

/** GRC20 factory realm path (shared with grc20.ts). */
export const GRC20_FACTORY_PATH = "gno.land/r/samcrew/tokenfactory_v2"

/** Memba token config for development (test13). */
export const MEMBA_TOKEN_DEV = {
    symbol: "MEMBATEST",
    name: "Memba Governance Token (Testnet)",
    decimals: 6,
    totalSupply: "10000000000000", // 10M * 10^6
    factoryPath: GRC20_FACTORY_PATH,
} as const

/** Memba token config for production (betanet/mainnet). */
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

/** MembaDAO realm paths and deployment params. */
export const MEMBA_DAO = {
    realmPath: "gno.land/r/samcrew/memba_dao",
    channelsPath: import.meta.env.VITE_CHANNELS_REALM_PATH || "gno.land/r/samcrew/memba_dao_channels_v2",
    candidaturePath: import.meta.env.VITE_CANDIDATURE_REALM_PATH || "gno.land/r/samcrew/memba_dao_candidature_v3",
    agentRegistryPath: "gno.land/r/samcrew/agent_registry_v2", // IsUserCall-guarded (v1 UseCredit was unguarded)
    escrowPath: "gno.land/r/samcrew/escrow_v3", // IsUserCall-guarded (v2 FundMilestone was unguarded)
    nftMarketPath: "gno.land/r/samcrew/memba_nft_market_v2",
    nftCollectionsPath: "gno.land/r/samcrew/memba_collections", // Phase 2 launchpad registry (pending deploy)
    badgesPath: "gno.land/r/samcrew/gnobuilders_badges_v2",
    reviewsPath: import.meta.env.VITE_REVIEWS_REALM_PATH || "gno.land/r/samcrew/memba_reviews_v1",
    // Reputation-isolated App Store reviews realm (shares the reviews engine but keeps its
    // reputation graph separate from the validator/profile web-of-trust). Deployed to test13.
    appReviewsPath: import.meta.env.VITE_APPSTORE_REVIEWS_REALM_PATH || "gno.land/r/samcrew/memba_appstore_reviews_v1",
    feedPath: import.meta.env.VITE_FEED_REALM_PATH || "gno.land/r/samcrew/memba_feed_v1",
    tokenOtcPath: "gno.land/r/samcrew/memba_token_otc_v2",
    deployFee: 10_000_000, // 10 GNOT in ugnot
} as const

/** Feedback board realm path (shared with FeedbackFeed). */
export const FEEDBACK_REALM_PATH = "gno.land/r/samcrew/memba_feedback_v2"

/**
 * The network key the backend home snapshot is scoped to.
 * useHomeSnapshot gates its query on this key so it never fires on other networks.
 *
 * PINNED and must move in lockstep with the backend's `homeSnapshotRPCURL`
 * (HOME_SNAPSHOT_RPC_URL → NFT_RPC_URL fallback), or the frontend asks for a
 * snapshot of a chain the backend isn't reading. History: held at "test13"
 * until #1009 moved the backend to topaz; moved to "sapphire" in the cutover
 * release together with the backend RPC secret flip. Between any two halves of
 * that window the hook self-disables (safe degradation: home renders without
 * the snapshot enrichment).
 */
export const SNAPSHOT_NETWORK = "sapphire"

/**
 * The network key the backend FEED INDEXER is scoped to — i.e. the one chain
 * whose `memba_feed_v1` events become readable posts.
 *
 * The feed realm path is the SAME on every network Memba allowlists it on, but
 * the backend tails exactly one chain (`FEED_RPC_URL`). So on any other network
 * the app would read this chain's timeline while writing to that chain's realm:
 * the tx succeeds, costs gas, is permanent on-chain, and the post is never
 * visible anywhere. `isFeedWritable()` exists to make that unrepresentable.
 *
 * ⚠️ MUST match the chain behind the backend's `FEED_RPC_URL`. If that env moves
 * (e.g. a Topaz cutover), change this in the SAME release or the feed silently
 * gates off — or, worse, gates ON for a chain the indexer isn't watching.
 * The durable fix is per-chain indexing (chain-scoped indexer state), after
 * which this constant goes away.
 *
 * Topaz cutover (2026-07-26): flipped to "topaz" in the SAME release that flips
 * VITE_GNO_CHAIN_ID and the backend FEED_RPC_URL/FEED_START_BLOCK envs.
 *
 * Sapphire cutover: flipped to "sapphire" in the SAME release as the backend
 * FEED_RPC_URL + FEED_START_BLOCK secret flip AND the mandatory feed-state
 * reset. The reset is load-bearing, not hygiene: `loadFeedCursor` reads the DB
 * cursor first and the env value is only a floor for missing rows, so a stale
 * topaz-height row silently pins the tailer to a block the new chain won't
 * reach for weeks (and the realm-scoped post ids would collide across chains).
 */
export const FEED_INDEXED_NETWORK = "sapphire"

/** Human-readable label for the indexed network (for user-facing copy). */
export const FEED_INDEXED_NETWORK_LABEL =
    NETWORKS[FEED_INDEXED_NETWORK]?.label ?? FEED_INDEXED_NETWORK

/**
 * Whether feed WRITES are safe on the active network — true only when the
 * backend indexes the chain we would be writing to.
 *
 * Reads `ACTIVE_NETWORK_KEY` (module-load config), which is correct because
 * `useNetwork.switchNetwork` performs a full page load, so this value can never
 * be stale relative to the selected network.
 */
export function isFeedWritable(): boolean {
    return ACTIVE_NETWORK_KEY === FEED_INDEXED_NETWORK
}

/**
 * Featured DAO realm path per network key — the DAO surfaced on the home
 * StateBoard for everyone (members + visitors). Null means the panel
 * self-hides on that network.
 *
 * Only networks where the realm is confirmed callable are populated; an
 * absent/null entry causes FeaturedDaoPanel to render null (no error).
 */
export const FEATURED_DAO_REALM: Record<string, string | null> = {
    test13: MEMBA_DAO.realmPath, // "gno.land/r/samcrew/memba_dao" — live on test13 (chain retired)
    topaz: MEMBA_DAO.realmPath,  // "gno.land/r/samcrew/memba_dao" — live on topaz-1 (2026-07-21 ceremony; chain retired 2026-08-12)
    gnoland1: null,
    // Set in the cutover PR whose ceremony published memba_dao to sapphire-1
    // (chain proof in realm-versions.json). getFeaturedDaoRealm re-checks
    // isRealmValidOn, so this stays inert unless the allowlist agrees.
    sapphire: MEMBA_DAO.realmPath,
}

/**
 * Get the featured DAO realm path for a given network key.
 * Returns null when no featured DAO is configured or the realm is not valid.
 */
export function getFeaturedDaoRealm(networkKey: string): string | null {
    const path = FEATURED_DAO_REALM[networkKey] ?? null
    if (!path) return null
    // Guard: realm must also be valid on the network (covers REALM_ALLOWLIST)
    if (!isRealmValidOn(networkKey, path)) return null
    return path
}

// ── Per-feature validity predicates (back each feature by its realm) ──
// These let a page short-circuit to a "not on this network" gate when its
// realm isn't valid on the active chain. Env feature-flags (VITE_ENABLE_*)
// are ANDed by the consuming page where they apply.
export const isTokenFactoryValid = () => isRealmValid(GRC20_FACTORY_PATH)
export const isEscrowValid = () => isRealmValid(MEMBA_DAO.escrowPath)
export const isNftMarketValid = () => isRealmValid(MEMBA_DAO.nftMarketPath)
/**
 * v3 NFT market validity. NFT_MARKETPLACE_V3_PATH now points at memba_nft_market_v3_2
 * (the active engine since the 2026-07-10 ceremony). Pages that trade on the v3 engine
 * (e.g. CollectionPublic, source="v3") MUST gate on this, not isNftMarketValid() (which
 * checks the retired v2 path). The v3 path IS allowlisted on test13 (v3_2 registered;
 * v3_1 kept through its escrow wind-down), so this returns true there. The v3-trading
 * surface stays dark in prod via the VITE_ENABLE_NFT flag (force-false there), which
 * every trade page ANDs with this predicate — not via allowlist exclusion.
 */
export const isNftMarketV3Valid = () => isRealmValid(NFT_MARKETPLACE_V3_PATH)
/** Phase 2 launchpad — backed by the canonical memba_collections registry. */
export const isNftLaunchpadValid = () => isRealmValid(MEMBA_DAO.nftCollectionsPath)
export const isFeedbackValid = () => isRealmValid(FEEDBACK_REALM_PATH)
export const isTokenOtcValid = () => isRealmValid(MEMBA_DAO.tokenOtcPath)
export const isAgentRegistryValid = () => isRealmValid(MEMBA_DAO.agentRegistryPath)

/**
 * NFT feature flag (VITE_ENABLE_NFT). The canonical reader for the whole NFT /
 * launchpad / studio surface — use this everywhere instead of re-deriving
 * `import.meta.env.VITE_ENABLE_NFT` per page, so a new NFT route can't silently
 * ship ungated (the P0 that left on-chain mint reachable by direct URL while the
 * feature was "off"). Pages still AND it with the relevant realm-validity
 * predicate (e.g. isNftMarketValid) where a tx targets a specific realm.
 */
export const isNftEnabled = (): boolean => import.meta.env.VITE_ENABLE_NFT === "true"
/** Reputation Points (MP) feature flag (VITE_ENABLE_POINTS) — canonical reader for the on-chain
 * points / tiers / leaderboard surface. Read-only (NOT safety-gated): it gates a display surface, not
 * a money path, so it stays OUT of SAFETY_GATED_FLAGS.
 *
 * DEFERRED 2026-07-16 — the feature is not relevant right now, so it is hard-off regardless of the
 * Netlify flag: the whole surface goes dark (nav → "soon", /points → coming-soon, home tile → "soon").
 * The realm (test13, live) + full UI (route, PointsPanel, PersonalRank, leaderboard) all stay in place.
 * To re-enable: set POINTS_FEATURE_DEFERRED = false (then VITE_ENABLE_POINTS governs again). */
const POINTS_FEATURE_DEFERRED = true
export const isPointsEnabled = (): boolean =>
    !POINTS_FEATURE_DEFERRED && import.meta.env.VITE_ENABLE_POINTS === "true"
/** Services (escrow) feature flag (VITE_ENABLE_SERVICES) — canonical reader, mirrors
 * isNftEnabled. The unified marketplace lane registry ANDs this with isEscrowValid(). */
export const isMarketplaceEnabled = (): boolean => import.meta.env.VITE_ENABLE_MARKETPLACE === "true"
/** Marketplace v2 rebuild (in-progress build-out). Ordinary flag — gates the new
 * unified marketplace experience; OFF in prod until the full version is complete +
 * reviewed, then flipped at cutover. Literal reader (prod-bundle safe). */
export const isMarketplaceV2Enabled = (): boolean => import.meta.env.VITE_ENABLE_MARKETPLACE_V2 === "true"
export const isServicesEnabled = (): boolean => import.meta.env.VITE_ENABLE_SERVICES === "true"
export const isTokensEnabled = (): boolean => import.meta.env.VITE_ENABLE_TOKENS === "true"
export const isAgentsEnabled = (): boolean => import.meta.env.VITE_ENABLE_AGENTS === "true"
export const isReviewsEnabled = (): boolean => import.meta.env.VITE_ENABLE_REVIEWS === "true"
export const isReviewsValid = (): boolean => isRealmValid(MEMBA_DAO.reviewsPath)
/** Community reviews on App Store listings (B2b). Ordinary flag — the App Store reviews
 * realm moves no funds (reputation graph only). Literal reader (prod-bundle safe). Gates the
 * ReviewsSection mount + AppReviewStars on the App Store detail page. */
export const isAppReviewsEnabled = (): boolean => import.meta.env.VITE_ENABLE_APP_REVIEWS === "true"
/** Social feed (W7.2). Ordinary flag — no funds. Literal reader (dynamic
 * import.meta.env[key] is undefined in prod bundles). */
export const isFeedEnabled = (): boolean => import.meta.env.VITE_ENABLE_FEED === "true"

/** On-chain blog (memba_blog_v1 reads with static fallback). Ordinary flag —
 * read-only surface, no money path. Off by default until the realm is
 * deployed + articles migrated. */
export const isOnchainBlogEnabled = (): boolean => import.meta.env.VITE_ENABLE_ONCHAIN_BLOG === "true"
export const isGameEnabled = (): boolean => import.meta.env.VITE_ENABLE_GAME === "true"
export const isSpaceInvadersEnabled = (): boolean =>
  import.meta.env.VITE_ENABLE_SPACE_INVADERS === "true"
/** MEMBA: BARRICADE (G1 preview). Ordinary flag — funds-free arcade game, no
 * wallet, no money path. Off by default; owner flips at reveal time. */
export const isBarricadeEnabled = (): boolean =>
  import.meta.env.VITE_ENABLE_BARRICADE === "true"
/** BARRICADE on-chain certify (G3). Read-only/opt-in surface: the certify action
 * re-submits a re-simulated run to the backend and reads the leaderboard realm —
 * no funds move, so NOT safety-gated (same rationale as isPointsEnabled). Off by
 * default; play stays no-wallet regardless. Separate from VITE_ENABLE_BARRICADE. */
export const isBarricadeCertifyEnabled = (): boolean =>
  import.meta.env.VITE_ENABLE_BARRICADE_CERTIFY === "true"
/** BARRICADE 3D "front line" renderer (Phase 0 bake-off). Ordinary flag — a
 * render-ONLY presentation swap over the frozen SIM_VERSION 2 sim; it moves no
 * funds and touches no replay/verifier surface, so it is NOT safety-gated. Off by
 * default; the 2D renderer stays as the required WebGL2 fallback. A runtime
 * ?r3d=1 / localStorage override can opt a single device into 3D on prod without
 * an env flip (see render/three/caps.ts). Literal reader (prod-bundle safe). */
export const isBarricade3DEnabled = (): boolean =>
  import.meta.env.VITE_ENABLE_BARRICADE_3D === "true"
/** BARRICADE 2.5D comparator (Phase 0 bake-off, arm A) — a THROWAWAY fake-perspective
 * renderer for the composition-vs-dimensionality question. Ordinary flag, render-ONLY
 * (sim frozen), off by default; the shipped 2D renderer is unchanged and is the path
 * everyone still sees. A runtime ?r25d=1 override opts a device into it without an env
 * flip. Literal reader (prod-bundle safe). */
export const isBarricade25DEnabled = (): boolean =>
  import.meta.env.VITE_ENABLE_BARRICADE_25D === "true"
/** Realm Explorer (W9 P0). Ordinary flag — read-only (qrender/qfile/qfuncs), no
 * funds. Literal reader (dynamic import.meta.env[key] is undefined in prod bundles). */
export const isExplorerEnabled = (): boolean => import.meta.env.VITE_ENABLE_EXPLORER === "true"
/** App Store (W9). SAFETY-GATED — the realm's RegisterApp fee path is not yet
 * verified on-chain (see SAFETY_GATED_FLAGS). Literal reader (prod-bundle safe). */
export const isAppStoreEnabled = (): boolean => import.meta.env.VITE_ENABLE_APPSTORE === "true"
/** App Store self-service submission (B3). SAFETY-GATED — RegisterApp attaches real coins
 * and the memba_appstore_v3 fee path is not yet deployed/verified (see SAFETY_GATED_FLAGS).
 * Literal reader (prod-bundle safe). */
export const isAppStoreSubmitEnabled = (): boolean => import.meta.env.VITE_ENABLE_APPSTORE_SUBMIT === "true"
/** gno.land public-sale announcement popup. Ordinary flag — a dismissible promo
 * linking out to the official sale portal, moves no funds. Literal reader (prod-bundle safe). */
export const isIcoAnnouncementEnabled = (): boolean => import.meta.env.VITE_ENABLE_ICO_ANNOUNCEMENT === "true"

/** Token allocation percentages (total = 100%). */
export const MEMBA_TOKEN_ALLOCATION = {
    community: 40,    // 40% — airdrops, candidature rewards
    treasury: 30,     // 30% — DAO treasury
    development: 20,  // 20% — engineering & ops
    founders: 10,     // 10% — founding team, 12-month vesting
} as const
