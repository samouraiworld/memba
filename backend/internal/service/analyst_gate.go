package service

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// ── Analyst access control ───────────────────────────────────
//
// The analyst is off unless ANALYST_ENABLED is explicitly "true" or "1".
// When on, report generation is limited per wallet per UTC day
// (ANALYST_DAILY_CAP_PER_WALLET, default 5), and only a request carrying the
// ANALYST_ADMIN_BEARER may force a cached report to be regenerated.

const defaultAnalystDailyCap = 5

// AnalystEnabled reports whether the analyst endpoints are switched on.
func AnalystEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("ANALYST_ENABLED"))) {
	case "true", "1":
		return true
	}
	return false
}

// AnalystGate answers 503 for every request while the analyst is disabled.
func AnalystGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !AnalystEnabled() {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":"analyst disabled"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// IsAnalystAdminRequest reports whether r carries the configured analyst admin
// bearer. It is always false when ANALYST_ADMIN_BEARER is unset.
func IsAnalystAdminRequest(r *http.Request) bool {
	want := strings.TrimSpace(os.Getenv("ANALYST_ADMIN_BEARER"))
	if want == "" {
		return false
	}
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return false
	}
	got := strings.TrimPrefix(h, "Bearer ")
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

type analystAdminKey struct{}

// WithAnalystAdmin marks ctx as an analyst admin request. Only the route that
// checked IsAnalystAdminRequest should call it.
func WithAnalystAdmin(ctx context.Context) context.Context {
	return context.WithValue(ctx, analystAdminKey{}, true)
}

// AnalystAdminFrom reports whether ctx was marked by WithAnalystAdmin.
func AnalystAdminFrom(ctx context.Context) bool {
	v, _ := ctx.Value(analystAdminKey{}).(bool)
	return v
}

// analystDailyCap is the number of reports one wallet may generate per UTC day.
func analystDailyCap() int {
	if v := strings.TrimSpace(os.Getenv("ANALYST_DAILY_CAP_PER_WALLET")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			return n
		}
	}
	return defaultAnalystDailyCap
}

// reserveAnalystQuota atomically takes one generation from addr's quota for the
// UTC day of now. It returns false when the quota is used up.
func reserveAnalystQuota(ctx context.Context, db *sql.DB, addr string, now time.Time) (bool, error) {
	limit := analystDailyCap()
	if limit <= 0 {
		return false, nil
	}
	day := now.UTC().Format("2006-01-02")
	var count int
	err := db.QueryRowContext(ctx,
		`INSERT INTO analyst_usage (address, day, count) VALUES (?, ?, 1)
		 ON CONFLICT(address, day) DO UPDATE SET count = count + 1 WHERE count < ?
		 RETURNING count`,
		addr, day, limit,
	).Scan(&count)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// PurgeAnalystRows deletes expired reports and usage counters older than the
// UTC day of now.
func PurgeAnalystRows(ctx context.Context, db *sql.DB, now time.Time) error {
	if _, err := db.ExecContext(ctx, `DELETE FROM analyst_reports WHERE expires_at <= ?`, now.UTC()); err != nil {
		return err
	}
	_, err := db.ExecContext(ctx, `DELETE FROM analyst_usage WHERE day < ?`, now.UTC().Format("2006-01-02"))
	return err
}

// StartAnalystPurge runs PurgeAnalystRows every interval until ctx is done.
func StartAnalystPurge(ctx context.Context, db *sql.DB, every time.Duration) {
	go func() {
		ticker := time.NewTicker(every)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := PurgeAnalystRows(ctx, db, time.Now()); err != nil {
					slog.Warn("analyst purge failed", "error", err)
				}
			}
		}
	}()
}
