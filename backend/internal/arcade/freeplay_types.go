package arcade

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"regexp"
	"strconv"
	"unicode/utf8"

	"github.com/samouraiworld/memba/backend/internal/address"
)

const (
	FreePlayPrefix         = "/api/arcade/free-play/v1/"
	FreePlayRealm          = "gno.land/r/samcrew/memba_arcade_scores_v2"
	FreePlayMaxScore int64 = 9007199254740991
	FreePlayMaxBody  int64 = 1 << 20
)

var (
	ErrFreePlayConflict = errors.New("run_conflict")
	ErrFreePlayMissing  = errors.New("run_not_found")
	ErrFreePlayPaused   = errors.New("publication_paused")
	ErrFreePlayQuote    = errors.New("quote_expired")
	ErrFreePlayReceipt  = errors.New("receipt_mismatch")
	fpHex64             = regexp.MustCompile(`^[0-9a-f]{64}$`)
	fpStateHash         = regexp.MustCompile(`^([0-9a-f]{8}|[0-9a-f]{64})$`)
	fpRules             = regexp.MustCompile(`^[a-z0-9-]{1,48}$`)
	fpUUID              = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	fpChain             = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`)
)

// HashFreePlayFields is SHA256 of uint32-BE length-prefixed UTF-8 fields.
// Callers validate bounded fields first; request JSON bytes are never hashed.
func HashFreePlayFields(fields ...string) string {
	h := sha256.New()
	for _, field := range fields {
		var length [4]byte
		binary.BigEndian.PutUint32(length[:], uint32(len(field))) // #nosec G115 -- all protocol fields are bounded below 1 MiB
		_, _ = h.Write(length[:])
		_, _ = h.Write([]byte(field))
	}
	return hex.EncodeToString(h.Sum(nil))
}

func validFreePlayGame(game string) bool {
	return game == "block-party" || game == "space-invaders" || game == "barricade"
}

type FreePlayTarget struct {
	ChainID string `json:"chainId"`
	Realm   string `json:"realm"`
}

func (t FreePlayTarget) Validate() error {
	if !fpChain.MatchString(t.ChainID) || t.Realm != FreePlayRealm {
		return errors.New("invalid_freeplay_target")
	}
	return nil
}

type FreePlayInput struct {
	ClientRunID  string `json:"clientRunId"`
	Game         string `json:"game"`
	Rules        string `json:"rules"`
	SimVersion   int64  `json:"simVersion"`
	Seed         string `json:"seed"`
	ReplayCodec  string `json:"replayCodec"`
	Replay       string `json:"replay"`
	FinishReason string `json:"finishReason"`
	ClaimedScore *int64 `json:"claimedScore,omitempty"`
}

type FreePlayEntry struct {
	Game       string `json:"game"`
	Player     string `json:"player"`
	Rules      string `json:"rules"`
	SimVersion int64  `json:"simVersion"`
	RunID      string `json:"runID"`
	Seed       string `json:"seed"`
	Score      int64  `json:"score"`
	StateHash  string `json:"stateHash"`
	ReplayHash string `json:"replayHash"`
}

func (e FreePlayEntry) Validate() error {
	a, err := address.Parse(e.Player)
	if err != nil || a.Kind() != address.KindGno || a.String() != e.Player {
		return errors.New("invalid_player")
	}
	if !validFreePlayGame(e.Game) || !fpRules.MatchString(e.Rules) || e.SimVersion < 1 || e.SimVersion > 2147483647 {
		return errors.New("invalid_rules")
	}
	if len(e.Seed) < 1 || len(e.Seed) > 128 || !utf8.ValidString(e.Seed) || e.Score < 0 || e.Score > FreePlayMaxScore {
		return errors.New("invalid_result")
	}
	if !fpHex64.MatchString(e.RunID) || !fpHex64.MatchString(e.ReplayHash) || !fpStateHash.MatchString(e.StateHash) {
		return errors.New("invalid_commitment")
	}
	return nil
}
func (e FreePlayEntry) PayloadHash(t FreePlayTarget) string {
	return HashFreePlayFields("memba:free-anchor:v1", t.ChainID, t.Realm, e.RunID, e.Player, e.Game, e.Rules, strconv.FormatInt(e.SimVersion, 10), e.Seed, strconv.FormatInt(e.Score, 10), e.StateHash, e.ReplayHash)
}
func FreePlayRunID(t FreePlayTarget, player, game, clientRunID string) (string, error) {
	if err := t.Validate(); err != nil {
		return "", err
	}
	a, err := address.Parse(player)
	if err != nil || a.Kind() != address.KindGno || a.String() != player || !validFreePlayGame(game) || !fpUUID.MatchString(clientRunID) {
		return "", errors.New("invalid_run_identity")
	}
	return HashFreePlayFields("memba:free-run:v1", t.ChainID, t.Realm, player, game, clientRunID), nil
}

type FreePlayRun struct {
	LastError   string           `json:"lastError,omitempty"`
	Attempts    int              `json:"attempts,omitempty"`
	Target      FreePlayTarget   `json:"target"`
	Entry       FreePlayEntry    `json:"entry"`
	ClientRunID string           `json:"clientRunId"`
	PayloadHash string           `json:"payloadHash"`
	ReplayCodec string           `json:"replayCodec"`
	Replay      string           `json:"replay"`
	Status      string           `json:"status"`
	Receipt     *FreePlayReceipt `json:"receipt,omitempty"`
}

// Receipt is supplied only after successful inclusion and an exact realm readback.
type FreePlayReceipt struct {
	Target        FreePlayTarget `json:"target"`
	Entry         FreePlayEntry  `json:"entry"`
	Height        int64          `json:"height"`
	Attester      string         `json:"attester"`
	TxHash        string         `json:"txHash,omitempty"`
	SchemaVersion int            `json:"schemaVersion"`
}
