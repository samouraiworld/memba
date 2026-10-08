/**
 * Calls into Adena that can't hang forever.
 *
 * Adena's injected API has no timeout of its own, and after an extension
 * update the requests from tabs opened before it are dropped and never
 * settle: Memba would wait on them for good. Reads (GetAccount, GetNetwork)
 * get a short limit; prompts (a window a person answers) get the unlock
 * budget, and say early when Adena's window is probably out of sight or
 * never opened.
 */
import { withWalletActivity } from "./walletActivity"

/** How long Adena's own window (approve, unlock, sign) may stay open: a person may be typing a password there. */
export const UNLOCK_TIMEOUT_MS = 300_000
/** After this long without an answer, Adena's window may be behind this one or on another screen. */
export const ADENA_SLOW_MS = 3_000
/** After this long, if this page never lost focus, Adena's window most likely never opened. */
export const ADENA_NO_POPUP_MS = 8_000

export const ADENA_NO_ANSWER_MESSAGE = "Adena didn't answer — reload this tab (needed after Adena updates)."
/** What Adena's UNEXPECTED_ERROR means: Adena closed its window itself (another request, from any tab, replaced it) or failed inside. */
export const ADENA_CLOSED_MESSAGE = "Adena closed its window or hit an error (another tab may have asked it something). Try again."

/** Adena did not answer in time. */
export class AdenaNoAnswerError extends Error {
    constructor() {
        super(ADENA_NO_ANSWER_MESSAGE)
        this.name = "AdenaNoAnswerError"
    }
}

/** Adena's reply type when it closed its window itself or failed inside (UNEXPECTED_ERROR). */
export const isAdenaWindowClosed = (reply: { status?: unknown; type?: unknown } | null | undefined): boolean =>
    reply?.status === "failure" && reply.type === "UNEXPECTED_ERROR"

/** Race `call` against `ms`; rejects with AdenaNoAnswerError when Adena is late. */
export async function adenaRead<T>(call: () => Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            call(),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AdenaNoAnswerError()), ms) }),
        ])
    } finally {
        if (timer !== undefined) clearTimeout(timer)
    }
}

/** What a caller may hear while Adena's window is open. Every hook is optional. */
export interface PromptWatch {
    /** Just before the request goes to Adena. */
    onSent?: () => void
    /** No answer after ADENA_SLOW_MS. */
    onSlow?: () => void
    /** No answer after ADENA_NO_POPUP_MS and this page never lost focus to a window. A hint only: the call keeps waiting. */
    onNoPopup?: () => void
    /** This page lost focus (Adena's window most likely took it). */
    onPopupFocus?: () => void
}

/**
 * Send a request that opens Adena's window. Holds release reloads while it is
 * open (withWalletActivity); rejects with AdenaNoAnswerError after
 * `timeoutMs` (the unlock budget by default).
 */
export function adenaPrompt<T>(call: () => Promise<T>, watch: PromptWatch = {}, timeoutMs: number = UNLOCK_TIMEOUT_MS): Promise<T> {
    return withWalletActivity(async () => {
        let blurred = false
        const onBlur = () => {
            if (blurred) return
            blurred = true
            watch.onPopupFocus?.()
        }
        const hasWindow = typeof window !== "undefined"
        if (hasWindow) window.addEventListener("blur", onBlur)
        const slow = setTimeout(() => watch.onSlow?.(), ADENA_SLOW_MS)
        const noPopup = setTimeout(() => { if (!blurred) watch.onNoPopup?.() }, ADENA_NO_POPUP_MS)
        try {
            watch.onSent?.()
            return await adenaRead(call, timeoutMs)
        } finally {
            clearTimeout(slow)
            clearTimeout(noPopup)
            if (hasWindow) window.removeEventListener("blur", onBlur)
        }
    })
}
