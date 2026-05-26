export const CORE_REPO = "gnolang/gno"

export function isCorerepo(repo: string): boolean {
    return repo === CORE_REPO || repo.endsWith("/gno")
}

export function sortReposWithCorePinned<T>(items: T[], getRepo: (item: T) => string): T[] {
    return [...items].sort((a, b) => {
        const aCore = isCorerepo(getRepo(a))
        const bCore = isCorerepo(getRepo(b))
        if (aCore && !bCore) return -1
        if (!aCore && bCore) return 1
        return 0
    })
}
