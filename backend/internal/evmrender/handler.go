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

	"github.com/samouraiworld/memba/backend/internal/chainreader"
	"github.com/samouraiworld/memba/backend/internal/evmreader"
)

// Handler holds the EVM render proxy state.
type Handler struct {
	reader *evmreader.EvmReader
	logger *slog.Logger
}

// New creates an EVM render handler.
func New(reader *evmreader.EvmReader, logger *slog.Logger) *Handler {
	return &Handler{reader: reader, logger: logger}
}

// RegisterRoutes attaches EVM-specific render proxy routes to a mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/evm/dao/{daoAddr}/members", h.handleDAOMembers)
	mux.HandleFunc("GET /api/evm/dao/{daoAddr}/member/{memberAddr}", h.handleDAOMember)
	mux.HandleFunc("GET /api/evm/token/{tokenAddr}/balance/{userAddr}", h.handleTokenBalance)
	mux.HandleFunc("GET /api/evm/native/balance/{userAddr}", h.handleNativeBalance)
	mux.HandleFunc("GET /api/evm/health", h.handleHealth)
}

// ── Handlers ─────────────────────────────────────────────────

func (h *Handler) handleDAOMembers(w http.ResponseWriter, r *http.Request) {
	daoAddr := r.PathValue("daoAddr")
	if daoAddr == "" {
		http.Error(w, "missing daoAddr", http.StatusBadRequest)
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
	if daoAddr == "" || memberAddr == "" {
		http.Error(w, "missing daoAddr or memberAddr", http.StatusBadRequest)
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
	if tokenAddr == "" || userAddr == "" {
		http.Error(w, "missing tokenAddr or userAddr", http.StatusBadRequest)
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
	if userAddr == "" {
		http.Error(w, "missing userAddr", http.StatusBadRequest)
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
