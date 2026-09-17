package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// Captured read-only from gnoland-1 (node_info.network checked) on 2026-09-17:
// vm/qeval gno.land/r/sys/users.ResolveAddress(address("g1manfred47kzduec920z88wfr64ylksmdcedlf5"))
const (
	liveMoulAddr        = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"
	liveResolveMoul     = `(&(struct{("g1manfred47kzduec920z88wfr64ylksmdcedlf5" .uverse.address),("moul" string),(false bool)} gno.land/r/sys/users.UserData) *gno.land/r/sys/users.UserData)`
	liveResolveNil      = `(nil *gno.land/r/sys/users.UserData)`
	liveResolveNameMoul = liveResolveMoul + "\n(true bool)"
)

func TestParseUserData(t *testing.T) {
	u, ok := parseUserData(liveResolveMoul)
	if !ok {
		t.Fatal("the live ResolveAddress literal must parse")
	}
	if u.addr != liveMoulAddr || u.name != "moul" || u.deleted {
		t.Fatalf("parsed %+v", u)
	}

	// ResolveName prints a second (isCurrent bool) value on its own line.
	if u, ok := parseUserData(liveResolveNameMoul); !ok || u.name != "moul" || u.addr != liveMoulAddr {
		t.Fatalf("ResolveName literal must parse, got %+v ok=%v", u, ok)
	}

	for name, in := range map[string]string{
		"nil":          liveResolveNil,
		"empty":        "",
		"other type":   `(&(struct{("g1manfred47kzduec920z88wfr64ylksmdcedlf5" .uverse.address),("moul" string),(false bool)} gno.land/r/demo/users.UserData) *gno.land/r/demo/users.UserData)`,
		"quoted name":  `(&(struct{("g1manfred47kzduec920z88wfr64ylksmdcedlf5" .uverse.address),("mo\"ul" string),(false bool)} gno.land/r/sys/users.UserData) *gno.land/r/sys/users.UserData)`,
		"prefixed":     "junk " + liveResolveMoul,
		"missing bool": `(&(struct{("g1manfred47kzduec920z88wfr64ylksmdcedlf5" .uverse.address),("moul" string)} gno.land/r/sys/users.UserData) *gno.land/r/sys/users.UserData)`,
	} {
		if _, ok := parseUserData(in); ok {
			t.Errorf("%s: must not parse", name)
		}
	}
}

func TestIsValidGnoAddress(t *testing.T) {
	if !isValidGnoAddress(liveMoulAddr) {
		t.Error("a real gnoland address must validate")
	}
	for _, bad := range []string{
		"",
		"g1abcdefghijklmnopqrstuvwxyz0123456789ab", // right shape, not bech32
		"g1manfred47kzduec920z88wfr64ylksmdcedlf6", // checksum broken
		"cosmos1manfred47kzduec920z88wfr64ylksmdcedlf5",
		`g1manfred47kzduec920z88wfr64ylksmdcedlf5")`,
		"G1MANFRED47KZDUEC920Z88WFR64YLKSMDCEDLF5",
	} {
		if isValidGnoAddress(bad) {
			t.Errorf("%q must not validate", bad)
		}
	}
}

// usersRegistryStub answers every abci_query with `answer` and records the
// decoded `data` of the last request.
func usersRegistryStub(t *testing.T, answer string, hits *int32, lastData *string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(hits, 1)
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Params struct {
				Path string `json:"path"`
				Data string `json:"data"`
			} `json:"params"`
		}
		_ = json.Unmarshal(body, &req)
		raw, err := base64.StdEncoding.DecodeString(req.Params.Data)
		if err != nil {
			t.Errorf("query data must be base64: %v", err)
		}
		if req.Params.Path != "vm/qeval" {
			t.Errorf("path = %q, want vm/qeval", req.Params.Path)
		}
		*lastData = string(raw)
		writeAbciData(w, answer)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestResolveUsername(t *testing.T) {
	var hits int32
	var data string
	srv := usersRegistryStub(t, liveResolveMoul, &hits, &data)
	t.Setenv("QUEST_RPC_URL", srv.URL)
	t.Setenv("RPC_FALLBACK_URLS", "")

	name, err := resolveUsername(context.Background(), liveMoulAddr)
	if err != nil {
		t.Fatal(err)
	}
	if name != "moul" {
		t.Fatalf("name = %q, want moul", name)
	}
	if want := `gno.land/r/sys/users.ResolveAddress(address("` + liveMoulAddr + `"))`; data != want {
		t.Fatalf("query = %q, want %q", data, want)
	}
}

func TestResolveUsername_Unregistered(t *testing.T) {
	var hits int32
	var data string
	srv := usersRegistryStub(t, liveResolveNil, &hits, &data)
	t.Setenv("QUEST_RPC_URL", srv.URL)
	t.Setenv("RPC_FALLBACK_URLS", "")

	name, err := resolveUsername(context.Background(), liveMoulAddr)
	if err != nil || name != "" {
		t.Fatalf("got (%q, %v), want empty name and no error", name, err)
	}
}

