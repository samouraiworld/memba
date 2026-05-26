import { isCorerepo } from "../../lib/gnoloveRepo"

interface Props {
    repo: string
    className?: string
}

export function RepoBadge({ repo, className }: Props) {
    const isCore = isCorerepo(repo)
    return (
        <span className={`gl-repo-badge ${isCore ? "gl-repo-badge--core" : "gl-repo-badge--eco"}${className ? ` ${className}` : ""}`}>
            {isCore ? "core" : "ecosystem"}
        </span>
    )
}
