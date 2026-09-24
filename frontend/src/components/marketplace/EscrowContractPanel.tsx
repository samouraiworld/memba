/**
 * EscrowContractPanel — the connected wallet's escrow contracts in the
 * Services lane:
 *
 *   - My contracts: the ones it created as client, newest first, from the
 *     realm's client index (GetClientContractsJSON).
 *   - Contracts where it is the freelancer: escrow_v4 keeps no freelancer
 *     index, so these are found through the tx-indexer's ContractCreated
 *     events (best effort, mainnet only) and each is read back from the realm
 *     before it is shown. The dependable path is the contract link the client
 *     shares.
 *   - A lookup by id.
 *
 * An opened contract renders with every call its state allows for the
 * connected address (EscrowContractDetail). Like the hire dialog, nothing is
 * read or broadcast unless the services lane is live on this network
 * (VITE_ENABLE_SERVICES && isEscrowValid()).
 */
import { useCallback, useEffect, useState, type FormEvent } from "react"
import { GNO_CHAIN_ID, MEMBA_DAO, getIndexerUrl, isEscrowValid, isServicesEnabled } from "../../lib/config"
import { useNetworkPath } from "../../hooks/useNetworkNav"
import { escrowContractPath } from "../../lib/marketplace/escrowActions"
import { findFreelancerContractsPage, type FreelancerCursor } from "../../lib/marketplace/escrowIndexer"
import { readClientContracts, readEscrowContract, type EscrowContractSummary, type EscrowContractView } from "../../lib/marketplace/escrowState"
import { EscrowContractDetail } from "./EscrowContractDetail"
import { SignedText } from "../ui/SigningValue"
import "./escrow.css"

export interface EscrowContractPanelProps {
    /** Connected wallet address, or "" when none. */
    caller: string
    /** Bumped (n) after a hire lands: re-read My contracts and open `id` when it is known. */
    createdContract?: { id: string | null; n: number }
}

type MyList = { caller: string; items: EscrowContractSummary[]; next: string | null; error: string | null; loading: boolean }

type FreelancerList = { caller: string; items: EscrowContractView[] | null; next: FreelancerCursor | null; error: string | null; loading: boolean }

const muted = { color: "var(--color-text-muted)", fontSize: "13px" }

/**
 * The contracts naming `caller` as freelancer, newest first, one page at a
 * time: ids from the indexer (bounded windows, at most
 * FREELANCER_CONTRACTS_MAX per page), each read back from the realm and kept
 * only if the chain names `caller` (archived ones read as absent and drop out).
 */
function useFreelancerContracts(caller: string, enabled: boolean): (FreelancerList & { loadMore: () => void }) | null {
    const [list, setList] = useState<FreelancerList | null>(null)
    const indexerUrl = getIndexerUrl()
    const active = enabled && Boolean(caller) && indexerUrl !== null

    const fetchPage = useCallback(async (cursor: FreelancerCursor | null, signal?: AbortSignal) => {
        const page = await findFreelancerContractsPage(indexerUrl!, GNO_CHAIN_ID, MEMBA_DAO.escrowPath, caller, cursor, signal)
        const read = await Promise.all(page.ids.map((id) => readEscrowContract(MEMBA_DAO.escrowPath, id)))
        return { items: read.filter((c): c is EscrowContractView => c !== null && c.freelancer === caller), next: page.next }
    }, [indexerUrl, caller])

    useEffect(() => {
        if (!active) return
        const ctrl = new AbortController()
        let cancelled = false
        fetchPage(null, ctrl.signal).then(
            ({ items, next }) => { if (!cancelled) setList({ caller, items, next, error: null, loading: false }) },
            (err: unknown) => { if (!cancelled) setList({ caller, items: null, next: null, error: err instanceof Error ? err.message : String(err), loading: false }) },
        )
        return () => { cancelled = true; ctrl.abort() }
    }, [active, caller, fetchPage])

    const loadMore = useCallback(() => {
        const cursor = list?.caller === caller ? list.next : null
        if (!cursor || list?.loading) return
        setList((l) => (l ? { ...l, loading: true } : l))
        fetchPage(cursor).then(
            ({ items, next }) => setList((l) => ({ caller, items: [...(l?.caller === caller ? l.items ?? [] : []), ...items], next, error: null, loading: false })),
            (err: unknown) => setList((l) => (l ? { ...l, loading: false, error: err instanceof Error ? err.message : String(err) } : l)),
        )
    }, [list, caller, fetchPage])

    if (!active) return null
    return { ...(list?.caller === caller ? list : { caller, items: null, next: null, error: null, loading: true }), loadMore }
}

