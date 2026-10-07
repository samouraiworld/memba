#!/usr/bin/env python3
"""Can memba_gov's class rules be written as one Snapshot X quorum?

Snapshot X sums voting power, so a whitelist with vp_i = a*w_i + b turns a coalition
(weight w, persons p) into a*w + b*p, and an execution strategy passes when that sum
reaches an absolute quorum. memba_gov's rules (samcrew-deployer projects/gov/memba_gov/
policy.gno, `meets`) are conjunctions on w and p. This enumerates every coalition of a
roster and searches small integer (a, b) for which every class is a threshold.

Usage: python3 gov_linear_check.py 2,1,1,1  [more rosters...]
"""
import sys
from itertools import combinations

RULES = {
    "routine": lambda w, p, W, N: 8 * w >= 3 * W and p >= 2,
    "financial": lambda w, p, W, N: 5 * w >= 3 * W and p >= 3 and 2 * p > N,
    "critical_weighted": lambda w, p, W, N: 3 * w >= 2 * W and 2 * p > N,
    "critical_headcount": lambda w, p, W, N: 3 * p >= 2 * N and 2 * w > W,
}


def coalitions(weights):
    pts = set()
    for k in range(1, len(weights) + 1):
        for c in combinations(range(len(weights)), k):
            pts.add((sum(weights[i] for i in c), k))
    return pts


def quorum(points, rule, a, b, W, N):
    passes = [a * w + b * p for w, p in points if rule(w, p, W, N)]
    fails = [a * w + b * p for w, p in points if not rule(w, p, W, N)]
    lo = min(passes)
    return lo if lo > max(fails, default=-1) else None


def check(weights, bound=8):
    W, N = sum(weights), len(weights)
    pts = coalitions(weights)
    for a in range(bound):
        for b in range(bound):
            if a == b == 0:
                continue
            qs = {name: quorum(pts, rule, a, b, W, N) for name, rule in RULES.items()}
            if all(q is not None for q in qs.values()):
                return W, N, (a, b), qs
    per_class = {}
    for name, rule in RULES.items():
        per_class[name] = next(
            ((a, b, q) for a in range(bound) for b in range(bound)
             if (a or b) and (q := quorum(pts, rule, a, b, W, N)) is not None),
            None,
        )
    return W, N, None, per_class


if __name__ == "__main__":
    rosters = sys.argv[1:] or ["2,1,1,1", "2,1,1,1,1,1,1", "2,2,2,1,1,1,1,1", "2,2,2,2,2,2,1,1,1,1,1,1"]
    for r in rosters:
        W, N, ab, qs = check([int(x) for x in r.split(",")])
        if ab:
            print(f"{r}: W={W} N={N} vp = {ab[0]}*w + {ab[1]} -> quorums {qs}")
        else:
            print(f"{r}: W={W} N={N} no single formula; per class (a, b, quorum): {qs}")
