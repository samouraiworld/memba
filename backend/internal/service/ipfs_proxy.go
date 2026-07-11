package service

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"time"
)

const (
	maxAvatarSize = 2 * 1024 * 1024 // 2MB — profile avatars (post-downscale)
	maxImageSize  = 5 * 1024 * 1024 // 5MB — App Store icons / screenshots (full-res)

	lighthouseUploadURL = "https://node.lighthouse.storage/api/v0/add"

	// sniffLen is how many leading bytes we peek for the magic-byte markup check.
	sniffLen = 512
)

// ──────────────────────────────────────────────────────────────────────────────
// Upload handler options — TEST-ONLY injection seam
// ──────────────────────────────────────────────────────────────────────────────

// ipfsUploadOptions holds injectable dependencies for the upload handler. It is
// UNEXPORTED on purpose: only same-package tests can construct it, so the upstream
// upload URL and HTTP client can never be influenced by a request header, query
// param, or untrusted env — the handler attaches the LIGHTHOUSE_API_KEY bearer to
// whatever URL it POSTs to, so an attacker-controlled URL would be secret
// exfiltration / SSRF. Production entrypoints pass no options and keep the hard
// const lighthouseUploadURL (mirrors nftHandlerOptions in ipfs_serve.go).
type ipfsUploadOptions struct {
	uploadURL  string       // injected upstream upload endpoint (empty → lighthouseUploadURL)
	httpClient *http.Client // injected client (nil → default 30s client)
}

func (o ipfsUploadOptions) resolvedURL() string {
	if o.uploadURL != "" {
		return o.uploadURL
	}
	return lighthouseUploadURL
}

func (o ipfsUploadOptions) resolvedClient() *http.Client {
	if o.httpClient != nil {
		return o.httpClient
	}
	return &http.Client{Timeout: 30 * time.Second}
}

// ──────────────────────────────────────────────────────────────────────────────
// Public entrypoints
// ──────────────────────────────────────────────────────────────────────────────

// HandleIPFSUpload handles POST /api/upload/avatar — profile avatars, 2MB cap.
// Proxies uploads to Lighthouse so the API key stays server-side.
func HandleIPFSUpload(opts ...ipfsUploadOptions) http.Handler {
	return ipfsUploadHandler(maxAvatarSize, "avatar.img", opts...)
}

