package launchpadindex

import (
	"bytes"
	"errors"
	"strconv"
	"strings"
	"testing"

	"github.com/cosmos/cosmos-sdk/types/bech32"
)

func validEvent(t *testing.T, id string) []Attribute {
	t.Helper()
	creator, err := bech32.ConvertAndEncode("g", bytes.Repeat([]byte{1}, 20))
	if err != nil {
		t.Fatal(err)
	}
	return []Attribute{
		{"id", id},
		{"registry_key", TokenRealmPath + "." + id},
		{"grc20_id", TokenRealmPath + "." + id + ".0000001"},
		{"creator", creator},
		{"mode", "direct_fixed"},
		{"ticker", "SAME"},
		{"currency_key", "ugnot"},
	}
}

func TestParseTokenCreated(t *testing.T) {
	attrs := validEvent(t, "T1")
	record, err := ParseTokenCreated(TokenRealmPath, TokenCreatedType, attrs)
	if err != nil {
		t.Fatal(err)
	}
	if record.ID != "T1" || record.RegistryKey != TokenRealmPath+".T1" ||
		record.GRC20ID != TokenRealmPath+".T1.0000001" || record.Creator != attrs[3].Value ||
		record.Mode != "direct_fixed" || record.Ticker != "SAME" || record.CurrencyKey != "ugnot" {
		t.Fatalf("wrong validated event: %+v", record)
	}
	// Ticker is descriptive and can legitimately be reused by another token.
	second := validEvent(t, "T2")
	second[2].Value = TokenRealmPath + ".T2.0000002"
	other, err := ParseTokenCreated(TokenRealmPath, TokenCreatedType, second)
	if err != nil || other.ID != "T2" || other.Ticker != record.Ticker {
		t.Fatalf("same ticker should be valid for distinct IDs: %+v, %v", other, err)
	}
}

func TestCompactIdentityBoundaries(t *testing.T) {
	for _, tc := range []struct {
		id, suffix string
	}{
		{"T1", "0000001"},
		{"T31", "000000z"},
		{"T32", "0000010"},
		{"T9999999999", "9a0qrzz"},
	} {
		number, err := strconv.ParseUint(tc.id[1:], 10, 64)
		if err != nil {
			t.Fatal(err)
		}
		if got := registeredLedgerID(tc.id, number); got != TokenRealmPath+"."+tc.id+"."+tc.suffix {
			t.Fatalf("%s: got %s", tc.id, got)
		}
	}
}

func TestRejectMalformedTokenCreated(t *testing.T) {
	valid := validEvent(t, "T1")
	wrongChecksum := valid[3].Value[:len(valid[3].Value)-1] + "x"
	tests := []struct {
		name, path, eventType string
		mutate                func([]Attribute) []Attribute
	}{
		{"wrong realm", TokenRealmPath + "2", TokenCreatedType, nil},
		{"wrong type", TokenRealmPath, "LaunchpadSaleCreated", nil},
		{"duplicate attribute", TokenRealmPath, TokenCreatedType, func(a []Attribute) []Attribute { a[6] = Attribute{"id", "T1"}; return a }},
		{"missing attribute", TokenRealmPath, TokenCreatedType, func(a []Attribute) []Attribute { return a[:6] }},
		{"unknown attribute", TokenRealmPath, TokenCreatedType, func(a []Attribute) []Attribute { a[6].Key = "launch_time"; return a }},
		{"zero ID", TokenRealmPath, TokenCreatedType, func(a []Attribute) []Attribute { a[0].Value = "T0"; return a }},
		{"leading zero ID", TokenRealmPath, TokenCreatedType, func(a []Attribute) []Attribute { a[0].Value = "T01"; return a }},
		{"overflow ID", TokenRealmPath, TokenCreatedType, func(a []Attribute) []Attribute { a[0].Value = "T10000000000"; return a }},
		{"registry belongs to other ID", TokenRealmPath, TokenCreatedType, func(a []Attribute) []Attribute { a[1].Value = TokenRealmPath + ".T2"; return a }},
		{"GRC20 belongs to other ID", TokenRealmPath, TokenCreatedType, func(a []Attribute) []Attribute { a[2].Value = TokenRealmPath + ".T2.0000002"; return a }},
		{"wrong compact suffix", TokenRealmPath, TokenCreatedType, func(a []Attribute) []Attribute { a[2].Value = TokenRealmPath + ".T1.0000002"; return a }},
		{"creator checksum", TokenRealmPath, TokenCreatedType, func(a []Attribute) []Attribute { a[3].Value = wrongChecksum; return a }},
		{"creator case", TokenRealmPath, TokenCreatedType, func(a []Attribute) []Attribute { a[3].Value = strings.ToUpper(a[3].Value); return a }},
		{"wrong mode", TokenRealmPath, TokenCreatedType, func(a []Attribute) []Attribute { a[4].Value = "auction"; return a }},
		{"ticker case", TokenRealmPath, TokenCreatedType, func(a []Attribute) []Attribute { a[5].Value = "same"; return a }},
		{"ticker long", TokenRealmPath, TokenCreatedType, func(a []Attribute) []Attribute { a[5].Value = "ABCDEFGHIJK"; return a }},
		{"empty currency", TokenRealmPath, TokenCreatedType, func(a []Attribute) []Attribute { a[6].Value = ""; return a }},
		{"control currency", TokenRealmPath, TokenCreatedType, func(a []Attribute) []Attribute { a[6].Value = "x\ny"; return a }},
		{"long currency", TokenRealmPath, TokenCreatedType, func(a []Attribute) []Attribute { a[6].Value = strings.Repeat("x", 201); return a }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			attrs := append([]Attribute(nil), valid...)
			if tc.mutate != nil {
				attrs = tc.mutate(attrs)
			}
			got, err := ParseTokenCreated(tc.path, tc.eventType, attrs)
			if !errors.Is(err, ErrInvalidTokenCreated) || got != (TokenCreated{}) {
				t.Fatalf("accepted invalid event: %+v, %v", got, err)
			}
		})
	}
}
