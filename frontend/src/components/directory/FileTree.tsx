/**
 * FileTree — Displays source file listing with line counts.
 * @module components/directory/FileTree
 */

import type { SourceFile } from "../../lib/gnowebSource"

interface FileTreeProps {
    files: SourceFile[]
    onFileClick?: (name: string) => void
}

export function FileTree({ files, onFileClick }: FileTreeProps) {
    if (files.length === 0) return null

    return (
        <div className="file-tree">
            <div className="file-tree__header">Files ({files.length})</div>
            <div className="file-tree__list">
                {files.map((f, i) => {
                    const isLast = i === files.length - 1
                    const prefix = isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 "
                    const icon = f.name.endsWith(".gno") ? "\uD83D\uDCC4" : f.name === "gno.mod" ? "\u2699\uFE0F" : "\uD83D\uDCC1"
                    return (
                        <button
                            key={f.name}
                            className="file-tree__item"
                            onClick={() => onFileClick?.(f.name)}
                        >
                            <span className="file-tree__prefix">{prefix}</span>
                            <span className="file-tree__icon">{icon}</span>
                            <span className="file-tree__name">{f.name}</span>
                            <span className="file-tree__lines">{f.lines} lines</span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
