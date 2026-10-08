import type { TRepository } from "./gnoloveSchemas"

/** A missing catalogue must never turn an all-repository request into core. */
export function resolveRepositoryScope(selected: readonly string[], all: boolean, catalogue?: readonly TRepository[]): string[] | null {
    if (selected.length) return [...selected]
    if (!all) return ["gnolang/gno"]
    if (!catalogue?.length) return null
    const available = catalogue.filter(r => r.status !== "unavailable" && r.status !== "private").map(r => r.id).sort()
    return available.length ? available : null
}
