package arcade

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"
)

// failoverNodes fakes two RPC nodes by host. Each node answers /status with its
// network and a vm/qeval POST with its query answer; every request is recorded
// as "host path".
type failoverNodes struct {
	network map[string]string
	query   map[string]func() *http.Response
	seen    []string
}

func (n *failoverNodes) client() *http.Client {
	return &http.Client{Transport: attestRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		n.seen = append(n.seen, req.URL.Host+" "+req.URL.Path)
		if strings.HasSuffix(req.URL.Path, "/status") {
			return jsonResponse(http.StatusOK, `{"result":{"node_info":{"network":"`+n.network[req.URL.Host]+`"}}}`), nil
		}
		answer, ok := n.query[req.URL.Host]
		if !ok {
			return nil, errors.New("dial tcp: connection refused")
		}
		return answer(), nil
	})}
}

func jsonResponse(code int, body string) *http.Response {
	return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}

func entryAnswer() *http.Response {
	data := base64.StdEncoding.EncodeToString([]byte(`"{\"inputLogSha256\":\"abc\",\"score\":42}" (string)`))
	return jsonResponse(http.StatusOK, `{"result":{"response":{"ResponseBase":{"Data":"`+data+`","Error":null}}}}`)
}

func failoverBroadcaster(nodes *failoverNodes) *gnokeyBroadcaster {
	return &gnokeyBroadcaster{
		cfg: AttesterConfig{
			Realm: "gno.land/r/x/leaderboard", ChainID: "gnoland-1", KeyName: "k", Timeout: time.Second,
			Remote: "https://primary.example", Fallbacks: []string{"", "https://primary.example", "https://backup.example"},
		},
		httpClient: nodes.client(),
	}
}

func TestGnokeyBroadcaster_LookupFailsOverWhenTheNodeCannotAnswer(t *testing.T) {
	for name, primary := range map[string]func() *http.Response{
		// gno v1.8.0: a refused code-running query is an HTTP 403.
		"refusal as 403": func() *http.Response {
			return jsonResponse(http.StatusForbidden, `{"error":{"message":"runs code, which this node does not allow over RPC"}}`)
		},
		// Earlier builds: HTTP 200 carrying a JSON-RPC error.
		"refusal as JSON-RPC error": func() *http.Response {
			return jsonResponse(http.StatusOK, `{"error":{"code":-32603,"message":"runs code, which this node does not allow over RPC"}}`)
		},
		"gateway error": func() *http.Response { return jsonResponse(http.StatusBadGateway, "") },
		"not JSON":      func() *http.Response { return jsonResponse(http.StatusOK, "<html>") },
	} {
		t.Run(name, func(t *testing.T) {
			nodes := &failoverNodes{
				network: map[string]string{"backup.example": "gnoland-1"},
				query:   map[string]func() *http.Response{"primary.example": primary, "backup.example": entryAnswer},
			}
			entry, found, err := failoverBroadcaster(nodes).LookupEntry(context.Background(), Run{Game: "invaders", Day: "2026-11-17", Addr: "g1alice"})
			if err != nil || !found || entry.LogHash != "abc" {
				t.Fatalf("lookup: entry=%+v found=%v err=%v", entry, found, err)
			}
			want := []string{"primary.example ", "backup.example /status", "backup.example "}
			if !slices.Equal(nodes.seen, want) {
				t.Fatalf("requests = %q, want %q", nodes.seen, want)
			}
		})
	}
}

func TestGnokeyBroadcaster_LookupFailsOverWhenTheNodeIsUnreachable(t *testing.T) {
	nodes := &failoverNodes{
		network: map[string]string{"backup.example": "gnoland-1"},
		query:   map[string]func() *http.Response{"backup.example": entryAnswer},
	}
	if _, found, err := failoverBroadcaster(nodes).LookupEntry(context.Background(), Run{Day: "2026-11-17", Addr: "g1alice"}); err != nil || !found {
		t.Fatalf("lookup: found=%v err=%v", found, err)
	}
}

func TestGnokeyBroadcaster_LookupKeepsTheRealmAnswer(t *testing.T) {
	// The node ran the query and the realm answered with an error: that is the
	// chain's answer, which another node must not be asked to overrule.
	nodes := &failoverNodes{
		network: map[string]string{"backup.example": "gnoland-1"},
		query: map[string]func() *http.Response{
			"primary.example": func() *http.Response {
				return jsonResponse(http.StatusOK, `{"result":{"response":{"ResponseBase":{"Data":"","Error":{"@type":"/vm.VMError"}}}}}`)
			},
			"backup.example": entryAnswer,
		},
	}
	if _, _, err := failoverBroadcaster(nodes).LookupEntry(context.Background(), Run{Day: "2026-11-17", Addr: "g1alice"}); err == nil {
		t.Fatal("a realm error must be returned, not overruled by the fallback")
	}
	if len(nodes.seen) != 1 {
		t.Fatalf("requests = %q, want the primary only", nodes.seen)
	}
}

