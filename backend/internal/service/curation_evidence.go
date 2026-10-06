package service

import (
	"bytes"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"regexp"
	"strings"
	"unicode/utf8"
)

// curationEvidenceMaxBytes bounds one statement or reason. The curation realm
// stores only its hash and CID; the client reads the text back from IPFS and
// shows it only when its SHA-256 matches the hash on chain.
const curationEvidenceMaxBytes = 16 * 1024

// curationEvidenceCID is what the curation realm accepts as a CID: CIDv1 in
// base32, dag-pb (bafy…) or raw (bafk…, the usual CID of a small file), or
// CIDv0 in base58 (Qm…). A pin that answers anything else could not be
// committed, so it is reported as a failure here.
var curationEvidenceCID = regexp.MustCompile(`^(baf[yk][a-z2-7]{55,86}|Qm[1-9A-HJ-NP-Za-km-z]{44})$`)

// rawCID is the CIDv1 of content stored as one raw block (multibase "b",
// base32 lower, of version 1, the raw codec 0x55 and the sha2-256 multihash),
// which is what Lighthouse answers (bafkrei…) for a small file.
func rawCID(content []byte) string {
	sum := sha256.Sum256(content)
	return "b" + strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(append([]byte{0x01, 0x55, 0x12, 0x20}, sum[:]...)))
}

// HandleCurationEvidenceUpload handles POST /api/upload/curation-evidence: the
// body is the evidence itself, UTF-8 plain text of at most 16 KB, pinned as is
// to IPFS. It answers {"cid","sha256"}: the content address and the SHA-256 of
// the exact bytes pinned, the pair a curation call commits on chain. It never
// logs the text. Wrap it with wallet authentication and rate limits, as the
// other uploads: it spends the shared Lighthouse quota.
func HandleCurationEvidenceUpload(opts ...ipfsUploadOptions) http.Handler {
	var o ipfsUploadOptions
	if len(opts) > 0 {
		o = opts[0]
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fail := func(status int, message string) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			fail(http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		apiKey := os.Getenv("LIGHTHOUSE_API_KEY")
		if apiKey == "" {
			slog.Error("LIGHTHOUSE_API_KEY not configured")
			fail(http.StatusServiceUnavailable, "IPFS upload not configured")
			return
		}
		mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mediaType != "text/plain" || (params["charset"] != "" && !strings.EqualFold(params["charset"], "utf-8")) {
			fail(http.StatusUnsupportedMediaType, "evidence must be sent as text/plain; charset=utf-8")
			return
		}
		text, err := io.ReadAll(http.MaxBytesReader(w, r.Body, curationEvidenceMaxBytes))
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			fail(http.StatusRequestEntityTooLarge, "evidence is larger than 16 KB")
			return
		}
		if err != nil {
			fail(http.StatusBadRequest, "evidence could not be read")
			return
		}
		if len(bytes.TrimSpace(text)) == 0 {
			fail(http.StatusBadRequest, "evidence is empty")
			return
		}
		// The client decodes the text strictly: bytes that are not UTF-8 could be committed but never shown.
		if !utf8.Valid(text) {
			fail(http.StatusBadRequest, "evidence is not valid UTF-8 text")
			return
		}

		cid, status, failure := lighthouseAdd(r.Context(), o, apiKey, "evidence.txt", "text/plain; charset=utf-8", bytes.NewReader(text))
		if status != 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_, _ = io.WriteString(w, failure)
			return
		}
		if !curationEvidenceCID.MatchString(cid) {
			slog.Error("lighthouse returned a CID the curation realm refuses", "cid", cid)
			fail(http.StatusBadGateway, "IPFS upload returned an unusable CID")
			return
		}
		// A raw-block CID is a hash of the bytes, so it is checked against
		// them. A dag-pb (bafy…) or CIDv0 (Qm…) CID hashes a UnixFS node whose
		// layout is the pinning service's choice, so it is only format-checked;
		// the client still hashes what it fetches before showing it.
		if strings.HasPrefix(cid, "bafk") && cid != rawCID(text) {
			slog.Error("lighthouse returned a raw CID that is not the text's", "cid", cid)
			fail(http.StatusBadGateway, "IPFS upload answered a CID that is not the text's")
			return
		}
		sum := sha256.Sum256(text)
		slog.Info("curation evidence pinned", "cid", cid, "bytes", len(text))
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]string{"cid": cid, "sha256": hex.EncodeToString(sum[:])})
	})
}
