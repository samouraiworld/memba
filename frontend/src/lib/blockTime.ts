/**
 * Block-to-time estimation utilities for Gno networks.
 *
 * Since on-chain proposals store creation block height (not wall-clock time),
 * we estimate the date by calculating the difference between the proposal's
 * block and the current block, multiplied by average block time.
 *
 * This is an ESTIMATION — displayed with "~" prefix in the UI.
 */

/** Default average block time in milliseconds (~2s on most Gno networks). */
export const DEFAULT_AVG_BLOCK_TIME_MS = 2000

/**
 * Estimate the wall-clock date for a given block height.
 *
 * @param blockHeight  - The block height to estimate the date for
 * @param currentBlock - The current latest block height
 * @param nowMs        - Current time in milliseconds (defaults to Date.now())
 * @param avgBlockTimeMs - Average block time in ms (defaults to 2000)
 * @returns Estimated Date, or null if inputs are invalid
 */
export function estimateBlockDate(
    blockHeight: number,
    currentBlock: number,
    nowMs: number = Date.now(),
    avgBlockTimeMs: number = DEFAULT_AVG_BLOCK_TIME_MS,
): Date | null {
    if (blockHeight <= 0 || currentBlock <= 0 || blockHeight > currentBlock) {
        return null
    }
    const blocksDiff = currentBlock - blockHeight
    const msDiff = blocksDiff * avgBlockTimeMs
    return new Date(nowMs - msDiff)
}

/**
 * Format a date for proposal display.
 * Returns "~Apr 3, 2026 at 14:32" format.
 *
 * @param date - The date to format
 * @returns Formatted string with "~" prefix indicating estimation
 */
export function formatProposalDate(date: Date | null): string {
    if (!date || isNaN(date.getTime())) return ""
    const month = date.toLocaleDateString("en-US", { month: "short" })
    const day = date.getDate()
    const year = date.getFullYear()
    const hours = date.getHours().toString().padStart(2, "0")
    const minutes = date.getMinutes().toString().padStart(2, "0")
    return `~${month} ${day}, ${year} at ${hours}:${minutes}`
}

/**
 * Convenience: estimate block date and format it in one call.
 *
 * @param blockHeight  - The block height to estimate
 * @param currentBlock - The current latest block height
 * @param avgBlockTimeMs - Average block time in ms (defaults to 2000)
 * @returns Formatted "~Apr 3, 2026 at 14:32" string, or "" if invalid
 */
export function formatBlockDate(
    blockHeight: number,
    currentBlock: number,
    avgBlockTimeMs: number = DEFAULT_AVG_BLOCK_TIME_MS,
): string {
    const date = estimateBlockDate(blockHeight, currentBlock)
    return formatProposalDate(date)
}
