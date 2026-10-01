package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/samouraiworld/memba/backend/internal/auth"
	"github.com/samouraiworld/memba/backend/internal/ratelimit"
)

const (
	// curationInboxMaxBody bounds one message, in bytes of UTF-8 text.
	curationInboxMaxBody = 4000
	// curationInboxMaxRequest bounds the JSON request that carries a message:
	// JSON may escape every byte of the text as \u00XX (six bytes).
	curationInboxMaxRequest = 6*curationInboxMaxBody + 1024
	curationInboxPageSize   = 50
	// curationInboxMaxMessages bounds the messages one thread holds at a time.
	// Messages are kept 12 months (curationInboxRetention), so without it a
	// single thread could still grow the database without bound.
	curationInboxMaxMessages = 2000
	// curationInboxMaxLoggedError bounds the error text that one request which
	// cannot be served adds to the log: it can quote what every node answered.
	curationInboxMaxLoggedError = 1024
)

// A send names itself with an id the client chooses, so a retry is stored once.
var curationClientID = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

// CurationInbox serves the private thread between a collection's founder and
// the curation managers. Message bodies are sealed with AES-256-GCM before they
// reach the database; chain, collection, sender and time stay in clear.
//
// It holds no roles. Every request asks the chain again (curationThreadAccess)
// who the authenticated wallet is to the collection. A nil *CurationInbox is
// the inbox that is not configured: it answers "not available" to everything.
type CurationInbox struct {
	db      *sql.DB
	chainID string
	rpcURL  string
	aead    cipher.AEAD
	keyID   string
	allow   func(wallet, endpoint string) bool // per-wallet cap of a ratelimit.*Endpoint
}

type curationMessage struct {
	Seq        int64  `json:"seq"`
	Sender     string `json:"sender"`
	ClientID   string `json:"clientId"`
	CreatedAt  int64  `json:"createdAt"`            // Unix seconds
	Body       string `json:"body"`                 // empty when unreadable
	Unreadable bool   `json:"unreadable,omitempty"` // the stored body does not open under the current key
}

type curationThreadPage struct {
	ChainID    string            `json:"chainId"`
	Collection string            `json:"collection"`
	Messages   []curationMessage `json:"messages"`             // newest first
	NextBefore int64             `json:"nextBefore,omitempty"` // pass as ?before= for older messages
}

type curationSend struct {
	ClientID string `json:"clientId"`
	Body     string `json:"body"`
}

