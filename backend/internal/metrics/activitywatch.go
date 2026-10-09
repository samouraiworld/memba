package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	ActivityWatchEnabled = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "memba_activity_watch_enabled",
		Help: "1 when realm activity notifications are enabled, even if startup fails.",
	})
	ActivityWatchProgress = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "memba_activity_watch_progress_timestamp_seconds",
		Help: "Chain time of last processed activity block; zero until initialized.",
	})
	ActivityWatchPending = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "memba_activity_watch_pending",
		Help: "Discord messages pending delivery; scanning pauses behind delivery failures.",
	})
	ActivityWatchOldest = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "memba_activity_watch_oldest_pending_timestamp_seconds",
		Help: "Enqueue time of the oldest pending Discord message, or zero when empty.",
	})
)
