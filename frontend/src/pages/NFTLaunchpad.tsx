/**
 * NFTLaunchpad — 5-step wizard for deploying GRC721 NFT collections.
 *
 * v3.1: Steps: Type → Info → Config → Preview → Deploy
 * Route: /nft/create (must be declared BEFORE /nft/:realmPath in App.tsx)
 *
 * @module pages/NFTLaunchpad
 */

import { useState, useMemo, useCallback, useEffect } from "react"
import { useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { generateNFTCollectionCode, type NFTCollectionConfig } from "../lib/nftTemplate"
import { GNO_CHAIN_ID } from "../lib/config"
import { ComingSoonGate } from "../components/ui/ComingSoonGate"
import type { LayoutContext } from "../types/layout"
import "./nft-launchpad.css"

const NFT_ENABLED = import.meta.env.VITE_ENABLE_NFT === "true"

// ── Constants ────────────────────────────────────────────────

const STEPS = [
    { label: "Type", icon: "🎯" },
    { label: "Info", icon: "📝" },
    { label: "Config", icon: "⚙️" },
    { label: "Preview", icon: "👁️" },
    { label: "Deploy", icon: "🚀" },
] as const

type CollectionType = "grc721" | "grc1155"

const COST_PER_BYTE = 100 // ugnot per byte on-chain (network-dependent storage cost)

// ── Component ────────────────────────────────────────────────

export function NFTLaunchpad() {
    if (!NFT_ENABLED) {
        return (
            <ComingSoonGate
                title="NFT Launchpad"
                icon="🚀"
                description="Deploy your own NFT collection on gno.land."
                features={[
                    "Deploy GRC721 (1-of-1) collections",
                    "Configure royalties, mint price, and supply",
                    "Auto-generated Gno smart contract code",
                    "One-click deployment via Adena wallet",
                ]}
            />
        )
    }

    return <LaunchpadContent />
}

function LaunchpadContent() {
    const navigate = useNetworkNav()
    const { auth, adena } = useOutletContext<LayoutContext>()

    // ── Wizard State ─────────────────────────────────────────
    const [step, setStep] = useState(0)
    const [collectionType, setCollectionType] = useState<CollectionType>("grc721")

    // ── Form State ───────────────────────────────────────────
    const [name, setName] = useState("")
    const [symbol, setSymbol] = useState("")
    const [description, setDescription] = useState("")
    const [realmSuffix, setRealmSuffix] = useState("")
    const [maxSupply, setMaxSupply] = useState("")
    const [royaltyPercent, setRoyaltyPercent] = useState("5")
    const [publicMint, setPublicMint] = useState(true)
    const [mintPrice, setMintPrice] = useState("0")

    // ── Deploy State ─────────────────────────────────────────
    const [deploying, setDeploying] = useState(false)
    const [deployError, setDeployError] = useState<string | null>(null)
    const [deploySuccess, setDeploySuccess] = useState(false)

    useEffect(() => { document.title = "Create NFT Collection — Memba" }, [])

    // ── Derived Values ───────────────────────────────────────
    const connectedAddress = adena?.address || ""
    const realmPath = connectedAddress
        ? `gno.land/r/${connectedAddress}/${realmSuffix || "nft_collection"}`
        : `gno.land/r/user/${realmSuffix || "nft_collection"}`

    const config: NFTCollectionConfig = useMemo(() => ({
        realmPath,
        name: name || "My NFT Collection",
        symbol: symbol || "NFT",
        description: description || "A GRC721 NFT collection.",
        adminAddress: connectedAddress || "g1...",
        maxSupply: parseInt(maxSupply, 10) || 0,
        royaltyPercent: Math.min(Math.max(parseInt(royaltyPercent, 10) || 0, 0), 10),
        publicMint,
        mintPrice: parseInt(mintPrice, 10) || 0,
    }), [realmPath, name, symbol, description, connectedAddress, maxSupply, royaltyPercent, publicMint, mintPrice])

    const generatedCode = useMemo(() => {
        if (collectionType === "grc1155") return "// GRC1155 templates coming soon"
        return generateNFTCollectionCode(config)
    }, [collectionType, config])

    const codeSizeBytes = new TextEncoder().encode(generatedCode).length
    const estimatedCostUgnot = codeSizeBytes * COST_PER_BYTE
    const estimatedCostGnot = (estimatedCostUgnot / 1_000_000).toFixed(2)

    // ── Step Validation ──────────────────────────────────────
    const canAdvance = useCallback((): boolean => {
        switch (step) {
            case 0: return true // type always selected
            case 1: return name.trim().length > 0 && symbol.trim().length > 0 && realmSuffix.trim().length > 0
            case 2: return true // config has defaults
            case 3: return true // preview is read-only
            default: return false
        }
    }, [step, name, symbol, realmSuffix])

    // ── Deploy ───────────────────────────────────────────────
    const handleDeploy = async () => {
        if (!auth.isAuthenticated || !connectedAddress) return
        setDeploying(true)
        setDeployError(null)

        try {
            const { buildDeployNFTCollectionMsg } = await import("../lib/nftTemplate")
            const { getGasConfig } = await import("../lib/gasConfig")

            const msg = buildDeployNFTCollectionMsg(connectedAddress, realmPath, generatedCode)
            // Set deposit based on code size
            msg.value.deposit = `${estimatedCostUgnot}ugnot`

            // MsgAddPackage uses /vm.m_addpkg — bypass toAdenaMessages (which only handles MsgCall)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const adenaWallet = (window as any).adena
            if (!adenaWallet?.DoContract) {
                throw new Error("Adena wallet not available — please install or refresh the page")
            }

            const gas = getGasConfig()
            const res = await adenaWallet.DoContract({
                messages: [msg],
                gasFee: gas.fee,
                gasWanted: gas.wanted,
                memo: `Deploy NFT: ${name}`,
            })

            if (res.status === "failure") {
                throw new Error(res.message || res.data?.message || "Deployment failed")
            }

            setDeploySuccess(true)
        } catch (err) {
            setDeployError(err instanceof Error ? err.message : "Deployment failed")
        } finally {
            setDeploying(false)
        }
    }

    // ── Step Renderers ───────────────────────────────────────

    const renderStepType = () => (
        <div className="nft-step-card" key="step-type">
            <h2>Choose Collection Type</h2>
            <p className="hint">Select the NFT standard for your collection.</p>
            <div className="nft-type-grid">
                <button
                    className={`nft-type-card${collectionType === "grc721" ? " nft-type-card--selected" : ""}`}
                    onClick={() => setCollectionType("grc721")}
                >
                    <div className="nft-type-card__icon">🎨</div>
                    <div className="nft-type-card__title">GRC721 — 1-of-1</div>
                    <div className="nft-type-card__desc">Unique NFTs. Each token is one-of-a-kind. Ideal for art, collectibles, PFPs.</div>
                </button>
                <button
                    className="nft-type-card nft-type-card--disabled"
                    disabled
                    title="Coming in v3.1 — GRC1155 edition support"
                >
                    <div className="nft-type-card__icon">📦</div>
                    <div className="nft-type-card__title">GRC1155 — Editions</div>
                    <div className="nft-type-card__desc">Multi-token standard. Multiple copies per token ID. For games, tickets, drops.</div>
                    <span className="nft-type-card__badge">coming soon</span>
                </button>
            </div>
        </div>
    )

    const renderStepInfo = () => (
        <div className="nft-step-card" key="step-info">
            <h2>Collection Information</h2>
            <p className="hint">Describe your NFT collection.</p>
            <div className="nft-form-group">
                <label className="nft-form-label" htmlFor="nft-name">Collection Name *</label>
                <input id="nft-name" className="nft-form-input" type="text" placeholder="e.g. Gno Punks"
                    value={name} onChange={e => setName(e.target.value)} maxLength={64} />
            </div>
            <div className="nft-form-row">
                <div className="nft-form-group">
                    <label className="nft-form-label" htmlFor="nft-symbol">Symbol *</label>
                    <input id="nft-symbol" className="nft-form-input" type="text" placeholder="e.g. GPUNK"
                        value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} maxLength={10} />
                </div>
                <div className="nft-form-group">
                    <label className="nft-form-label" htmlFor="nft-realm">Realm Suffix *</label>
                    <input id="nft-realm" className="nft-form-input" type="text" placeholder="e.g. gno_punks"
                        value={realmSuffix} onChange={e => setRealmSuffix(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} maxLength={32} />
                    <span className="nft-form-hint">{realmPath}</span>
                </div>
            </div>
            <div className="nft-form-group">
                <label className="nft-form-label" htmlFor="nft-desc">Description</label>
                <input id="nft-desc" className="nft-form-input" type="text" placeholder="A unique art collection on gno.land"
                    value={description} onChange={e => setDescription(e.target.value)} maxLength={200} />
            </div>
        </div>
    )

    const renderStepConfig = () => (
        <div className="nft-step-card" key="step-config">
            <h2>Minting Configuration</h2>
            <p className="hint">Set supply limits, pricing, and royalties.</p>
            <div className="nft-form-row">
                <div className="nft-form-group">
                    <label className="nft-form-label" htmlFor="nft-supply">Max Supply</label>
                    <input id="nft-supply" className="nft-form-input" type="number" placeholder="0 = unlimited"
                        value={maxSupply} onChange={e => setMaxSupply(e.target.value)} min={0} />
                    <span className="nft-form-hint">0 means unlimited supply</span>
                </div>
                <div className="nft-form-group">
                    <label className="nft-form-label" htmlFor="nft-royalty">Royalty %</label>
                    <input id="nft-royalty" className="nft-form-input" type="number" placeholder="0-10"
                        value={royaltyPercent} onChange={e => setRoyaltyPercent(e.target.value)} min={0} max={10} />
                    <span className="nft-form-hint">Creator royalty on resales (0-10%)</span>
                </div>
            </div>
            <div className="nft-form-group">
                <label className="nft-form-label" htmlFor="nft-price">Mint Price (ugnot)</label>
                <input id="nft-price" className="nft-form-input" type="number" placeholder="0 = free mint"
                    value={mintPrice} onChange={e => setMintPrice(e.target.value)} min={0} />
                <span className="nft-form-hint">Price per mint in ugnot (0 = free). 1 GNOT = 1,000,000 ugnot</span>
            </div>
            <div className="nft-form-group">
                <label className="nft-form-label">Public Mint</label>
                <button
                    className={`nft-form-toggle${publicMint ? " nft-form-toggle--on" : ""}`}
                    onClick={() => setPublicMint(!publicMint)}
                    type="button"
                    role="switch"
                    aria-checked={publicMint}
                >
                    <span className="nft-form-toggle__track">
                        <span className="nft-form-toggle__thumb" />
                    </span>
                    <span className="nft-form-toggle__label">{publicMint ? "Anyone can mint" : "Admin-only mint"}</span>
                </button>
            </div>
        </div>
    )

    const renderStepPreview = () => (
        <div className="nft-step-card" key="step-preview">
            <h2>Review & Preview</h2>
            <p className="hint">Review the generated Gno smart contract code before deployment.</p>
            <pre className="nft-code-preview">{generatedCode}</pre>
            <div className="nft-cost-estimate">
                <span className="nft-cost-estimate__label">Estimated deployment cost</span>
                <span className="nft-cost-estimate__value">
                    ~{estimatedCostGnot} GNOT ({codeSizeBytes.toLocaleString()} bytes × {COST_PER_BYTE} ugnot)
                </span>
            </div>
        </div>
    )

    const renderStepDeploy = () => {
        if (deploySuccess) {
            return (
                <div className="nft-step-card" key="step-success">
                    <div className="nft-success">
                        <div className="nft-success__icon">✅</div>
                        <h3>Collection Deployed!</h3>
                        <p>Your GRC721 collection is now live on {GNO_CHAIN_ID}.</p>
                        <a className="nft-success__link" href="#" onClick={(e) => { e.preventDefault(); navigate(`/nft/${encodeURIComponent(realmPath)}`) }}>
                            View Collection →
                        </a>
                    </div>
                </div>
            )
        }

        return (
            <div className="nft-step-card" key="step-deploy">
                <h2>Deploy Collection</h2>
                {!auth.isAuthenticated ? (
                    <p className="hint">Connect your wallet to deploy.</p>
                ) : (
                    <>
                        <p className="hint">
                            Deploy <strong>{name || "NFT Collection"}</strong> ({symbol || "NFT"}) to <code>{GNO_CHAIN_ID}</code>.
                            This will broadcast a MsgAddPkg transaction via your Adena wallet.
                        </p>
                        <div className="nft-cost-estimate">
                            <span className="nft-cost-estimate__label">Deposit required</span>
                            <span className="nft-cost-estimate__value">~{estimatedCostGnot} GNOT</span>
                        </div>
                        {deployError && <div className="nft-deploy-error" role="alert">{deployError}</div>}
                    </>
                )}
            </div>
        )
    }

    const stepRenderers = [renderStepType, renderStepInfo, renderStepConfig, renderStepPreview, renderStepDeploy]

    // ── Render ───────────────────────────────────────────────

    return (
        <div className="nft-launchpad animate-fade-in">
            <h1>🚀 NFT <span>Launchpad</span></h1>

            {/* Step indicator */}
            <ol className="nft-steps" role="tablist" aria-label="Wizard progress">
                {STEPS.map((s, i) => (
                    <li
                        key={s.label}
                        className={`nft-step${i === step ? " nft-step--active" : ""}${i < step ? " nft-step--done" : ""}`}
                        aria-current={i === step ? "step" : undefined}
                    >
                        <div className="nft-step__dot">{i < step ? "✓" : i + 1}</div>
                        <span className="nft-step__label">{s.label}</span>
                    </li>
                ))}
            </ol>

            {/* Active step content */}
            {stepRenderers[step]()}

            {/* Navigation */}
            <div className="nft-nav">
                {step > 0 && !deploySuccess ? (
                    <button className="nft-nav-btn nft-nav-btn--back" onClick={() => setStep(step - 1)}>
                        ← Back
                    </button>
                ) : <div />}

                {step < STEPS.length - 1 ? (
                    <button className="nft-nav-btn nft-nav-btn--next" onClick={() => setStep(step + 1)} disabled={!canAdvance()}>
                        Next →
                    </button>
                ) : !deploySuccess ? (
                    <button
                        className="nft-nav-btn nft-nav-btn--deploy"
                        onClick={handleDeploy}
                        disabled={deploying || !auth.isAuthenticated}
                    >
                        {deploying ? "Deploying..." : "Deploy Collection"}
                    </button>
                ) : null}
            </div>
        </div>
    )
}

export default NFTLaunchpad