func TestResolveUsername_RejectsRecordForAnotherAddress(t *testing.T) {
	// A record naming a different address must never be attributed to the caller.
	other := `(&(struct{("g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0" .uverse.address),("moul" string),(false bool)} gno.land/r/sys/users.UserData) *gno.land/r/sys/users.UserData)`
	var hits int32
	var data string
	srv := usersRegistryStub(t, other, &hits, &data)
	t.Setenv("QUEST_RPC_URL", srv.URL)
	t.Setenv("RPC_FALLBACK_URLS", "")

	name, _ := resolveUsername(context.Background(), liveMoulAddr)
	if name != "" {
		t.Fatalf("name = %q, want empty for a record with another address", name)
	}
}

func TestResolveUsername_DeletedOrMalformedIsNoName(t *testing.T) {
	for label, answer := range map[string]string{
		"deleted":    `(&(struct{("g1manfred47kzduec920z88wfr64ylksmdcedlf5" .uverse.address),("moul" string),(true bool)} gno.land/r/sys/users.UserData) *gno.land/r/sys/users.UserData)`,
		"bad name":   `(&(struct{("g1manfred47kzduec920z88wfr64ylksmdcedlf5" .uverse.address),("Moul](x)" string),(false bool)} gno.land/r/sys/users.UserData) *gno.land/r/sys/users.UserData)`,
		"unexpected": "# Users\n* [moul](/u/moul)",
	} {
		t.Run(label, func(t *testing.T) {
			var hits int32
			var data string
			srv := usersRegistryStub(t, answer, &hits, &data)
			t.Setenv("QUEST_RPC_URL", srv.URL)
			t.Setenv("RPC_FALLBACK_URLS", "")
			name, _ := resolveUsername(context.Background(), liveMoulAddr)
			if name != "" {
				t.Fatalf("name = %q, want empty", name)
			}
		})
	}
}

func TestResolveUsername_InvalidAddressNeverQueries(t *testing.T) {
	var hits int32
	var data string
	srv := usersRegistryStub(t, liveResolveMoul, &hits, &data)
	t.Setenv("QUEST_RPC_URL", srv.URL)
	t.Setenv("RPC_FALLBACK_URLS", "")

	for _, bad := range []string{`g1")+Evil("`, "g1abcdefghijklmnopqrstuvwxyz0123456789ab", ""} {
		if name, _ := resolveUsername(context.Background(), bad); name != "" {
			t.Errorf("%q resolved to %q", bad, name)
		}
	}
	if hits != 0 {
		t.Fatalf("invalid addresses reached the RPC %d times", hits)
	}
}

func TestRegisterUsernameQuest_UsesAddressLookup(t *testing.T) {
	h := setup(t)
	for label, tc := range map[string]struct {
		answer string
		want   bool
	}{
		"registered":     {liveResolveMoul, true},
		"unregistered":   {liveResolveNil, false},
		"other address":  {`(&(struct{("g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0" .uverse.address),("moul" string),(false bool)} gno.land/r/sys/users.UserData) *gno.land/r/sys/users.UserData)`, false},
		"render instead": {"# r/sys/users\n* [moul](/u/moul)", false},
	} {
		t.Run(label, func(t *testing.T) {
			var hits int32
			var data string
			srv := usersRegistryStub(t, tc.answer, &hits, &data)
			t.Setenv("QUEST_RPC_URL", srv.URL)
			t.Setenv("RPC_FALLBACK_URLS", "")
			ok, _ := h.svc.defaultVerifyOnChainQuest(context.Background(), liveMoulAddr, "register-username", "")
			if ok != tc.want {
				t.Fatalf("verify = %v, want %v", ok, tc.want)
			}
		})
	}
}

func TestNamespaceOwnedBy_ParsesOwnerField(t *testing.T) {
	h := setup(t)
	for label, tc := range map[string]struct {
		answer string
		addr   string
		want   bool
	}{
		"owner":     {liveResolveNameMoul, liveMoulAddr, true},
		"not owner": {liveResolveNameMoul, "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0", false},
		"no record": {liveResolveNil + "\n(false bool)", liveMoulAddr, false},
	} {
		t.Run(label, func(t *testing.T) {
			var hits int32
			var data string
			srv := usersRegistryStub(t, tc.answer, &hits, &data)
			t.Setenv("QUEST_RPC_URL", srv.URL)
			t.Setenv("RPC_FALLBACK_URLS", "")
			ok, err := h.svc.namespaceOwnedBy(context.Background(), "moul", tc.addr)
			if err != nil {
				t.Fatal(err)
			}
			if ok != tc.want {
				t.Fatalf("owned = %v, want %v", ok, tc.want)
			}
		})
	}
}
