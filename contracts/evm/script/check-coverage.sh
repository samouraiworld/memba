#!/usr/bin/env bash
# Coverage gate for Memba-owned contracts: every file under src/ in the LCOV report must have all its lines,
# functions and branches covered by the unit tests. A report without any src/ file fails (nothing was measured).
# Usage: script/check-coverage.sh <lcov.info>
set -euo pipefail
awk '
  /^SF:/ { file = substr($0, 4); keep = (file ~ /^src\//); if (keep) n++; next }
  !keep { next }
  /^LF:/ { lf = substr($0, 4) }
  /^LH:/ { lh = substr($0, 4) }
  /^FNF:/ { fnf = substr($0, 5) }
  /^FNH:/ { fnh = substr($0, 5) }
  /^BRF:/ { brf = substr($0, 5) }
  /^BRH:/ { brh = substr($0, 5) }
  /^end_of_record/ {
    printf "%s: lines %d/%d, functions %d/%d, branches %d/%d\n", file, lh, lf, fnh, fnf, brh, brf
    if (lh + 0 != lf + 0 || fnh + 0 != fnf + 0 || brh + 0 != brf + 0) bad = 1
    lf = lh = fnf = fnh = brf = brh = 0
    keep = 0
  }
  END {
    if (n == 0) { print "::error::no src/ file in the coverage report"; exit 1 }
    if (bad) { print "::error::Memba-owned contracts must be fully covered by unit tests"; exit 1 }
  }
' "$1"
