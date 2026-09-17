/** Human form of a duration in seconds: "3 days", "1 hour", "90 minutes". */
export function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "an invalid duration"
    if (seconds === 0) return "no wait"
    const units: [number, string][] = [[86400, "day"], [3600, "hour"], [60, "minute"]]
    for (const [size, unit] of units) {
        if (seconds % size === 0) {
            const n = seconds / size
            return `${n} ${unit}${n === 1 ? "" : "s"}`
        }
    }
    return `${seconds} seconds`
}
