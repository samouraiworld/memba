/**
 * Create a collection (`create`): its name, symbol, profile, mode, supply,
 * metadata folder and royalties, checked by the ledger's own rules as they are
 * typed, then reviewed and signed. The collection fee is read and shown first.
 * Guests fill the form and are asked to connect only when they create.
 *
 * @module os/apps/nft/create
 */
import { useQuery } from "@tanstack/react-query"
import { useEffect, useId, useRef, useState, type Ref } from "react"
import { isRealmValidOn } from "../../../lib/config"
import { networkGasPriceFresh } from "../../../lib/grc20"
import { percentToBPS, termsProblem, type CollectionTerms, type NftRoyaltyShare } from "../../../lib/nft/create"
import { NFT_DROPS_PATH, getDropTerms } from "../../../lib/nft/drops"
import { formatAmount } from "../../../lib/nft/format"
import type { NftMode } from "../../../lib/nft/ledger"
import { ReadError, RealmRefusedError } from "../../../lib/nft/read"
import { TokenLaunchpadReadError } from "../../../lib/tokenLaunchpadClient"
import { useSigner } from "../../sign/signerContext"
import type { OsSession } from "../../shell/useOsSession"
import { Loading } from "../../kit"
import { assertCreatable, createCollectionRequest } from "./createRequest"
import { Back, ReadFailure } from "./parts"
import { launchpadReadFailure, type NftScreen } from "./screen"

const MODES: { id: NftMode; label: string }[] = [
    { id: "open", label: "Transferable" },
    { id: "royalty_protected", label: "Royalty-protected" },
    { id: "soulbound", label: "Soulbound" },
]

function reason(err: unknown): string {
    if (err instanceof ReadError) return "The network could not be read. Try again in a moment."
    if (err instanceof RealmRefusedError) return "The network refused this read. Try again later."
    if (err instanceof TokenLaunchpadReadError) return launchpadReadFailure(err)
    return err instanceof Error ? err.message : String(err)
}

interface RoyaltyRow { account: string; percent: string }

