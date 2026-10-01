package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/samouraiworld/memba/backend/internal/arcade"
)

// curationRealmPath is the realm that knows who founded a collection and who
// holds a manager seat. It may not be published on a network: a node that has
// no such realm gives no answer, which reads as unavailable, never as a role.
const curationRealmPath = "gno.land/r/samcrew/launchpad/curation/v1"

// Launchpad collection ids are "C<n>", n a positive int64 without leading zero.
var curationCollectionID = regexp.MustCompile(`^C[1-9][0-9]{0,18}$`)

// curationMaxBlockAge bounds the age of the block an access answer was read at:
// blocks come every few seconds, so an older answer may still show a removed seat.
const curationMaxBlockAge = time.Minute

// curationAccessKeys are the keys of the realm's AccessJSON answer, in the order
// the realm writes them: where and when it was evaluated, what was asked, and
// the three roles.
var curationAccessKeys = [...]string{"chainId", "height", "time", "collection", "account", "founder", "manager", "conflicted"}

// errCurationAnswer means a node answered, but not with the realm's exact
// AccessJSON object, read on the expected chain within curationMaxBlockAge, for
// the collection and account that were asked.
var errCurationAnswer = errors.New("curation access: not a current answer of the realm on the expected chain")

// curationThreadAccess asks the chain, now, whether account may read and write
// the private thread of collection: its founder, or an active manager with no
// conflict on that collection.
//
// The answer is never cached and no role comes from the client. It is one
// vm/qeval whose answer says which chain evaluated it and at what block time,
// so no second request has to vouch for the node. The configured node is asked
// first, then the failover nodes: an answer that fails, comes from another
// chain, is too old or is malformed is neither a grant nor a refusal, and the
// next node is asked. So is the empty answer of a node on which the realm
// aborted, as it does for a collection it does not know: nothing in it says
// which chain refused, or when. An error means no node gave a current answer.
func curationThreadAccess(ctx context.Context, rpcURL, chainID, collection, account string) (bool, error) {
	if chainID == "" || !curationCollectionID.MatchString(collection) || !isValidGnoAddress(account) {
		return false, errors.New("curation access: invalid chain, collection or account")
	}
	expr := curationRealmPath + ".AccessJSON(" + strconv.Quote(collection) + "," + strconv.Quote(account) + ")"
	var failures []error
	for n, node := range rpcURLsInOrder(rpcURL) {
		out, err := questAbciQueryOnce(ctx, node, "vm/qeval", expr)
		if err == nil {
			var allowed bool
			if allowed, err = parseCurationAccess(out, chainID, collection, account, time.Now()); err == nil {
				return allowed, nil
			}
		}
		failures = append(failures, fmt.Errorf("node %d: %w", n+1, err))
	}
	return false, fmt.Errorf("curation access: no current answer: %w", errors.Join(failures...))
}

// parseCurationAccess reads one vm/qeval print of AccessJSON as of now. It
// accepts exactly curationAccessKeys, in that order: five strings, of which the
// chain id, the collection and the account must equal what was asked, the
// height must be a positive decimal and the time a Unix second within
// curationMaxBlockAge of now (either side); then three JSON booleans. Anything
// else is errCurationAnswer: a missing or mistyped field is never read as false.
func parseCurationAccess(out, chainID, collection, account string, now time.Time) (bool, error) {
	answer, err := arcade.QevalString(out)
	if err != nil {
		return false, fmt.Errorf("%w: %w", errCurationAnswer, err)
	}
	var fields [len(curationAccessKeys)]json.RawMessage
	dec := json.NewDecoder(strings.NewReader(answer))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return false, errCurationAnswer
	}
	for n, key := range curationAccessKeys {
		if tok, err := dec.Token(); err != nil || tok != key || dec.Decode(&fields[n]) != nil {
			return false, errCurationAnswer
		}
	}
	if tok, err := dec.Token(); err != nil || tok != json.Delim('}') {
		return false, errCurationAnswer
	}
	if _, err := dec.Token(); err != io.EOF {
		return false, errCurationAnswer
	}
	var text [5]string
	for n := range text {
		if !jsonText(fields[n], &text[n]) {
			return false, errCurationAnswer
		}
	}
	if text[0] != chainID {
		return false, fmt.Errorf("%w: answered by chain %.40q", errCurationAnswer, text[0])
	}
	if text[3] != collection || text[4] != account {
		return false, errCurationAnswer
	}
	_, heightOK := positiveDecimal(text[1])
	seconds, timeOK := positiveDecimal(text[2])
	if !heightOK || !timeOK {
		return false, errCurationAnswer
	}
	if age := now.Sub(time.Unix(seconds, 0)); age.Abs() > curationMaxBlockAge {
		return false, fmt.Errorf("%w: read at a block %s old", errCurationAnswer, age.Round(time.Second))
	}
	founder, okFounder := jsonBool(fields[5])
	manager, okManager := jsonBool(fields[6])
	conflicted, okConflicted := jsonBool(fields[7])
	if !okFounder || !okManager || !okConflicted {
		return false, errCurationAnswer
	}
	return founder || (manager && !conflicted), nil
}

// jsonText decodes raw into out only when raw is a JSON string.
func jsonText(raw json.RawMessage, out *string) bool {
	return len(raw) > 0 && raw[0] == '"' && json.Unmarshal(raw, out) == nil
}

// jsonBool reads raw only when it is the JSON literal true or false.
func jsonBool(raw json.RawMessage) (value, ok bool) {
	switch string(raw) {
	case "true":
		return true, true
	case "false":
		return false, true
	}
	return false, false
}

// positiveDecimal reads s only when it is a positive int64 in plain decimal, as
// the realm writes its int64 values.
func positiveDecimal(s string) (int64, bool) {
	n, err := strconv.ParseInt(s, 10, 64)
	return n, err == nil && n > 0 && strconv.FormatInt(n, 10) == s
}