// HandleIPFSUploadImage handles POST /api/upload/image — App Store icons and
// screenshots, 5MB cap. Same server-side-key proxying and hardening as the avatar
// path; larger cap because these are full-resolution artwork, not downscaled.
func HandleIPFSUploadImage(opts ...ipfsUploadOptions) http.Handler {
	return ipfsUploadHandler(maxImageSize, "image.img", opts...)
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared handler
// ──────────────────────────────────────────────────────────────────────────────

// ipfsUploadHandler is the size-parametrized core behind both upload entrypoints.
// It reads a multipart "file" field, validates size + type (declared-type deny AND
// magic-byte sniff), and streams the bytes to Lighthouse with the server-side
// bearer, returning {"cid":…}.
//
//   - maxBytes:       the decoded-file size cap (2MB avatar / 5MB image).
//   - sanitizedName:  the filename forwarded upstream — NEVER the user's, to avoid
//     header injection / path games in the outbound multipart.
func ipfsUploadHandler(maxBytes int64, sanitizedName string, opts ...ipfsUploadOptions) http.Handler {
	var o ipfsUploadOptions
	if len(opts) > 0 {
		o = opts[0]
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		apiKey := os.Getenv("LIGHTHOUSE_API_KEY")
		if apiKey == "" {
			slog.Error("LIGHTHOUSE_API_KEY not configured")
			http.Error(w, `{"error":"IPFS upload not configured"}`, http.StatusServiceUnavailable)
			return
		}

		// Cap the request body (file + multipart header overhead). An oversize body
		// trips MaxBytesReader inside ParseMultipartForm → 413 below.
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes+4096)

		if err := r.ParseMultipartForm(maxBytes); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"file too large (max %dMB)"}`, maxBytes/(1024*1024)), http.StatusRequestEntityTooLarge)
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, `{"error":"file field is required"}`, http.StatusBadRequest)
			return
		}
		defer func() { _ = file.Close() }()

		// Declared-type check: must be image/*, and image/svg+xml is explicitly denied
		// (it carries the "image/" prefix but is an active-content XSS vector).
		contentType := header.Header.Get("Content-Type")
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		mediaType, _, _ := mime.ParseMediaType(contentType)
		if !isAcceptedRasterType(mediaType) {
			http.Error(w, `{"error":"only raster image files are accepted (no SVG)"}`, http.StatusBadRequest)
			return
		}

		// Size guard (secondary to MaxBytesReader; header.Size is the multipart part size).
		if header.Size > maxBytes {
			http.Error(w, fmt.Sprintf(`{"error":"file too large (max %dMB)"}`, maxBytes/(1024*1024)), http.StatusRequestEntityTooLarge)
			return
		}

		// Magic-byte sniff: the declared Content-Type is client-supplied and bypassable
		// (a PNG-labeled SVG passes the check above). Peek the leading bytes and reject
		// anything whose first non-whitespace bytes are XML/HTML/SVG markup. bufio.Reader
		// replays the peeked bytes, so the full body still streams upstream intact.
		br := bufio.NewReaderSize(file, sniffLen)
		head, _ := br.Peek(sniffLen) // short reads are fine; err on EOF is expected for tiny files
		if looksLikeMarkup(head) {
			http.Error(w, `{"error":"file content is markup (SVG/HTML/XML), not a raster image"}`, http.StatusBadRequest)
			return
		}

		// Build the outbound multipart request to Lighthouse.
		pr, pw := io.Pipe()
		mw := multipart.NewWriter(pw)
		go func() {
			defer func() { _ = pw.Close() }()
			part, cerr := mw.CreateFormFile("file", sanitizedName) // sanitized — never forward user input
			if cerr != nil {
				_ = pw.CloseWithError(cerr)
				return
			}
			if _, cerr := io.Copy(part, br); cerr != nil {
				_ = pw.CloseWithError(cerr)
				return
			}
			_ = mw.Close()
		}()

		req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, o.resolvedURL(), pr)
		if err != nil {
			slog.Error("failed to create lighthouse request", "error", err)
			http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
			return
		}
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+apiKey)

		resp, err := o.resolvedClient().Do(req)
		if err != nil {
			slog.Error("lighthouse upload failed", "error", err)
			http.Error(w, `{"error":"IPFS upload failed"}`, http.StatusBadGateway)
			return
		}
		defer func() { _ = resp.Body.Close() }()

		body, err := io.ReadAll(io.LimitReader(resp.Body, 1*1024*1024)) // 1MB max response
		if err != nil {
			slog.Error("failed to read lighthouse response", "error", err)
			http.Error(w, `{"error":"IPFS upload failed"}`, http.StatusBadGateway)
			return
		}

		if resp.StatusCode != http.StatusOK {
			slog.Warn("lighthouse returned non-200", "status", resp.StatusCode, "body", string(body))
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_, _ = fmt.Fprintf(w, `{"error":"IPFS upload failed (status %d)"}`, resp.StatusCode)
			return
		}

		var lhResp struct {
			Hash string `json:"Hash"`
			Cid  string `json:"cid"`
		}
		if err := json.Unmarshal(body, &lhResp); err != nil {
			slog.Error("failed to parse lighthouse response", "error", err, "body", string(body))
			http.Error(w, `{"error":"failed to parse IPFS response"}`, http.StatusBadGateway)
			return
		}

		cid := lhResp.Hash
		if cid == "" {
			cid = lhResp.Cid
		}
		if cid == "" {
			slog.Error("lighthouse returned no CID", "body", string(body))
			http.Error(w, `{"error":"IPFS upload returned no CID"}`, http.StatusBadGateway)
			return
		}

		slog.Info("media uploaded to IPFS", "cid", cid, "bytes", header.Size)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"cid": cid})
	})
}

// isAcceptedRasterType reports whether the declared media type is a raster image we
// accept. SVG is deliberately excluded — it is markup that can carry <script>.
func isAcceptedRasterType(mediaType string) bool {
	switch mediaType {
	case "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/apng", "image/bmp":
		return true
	default:
		return false
	}
}

// looksLikeMarkup reports whether the leading non-whitespace bytes are an XML / HTML
// / SVG document marker. This is the magic-byte defense that a client-set
// Content-Type can't bypass: a raster image never begins with these tokens, but an
// SVG/HTML payload (the XSS vector) does.
func looksLikeMarkup(head []byte) bool {
	head = bytes.TrimPrefix(head, []byte{0xEF, 0xBB, 0xBF}) // UTF-8 BOM
	head = bytes.TrimLeft(head, " \t\r\n\f\v")
	lower := bytes.ToLower(head)
	for _, sig := range [][]byte{
		[]byte("<?xml"),
		[]byte("<svg"),
		[]byte("<!doctype"),
		[]byte("<html"),
	} {
		if bytes.HasPrefix(lower, sig) {
			return true
		}
	}
	return false
}