export function EscrowContractPanel({ caller, createdContract }: EscrowContractPanelProps) {
    const live = isServicesEnabled() && isEscrowValid()
    const np = useNetworkPath()
    const [mine, setMine] = useState<MyList | null>(null)
    const [id, setId] = useState("")
    // The opened contract; n remounts the detail so the same id is read again.
    const [open, setOpen] = useState<{ id: string; n: number } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const freelancer = useFreelancerContracts(caller, live)

    // Reads only while the lane is live here: elsewhere the realm may not exist.
    const loadMine = useCallback(async (before: string) => {
        if (!live || !caller) return
        setMine((m) => ({ caller, items: before && m?.caller === caller ? m.items : [], next: m?.next ?? null, error: null, loading: true }))
        try {
            const page = await readClientContracts(MEMBA_DAO.escrowPath, caller, before)
            setMine((m) => ({ caller, items: [...(before && m?.caller === caller ? m.items : []), ...page.items], next: page.next, error: null, loading: false }))
        } catch (err) {
            setMine((m) => ({ caller, items: m?.caller === caller ? m.items : [], next: null, error: err instanceof Error ? err.message : String(err), loading: false }))
        }
    }, [live, caller])

    const openContract = useCallback((contractId: string) => {
        setError(null)
        setOpen((o) => ({ id: contractId, n: (o?.n ?? 0) + 1 }))
    }, [])

    const createdN = createdContract?.n ?? 0
    const createdId = createdContract?.id ?? null
    useEffect(() => {
        void loadMine("")
        if (createdN > 0 && createdId) {
            setId(createdId)
            openContract(createdId)
        }
        // The effect follows the caller and each new hire only.
    }, [loadMine, openContract, createdN, createdId])

    const onLookup = (e: FormEvent) => {
        e.preventDefault()
        const trimmed = id.trim()
        if (!/^(0|[1-9]\d{0,8})$/.test(trimmed)) {
            setError("Enter a contract id: a whole number such as 0, 1 or 42.")
            return
        }
        // Like My contracts: no reads unless the lane is live here, where the realm may not exist.
        if (!live) {
            setError("Service escrow is not available on this network yet.")
            return
        }
        openContract(trimmed)
    }

    return (
        <section className="k-card" data-testid="escrow-contract-panel" style={{ marginTop: "24px", padding: "20px" }}>
            <h3 style={{ margin: "0 0 4px", fontSize: "16px", color: "var(--color-text)" }}>Your escrow contracts</h3>
            <p style={{ ...muted, margin: "0 0 12px" }}>
                Open a contract to fund, deliver, release, dispute, cancel or archive it, depending on your part in it and its state.
            </p>
            {caller && live && (
                <div data-testid="escrow-my-contracts" style={{ margin: "0 0 16px" }}>
                    <h4 style={{ margin: "0 0 6px", fontSize: "14px", color: "var(--color-text)" }}>My contracts</h4>
                    {mine?.error && <p role="alert" style={{ ...muted, margin: "0 0 6px" }}>{`Could not load your contracts: ${mine.error}`}</p>}
                    {mine && !mine.error && !mine.loading && mine.items.length === 0 && (
                        <p style={{ ...muted, margin: 0 }}>You have not created any escrow contracts that are still stored.</p>
                    )}
                    {mine && mine.items.length > 0 && (
                        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
                            {mine.items.map((it) => (
                                <li key={it.id} style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                                    <button
                                        className="k-btn-secondary"
                                        onClick={() => { setId(it.id); openContract(it.id) }}
                                        aria-label={`Open contract ${it.id}`}
                                    >
                                        {`#${it.id}`}
                                    </button>
                                    <span style={muted}>{`${it.status} · created at block ${it.createdAt.toLocaleString("en-US")}`}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {mine?.loading && <p style={{ ...muted, margin: "6px 0 0" }}>Loading your contracts...</p>}
                    {mine?.next && !mine.loading && (
                        <button className="k-btn-secondary" style={{ marginTop: "8px" }} onClick={() => void loadMine(mine.next!)}>
                            Load older contracts
                        </button>
                    )}
                </div>
            )}

            {freelancer && (
                <div data-testid="escrow-freelancer-contracts" style={{ margin: "0 0 16px" }}>
                    <h4 style={{ margin: "0 0 6px", fontSize: "14px", color: "var(--color-text)" }}>Contracts where you are the freelancer</h4>
                    {freelancer.error && (
                        <p style={{ ...muted, margin: "0 0 6px" }}>
                            {`Could not search for them (${freelancer.error}). Ask the client for the contract's link.`}
                        </p>
                    )}
                    {!freelancer.error && freelancer.items === null && <p style={{ ...muted, margin: 0 }}>Searching...</p>}
                    {freelancer.items?.length === 0 && !freelancer.next && (
                        <p style={{ ...muted, margin: 0 }}>None found. The client can send you the contract&apos;s link.</p>
                    )}
                    {freelancer.items && freelancer.items.length > 0 && (
                        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
                            {freelancer.items.map((c) => (
                                <li key={c.id} style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                                    <button className="k-btn-secondary" onClick={() => { setId(c.id); openContract(c.id) }} aria-label={`Open contract ${c.id}`}>
                                        {`#${c.id}`}
                                    </button>
                                    <span style={muted}><SignedText value={c.title} />{` · ${c.status}`}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {freelancer.items?.length === 0 && freelancer.next && (
                        <p style={{ ...muted, margin: 0 }}>None in the most recent blocks.</p>
                    )}
                    {freelancer.items !== null && freelancer.next && (
                        <button className="k-btn-secondary" style={{ marginTop: "8px" }} onClick={freelancer.loadMore} disabled={freelancer.loading}>
                            {freelancer.loading ? "Searching..." : "Load more"}
                        </button>
                    )}
                    <p style={{ ...muted, margin: "6px 0 0", fontSize: "12px" }}>
                        Found through the transaction indexer, then read from the chain. A contract missing here still works from its link.
                    </p>
                </div>
            )}

            <form onSubmit={onLookup} style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <label className="k-label" htmlFor="escrow-contract-id" style={{ alignSelf: "center" }}>Contract id</label>
                <input
                    id="escrow-contract-id"
                    className="escrow-input"
                    inputMode="numeric"
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                    style={{ flex: "1 1 120px", width: "auto" }}
                />
                <button type="submit" className="k-btn-secondary">Look up</button>
            </form>

            {error && <div className="k-error-banner" role="alert" style={{ marginTop: "12px" }}>{error}</div>}

            {open && (
                <EscrowContractDetail
                    key={`${open.id}:${open.n}`}
                    id={open.id}
                    caller={caller}
                    onChanged={() => void loadMine("")}
                    shareUrl={`${window.location.origin}${np(escrowContractPath(open.id))}`}
                />
            )}
        </section>
    )
}
