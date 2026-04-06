/**
 * FunctionList — Displays exported function signatures for a realm/package.
 * @module components/directory/FunctionList
 */

import type { FunctionSignature } from "../../lib/gnowebSource"

interface FunctionListProps {
    functions: FunctionSignature[]
    showPrivate?: boolean
}

export function FunctionList({ functions, showPrivate = false }: FunctionListProps) {
    const filtered = showPrivate ? functions : functions.filter(f => f.isExported)

    if (filtered.length === 0) return null

    return (
        <div className="func-list">
            <div className="func-list__header">
                Public Functions ({filtered.length})
            </div>
            <div className="func-list__items">
                {filtered.map(f => (
                    <div key={f.name} className="func-list__item">
                        <span className="func-list__keyword">func </span>
                        <span className="func-list__name">{f.name}</span>
                        <span className="func-list__params">{f.params}</span>
                        {f.returns && (
                            <span className="func-list__returns"> {f.returns}</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}
