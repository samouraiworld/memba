/**
 * gnoFuncs — fetch a realm's exported function signatures via ABCI `vm/qfuncs`.
 *
 * This is the authoritative, VM-resolved list of callable functions (the
 * Explorer's Functions tab), distinct from the best-effort signatures the source
 * parser (`gnowebSource`) extracts from raw `.gno` text. Read-only: `vm/qfuncs` is
 * a query, never a state change (unlike the removed `vm/qeval`, SEC-01) — so the
 * Explorer stays read-only-safe by construction.
 *
 * @module lib/gnoFuncs
 */

import { resilientAbciQuery } from "./rpcFallback"

export interface GnoParam {
    name: string
    type: string
}

export interface GnoFunc {
    name: string
    params: GnoParam[]
    results: GnoParam[]
}

/**
 * The interrealm-v2 realm-transition first param (`cur realm`) reports a huge
 * inline interface type from qfuncs — collapse it to `realm` for display.
 *
 * Otherwise, strip the internal `.uverse.` package qualifier the VM prepends to
 * builtin/primitive types (`.uverse.address` → `address`, `.uverse.realm` →
 * `realm`), including nested forms (`[].uverse.int` → `[]int`,
 * `map[.uverse.string].uverse.address` → `map[string]address`). The match is
 * boundary-anchored (start-of-string or a non-identifier char before the
 * qualifier), so it strips only the VM qualifier and leaves a name that merely
 * contains `.uverse.` mid-identifier intact.
 */
export function simplifyType(raw: string): string {
    const t = (raw || "").trim()
    if (t.startsWith("interface {") && t.includes(".seal func()")) return "realm"
    return t.replace(/(^|[^\w.])\.uverse\./g, "$1")
}

/**
 * Resolve the Explorer Functions-tab list: prefer the authoritative,
 * VM-resolved qfuncs signatures; fall back to the source parser's exported
 * function NAMES (signatures unknown → empty params/results) when qfuncs is
 * empty or unavailable. Pure — unit-testable without the network, and the single
 * source of truth for the fallback the Explorer's Functions tab renders.
 */
export function resolveFnList(qfuncs: GnoFunc[] | null, sourceExportedNames: string[]): GnoFunc[] {
    if (qfuncs && qfuncs.length > 0) return qfuncs
    return sourceExportedNames.map((name) => ({ name, params: [], results: [] }))
}

function toParams(list: unknown): GnoParam[] {
    if (!Array.isArray(list)) return []
    return list
        .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
        .map((p) => {
            // Unnamed results come back with internal gno names like ".res.0" —
            // treat those as unnamed so the signature shows just the type.
            const rawName = typeof p.Name === "string" ? p.Name : ""
            return {
                name: rawName.startsWith(".") ? "" : rawName,
                type: simplifyType(typeof p.Type === "string" ? p.Type : ""),
            }
        })
}

/**
 * Parse a raw `vm/qfuncs` JSON payload into GnoFunc[]. Defensive: any malformed
 * or non-array input yields an empty list (never throws), so a realm that isn't
 * found / returns an error simply shows no functions.
 */
export function parseQfuncs(raw: string | null): GnoFunc[] {
    if (!raw) return []
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return []
    }
    if (!Array.isArray(parsed)) return []
    const out: GnoFunc[] = []
    for (const entry of parsed) {
        if (!entry || typeof entry !== "object") continue
        const rec = entry as Record<string, unknown>
        const name = typeof rec.FuncName === "string" ? rec.FuncName : ""
        if (!name) continue
        out.push({ name, params: toParams(rec.Params), results: toParams(rec.Results) })
    }
    return out
}

/** Format a GnoFunc as a Go-like signature string for display. */
export function formatSignature(fn: GnoFunc): string {
    const params = fn.params.map((p) => `${p.name} ${p.type}`.trim()).join(", ")
    if (fn.results.length === 0) return `${fn.name}(${params})`
    const results = fn.results.map((r) => `${r.name} ${r.type}`.trim()).join(", ")
    return fn.results.length > 1
        ? `${fn.name}(${params}) (${results})`
        : `${fn.name}(${params}) ${results}`
}

/**
 * Normalize a realm path (`/r/x/y` or `gno.land/r/x/y`) to the qfuncs pkgpath
 * form and fetch its exported functions. Non-strict — returns [] on any error.
 */
export async function fetchRealmFuncs(realmPath: string): Promise<GnoFunc[]> {
    const pkgPath = realmPath.startsWith("gno.land")
        ? realmPath
        : `gno.land${realmPath.startsWith("/") ? realmPath : `/${realmPath}`}`
    const raw = await resilientAbciQuery("vm/qfuncs", pkgPath)
    return parseQfuncs(raw)
}