// NewCurationInbox builds the inbox from its key (keyHex: 64 hex characters, a
// 32-byte AES key used for nothing else). An empty keyHex is "not configured":
// nil, no error. A key that is set but unusable, a missing chain id, or a
// server that accepts unsigned logins (anyone can then obtain a session for a
// founder's or a manager's address) is an error and also leaves the inbox off.
func NewCurationInbox(db *sql.DB, chainID, keyHex string, allow func(wallet, endpoint string) bool) (*CurationInbox, error) {
	if keyHex == "" {
		return nil, nil
	}
	if auth.UnsignedAuthAllowed() {
		return nil, errors.New("curation inbox: refused while " + auth.AllowUnsignedAuthEnv + " accepts unsigned logins")
	}
	key, err := hex.DecodeString(keyHex)
	if err != nil || len(key) != 32 {
		return nil, errors.New("curation inbox: the key must be 64 hex characters")
	}
	if db == nil || chainID == "" || allow == nil {
		return nil, errors.New("curation inbox: a database, a chain id and a wallet limiter are required")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	// The key id is a fingerprint: logged here and stored with every row.
	id := sha256.Sum256(append([]byte("memba-curation-inbox-key-id\x00"), key...))
	inbox := &CurationInbox{db: db, chainID: chainID, rpcURL: gnoRPCURL(), aead: aead, keyID: hex.EncodeToString(id[:8]), allow: allow}
	slog.Info("curation inbox enabled", "chain_id", chainID, "key_id", inbox.keyID)
	return inbox, nil
}

// ServeHTTP handles GET (read a page) and POST (send one message) for
// ?collection=C<n>, behind the wallet session middleware. The session, the
// request and the per-wallet caps are checked before the chain is asked.
func (i *CurationInbox) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if i == nil {
		curationInboxError(w, http.StatusServiceUnavailable, "curation inbox not available")
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		curationInboxError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	wallet, ok := AuthAddressFrom(r.Context())
	if !ok {
		curationInboxError(w, http.StatusUnauthorized, "authorization required")
		return
	}
	collection := r.URL.Query().Get("collection")
	if !curationCollectionID.MatchString(collection) {
		curationInboxError(w, http.StatusBadRequest, "invalid collection")
		return
	}
	before, in := int64(math.MaxInt64), curationSend{}
	if r.Method == http.MethodPost {
		if status, message := decodeCurationSend(w, r, &in); status != 0 {
			curationInboxError(w, status, message)
			return
		}
	} else if raw := r.URL.Query().Get("before"); raw != "" {
		var err error
		if before, err = strconv.ParseInt(raw, 10, 64); err != nil || before < 1 {
			curationInboxError(w, http.StatusBadRequest, "invalid before")
			return
		}
	}
	if !i.allow(wallet, ratelimit.CurationInboxEndpoint) ||
		(r.Method == http.MethodPost && !i.allow(wallet, ratelimit.CurationSendEndpoint)) {
		curationInboxError(w, http.StatusTooManyRequests, "rate limit exceeded")
		return
	}
	allowed, err := curationThreadAccess(r.Context(), i.rpcURL, i.chainID, collection, wallet)
	if err != nil {
		i.unavailable(w, "access could not be read from the chain", err)
		return
	}
	if !allowed {
		curationInboxError(w, http.StatusForbidden, "no access to this thread")
		return
	}
	if r.Method == http.MethodGet {
		i.read(w, r, collection, before)
		return
	}
	i.send(w, r, collection, wallet, in)
}

// decodeCurationSend reads and checks a send request. It returns 0 when in is
// a message that may be stored, or the status and message to refuse it with.
func decodeCurationSend(w http.ResponseWriter, r *http.Request, in *curationSend) (int, string) {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, curationInboxMaxRequest))
	dec.DisallowUnknownFields()
	if err := dec.Decode(in); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return http.StatusRequestEntityTooLarge, "message too large"
		}
		return http.StatusBadRequest, "invalid message"
	}
	if len(in.Body) > curationInboxMaxBody {
		return http.StatusRequestEntityTooLarge, "message too large"
	}
	if !curationClientID.MatchString(in.ClientID) || strings.TrimSpace(in.Body) == "" {
		return http.StatusBadRequest, "invalid message"
	}
	return 0, ""
}

func (i *CurationInbox) read(w http.ResponseWriter, r *http.Request, collection string, before int64) {
	rows, err := i.db.QueryContext(r.Context(), `SELECT seq, sender, client_id, created_at, key_id, nonce, body
		FROM curation_inbox_messages WHERE chain_id = ? AND collection = ? AND seq < ?
		ORDER BY seq DESC LIMIT ?`, i.chainID, collection, before, curationInboxPageSize+1)
	if err != nil {
		i.unavailable(w, "store read failed", err)
		return
	}
	defer func() { _ = rows.Close() }()
	page := curationThreadPage{ChainID: i.chainID, Collection: collection, Messages: []curationMessage{}}
	for rows.Next() {
		m, err := i.scan(rows, collection)
		if err != nil {
			i.unavailable(w, "store read failed", err)
			return
		}
		page.Messages = append(page.Messages, m)
	}
	if err := rows.Err(); err != nil {
		i.unavailable(w, "store read failed", err)
		return
	}
	if len(page.Messages) > curationInboxPageSize {
		page.Messages = page.Messages[:curationInboxPageSize]
		page.NextBefore = page.Messages[curationInboxPageSize-1].Seq
	}
	writeJSON(w, page)
}

