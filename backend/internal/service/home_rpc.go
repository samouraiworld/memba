package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// queryFunc is the injectable seam over abciQuery so assembleHomeSnapshot is
// unit-testable without a live chain. Defaults to the package-level abciQuery.
type queryFunc func(rpcURL, path, data string) (string, error)

// homeSnapshotRPCURL returns the RPC the home snapshot reads. The default is the
// pinned samourai node (matching fly.toml) — NOT the public test13 node, which
// rate-limits the Fly egress IP (#466); an unset env must not silently re-trigger
// that. do not use gnoRPCURL() here — both now point at test13, but keeping the
// home var separate avoids accidental coupling if GNO_RPC_URL is repurposed.
func homeSnapshotRPCURL() string {
	if v := os.Getenv("HOME_SNAPSHOT_RPC_URL"); v != "" {
		return v
	}
	if v := os.Getenv("NFT_RPC_URL"); v != "" {
		return v
	}
	return "https://rpc.testnet13.samourai.live:443"
}

// homeSnapshotTTL is the cache window (default 30s, env HOME_SNAPSHOT_TTL as a Go duration).
func homeSnapshotTTL() time.Duration {
	if v := os.Getenv("HOME_SNAPSHOT_TTL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return 30 * time.Second
}

// cachedHomeSnapshot returns a fresh snapshot from cache, re-assembles on
// expiry, and serves the last-good value if re-assembly returns nil (stale).
func (s *MultisigService) cachedHomeSnapshot(
	ctx context.Context,
	chainID string,
	assemble func(context.Context, string) *membav1.HomeSnapshot,
) *membav1.HomeSnapshot {
	ttl := homeSnapshotTTL()

	s.homeCacheMu.RLock()
	cached, ok := s.homeCached[chainID]
	at := s.homeCachedAt[chainID]
	s.homeCacheMu.RUnlock()
	if ok && cached != nil && time.Since(at) < ttl {
		return cached // HIT
	}

	// The snapshot is single-network (test13) per spec §6, so the same RPC URL
	// serves every chain_id today. A future multi-chain deployment would resolve
	// the RPC URL from chainID here instead of calling homeSnapshotRPCURL().
	// NOTE: concurrent cache misses may each call assemble — deliberate (mirrors
	// HandleMarketplaceAgentsProxy pattern); bounded by the endpoint's rate limit.
	// A singleflight.Group is a future option if thundering-herd becomes an issue.
	fresh := assemble(ctx, homeSnapshotRPCURL()) // MISS
	if fresh == nil {
		// Serve stale if we have any prior value.
		s.homeCacheMu.RLock()
		stale := s.homeCached[chainID]
		s.homeCacheMu.RUnlock()
		if stale != nil {
			slog.Warn("home snapshot assemble failed; serving stale", "chain_id", chainID)
			return stale
		}
		return nil
	}

	s.homeCacheMu.Lock()
	s.homeCached[chainID] = fresh
	s.homeCachedAt[chainID] = time.Now()
	s.homeCacheMu.Unlock()
	return fresh
}

// GetHomeSnapshot returns the cached, server-assembled global home payload.
// Public read (no auth). chain_id defaults to the server's configured chain.
func (s *MultisigService) GetHomeSnapshot(
	ctx context.Context,
	req *connect.Request[membav1.GetHomeSnapshotRequest],
) (*connect.Response[membav1.GetHomeSnapshotResponse], error) {
	chainID := req.Msg.GetChainId()
	// HOME-CHAINID: this is a public, unauthenticated endpoint. Collapse empty,
	// unknown, or (legacy) any chain_id to the server's configured chain so the
	// cache map key is bounded to the accepted set — prevents cache-busting /
	// unbounded map growth, and matches spec §6 (chain_id validated vs acceptedChainIDs).
	if chainID == "" || len(s.acceptedChainIDs) == 0 || !slices.Contains(s.acceptedChainIDs, chainID) {
		chainID = s.chainID
	}

	snap := s.cachedHomeSnapshot(ctx, chainID, s.assembleHomeSnapshot)
	if snap == nil {
		// No cache and assembly produced nothing — return an empty snapshot
		// (non-breaking: the frontend treats this as "use Phase-1 fallback").
		snap = &membav1.HomeSnapshot{StaleSources: []string{"all"}}
	}
	return connect.NewResponse(&membav1.GetHomeSnapshotResponse{Snapshot: snap}), nil
}

// assembleHomeSnapshot builds the global snapshot from chain + DB sources.
// Each source is independently fault-tolerant (see Phase C). Returns a non-nil
// snapshot even when sources fail (their names go in stale_sources).
func (s *MultisigService) assembleHomeSnapshot(ctx context.Context, rpcURL string) *membav1.HomeSnapshot {
	snap := &membav1.HomeSnapshot{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Counts:      &membav1.EcosystemCounts{}, // initialise once; failed sources leave their field 0
	}

	// RPC source: network pulse (block height) from /status.
	if p, err := fetchNetworkPulse(ctx, rpcURL); err != nil {
		snap.StaleSources = append(snap.StaleSources, "network")
	} else {
		snap.Network = p
		snap.AsOfBlock = p.BlockHeight
	}

	// RPC source: validator-set health from /validators.
	if v, err := fetchValidatorsHealth(ctx, rpcURL); err != nil {
		snap.StaleSources = append(snap.StaleSources, "validators")
	} else {
		snap.ValidatorsHealth = v
		snap.Counts.Validators = v.Total
		// Surface the validator count on the network pulse too: the home
		// StatusStrip / NetworkPulse panel reads snap.Network.ValidatorsTotal
		// (frontend useNetworkPulse), not Counts.Validators. Network is fetched
		// just above, so it's already set here when /status succeeded.
		if snap.Network != nil {
			snap.Network.ValidatorsTotal = v.Total
		}
	}

	// On-chain source: token count from tokenfactory_v2 render.
	if n, err := s.countTokens(ctx, rpcURL); err != nil {
		snap.StaleSources = append(snap.StaleSources, "tokens")
	} else {
		snap.Counts.Tokens = n
	}

	// On-chain source: agent count from agent_registry render.
	if n, err := s.countAgents(ctx, rpcURL); err != nil {
		snap.StaleSources = append(snap.StaleSources, "agents")
	} else {
		snap.Counts.Agents = n
	}

	// DB source: collection count.
	if n, err := s.countCollections(ctx); err != nil {
		snap.StaleSources = append(snap.StaleSources, "collections")
	} else {
		snap.Counts.Collections = n
	}

	// DB source: highest block seen by the NFT indexer.
	if b, err := s.maxIndexerBlock(ctx); err != nil {
		snap.StaleSources = append(snap.StaleSources, "indexer_block")
	} else {
		snap.IndexerLastBlock = b
	}

	// On-chain source: featured DAO summary (name, open proposals, treasury).
	if dao, err := s.fetchFeaturedDao(ctx, rpcURL); err != nil {
		snap.StaleSources = append(snap.StaleSources, "featured_dao")
	} else {
		snap.FeaturedDao = dao
	}

	// On-chain source: directory members preview (up to 4 entries).
	if members, err := s.fetchDirectoryMembers(ctx, rpcURL, 4); err != nil {
		snap.StaleSources = append(snap.StaleSources, "directory_members")
	} else {
		snap.DirectoryMembers = members
	}

	return snap
}

// tokenfactoryRealmPath returns the on-chain path for the Samcrew token factory.
// Matches the TOKENFACTORY_REALM env used by the frontend lib/config.ts.
func tokenfactoryRealmPath() string {
	if v := os.Getenv("TOKENFACTORY_REALM"); v != "" {
		return v
	}
	return "gno.land/r/samcrew/tokenfactory_v2"
}

// agentRegistryRealmPath returns the on-chain path for the Memba agent registry.
// Reuses the same env name as analyst.go (AGENT_REGISTRY_REALM).
func agentRegistryRealmPath() string {
	if v := os.Getenv("AGENT_REGISTRY_REALM"); v != "" {
		return v
	}
	return "gno.land/r/samcrew/agent_registry"
}

var reTokenCount = regexp.MustCompile(`(\d+)\s+tokens?`)

// countTokens fetches the tokenfactory bare render via vm/qrender and parses
// the self-reported count from the header line, e.g. "# Samcrew Token Factory (3 tokens)".
// The data is the raw "<realmPath>:" qrender argument; abciQueryOnce base64-encodes it
// once on the wire (pre-encoding here double-encodes and breaks the query — see B1 test).
func (s *MultisigService) countTokens(ctx context.Context, rpcURL string) (uint32, error) {
	realmPath := tokenfactoryRealmPath()
	data := realmPath + ":"
	raw, err := s.homeQuery(rpcURL, "vm/qrender", data)
	if err != nil {
		return 0, fmt.Errorf("countTokens query: %w", err)
	}
	m := reTokenCount.FindStringSubmatch(raw)
	if m == nil {
		return 0, nil // tolerate unexpected render format
	}
	n, err := strconv.ParseUint(m[1], 10, 32)
	if err != nil {
		return 0, fmt.Errorf("countTokens parse: %w", err)
	}
	return uint32(n), nil
}

// countAgents fetches the agent_registry bare render via vm/qrender and counts
// agent table rows. Mirrors the frontend parseAgentTable logic in
// frontend/src/lib/agentRegistry.ts:158 — a valid row must split on "|" into
// ≥5 non-empty trimmed columns AND have a markdown link in the name column.
// The empty-state render ("*No agents registered yet.*") yields 0.
func (s *MultisigService) countAgents(ctx context.Context, rpcURL string) (uint32, error) {
	realmPath := agentRegistryRealmPath()
	data := realmPath + ":"
	raw, err := s.homeQuery(rpcURL, "vm/qrender", data)
	if err != nil {
		return 0, fmt.Errorf("countAgents query: %w", err)
	}
	var count uint32
	for _, line := range strings.Split(raw, "\n") {
		if !strings.HasPrefix(line, "|") {
			continue
		}
		cols := make([]string, 0, 6)
		for _, c := range strings.Split(line, "|") {
			t := strings.TrimSpace(c)
			if t != "" {
				cols = append(cols, t)
			}
		}
		if len(cols) < 5 {
			continue
		}
		// Skip header and separator rows; accept only rows with a markdown link in name column.
		if !strings.Contains(cols[1], "[") {
			continue
		}
		count++
	}
	return count, nil
}

// countCollections returns the number of NFT collections tracked in the DB.
func (s *MultisigService) countCollections(ctx context.Context) (uint32, error) {
	var n uint32
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM nft_collections`).Scan(&n)
	return n, err
}

// maxIndexerBlock returns the highest last_processed_block across all indexed
// realms. Returns 0 when the table is empty (MAX returns NULL on an empty set).
func (s *MultisigService) maxIndexerBlock(ctx context.Context) (int64, error) {
	var b sql.NullInt64
	err := s.db.QueryRowContext(ctx, `SELECT MAX(last_processed_block) FROM nft_indexer_state`).Scan(&b)
	if err != nil {
		return 0, err
	}
	return b.Int64, nil
}

// featuredDaoRealmPath returns the on-chain path for the featured DAO.
// Env FEATURED_DAO_REALM overrides the default (gno.land/r/samcrew/memba_dao).
func featuredDaoRealmPath() string {
	if v := os.Getenv("FEATURED_DAO_REALM"); v != "" {
		return v
	}
	return "gno.land/r/samcrew/memba_dao"
}

// userRegistryRealmPath returns the on-chain path for the user registry.
// Env USER_REGISTRY_REALM overrides the default (gno.land/r/sys/users).
func userRegistryRealmPath() string {
	if v := os.Getenv("USER_REGISTRY_REALM"); v != "" {
		return v
	}
	return "gno.land/r/sys/users"
}

// reDAOName matches the "# Name" heading line at the start of a bare DAO render.
var reDAOName = regexp.MustCompile(`(?m)^#\s+(.+)$`)

// reRealmAddress matches "> Realm address: g1..." from the bare DAO render.
var reRealmAddress = regexp.MustCompile(`>\s*Realm\s+address:\s*(g1[a-z0-9]+)`)

// reProposalHeader matches GovDAO v3 proposal headers: "### [Prop #N - Title](link)".
var reProposalHeader = regexp.MustCompile(`###\s+\[Prop\s+#(\d+)\s*-\s*(.+?)\]`)

// reProposalStatus matches "Status: ACTIVE" etc. within a proposal section.
var reProposalStatus = regexp.MustCompile(`(?i)Status:\s*(\w+)`)

// isOpenProposalStatus returns true for proposal statuses considered "open/active".
// Mirrors frontend/src/lib/dao/shared.ts:normalizeStatus.
func isOpenProposalStatus(s string) bool {
	lower := strings.ToLower(s)
	return lower == "active" || lower == "open" || lower == ""
}

// parseProposalList parses a GovDAO v3 proposals render (the ":proposals" page)
// and returns (openCount, firstOpenTitle). Mirrors frontend proposals.ts:parseProposalList.
func parseProposalList(raw string) (openCount uint32, firstTitle string) {
	sections := strings.Split(raw, "### ")
	for _, section := range sections {
		m := reProposalHeader.FindStringSubmatch("### " + section)
		if m == nil {
			continue
		}
		title := strings.TrimSpace(m[2])

		status := "open"
		sm := reProposalStatus.FindStringSubmatch(section)
		if sm != nil {
			status = sm[1]
		}
		if isOpenProposalStatus(status) {
			openCount++
			if firstTitle == "" {
				firstTitle = title
			}
		}
	}
	return openCount, firstTitle
}

// reUserWithLink matches "* [username](link) - address" (Format 1 from parseUserRegistry).
var reUserWithLink = regexp.MustCompile(`\*\s*\[([^\]]+)\]\([^)]*\)\s*-?\s*` + "`?" + `([a-z0-9]+)` + "`?")

// reUserSimple matches "* username address" where address starts with "g1" (Format 2).
var reUserSimple = regexp.MustCompile(`\*\s*(\S+)\s+(\S+)`)

// parseUserRegistryMembers mirrors frontend/src/lib/directory.ts:parseUserRegistry.
// Returns a list of DirectoryMember from a user registry render.
func parseUserRegistryMembers(raw string) []*membav1.DirectoryMember {
	var entries []*membav1.DirectoryMember
	for _, line := range strings.Split(raw, "\n") {
		// Format 1: "* [username](link) - address"
		m := reUserWithLink.FindStringSubmatch(line)
		if m != nil {
			entries = append(entries, &membav1.DirectoryMember{
				Name:    m[1],
				Address: m[2],
			})
			continue
		}
		// Format 2: "* username address"
		s2 := reUserSimple.FindStringSubmatch(line)
		if s2 != nil && strings.HasPrefix(s2[2], "g1") {
			entries = append(entries, &membav1.DirectoryMember{
				Name:    s2[1],
				Address: s2[2],
			})
		}
	}
	return entries
}

// fetchFeaturedDao fetches the featured DAO summary from the chain.
// Sub-parts (proposals, treasury) are best-effort: a failure degrades that field to 0/""
// without failing the whole source.
func (s *MultisigService) fetchFeaturedDao(ctx context.Context, rpcURL string) (*membav1.FeaturedDao, error) {
	realmPath := featuredDaoRealmPath()

	// --- bare render (name + realm address) ---
	bareData := realmPath + ":"
	bareRaw, err := s.homeQuery(rpcURL, "vm/qrender", bareData)
	if err != nil {
		return nil, fmt.Errorf("fetchFeaturedDao bare render: %w", err)
	}

	// Parse name from "# ..." heading (primary, reliable).
	name := ""
	if nm := reDAOName.FindStringSubmatch(bareRaw); nm != nil {
		name = strings.TrimSpace(nm[1])
	}

	// Parse treasury address — best-effort.
	var treasuryUgnot uint64
	if am := reRealmAddress.FindStringSubmatch(bareRaw); am != nil {
		addr := am[1]
		// bank/balances uses empty data param; result format is e.g. "1000000ugnot"
		balRaw, berr := s.homeQuery(rpcURL, "bank/balances/"+addr, "")
		if berr == nil {
			// Format: "1000000ugnot" (one or more coin entries, comma-separated)
			for _, coin := range strings.Split(balRaw, ",") {
				coin = strings.TrimSpace(strings.Trim(coin, `"`))
				if strings.HasSuffix(coin, "ugnot") {
					numStr := strings.TrimSuffix(coin, "ugnot")
					if n, perr := strconv.ParseUint(numStr, 10, 64); perr == nil {
						treasuryUgnot += n
					}
				}
			}
		}
		// treasury failure is silent — best-effort 0 is acceptable
	}

	// --- proposals render (open count + latest title) — best-effort ---
	var openProposals uint32
	var latestTitle string
	propData := realmPath + ":proposals"
	if propRaw, perr := s.homeQuery(rpcURL, "vm/qrender", propData); perr == nil {
		openProposals, latestTitle = parseProposalList(propRaw)
	}
	// proposal failure is silent — best-effort 0/"" is acceptable

	return &membav1.FeaturedDao{
		RealmPath:           realmPath,
		Name:                name,
		OpenProposals:       openProposals,
		LatestProposalTitle: latestTitle,
		TreasuryUgnot:       treasuryUgnot,
		// Members: best-effort 0 — a cheap members count would require
		// reading the :members render and memberstore; deferred (YAGNI).
	}, nil
}

// fetchDirectoryMembers fetches the user registry bare render and parses member entries.
// Mirrors frontend/src/lib/directory.ts:parseUserRegistry.
// The live test13 registry yields a stats-only render → [] (correct, expected).
// Results are sliced to limit (use 4 for MEMBER_PREVIEW_COUNT).
func (s *MultisigService) fetchDirectoryMembers(ctx context.Context, rpcURL string, limit int) ([]*membav1.DirectoryMember, error) {
	realmPath := userRegistryRealmPath()
	data := realmPath + ":"
	raw, err := s.homeQuery(rpcURL, "vm/qrender", data)
	if err != nil {
		return nil, fmt.Errorf("fetchDirectoryMembers query: %w", err)
	}
	members := parseUserRegistryMembers(raw)
	if limit > 0 && len(members) > limit {
		members = members[:limit]
	}
	return members, nil
}

// httpGetJSON performs a GET to url, decodes the JSON body into out.
// Local replica of the indexer's unexported httpGet so we avoid a cross-package dep.
func httpGetJSON(ctx context.Context, url string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: rpcAttemptTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	return json.Unmarshal(body, out)
}

// fetchNetworkPulse calls rpcURL+"/status" and returns the current block height
// plus a best-effort average block time in milliseconds computed from the last
// N=min(10, H-1) blocks. If the /block fetch or timestamp parse fails, the
// function still succeeds with AvgBlockTimeMs==0 (best-effort degradation).
func fetchNetworkPulse(ctx context.Context, rpcURL string) (*membav1.NetworkPulse, error) {
	var s struct {
		Result struct {
			SyncInfo struct {
				LatestBlockHeight string `json:"latest_block_height"`
				LatestBlockTime   string `json:"latest_block_time"`
			} `json:"sync_info"`
		} `json:"result"`
	}
	if err := httpGetJSONResilient(ctx, rpcURL, "/status", &s); err != nil {
		return nil, err
	}
	h, err := strconv.ParseInt(s.Result.SyncInfo.LatestBlockHeight, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("parse block height: %w", err)
	}

	pulse := &membav1.NetworkPulse{BlockHeight: h}

	// Best-effort: compute avg block time over the last N blocks (mirrors
	// frontend/src/lib/validators.ts:getNetworkStats window of 10 blocks).
	if h > 1 {
		n := int64(10)
		if h-1 < n {
			n = h - 1
		}
		latestTime, tErr := time.Parse(time.RFC3339Nano, s.Result.SyncInfo.LatestBlockTime)
		if tErr != nil {
			slog.Debug("fetchNetworkPulse: parse latest_block_time", "err", tErr)
		} else {
			var b struct {
				Result struct {
					Block struct {
						Header struct {
							Time string `json:"time"`
						} `json:"header"`
					} `json:"block"`
				} `json:"result"`
			}
			blockSuffix := fmt.Sprintf("/block?height=%d", h-n)
			if bErr := httpGetJSONResilient(ctx, rpcURL, blockSuffix, &b); bErr != nil {
				slog.Debug("fetchNetworkPulse: fetch /block", "height", h-n, "err", bErr)
			} else {
				earlierTime, pErr := time.Parse(time.RFC3339Nano, b.Result.Block.Header.Time)
				if pErr != nil {
					slog.Debug("fetchNetworkPulse: parse block header time", "err", pErr)
				} else if latestTime.After(earlierTime) {
					pulse.AvgBlockTimeMs = (latestTime.UnixMilli() - earlierTime.UnixMilli()) / n
				}
			}
		}
	}

	return pulse, nil
}

// fetchValidatorsHealth calls rpcURL+"/validators" and returns the validator-set
// health. Active and Total are set from the set size; Status is "healthy" unless
// the set is empty ("down"). AvgBlockTimeMs and per-validator uptime are not
// computed in v1 (left 0 per YAGNI).
func fetchValidatorsHealth(ctx context.Context, rpcURL string) (*membav1.ValidatorsHealth, error) {
	var v struct {
		Result struct {
			Validators []json.RawMessage `json:"validators"`
		} `json:"result"`
	}
	if err := httpGetJSONResilient(ctx, rpcURL, "/validators", &v); err != nil {
		return nil, err
	}
	total := uint32(len(v.Result.Validators)) // #nosec G115 -- validator set size is tiny (tens of nodes), never overflows uint32
	status := "healthy"
	if total == 0 {
		status = "down"
	}
	return &membav1.ValidatorsHealth{Status: status, Active: total, Total: total}, nil
}
