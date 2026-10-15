import { noteExportFilename } from '../../../lib/notes/exportFilename'
import { abciQueryText } from '../../../lib/dao/packageStatus'
import { ugnotInCoinsJson } from '../../../lib/bankBalance'
import { getRpcUrlsInOrder } from '../../../lib/rpcFallback'
import { withTimeout } from '../../../lib/notes/freshness'

/** g1abc…wxyz: enough to recognise an account in a sentence. */
export const shortAddress = (address: string) => address.length > 12 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address

/** Saves the note as Markdown, named after its title. */
export function downloadMarkdown(title: string, body: string): void {
    const url = URL.createObjectURL(new Blob([`# ${title}\n\n${body}`], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = noteExportFilename(title); link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Preview beside the editor is a per-device choice, off by default. */
const PREVIEW_KEY = 'memba_notes_preview'
export function readPreviewChoice(): boolean {
    try { return localStorage.getItem(PREVIEW_KEY) === '1' } catch { return false }
}
export function writePreviewChoice(on: boolean): void {
    try { if (on) localStorage.setItem(PREVIEW_KEY, '1'); else localStorage.removeItem(PREVIEW_KEY) } catch { /* The choice is then not remembered. */ }
}

/** The lines where two texts differ, once their common first and last lines are set aside. */
export function differingLines(mine: string, theirs: string): { mine: string[]; theirs: string[] } {
    const a = mine.split('\n'), b = theirs.split('\n')
    let start = 0, end = 0
    while (start < a.length && start < b.length && a[start] === b[start]) start++
    while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
    return { mine: a.slice(start, a.length - end), theirs: b.slice(start, b.length - end) }
}
/** The account's ugnot balance, or null when it cannot be read (which blocks nothing). */
export async function balanceOf(chainId: string, address: string): Promise<bigint | null> {
    const urls = getRpcUrlsInOrder()
    return withTimeout(abciQueryText({ chainId, rpcUrl: urls[0], rpcUrls: urls }, `bank/balances/${address}`, '').then(ugnotInCoinsJson), 5000).catch(() => null)
}
