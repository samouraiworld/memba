package service

import (
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
	maxAvatarSize      = 2 * 1024 * 1024 // 2MB
	lighthouseUploadURL = "https://node.lighthouse.storage/api/v0/add"
)

// HandleIPFSUpload handles POST /api/upload/avatar
// Proxies avatar uploads to Lighthouse so the API key stays server-side.
//
// Expects multipart/form-data with a "file" field.
// Validates: file size < 2MB, content type is image/*.
// Returns: {"cid": "Qm..."} on success.
func HandleIPFSUpload() http.Handler {
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

		// Limit request body to 2MB + overhead for multipart headers
		r.Body = http.MaxBytesReader(w, r.Body, maxAvatarSize+4096)

		// Parse multipart form
		if err := r.ParseMultipartForm(maxAvatarSize); err != nil {
			http.Error(w, `{"error":"file too large (max 2MB)"}`, http.StatusRequestEntityTooLarge)
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, `{"error":"file field is required"}`, http.StatusBadRequest)
			return
		}
		defer func() { _ = file.Close() }()

		// Validate content type
		contentType := header.Header.Get("Content-Type")
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		mediaType, _, _ := mime.ParseMediaType(contentType)
		if mediaType == "" || len(mediaType) < 6 || mediaType[:6] != "image/" {
			http.Error(w, `{"error":"only image files are accepted"}`, http.StatusBadRequest)
			return
		}

		// Validate file size
		if header.Size > maxAvatarSize {
			http.Error(w, `{"error":"file too large (max 2MB)"}`, http.StatusRequestEntityTooLarge)
			return
		}

		// Build multipart request to Lighthouse
		pr, pw := io.Pipe()
		mw := multipart.NewWriter(pw)

		go func() {
			defer func() { _ = pw.Close() }()
			part, err := mw.CreateFormFile("file", "avatar.img") // sanitized filename — don't forward user input
			if err != nil {
				_ = pw.CloseWithError(err)
				return
			}
			if _, err := io.Copy(part, file); err != nil {
				_ = pw.CloseWithError(err)
				return
			}
			_ = mw.Close()
		}()

		req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, lighthouseUploadURL, pr)
		if err != nil {
			slog.Error("failed to create lighthouse request", "error", err)
			http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
			return
		}
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+apiKey)

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(req)
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

		// Parse Lighthouse response to extract CID
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

		slog.Info("avatar uploaded to IPFS", "cid", cid)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"cid": cid})
	})
}
