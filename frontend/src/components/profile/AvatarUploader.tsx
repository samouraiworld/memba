/**
 * AvatarUploader — File picker + URL input for profile avatars.
 *
 * Phase 1: Local file preview with DataURL (no external upload).
 * Phase 2 (future): Storacha/web3.storage IPFS upload when env var is configured.
 *
 * Constraints:
 * - Max 2MB image file
 * - Accepts: JPEG, PNG, WebP, GIF
 * - Shows preview before saving
 *
 * v2.0.0-alpha.1 (Sprint C, Step 12)
 */

import { useState, useRef, useCallback } from "react"

const MAX_SIZE_BYTES = 2 * 1024 * 1024 // 2MB
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]

interface Props {
    /** Current avatar URL (from profile). */
    currentUrl: string
    /** Called when user confirms a new avatar URL. */
    onUrlChange: (url: string) => void
}

export function AvatarUploader({ currentUrl, onUrlChange }: Props) {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [urlInput, setUrlInput] = useState(currentUrl)
    const [error, setError] = useState<string | null>(null)
    const [mode, setMode] = useState<"url" | "file">("url")
    const fileRef = useRef<HTMLInputElement>(null)

    const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setError(null)

        if (!ACCEPTED_TYPES.includes(file.type)) {
            setError("Only JPEG, PNG, WebP, and GIF images are supported")
            return
        }
        if (file.size > MAX_SIZE_BYTES) {
            setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max: 2 MB`)
            return
        }

        const reader = new FileReader()
        reader.onload = () => {
            const dataUrl = reader.result as string
            setPreviewUrl(dataUrl)
        }
        reader.onerror = () => setError("Failed to read file")
        reader.readAsDataURL(file)
    }, [])

    const applyUrl = () => {
        if (urlInput.trim()) {
            onUrlChange(urlInput.trim())
            setPreviewUrl(null)
            setError(null)
        }
    }

    const applyFile = () => {
        if (previewUrl) {
            // For Phase 1, we pass the DataURL to the parent.
            // In Phase 2, this would upload to IPFS first and return the CID URL.
            onUrlChange(previewUrl)
            setPreviewUrl(null)
        }
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: "#ccc" }}>Avatar</span>
                <div style={{ display: "flex", gap: 2 }}>
                    {(["url", "file"] as const).map(m => (
                        <button
                            key={m}
                            onClick={() => { setMode(m); setError(null) }}
                            style={{
                                padding: "3px 10px", fontSize: 10, borderRadius: 4,
                                fontFamily: "JetBrains Mono, monospace",
                                background: mode === m ? "rgba(0,212,170,0.08)" : "transparent",
                                border: "1px solid",
                                borderColor: mode === m ? "rgba(0,212,170,0.2)" : "#222",
                                color: mode === m ? "#00d4aa" : "#666",
                                cursor: "pointer", transition: "all 0.15s",
                            }}
                        >
                            {m === "url" ? "🔗 URL" : "📁 Upload"}
                        </button>
                    ))}
                </div>
            </div>

            {mode === "url" ? (
                <div style={{ display: "flex", gap: 8 }}>
                    <input
                        type="text"
                        value={urlInput}
                        onChange={e => setUrlInput(e.target.value)}
                        placeholder="https://example.com/avatar.png"
                        style={{
                            flex: 1, padding: "8px 12px", borderRadius: 6,
                            border: "1px solid #1a1a1a", background: "#0d0d0d",
                            color: "#f0f0f0", fontSize: 11,
                            fontFamily: "JetBrains Mono, monospace", outline: "none",
                        }}
                    />
                    <button
                        onClick={applyUrl}
                        disabled={!urlInput.trim()}
                        className="k-btn-primary"
                        style={{ fontSize: 10, padding: "6px 12px", opacity: urlInput.trim() ? 1 : 0.4 }}
                    >
                        Apply
                    </button>
                </div>
            ) : (
                <div>
                    <input
                        ref={fileRef}
                        type="file"
                        accept={ACCEPTED_TYPES.join(",")}
                        onChange={handleFile}
                        style={{ display: "none" }}
                    />
                    <button
                        onClick={() => fileRef.current?.click()}
                        className="k-btn-secondary"
                        style={{
                            fontSize: 11, padding: "10px 18px", width: "100%",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                        }}
                    >
                        📁 Choose Image (max 2 MB)
                    </button>

                    {/* Preview */}
                    {previewUrl && (
                        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
                            <img
                                src={previewUrl}
                                alt="Preview"
                                style={{
                                    width: 56, height: 56, borderRadius: "50%",
                                    objectFit: "cover", border: "2px solid rgba(0,212,170,0.2)",
                                }}
                            />
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <span style={{ fontSize: 10, color: "#888", fontFamily: "JetBrains Mono, monospace" }}>
                                    Preview ready
                                </span>
                                <button
                                    onClick={applyFile}
                                    className="k-btn-primary"
                                    style={{ fontSize: 10, padding: "4px 12px" }}
                                >
                                    ✓ Use This Photo
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {error && (
                <div style={{
                    fontSize: 10, color: "#ef4444", fontFamily: "JetBrains Mono, monospace",
                    padding: "6px 10px", borderRadius: 4,
                    background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.12)",
                }}>
                    ⚠️ {error}
                </div>
            )}

            {/* Current avatar display */}
            {currentUrl && !previewUrl && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <img
                        src={currentUrl}
                        alt="Current avatar"
                        style={{
                            width: 32, height: 32, borderRadius: "50%",
                            objectFit: "cover", border: "1px solid #222",
                        }}
                        onError={e => e.currentTarget.style.display = "none"}
                    />
                    <span style={{ fontSize: 9, color: "#555", fontFamily: "JetBrains Mono, monospace" }}>
                        Current avatar
                    </span>
                </div>
            )}
        </div>
    )
}
