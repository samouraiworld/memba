package main

import (
	"context"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/samouraiworld/memba/backend/internal/arcade"
	"github.com/samouraiworld/memba/backend/internal/launchpadwatch"
)

const treasury = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"

const salesAddr = "g1rdjmeglm55p7evsxrk0y639l2gqwemh7qpaw53"

// sweptEvents is gnokey's EVENTS line for a sweep: the bank transfer out of the
// sales realm, then the realm's event.
func sweptEvents(to, amount string) string {
	// The caller's own transfer (a storage deposit, say) is not the sweep's.
	return sweptEventsPaying(to, amount, `{"from":"g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5","to":"g1x","coins":[{"denom":"ugnot","amount":9}]},`+
		`{"from":"`+salesAddr+`","to":"`+to+`","coins":[{"denom":"ugnot","amount":`+amount+`}]}`)
}

func sweptEventsPaying(to, amount, transfers string) string {
	if transfers != "" {
		transfers += ","
	}
	return `EVENTS:     [` + transfers + `{"type":"LaunchpadFeesSwept","attrs":[{"key":"currency","value":"ugnot"},{"key":"treasury","value":"` + to +
		`"},{"key":"amount","value":"` + amount + `"},{"key":"actor","value":"g1x"}],"pkg_path":"` + launchpadwatch.SalesPath + `"}]`
}

type fixture struct {
	t     *testing.T
	k     keeper
	out   *strings.Builder
	warn  *strings.Builder
	runs  [][]string
	reply string
	pages []string
	mu    sync.Mutex
}

func newFixture(t *testing.T, fees int64) *fixture {
	t.Helper()
	f := &fixture{t: t, out: &strings.Builder{}, warn: &strings.Builder{}, reply: "OK!\n" + sweptEvents(treasury, "500") + "\nTX HASH: x"}
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.pages = append(f.pages, string(b))
		f.mu.Unlock()
	}))
	t.Cleanup(hook.Close)
	f.k = keeper{
		o: options{chainID: "gnoland-1", remote: "https://node", state: filepath.Join(t.TempDir(), "keeper.json"), key: "launchpad-keeper",
			gnokey: "gnokey", minFees: 1000, maxAge: 24 * time.Hour, gasWanted: 30_000_000, maxFee: 2_000_000, timeout: time.Minute},
		out: f.out, warn: f.warn, client: hook.Client(), webhook: hook.URL, now: func() time.Time { return time.Unix(1_800_000_000, 0) },
		run: func(_ context.Context, args []string) (string, error) {
			f.runs = append(f.runs, args)
			return f.reply, nil
		},
		plan: func(context.Context, string, string) (launchpadwatch.SweepPlan, error) {
			return launchpadwatch.SweepPlan{Fees: big.NewInt(fees), Treasury: treasury, Height: 7}, nil
		},
		gasPrice: func(context.Context, *http.Client, string, string) (arcade.GasPrice, error) {
			return arcade.GasPrice{Gas: 1000, PriceUgnot: 1}, nil // 30M gas → 30,000 ugnot, paid twice over
		},
	}
	return f
}

func (f *fixture) once() error { return f.k.once(context.Background()) }

func TestZeroFeesSendNothing(t *testing.T) {
	f := newFixture(t, 0)
	f.k.o.broadcast = true
	if err := f.once(); err != nil || len(f.runs) != 0 {
		t.Fatalf("err %v, runs %d", err, len(f.runs))
	}
}

func TestDueOnFirstRunAtMinFeesOrAfterMaxAge(t *testing.T) {
	f := newFixture(t, 500) // below min-fees, no state: due
	f.k.o.broadcast = true
	if err := f.once(); err != nil || len(f.runs) != 1 {
		t.Fatalf("first run: err %v, runs %d", err, len(f.runs))
	}
	if err := f.once(); err != nil || len(f.runs) != 1 { // just swept, below min: not due
		t.Fatalf("second run: err %v, runs %d", err, len(f.runs))
	}
	f.k.now = func() time.Time { return time.Unix(1_800_000_000, 0).Add(24 * time.Hour) }
	if err := f.once(); err != nil || len(f.runs) != 2 {
		t.Fatalf("after max-age: err %v, runs %d", err, len(f.runs))
	}
	g := newFixture(t, 1000)
	g.k.o.broadcast, g.k.o.state = true, f.k.o.state // a sweep just ran, but the fees reach min-fees
	g.reply = "OK!\n" + sweptEvents(treasury, "1000")
	if err := g.once(); err != nil || len(g.runs) != 1 {
		t.Fatalf("at min-fees: err %v, runs %d", err, len(g.runs))
	}
}

