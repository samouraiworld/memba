package metrics

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestAuthLoginTotal_CountsByResult(t *testing.T) {
	AuthLoginTotal.Reset()
	AuthLoginTotal.WithLabelValues("signed").Inc()
	AuthLoginTotal.WithLabelValues("signed").Inc()
	AuthLoginTotal.WithLabelValues("empty_rejected").Inc()

	if got := testutil.ToFloat64(AuthLoginTotal.WithLabelValues("signed")); got != 2 {
		t.Fatalf("signed counter = %v, want 2", got)
	}
	if got := testutil.ToFloat64(AuthLoginTotal.WithLabelValues("empty_rejected")); got != 1 {
		t.Fatalf("empty_rejected counter = %v, want 1", got)
	}
}

// The /metrics endpoint (promhttp over the default registry) must expose the
// auth-login signal so an external drain can compute the signed-login ratio.
func TestMetricsEndpoint_ExposesAuthLogin(t *testing.T) {
	AuthLoginTotal.WithLabelValues("signed").Inc()

	rec := httptest.NewRecorder()
	promhttp.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("/metrics status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "memba_auth_login_total") {
		t.Fatal("/metrics did not expose memba_auth_login_total")
	}
}