/** `back` goes on the control back to Collections, which takes focus when this screen is opened from another. */
export function CreateCollection({ screen, session, back }: { screen: NftScreen; session: OsSession; back: Ref<HTMLButtonElement> }) {
    const signer = useSigner()
    const available = isRealmValidOn(screen.network, NFT_DROPS_PATH)
    const terms = useQuery({
        queryKey: ["nft", "drops", "terms", screen.chainId, "ugnot"],
        queryFn: () => getDropTerms("ugnot"),
        enabled: available,
        staleTime: 30_000, retry: false,
    })
    const [form, setForm] = useState({
        name: "", symbol: "", description: "", image: "", banner: "", website: "",
        mode: "open" as NftMode, revocable: false, maxSupply: "", metadataMode: "static" as "static" | "mutable", baseURI: "",
    })
    const [rows, setRows] = useState<RoyaltyRow[]>([])
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")
    const [created, setCreated] = useState(false)
    const alive = useRef(true)
    useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
    const id = useId()
    const fee = terms.data?.collectionFee ?? null
    const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }))

    if (!available) {
        return <div className="os-stack"><Back ref={back} label="Collections" onClick={() => screen.go({ kind: "home" })} /><p className="os-note" role="note">Creating a collection is not available on this network.</p></div>
    }

    const build = (): CollectionTerms | string => {
        const supply = form.maxSupply.trim() === "" ? 0n : /^\d{1,19}$/.test(form.maxSupply.trim()) ? BigInt(form.maxSupply.trim()) : null
        if (supply === null) return "The maximum supply is a whole number, 0 for an open edition."
        const royalties: NftRoyaltyShare[] = []
        // A soulbound collection takes no royalties: rows left from another mode are not sent.
        for (const row of form.mode === "soulbound" ? [] : rows) {
            const bps = percentToBPS(row.percent)
            if (bps === null) return "Write each royalty share as a percentage, such as 2.5."
            royalties.push({ account: row.account.trim(), bps })
        }
        const built: CollectionTerms = {
            ...form, maxSupply: supply, royalties, revocable: form.mode === "soulbound" && form.revocable,
            name: form.name, symbol: form.symbol.trim(), baseURI: form.baseURI.trim(),
            image: form.image.trim(), banner: form.banner.trim(), website: form.website.trim(),
        }
        return termsProblem(built) || built
    }

    const create = async () => {
        setError("")
        const built = build()
        if (typeof built === "string") { setError(built); return }
        if (session.status !== "member") { session.openConnect(); return }
        if (fee === null) { setError("Creating a collection in GNOT is not open on this network."); return }
        setBusy(true)
        try {
            const [gas] = await Promise.all([networkGasPriceFresh(), assertCreatable(screen.network, built, fee)])
            if (!alive.current) return
            signer.sign(createCollectionRequest({
                terms: built, fee, caller: session.address, networkKey: screen.network, chainId: screen.chainId, gas,
                onSettled: (outcome) => { if (alive.current && (outcome === "confirmed" || outcome === "submitted")) setCreated(true) },
            }))
        } catch (err) {
            if (alive.current) setError(reason(err))
        } finally {
            if (alive.current) setBusy(false)
        }
    }

    const field = (label: string, key: "name" | "symbol" | "image" | "banner" | "website" | "baseURI" | "maxSupply", hint: string) => (
        <div className="os-stack os-tight">
            <label className="os-stack os-tight">
                <span>{label}</span>
                <input aria-describedby={`${id}-${key}`} value={form[key]} onChange={(event) => set(key, key === "symbol" ? event.target.value.toUpperCase() : event.target.value)} />
            </label>
            <span className="os-sub" id={`${id}-${key}`}>{hint}</span>
        </div>
    )
    return (
        <div className="os-stack">
            <Back ref={back} label="Collections" onClick={() => screen.go({ kind: "home" })} />
            <h2 className="os-h">Create a collection</h2>
            {terms.isPending ? <Loading label="Reading the collection fee…" />
                : terms.isError ? <ReadFailure error={terms.error} what="collection fee" retry={() => void terms.refetch()} />
                : terms.data.collectionFee === null ? <p className="os-note os-warn" role="note">Creating a collection in GNOT is not open on this network.</p>
                : <p className="os-sub">Creating a collection costs {formatAmount(terms.data.collectionFee, "ugnot")}, paid to the Launchpad treasury, plus a storage deposit and the network fee.</p>}
            {created && <p className="os-note" role="status">Your collection was sent. It appears in Collections once the chain has it; schedule a mint stage from its studio.</p>}
            <div className="os-stack os-nft-form">
                {field("Name", "name", "1 to 32 characters. It can never change.")}
                {field("Symbol", "symbol", "1 to 10 capital letters or digits. It can never change.")}
                <label className="os-stack os-tight"><span>Description</span><textarea rows={3} value={form.description} onChange={(event) => set("description", event.target.value)} /></label>
                {field("Image", "image", "An ipfs:// or https:// link, or empty.")}
                {field("Banner", "banner", "An ipfs:// or https:// link, or empty.")}
                {field("Website", "website", "An https:// link, or empty.")}
                <label className="os-stack os-tight"><span>Mode</span>
                    <select value={form.mode} onChange={(event) => set("mode", event.target.value as NftMode)}>
                        {MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                    </select>
                </label>
                {form.mode === "soulbound" && <label className="os-row os-tight-row"><input type="checkbox" checked={form.revocable} onChange={(event) => set("revocable", event.target.checked)} /><span>Revocable: I may revoke a token</span></label>}
                {field("Maximum supply", "maxSupply", "Leave empty or 0 for an open edition.")}
                <label className="os-stack os-tight"><span>Metadata</span>
                    <select value={form.metadataMode} onChange={(event) => set("metadataMode", event.target.value as "static" | "mutable")}>
                        <option value="static">Fixed for good</option>
                        <option value="mutable">Changeable until I freeze it</option>
                    </select>
                </label>
                {field("Base URI", "baseURI", "The ipfs:// folder of the token files: token 1 is <base>1.json.")}
                {form.mode !== "soulbound" && (
                    <fieldset className="os-stack os-tight">
                        <legend>Royalties</legend>
                        {rows.map((row, index) => (
                            <div key={index} className="os-row os-tight-row">
                                <input aria-label={`Royalty receiver ${index + 1}`} placeholder="g1…" value={row.account} onChange={(event) => setRows(rows.map((r, at) => (at === index ? { ...r, account: event.target.value } : r)))} />
                                <input aria-label={`Royalty share ${index + 1} in percent`} inputMode="decimal" size={5} placeholder="%" value={row.percent} onChange={(event) => setRows(rows.map((r, at) => (at === index ? { ...r, percent: event.target.value } : r)))} />
                                <button type="button" className="os-btn os-quiet" onClick={() => setRows(rows.filter((_, at) => at !== index))}>Remove</button>
                            </div>
                        ))}
                        {rows.length < 10 && <div className="os-row"><button type="button" className="os-btn os-quiet" onClick={() => setRows([...rows, { account: "", percent: "" }])}>Add a royalty receiver</button></div>}
                        <span className="os-sub">At most 10% in all, paid on every sale. They can never change.</span>
                    </fieldset>
                )}
            </div>
            <div className="os-row"><button type="button" className="os-btn" disabled={busy || fee === null} onClick={() => void create()}>{busy ? "Checking…" : session.status === "member" ? "Review and create" : "Connect to create"}</button></div>
            {error && <p className="os-note os-warn" role="alert">{error}</p>}
        </div>
    )
}
