package metrics

import _ "embed"

// AlertRulesYAML is the Prometheus alerting/recording rule set for this backend,
// embedded from rules/memba.rules.yml.
//
// It is EMBEDDED rather than read from a path at test time, and that is the whole
// point rather than a convenience. `go test` caches on declared inputs: a file
// opened with os.ReadFile from an arbitrary path is invisible to the cache, so
// rules_test.go would report a cached `ok` after the YAML changed — the guard
// would quietly stop guarding exactly when someone edited the thing it guards.
// (Observed: three separate mutations to the rules file all returned a cached
// pass.) An embed is a build input, so any edit rebuilds and re-runs the checks.
//
// It also removes a second failure mode: the rules that were validated and the
// rules that get deployed are now the same bytes, so they cannot drift apart.
//
// Deploying them is still owner-side — see docs/OPS_RUNBOOK.md §3.4.
//
//go:embed rules/memba.rules.yml
var AlertRulesYAML []byte
