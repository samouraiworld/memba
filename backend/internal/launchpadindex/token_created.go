// Package launchpadindex validates Launchpad chain events before they enter a
// future chain-bound projection. It does not establish event finality or time.
package launchpadindex

import (
	"errors"
	"strconv"
	"strings"

	"github.com/cosmos/cosmos-sdk/types/bech32"
)

const (
	TokenRealmPath          = "gno.land/r/samcrew/launchpad/tokens/v1"
	TokenCreatedType        = "LaunchpadTokenCreated"
	maxTokenNumber   uint64 = 9_999_999_999
	compactAlphabet         = "0123456789abcdefghjkmnpqrstvwxyz"
)

var ErrInvalidTokenCreated = errors.New("invalid LaunchpadTokenCreated event")

// Attribute preserves the raw event's order and duplicate keys. A caller must
// pass the original attributes, not a flattened map that has lost duplicates.
type Attribute struct {
	Key   string
	Value string
}

// TokenCreated contains only identities emitted by the tokens realm. A chain
// ID, realm generation, confirmed block and event coordinates must be attached
// by the eventual chain-bound indexer before this can become a public record.
type TokenCreated struct {
	ID          string
	RegistryKey string
	GRC20ID     string
	Creator     string
	Mode        string
	Ticker      string
	CurrencyKey string
}

// ParseTokenCreated validates the exact event contract of tokens/v1.Create.
// It rejects duplicate, absent and unknown attributes as well as identities
// that do not derive from the same canonical T<n> number.
func ParseTokenCreated(pkgPath, eventType string, attributes []Attribute) (TokenCreated, error) {
	if pkgPath != TokenRealmPath || eventType != TokenCreatedType || len(attributes) != 7 {
		return TokenCreated{}, ErrInvalidTokenCreated
	}
	fields := make(map[string]string, len(attributes))
	for _, a := range attributes {
		switch a.Key {
		case "id", "registry_key", "grc20_id", "creator", "mode", "ticker", "currency_key":
		default:
			return TokenCreated{}, ErrInvalidTokenCreated
		}
		if _, exists := fields[a.Key]; exists {
			return TokenCreated{}, ErrInvalidTokenCreated
		}
		fields[a.Key] = a.Value
	}
	id := fields["id"]
	if len(id) < 2 || id[0] != 'T' {
		return TokenCreated{}, ErrInvalidTokenCreated
	}
	number, err := strconv.ParseUint(id[1:], 10, 64)
	if err != nil || number == 0 || number > maxTokenNumber || id != "T"+strconv.FormatUint(number, 10) {
		return TokenCreated{}, ErrInvalidTokenCreated
	}
	registryKey := TokenRealmPath + "." + id
	if fields["registry_key"] != registryKey || fields["grc20_id"] != registeredLedgerID(id, number) {
		return TokenCreated{}, ErrInvalidTokenCreated
	}
	creator := fields["creator"]
	if creator == "" || creator != strings.ToLower(creator) || !strings.HasPrefix(creator, "g1") {
		return TokenCreated{}, ErrInvalidTokenCreated
	}
	hrp, payload, err := bech32.DecodeAndConvert(creator)
	if err != nil || hrp != "g" || len(payload) != 20 {
		return TokenCreated{}, ErrInvalidTokenCreated
	}
	mode := fields["mode"]
	switch mode {
	case "curve", "direct_fixed", "direct_capped", "fairsale":
	default:
		return TokenCreated{}, ErrInvalidTokenCreated
	}
	ticker := fields["ticker"]
	if len(ticker) < 1 || len(ticker) > 10 {
		return TokenCreated{}, ErrInvalidTokenCreated
	}
	for i := 0; i < len(ticker); i++ {
		c := ticker[i]
		if !(c >= 'A' && c <= 'Z') && !(c >= '0' && c <= '9') {
			return TokenCreated{}, ErrInvalidTokenCreated
		}
	}
	currencyKey := fields["currency_key"]
	if len(currencyKey) == 0 || len(currencyKey) > 200 {
		return TokenCreated{}, ErrInvalidTokenCreated
	}
	for i := 0; i < len(currencyKey); i++ {
		if currencyKey[i] <= 0x20 || currencyKey[i] >= 0x7f {
			return TokenCreated{}, ErrInvalidTokenCreated
		}
	}
	return TokenCreated{
		ID: id, RegistryKey: registryKey, GRC20ID: fields["grc20_id"],
		Creator: creator, Mode: mode, Ticker: ticker, CurrencyKey: currencyKey,
	}, nil
}

// seqid.ID.String uses seven cford32 digits, most significant digit first.
func registeredLedgerID(id string, number uint64) string {
	var suffix [7]byte
	for i := len(suffix) - 1; i >= 0; i-- {
		suffix[i] = compactAlphabet[number&31]
		number >>= 5
	}
	return TokenRealmPath + "." + id + "." + string(suffix[:])
}
