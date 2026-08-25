package metrics

// Guard for ops/prometheus/memba.rules.yml.
//
// WHY. Alert rules rot in one direction almost every time: a metric is renamed
// or removed, the rule keeps referencing the old name, and Prometheus evaluates
// it forever against nothing. It never errors — it just never fires. That is
// indistinguishable from "healthy" on a dashboard, which is precisely the shape
// of failure alerting exists to prevent.
//
// So this test binds the rules file to the metrics the backend actually declares,
// in both directions:
//
//   - every `memba_*` name referenced in a rule must be a real declared metric
//     (catches renames and typos);
//   - every declared metric must be either referenced by a rule or listed in
//     `intentionallyUncovered` with a reason (catches a new metric quietly
//     shipping with no alerting story).
//
// It deliberately does NOT check thresholds. Those are judgement calls that get
// tuned against real baselines; encoding them twice would just mean editing two
// places to change one number.

import (
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// Metric families whose absence from the rules file is a deliberate choice, not
// an oversight. Keep the reason with the entry — an unexplained waiver here is
// how coverage quietly erodes.
var intentionallyUncovered = map[string]string{
	"memba_db_connections_idle": "Pool telemetry for dashboards. Saturation is alerted via " +
		"memba_db_wait_duration_seconds_total, which is the signal that actually hurts.",
	"memba_db_connections_open": "Same: MaxOpenConns(1) makes this a constant, useful on a " +
		"graph and meaningless as a threshold.",
	"memba_feed_auto_hides_per_day": "Moderation product analytics — trend surface, no " +
		"operational threshold in OPS_RUNBOOK.md §3.4.",
	"memba_feed_flags_per_hour": "Moderation product analytics; abuse pressure is judged in " +
		"review, not paged on.",
	"memba_feed_posting_authors_per_hour": "Growth/engagement metric, not an operational signal.",
	"memba_feed_unique_flaggers_per_day":  "Moderation product analytics, as above.",
}

// Prometheus exposes a histogram as _bucket/_count/_sum and a summary as
// _count/_sum. Rules legitimately reference those, so fold them back to the
// declared family name before comparing.
var derivedSuffixes = []string{"_bucket", "_count", "_sum"}

type ruleFile struct {
	Groups []struct {
		Name     string `yaml:"name"`
		Interval string `yaml:"interval"`
		Rules    []struct {
			Alert       string            `yaml:"alert"`
			Record      string            `yaml:"record"`
			Expr        string            `yaml:"expr"`
			For         string            `yaml:"for"`
			Labels      map[string]string `yaml:"labels"`
			Annotations map[string]string `yaml:"annotations"`
		} `yaml:"rules"`
	} `yaml:"groups"`
}

// declaredMetrics scans the metrics package sources for `Name: "memba_..."`.
// Reading the sources rather than the registry is deliberate: promauto's *Vec
// types register no series until a label is first observed, so a registry walk
// would report a metric as missing purely because nothing has happened yet —
// exactly the false signal this test exists to prevent.
func declaredMetrics(t *testing.T) map[string]bool {
	t.Helper()
	nameRe := regexp.MustCompile(`Name:\s*"(memba_[a-z0-9_]+)"`)
	found := map[string]bool{}

	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read metrics package dir: %v", err)
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		src, err := os.ReadFile(e.Name())
		if err != nil {
			t.Fatalf("read %s: %v", e.Name(), err)
		}
		for _, m := range nameRe.FindAllStringSubmatch(string(src), -1) {
			found[m[1]] = true
		}
	}
	return found
}

func loadRules(t *testing.T) ruleFile {
	t.Helper()
	// Embedded, not read from disk: see rules.go for why (go test caches on
	// declared inputs, so a path read would let the YAML change without
	// re-running these checks).
	if len(AlertRulesYAML) == 0 {
		t.Fatal("embedded rules are empty — the guard would be vacuous")
	}
	var rf ruleFile
	// A YAML syntax error here is the whole ballgame: Prometheus refuses to load
	// a bad rules file and silently keeps running with the previous one.
	if err := yaml.Unmarshal(AlertRulesYAML, &rf); err != nil {
		t.Fatalf("rules file is not valid YAML: %v", err)
	}
	return rf
}

// metricsReferenced pulls every memba_* identifier out of the rule expressions.
func metricsReferenced(rf ruleFile) map[string]bool {
	re := regexp.MustCompile(`memba_[a-z0-9_]+`)
	out := map[string]bool{}
	for _, g := range rf.Groups {
		for _, r := range g.Rules {
			for _, m := range re.FindAllString(r.Expr, -1) {
				out[m] = true
			}
		}
	}
	return out
}

