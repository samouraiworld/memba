// Keep an active wallet/polling operation locked across editor remounts.
const active = new Set<string>()
const listeners = new Set<() => void>()
export const submissionKey = (chain: string, path: string) => `${chain}:${path}`
export const isSubmissionActive = (key: string) => active.has(key)
export function subscribeSubmissions(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}
export function beginSubmission(key: string) {
    if (active.has(key)) throw new Error("This submission is already in progress")
    active.add(key)
    for (const listener of listeners) listener()
    return () => { active.delete(key); for (const listener of listeners) listener() }
}
