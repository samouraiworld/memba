// Package evmrender provides HTTP handlers that serve Memba contract reads
// from EVM chains. This is the EVM equivalent of the Gno render proxy —
// it reads contract state via EvmReader and returns JSON responses
// compatible with the frontend's existing data model.
//
// Routes mirror the Gno render proxy paths so the frontend can swap
// seamlessly between chains.
package evmrender

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/ethereum/go-ethereum/common"

	"github.com/samouraiworld/memba/backend/internal/chainreader"
	"github.com/samouraiworld/memba/backend/internal/evmreader"
)

// Middleware wraps a handler with cross-cutting behaviour (rate limiting, auth). The `name`
// labels the route for the limiter, matching the repo convention in cmd/memba/main.go.
type Middleware func(name string, h http.Handler) http.Handler

// Handler holds the EVM render proxy state.
type Handler struct {
	reader *evmreader.EvmReader
	logger *slog.Logger
}

// New creates an EVM render handler.
func New(reader *evmreader.EvmReader, logger *slog.Logger) *Handler {
	return &Handler{reader: reader, logger: logger}
}

// RegisterRoutes attaches EVM-specific render proxy routes to a mux, wrapping each with the
// supplied middleware. `wrap` is mandatory: passing it by argument (rather than reaching for a
// package-level mux) makes it impossible to register these routes without the repo's
// rate-limit/auth middleware, which is the A-8 defect this closes.
func (h *Handler) RegisterRoutes(mux *http.ServeMux, wrap Middleware) {
	reg := func(pattern, name string, hf http.HandlerFunc) {
		mux.Handle(pattern, wrap(name, hf))
	}
	reg("GET /api/evm/dao/{daoAddr}/members", "evm_render", h.handleDAOMembers)
	reg("GET /api/evm/dao/{daoAddr}/member/{memberAddr}", "evm_render", h.handleDAOMember)
	reg("GET /api/evm/token/{tokenAddr}/balance/{userAddr}", "evm_render", h.handleTokenBalance)
	reg("GET /api/evm/native/balance/{userAddr}", "evm_render", h.handleNativeBalance)
	reg("GET /api/evm/health", "evm_render", h.handleHealth)
}

// requireAddr validates a path value as a 20-byte hex address, writing a 400 and returning
// false if not. common.HexToAddress never errors and silently crops an over-long hex string,
// so validation must be explicit (A-8).
func requireAddr(w http.ResponseWriter, name, value string) bool {
	if value == "" {
		http.Error(w, "missing "+name, http.StatusBadRequest)
		return false
	}
	if !common.IsHexAddress(value) {
		http.Error(w, "invalid "+name+": not a hex address", http.StatusBadRequest)
		return false
	}
	return true
}

// ── Handlers ─────────────────────────────────────────────────

func (h *Handler) handleDAOMembers(w http.ResponseWriter, r *http.Request) {
	daoAddr := r.PathValue("daoAddr")
	if !requireAddr(w, "daoAddr", daoAddr) {
		return
	}

	members, err := h.reader.GetDAOMembers(r.Context(), daoAddr)
	if err != nil {
		h.logger.Error("evm render: GetDAOMembers", "dao", daoAddr, "error", err)
		http.Error(w, fmt.Sprintf("contract read failed: %v", err), http.StatusBadGateway)
		return
	}

	writeJSON(w, members)
}

func (h *Handler) handleDAOMember(w http.ResponseWriter, r *http.Request) {
	daoAddr := r.PathValue("daoAddr")
	memberAddr := r.PathValue("memberAddr")
	if !requireAddr(w, "daoAddr", daoAddr) || !requireAddr(w, "memberAddr", memberAddr) {
		return
	}

	isMember, err := h.reader.IsDAOMember(r.Context(), daoAddr, memberAddr)
	if err != nil {
		h.logger.Error("evm render: IsDAOMember", "dao", daoAddr, "member", memberAddr, "error", err)
		http.Error(w, fmt.Sprintf("contract read failed: %v", err), http.StatusBadGateway)
		return
	}

	writeJSON(w, map[string]interface{}{
		"address":  memberAddr,
		"isMember": isMember,
	})
}

func (h *Handler) handleTokenBalance(w http.ResponseWriter, r *http.Request) {
	tokenAddr := r.PathValue("tokenAddr")
	userAddr := r.PathValue("userAddr")
	if !requireAddr(w, "tokenAddr", tokenAddr) || !requireAddr(w, "userAddr", userAddr) {
		return
	}

	bal, err := h.reader.GetTokenBalance(r.Context(), tokenAddr, userAddr)
	if err != nil {
		h.logger.Error("evm render: GetTokenBalance", "token", tokenAddr, "user", userAddr, "error", err)
		http.Error(w, fmt.Sprintf("contract read failed: %v", err), http.StatusBadGateway)
		return
	}

	writeJSON(w, bal)
}

func (h *Handler) handleNativeBalance(w http.ResponseWriter, r *http.Request) {
	userAddr := r.PathValue("userAddr")
	if !requireAddr(w, "userAddr", userAddr) {
		return
	}

	bal, err := h.reader.GetNativeBalance(r.Context(), userAddr)
	if err != nil {
		h.logger.Error("evm render: GetNativeBalance", "user", userAddr, "error", err)
		http.Error(w, fmt.Sprintf("balance read failed: %v", err), http.StatusBadGateway)
		return
	}

	writeJSON(w, map[string]string{
		"address": userAddr,
		"balance": bal,
	})
}

func (h *Handler) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]interface{}{
		"status": "ok",
		"family": string(chainreader.FamilyEVM),
	})
}

// ── Helpers ──────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(data); err != nil {
		http.Error(w, "json encode failed", http.StatusInternalServerError)
	}
}

// ParseUint helper for path params.
func ParseUint(s string) (uint64, error) {
	return strconv.ParseUint(s, 10, 64)
}