func TestGnokeyBroadcaster_FallbackOnAnotherChainIsNeverQueried(t *testing.T) {
	nodes := &failoverNodes{
		network: map[string]string{"backup.example": "test-13"},
		query: map[string]func() *http.Response{
			"primary.example": func() *http.Response { return jsonResponse(http.StatusForbidden, "") },
			"backup.example":  entryAnswer,
		},
	}
	b := failoverBroadcaster(nodes)
	_, _, err := b.LookupEntry(context.Background(), Run{Day: "2026-11-17", Addr: "g1alice"})
	if err == nil || !strings.Contains(err.Error(), `reports "test-13"`) {
		t.Fatalf("lookup err = %v, want the wrong-chain refusal", err)
	}
	b.exec = func(_ context.Context, args []string, _ string) (string, error) {
		return "invalid status code received, 403", errors.New("exit 1")
	}
	if _, err := b.AttestScore(context.Background(), Run{LogHash: "x"}); err == nil || !strings.Contains(err.Error(), `reports "test-13"`) {
		t.Fatalf("attest err = %v, want the wrong-chain refusal", err)
	}
	for _, r := range nodes.seen {
		if r == "backup.example " {
			t.Fatalf("the wrong-chain fallback was queried: %q", nodes.seen)
		}
	}
}

// attestExec answers gnokey per -remote and records the remotes in call order.
func attestExec(byRemote map[string]func(context.Context) (string, error), remotes *[]string) attesterExecFn {
	return func(ctx context.Context, args []string, _ string) (string, error) {
		remote := args[slices.Index(args, "-remote")+1]
		*remotes = append(*remotes, remote)
		return byRemote[remote](ctx)
	}
}

func TestGnokeyBroadcaster_AttestFailsOverWhenTheNodeFails(t *testing.T) {
	for name, primary := range map[string]func(context.Context) (string, error){
		// gnokey's RPC client on a refused simulate (403 on gno v1.8.0).
		"refusal": func(context.Context) (string, error) {
			return "Error: invalid status code received, 403", errors.New("exit 1")
		},
		"refusal text": func(context.Context) (string, error) {
			return `query ".app/simulate" runs code, which this node does not allow over RPC`, errors.New("exit 1")
		},
		"unreachable": func(context.Context) (string, error) {
			return "post https://primary.example: dial tcp: connection refused", errors.New("exit 1")
		},
		"hung": func(ctx context.Context) (string, error) {
			<-ctx.Done()
			return "", ctx.Err()
		},
	} {
		t.Run(name, func(t *testing.T) {
			nodes := &failoverNodes{network: map[string]string{"backup.example": "gnoland-1"}}
			b := failoverBroadcaster(nodes)
			b.cfg.Timeout = 50 * time.Millisecond
			var remotes []string
			b.exec = attestExec(map[string]func(context.Context) (string, error){
				"https://primary.example": primary,
				"https://backup.example":  func(context.Context) (string, error) { return "TX HASH: abc==", nil },
			}, &remotes)
			tx, err := b.AttestScore(context.Background(), Run{LogHash: "x"})
			if err != nil || tx != "abc==" {
				t.Fatalf("attest: tx=%q err=%v", tx, err)
			}
			if want := []string{"https://primary.example", "https://backup.example"}; !slices.Equal(remotes, want) {
				t.Fatalf("remotes = %q, want %q", remotes, want)
			}
			if !slices.Contains(nodes.seen, "backup.example /status") {
				t.Fatalf("the fallback's chain was not checked: %q", nodes.seen)
			}
		})
	}
}

func TestGnokeyBroadcaster_AttestKeepsTransactionFailures(t *testing.T) {
	for name, tc := range map[string]struct {
		out  string
		want error
	}{
		"realm keeps the better run": {out: "panic: existing entry is not improved", want: ErrAlreadyOnChain},
		"realm shape refusal":        {out: "panic: score out of range", want: ErrPermanentReject},
		// The transaction's own failure, which every node would share. The gas
		// figure carries "403" on purpose: only gnokey's status line may match.
		"insufficient funds": {out: "insufficient funds to pay for fees; 4030000ugnot < 5000000ugnot"},
	} {
		t.Run(name, func(t *testing.T) {
			b := failoverBroadcaster(&failoverNodes{network: map[string]string{"backup.example": "gnoland-1"}})
			var remotes []string
			b.exec = attestExec(map[string]func(context.Context) (string, error){
				"https://primary.example": func(context.Context) (string, error) { return tc.out, errors.New("exit 1") },
				"https://backup.example":  func(context.Context) (string, error) { return "TX HASH: abc==", nil },
			}, &remotes)
			_, err := b.AttestScore(context.Background(), Run{LogHash: "x"})
			if err == nil || tc.want != nil && !errors.Is(err, tc.want) {
				t.Fatalf("attest err = %v, want %v", err, tc.want)
			}
			if len(remotes) != 1 {
				t.Fatalf("remotes = %q, want the primary only", remotes)
			}
		})
	}
}

func TestGnokeyBroadcaster_AttestStopsWhenTheCallerCancels(t *testing.T) {
	b := failoverBroadcaster(&failoverNodes{network: map[string]string{"backup.example": "gnoland-1"}})
	ctx, cancel := context.WithCancel(context.Background())
	var remotes []string
	b.exec = attestExec(map[string]func(context.Context) (string, error){
		"https://primary.example": func(context.Context) (string, error) {
			cancel()
			return "dial tcp: connection refused", errors.New("exit 1")
		},
		"https://backup.example": func(context.Context) (string, error) { return "TX HASH: abc==", nil },
	}, &remotes)
	if _, err := b.AttestScore(ctx, Run{LogHash: "x"}); err == nil || len(remotes) != 1 {
		t.Fatalf("err=%v remotes=%q, want an error from the primary only", err, remotes)
	}
}
