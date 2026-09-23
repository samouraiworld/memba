/**
 * Display pieces for values a member is about to sign, shared by the
 * transaction confirmation modal and the multisig review page:
 * - SignedText: invisible characters shown as [U+XXXX], and the text pinned to
 *   its signed left-to-right order (right-to-left letters cannot reorder it);
 * - SignedArg: one call argument; addresses and realm paths always in full
 *   with Copy, other long values cut only behind a marker and a toggle;
 * - CopyValueButton: copies the exact signed value.
 */
import { useState } from "react"
import { revealInvisibleFormatting } from "../../lib/dao/v2Text"
import { ARG_PREVIEW_CHARS, mustShowInFull } from "../../lib/signingText"
import "./signing-value.css"

export function SignedText({ value, className = "" }: { value: string; className?: string }) {
    return <span dir="ltr" className={`signing-text ${className}`.trim()}>{revealInvisibleFormatting(value)}</span>
}

export function CopyValueButton({ value }: { value: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <button
            type="button"
            className="tx-confirm-copy"
            aria-label={`Copy ${value}`}
            title={copied ? "Copied" : "Copy"}
            onClick={() => {
                void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => {})
            }}
        >
            {copied ? "Copied" : "Copy"}
        </button>
    )
}

/** An address (or any value) shown in full with a Copy button. */
export function SignedAddress({ value, className = "tx-confirm-addr" }: { value: string; className?: string }) {
    return (
        <span className="tx-confirm-arg-wrap">
            <SignedText value={value} className={className} />
            <CopyValueButton value={value} />
        </span>
    )
}

export function SignedArg({ value }: { value: string }) {
    const [expanded, setExpanded] = useState(false)
    if (mustShowInFull(value)) return <SignedAddress value={value} className="tx-confirm-arg tx-confirm-arg--full" />
    const shown = revealInvisibleFormatting(value)
    const chars = Array.from(shown)
    if (chars.length <= ARG_PREVIEW_CHARS) {
        return <span dir="ltr" className="signing-text tx-confirm-arg">{shown}</span>
    }
    const hidden = chars.length - ARG_PREVIEW_CHARS
    return (
        <span className="tx-confirm-arg-wrap">
            <span dir="ltr" className="signing-text tx-confirm-arg tx-confirm-arg--full">{expanded ? shown : chars.slice(0, ARG_PREVIEW_CHARS).join("")}</span>
            {!expanded && <span className="tx-confirm-arg-marker">… {hidden.toLocaleString("en-US")} more characters hidden</span>}
            <button
                type="button"
                className="tx-confirm-copy"
                aria-expanded={expanded}
                aria-label={expanded ? "Show less" : "Show full argument"}
                onClick={() => setExpanded(v => !v)}
            >
                {expanded ? "Show less" : "Show full"}
            </button>
        </span>
    )
}

/** Each argument on its own, so a comma inside one cannot pass for two. */
export function SignedArgs({ args }: { args: string[] }) {
    return <span className="tx-confirm-args">{args.map((a, i) => <SignedArg key={i} value={String(a)} />)}</span>
}