// canonical folds a referenced name back to its declared family.
func canonical(name string, declared map[string]bool) string {
	if declared[name] {
		return name
	}
	for _, suf := range derivedSuffixes {
		if base, ok := strings.CutSuffix(name, suf); ok && declared[base] {
			return base
		}
	}
	return name
}

func TestRulesFileIsStructurallySound(t *testing.T) {
	rf := loadRules(t)

	// Vacuity floor. If the path moves or the schema drifts, every assertion
	// below would pass against an empty struct while the rules go unchecked.
	if len(rf.Groups) == 0 {
		t.Fatal("no rule groups parsed — the guard would be vacuous")
	}
	total := 0
	for _, g := range rf.Groups {
		if g.Name == "" {
			t.Error("a rule group has no name")
		}
		total += len(g.Rules)
	}
	if total < 10 {
		t.Fatalf("only %d rules parsed; expected the full §3.4 set — parser or file is wrong", total)
	}

	for _, g := range rf.Groups {
		for _, r := range g.Rules {
			switch {
			case r.Alert != "" && r.Record != "":
				t.Errorf("%s: rule is both alert and record", r.Alert)
			case r.Alert == "" && r.Record == "":
				t.Errorf("group %s: a rule is neither an alert nor a recording rule", g.Name)
			}
			if strings.TrimSpace(r.Expr) == "" {
				t.Errorf("%s%s: empty expr", r.Alert, r.Record)
			}
			if r.Alert == "" {
				continue
			}
			// An alert with no severity cannot be routed, and one with no summary
			// pages a human with nothing to act on.
			if r.Labels["severity"] == "" {
				t.Errorf("alert %s: missing severity label", r.Alert)
			}
			if sev := r.Labels["severity"]; sev != "page" && sev != "warn" && sev != "watch" {
				t.Errorf("alert %s: unexpected severity %q (want page|warn|watch)", r.Alert, sev)
			}
			if r.Annotations["summary"] == "" {
				t.Errorf("alert %s: missing summary annotation", r.Alert)
			}
			if r.Annotations["runbook"] == "" {
				t.Errorf("alert %s: missing runbook annotation", r.Alert)
			}
		}
	}
}

func TestRulesOnlyReferenceRealMetrics(t *testing.T) {
	declared := declaredMetrics(t)
	if len(declared) < 15 {
		t.Fatalf("only %d metrics found in the package sources; the scanner is broken "+
			"and every check below would pass vacuously", len(declared))
	}

	var unknown []string
	for name := range metricsReferenced(loadRules(t)) {
		if !declared[canonical(name, declared)] {
			unknown = append(unknown, name)
		}
	}
	sort.Strings(unknown)
	if len(unknown) > 0 {
		t.Errorf("rules reference metrics that this backend does not declare: %v\n"+
			"An alert on a non-existent metric evaluates forever and never fires — it "+
			"reads as healthy. Fix the name, or remove the rule.", unknown)
	}
}

func TestEveryMetricIsCoveredOrWaived(t *testing.T) {
	declared := declaredMetrics(t)
	referenced := map[string]bool{}
	for name := range metricsReferenced(loadRules(t)) {
		referenced[canonical(name, declared)] = true
	}

	var uncovered []string
	for name := range declared {
		if referenced[name] {
			continue
		}
		if _, waived := intentionallyUncovered[name]; waived {
			continue
		}
		uncovered = append(uncovered, name)
	}
	sort.Strings(uncovered)
	if len(uncovered) > 0 {
		t.Errorf("metrics are emitted with no alerting story: %v\n"+
			"Add a rule to ops/prometheus/memba.rules.yml, or add the metric to "+
			"intentionallyUncovered with the reason it does not need one.", uncovered)
	}
}

func TestWaiversAreNotStale(t *testing.T) {
	// The other direction: a waiver for a metric that no longer exists, or one
	// that has since gained a rule, is dead weight that hides real drift.
	declared := declaredMetrics(t)
	referenced := map[string]bool{}
	for name := range metricsReferenced(loadRules(t)) {
		referenced[canonical(name, declared)] = true
	}

	for name, reason := range intentionallyUncovered {
		if reason == "" {
			t.Errorf("waiver for %s has no reason", name)
		}
		if !declared[name] {
			t.Errorf("waiver for %s, which is no longer declared — drop it", name)
		}
		if referenced[name] {
			t.Errorf("%s is waived but now has a rule — drop the waiver", name)
		}
	}
}
