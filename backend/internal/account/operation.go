package account

import (
	"net/http"
	"sync"
)

// The deployed backend is one process over a local SQLite volume (fly.toml,
// start.sh). Keep remote provider I/O inside one account operation without
// holding a SQLite write transaction or blocking unrelated accounts. This
// guard must become shared coordination before adding backend processes.
// Process-wide scope also covers separately constructed HTTP handlers.
var accountOperations = struct {
	sync.Mutex
	active map[string]bool
}{active: make(map[string]bool)}

// beginOperation rejects rather than queues a concurrent request. Its caller
// retries with fresh account state; in particular it must not reuse an email
// snapshot from before a deletion/address change. Entries live only as long
// as active requests, so arbitrary authenticated subjects cannot grow a cache.
func beginOperation(w http.ResponseWriter, subject string) (func(), bool) {
	accountOperations.Lock()
	if accountOperations.active[subject] {
		accountOperations.Unlock()
		w.Header().Set("Retry-After", "1")
		writeError(w, http.StatusConflict, "another account operation is in progress; try again")
		return nil, false
	}
	accountOperations.active[subject] = true
	accountOperations.Unlock()
	return func() {
		accountOperations.Lock()
		delete(accountOperations.active, subject)
		accountOperations.Unlock()
	}, true
}