func TestDryRunPrintsTheCommand(t *testing.T) {
	f := newFixture(t, 500)
	if err := f.once(); err != nil || len(f.runs) != 0 {
		t.Fatalf("err %v, runs %d", err, len(f.runs))
	}
	want := "gnokey maketx call -pkgpath gno.land/r/samcrew/launchpad/sales/v1 -func SweepFees -args ugnot -gas-fee 60000ugnot -gas-wanted 30000000 -chainid gnoland-1 -remote https://node -broadcast launchpad-keeper"
	if !strings.Contains(f.out.String(), want) {
		t.Fatalf("dry run printed:\n%s\nwant:\n%s", f.out, want)
	}
	if _, err := os.Stat(f.k.o.state); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("a dry run saved state")
	}
}

func TestPasswordStdinAndHome(t *testing.T) {
	f := newFixture(t, 500)
	f.k.o.broadcast, f.k.o.passwordStdin, f.k.o.home = true, true, "/keys"
	if err := f.once(); err != nil {
		t.Fatal(err)
	}
	argv := strings.Join(f.runs[0], " ")
	if !strings.HasSuffix(argv, "-broadcast -home /keys -insecure-password-stdin launchpad-keeper") {
		t.Fatalf("argv %s", argv)
	}
}

func TestAFeeAboveTheCapIsRefused(t *testing.T) {
	f := newFixture(t, 500)
	f.k.o.broadcast, f.k.o.maxFee = true, 59_999
	if err := f.once(); err == nil || len(f.runs) != 0 {
		t.Fatalf("err %v, runs %d", err, len(f.runs))
	}
	f.k.o.maxFee = 60_000 // the cap itself is allowed
	if err := f.once(); err != nil || len(f.runs) != 1 {
		t.Fatalf("at the cap: err %v, runs %d", err, len(f.runs))
	}
}

func TestAMismatchedSweepPages(t *testing.T) {
	for name, reply := range map[string]string{
		"other treasury":     sweptEvents("g1nn54k5fmly8agexe3ll4t6clqmcefsn7nr9ee3", "500"),
		"less than owed":     sweptEvents(treasury, "499"),
		"no event":           "OK!\nEVENTS:     []",
		"no transfer":        sweptEventsPaying(treasury, "500", ""),
		"transfer elsewhere": sweptEventsPaying(treasury, "500", `{"from":"`+salesAddr+`","to":"g1nn54k5fmly8agexe3ll4t6clqmcefsn7nr9ee3","coins":[{"denom":"ugnot","amount":500}]}`),
		"transfer of more":   sweptEventsPaying(treasury, "500", `{"from":"`+salesAddr+`","to":"`+treasury+`","coins":[{"denom":"ugnot","amount":501}]}`),
		"two transfers out":  sweptEventsPaying(treasury, "500", `{"from":"`+salesAddr+`","to":"`+treasury+`","coins":[{"denom":"ugnot","amount":500}]},{"from":"`+salesAddr+`","to":"g1x","coins":[{"denom":"ugnot","amount":1}]}`),
	} {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t, 500)
			f.k.o.broadcast, f.reply = true, reply
			if err := f.once(); err == nil {
				t.Fatal("a mismatched sweep passed")
			}
			if len(f.pages) != 1 || !strings.Contains(f.pages[0], "LAUNCHPAD PAGE sweep") {
				t.Fatalf("pages %v", f.pages)
			}
			if _, err := os.Stat(f.k.o.state); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("a mismatched sweep saved state")
			}
		})
	}
}

func TestAFailedBroadcastIsAnErrorNotAPage(t *testing.T) {
	f := newFixture(t, 500)
	f.k.o.broadcast = true
	f.k.run = func(context.Context, []string) (string, error) { return "", errors.New("exit 1") }
	if err := f.once(); err == nil || len(f.pages) != 0 {
		t.Fatalf("err %v, pages %d", err, len(f.pages))
	}
}

