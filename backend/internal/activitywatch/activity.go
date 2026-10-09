package activitywatch

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"

	"github.com/gnolang/gno/gno.land/pkg/sdk/vm"
	"github.com/gnolang/gno/tm2/pkg/amino"
	// Register bank messages even when this package is used without the API's
	// multisig service. Unrelated transfers must decode before they are ignored.
	_ "github.com/gnolang/gno/tm2/pkg/sdk/bank"
	"github.com/gnolang/gno/tm2/pkg/std"
)

// Only structural metadata leaves the backend. Never forward arguments, memo,
// source code, event attributes, error text, or arbitrary Discord markdown.
func safe(s string) string {
	var b strings.Builder
	for _, c := range s {
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune("/_-.", c) {
			b.WriteRune(c)
		}
		if b.Len() >= 250 {
			break
		}
	}
	return b.String()
}

func (w *Watcher) messages(height int64, raw []byte, r receipt) ([]string, error) {
	if r.ResponseBase == nil || len(r.ResponseBase.Error) == 0 {
		return nil, errors.New("missing transaction receipt")
	}
	// Failed transactions may have emitted events before rollback: never report
	// those events as successful activity. Report a failed direct call as such.
	failed := !null(r.ResponseBase.Error)
	var tx std.Tx
	if err := amino.Unmarshal(raw, &tx); err != nil {
		return nil, errors.New("cannot decode chain transaction; cursor retained")
	}
	lines := map[string]bool{}
	add := func(path, action string) {
		if w.cfg.watches(path) {
			lines["`"+safe(path)+"` — `"+safe(action)+"`"] = true
		}
	}
	for _, msg := range tx.Msgs {
		switch m := msg.(type) {
		case vm.MsgCall:
			add(m.PkgPath, m.Func)
		case vm.MsgAddPackage:
			if m.Package != nil {
				add(m.Package.Path, "PackageSubmitted")
			}
		case vm.MsgEnablePackage:
			add(m.PkgPath, "PackageEnabled")
		case vm.MsgRejectPackage:
			add(m.PkgPath, "PackageRejected")
		}
	}
	if !failed {
		for _, ev := range r.ResponseBase.Events {
			name := ev.Type
			if name == "" {
				name = strings.TrimPrefix(ev.Kind, "/tm.")
			}
			if name != "" {
				add(ev.PkgPath, name)
			}
		}
	}
	if len(lines) == 0 {
		return nil, nil
	}
	ordered := make([]string, 0, len(lines))
	for l := range lines {
		ordered = append(ordered, l)
	}
	sort.Strings(ordered)
	hash := sha256.Sum256(raw)
	txHash := hex.EncodeToString(hash[:])
	state := "confirmed"
	if failed {
		state = "FAILED (realm changes reverted; fees may apply)"
	}
	link := "https://gnoscan.io/transactions/details?txhash=" + txHash + "&chainId=" + url.QueryEscape(w.cfg.ChainID)
	if w.cfg.ChainID != "gnoland-1" && w.cfg.ChainID != "staging" {
		link = strings.TrimRight(w.cfg.RPCURL, "/") + "/tx?hash=0x" + txHash
	}
	header := fmt.Sprintf("**Memba activity — %s**\n%s · block %d\n<%s>\n", state, w.cfg.ChainID, height, link)
	// Bound each Discord payload; split rather than discard a large transaction.
	var out []string
	content := header
	for _, l := range ordered {
		if len(content)+len(l)+1 > 1800 {
			out = append(out, content)
			content = header
		}
		content += l + "\n"
	}
	return append(out, content), nil
}