func (i *CurationInbox) send(w http.ResponseWriter, r *http.Request, collection, wallet string, in curationSend) {
	now := time.Now().Unix()
	nonce := make([]byte, i.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		i.unavailable(w, "no randomness", err)
		return
	}
	sealed := i.aead.Seal(nil, nonce, []byte(in.Body), curationInboxAAD(i.chainID, collection, wallet, in.ClientID, now))
	// seq is the next position in this chain's thread; once every message of a
	// thread has expired (12 months), the thread starts again at 1. Nothing is
	// stored when the thread is full (HAVING) or this sender already used the
	// client id (index).
	res, err := i.db.ExecContext(r.Context(), `INSERT INTO curation_inbox_messages
		(chain_id, collection, seq, sender, client_id, created_at, key_id, nonce, body)
		SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ?, ?
		FROM curation_inbox_messages WHERE chain_id = ? AND collection = ?
		HAVING COUNT(*) < ?
		ON CONFLICT (chain_id, collection, sender, client_id) DO NOTHING`,
		i.chainID, collection, wallet, in.ClientID, now, i.keyID, nonce, sealed, i.chainID, collection, curationInboxMaxMessages)
	if err != nil {
		i.unavailable(w, "store write failed", err)
		return
	}
	inserted, err := res.RowsAffected()
	if err != nil {
		i.unavailable(w, "store write failed", err)
		return
	}
	stored, err := i.scan(i.db.QueryRowContext(r.Context(), `SELECT seq, sender, client_id, created_at, key_id, nonce, body
		FROM curation_inbox_messages WHERE chain_id = ? AND collection = ? AND sender = ? AND client_id = ?`,
		i.chainID, collection, wallet, in.ClientID), collection)
	switch {
	case errors.Is(err, sql.ErrNoRows): // nothing stored, and no earlier send under this id
		curationInboxError(w, http.StatusConflict, "this thread has reached its message limit")
		return
	case err != nil:
		i.unavailable(w, "store read failed", err)
		return
	case stored.Unreadable || stored.Body != in.Body:
		curationInboxError(w, http.StatusConflict, "client id already used")
		return
	}
	if inserted == 1 {
		w.WriteHeader(http.StatusCreated)
	}
	writeJSON(w, stored)
}

// scan reads one stored row and opens its body. A row sealed under another key,
// or whose clear columns were altered, does not open: it is returned marked
// unreadable, with no body, and logged; the other rows are still served.
func (i *CurationInbox) scan(row interface{ Scan(...any) error }, collection string) (curationMessage, error) {
	var m curationMessage
	var keyID string
	var nonce, sealed []byte
	if err := row.Scan(&m.Seq, &m.Sender, &m.ClientID, &m.CreatedAt, &keyID, &nonce, &sealed); err != nil {
		return m, err
	}
	plain, err := i.open(nonce, sealed, curationInboxAAD(i.chainID, collection, m.Sender, m.ClientID, m.CreatedAt))
	if err != nil {
		m.Unreadable = true
		slog.Error("curation inbox: a stored message does not open", "chain_id", i.chainID, "collection", collection,
			"seq", m.Seq, "row_key_id", keyID, "key_id", i.keyID, "error", err)
	}
	m.Body = string(plain)
	return m, nil
}

func (i *CurationInbox) open(nonce, sealed, aad []byte) ([]byte, error) {
	if len(nonce) != i.aead.NonceSize() { // Open panics on any other length
		return nil, errors.New("nonce of the wrong length")
	}
	return i.aead.Open(nil, nonce, sealed, aad)
}

// curationInboxAAD binds a sealed body to the clear columns of its row (no text
// part can contain the separator). Not seq: the INSERT assigns it after sealing.
func curationInboxAAD(chainID, collection, sender, clientID string, createdAt int64) []byte {
	return fmt.Appendf(nil, "%s\x00%s\x00%s\x00%s\x00%d", chainID, collection, sender, clientID, createdAt)
}

// unavailable answers 503 for what is neither a grant nor a refusal: the chain
// gave no current answer, or the store could not be read or written.
func (i *CurationInbox) unavailable(w http.ResponseWriter, reason string, err error) {
	if errors.Is(err, errPackageNotFound) {
		reason = "curation realm not published on this chain"
	}
	slog.Warn("curation inbox unavailable", "reason", reason, "chain_id", i.chainID, "error", truncate(err.Error(), curationInboxMaxLoggedError))
	curationInboxError(w, http.StatusServiceUnavailable, "curation inbox not available")
}

func curationInboxError(w http.ResponseWriter, status int, message string) {
	w.WriteHeader(status)
	writeJSON(w, map[string]string{"error": message})
}