func TestRequiredFlags(t *testing.T) {
	f := newFixture(t, 500)
	f.k.o.broadcast, f.k.o.key = true, ""
	if err := f.once(); err == nil {
		t.Fatal("-broadcast without -key ran")
	}
	f.k.o.key, f.k.o.chainID = "k", ""
	if err := f.once(); err == nil {
		t.Fatal("no -chain-id ran")
	}
	f.k.o.chainID, f.k.o.maxAge = "gnoland-1", 0
	if err := f.once(); err == nil {
		t.Fatal("-max-age 0 ran")
	}
	f.k.o.maxAge, f.k.o.timeout = time.Hour, 0
	if err := f.once(); err == nil {
		t.Fatal("-timeout 0 ran")
	}
	f.k.o.timeout, f.k.webhook = time.Minute, ""
	if err := f.once(); err == nil || len(f.runs) != 0 {
		t.Fatalf("-broadcast without a webhook ran: %v", err)
	}
	f.k.o.broadcast = false // a dry run needs no webhook
	if err := f.once(); err != nil {
		t.Fatal(err)
	}
}

func TestStateIsPrivateAndAnUnreadableOneMeansNeverSwept(t *testing.T) {
	f := newFixture(t, 500)
	f.k.o.broadcast = true
	if err := os.WriteFile(f.k.o.state, []byte("{torn"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := f.once(); err != nil || len(f.runs) != 1 {
		t.Fatalf("err %v, runs %d", err, len(f.runs))
	}
	if !strings.Contains(f.warn.String(), "treated as never swept") {
		t.Fatalf("no warning: %q", f.warn.String())
	}
	info, err := os.Stat(f.k.o.state)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("state mode %v, %v", info.Mode().Perm(), err)
	}
}

func TestRunsNeverOverlap(t *testing.T) {
	f := newFixture(t, 500)
	held, err := os.OpenFile(f.k.o.state+".lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = held.Close() }()
	if err := syscall.Flock(int(held.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	if err := f.k.locked(context.Background()); err == nil || !strings.Contains(err.Error(), "another keeper run") {
		t.Fatalf("a second run went ahead: %v", err)
	}
	_ = syscall.Flock(int(held.Fd()), syscall.LOCK_UN)
	if err := f.k.locked(context.Background()); err != nil {
		t.Fatal(err)
	}
}

// fakeGnokey is a gnokey that prints its stdin, or sleeps when asked to.
func fakeGnokey(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "gnokey")
	script := "#!/bin/sh\ncase \"$*\" in *sleep*) sleep 5;; esac\necho \"stdin: $(cat)\"\n"
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestTheKeyPasswordGoesToGnokeyOnlyWhenAsked(t *testing.T) {
	gnokey := fakeGnokey(t)
	with, err := runGnokey(options{gnokey: gnokey, passwordStdin: true}, strings.NewReader("hunter2"))(context.Background(), []string{"x"})
	if err != nil || !strings.Contains(with, "stdin: hunter2") {
		t.Fatalf("with -password-stdin: %q, %v", with, err)
	}
	without, err := runGnokey(options{gnokey: gnokey}, strings.NewReader("hunter2"))(context.Background(), []string{"x"})
	if err != nil || strings.Contains(without, "hunter2") {
		t.Fatalf("without -password-stdin: %q, %v", without, err)
	}
}

func TestGnokeyIsStoppedAtTheTimeout(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := runGnokey(options{gnokey: fakeGnokey(t)}, nil)(ctx, []string{"sleep"}); err == nil || time.Since(start) > 3*time.Second {
		t.Fatalf("err %v after %v", err, time.Since(start))
	}
}

func TestTheRunGivesGnokeyTheTimeout(t *testing.T) {
	f := newFixture(t, 500)
	f.k.o.broadcast, f.k.o.timeout = true, 50*time.Millisecond
	f.k.run = func(ctx context.Context, _ []string) (string, error) {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(5 * time.Second):
			return f.reply, nil
		}
	}
	start := time.Now()
	if err := f.once(); err == nil || time.Since(start) > 2*time.Second {
		t.Fatalf("err %v after %v", err, time.Since(start))
	}
}
