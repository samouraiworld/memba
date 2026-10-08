package evmauth

import (
	"slices"
	"strconv"
	"strings"

	"github.com/samouraiworld/memba/backend/internal/address"
)

// RPCURLsEnv maps each EVM chain to the JSON-RPC endpoint the backend reads it
// through: "84532=https://…,8453=https://…". https only (http only on
// loopback, see NewClient). An endpoint may carry a provider key: it is never
// logged, and no problem ParseRPCURLs reports contains one.
const RPCURLsEnv = "MEMBA_EVM_RPC_URLS"

// RPCURLs is MEMBA_EVM_RPC_URLS, read once for every caller.
type RPCURLs struct {
	urls       map[uint64]string
	duplicated map[uint64]bool
}

// ParseRPCURLs reads the "<chain id>=<url>" list. Malformed entries are
// reported and skipped; a chain listed twice is reported and has no endpoint
// (it is refused rather than one of the two picked).
func ParseRPCURLs(raw string) (RPCURLs, []string) {
	r := RPCURLs{urls: map[uint64]string{}, duplicated: map[uint64]bool{}}
	var problems []string
	for entry := range strings.SplitSeq(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		ref, rawURL, ok := strings.Cut(entry, "=")
		id, err := address.ParseCAIP2(address.EIP155Namespace + ":" + strings.TrimSpace(ref))
		switch {
		case !ok || err != nil:
			problems = append(problems, RPCURLsEnv+": an entry is not <chain id>=<url>")
		case r.duplicated[id]:
		case r.urls[id] != "":
			problems = append(problems, RPCURLsEnv+": chain "+strconv.FormatUint(id, 10)+" listed twice")
			delete(r.urls, id)
			r.duplicated[id] = true
		default:
			r.urls[id] = strings.TrimSpace(rawURL)
		}
	}
	return r, problems
}

// For returns the configured endpoint of a chain, if exactly one is configured.
func (r RPCURLs) For(chainID uint64) (string, bool) {
	u, ok := r.urls[chainID]
	return u, ok
}

// Duplicated reports whether the chain was listed more than once (and so has no endpoint).
func (r RPCURLs) Duplicated(chainID uint64) bool { return r.duplicated[chainID] }

// Chains lists every chain id the variable names, configured or refused, in ascending order.
func (r RPCURLs) Chains() []uint64 {
	var ids []uint64
	for id := range r.urls {
		ids = append(ids, id)
	}
	for id := range r.duplicated {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	return ids
}
