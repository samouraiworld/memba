/**
 * ImageUploader — generic file picker that pins an image to IPFS via the auth-gated
 * backend proxy (/api/upload/image) and emits the resulting BARE CID.
 *
 * Generalizes AvatarUploader for App Store media (icon + screenshots):
 * - Client-rejects non-image files (JPEG/PNG/WebP/GIF only — never SVG) BEFORE any
 *   network call; the server re-validates (raster allowlist + magic-byte sniff).
 * - Full-resolution: no 256²/512KB downscale (uploadImage skips it) — the 5MB cap is
 *   enforced server-side; a light client size guard avoids obviously-oversize POSTs.
 * - Emits the bare CID (no ipfs:// prefix) — exactly what the realm's iconCID /
 *   screenshots CSV store and what isValidCid expects.
 *
 * Backend auth is a prerequisite (the proxy is auth-gated); the PARENT surfaces the
 * "sign in first" state — this component only reports the upload error it gets back.
 *
 * @module components/media/ImageUploader
 */

import { useCallback, useRef, useState } from "react"
import { uploadImage, isValidImageMime } from "../../lib/ipfs"

// Accepts the same raster types as isValidImageMime — SVG is intentionally excluded.
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
// Client-side guard mirroring the server's 5MB cap — reject obviously-oversize files
// before the POST (the server remains the authority).
const DEFAULT_MAX_INPUT_BYTES = 5 * 1024 * 1024

interface Props {
    /** Short label for the control, e.g. "Icon" or "Screenshot". */
    label: string
    /** Called with the freshly-pinned BARE CID. */
    onUploaded: (cid: string) => void
    /** Stable prefix for data-testid hooks (e.g. "appsubmit-icon"). */
    testIdPrefix: string
    /** Optional override for the client-side size guard (bytes). */
    maxInputBytes?: number
    /** Optional hint text under the picker. */
    hint?: string
    /** Disable the picker (e.g. while the auth prerequisite is unmet). */
    disabled?: boolean
}

export function ImageUploader({ label, onUploaded, testIdPrefix, maxInputBytes = DEFAULT_MAX_INPUT_BYTES, hint, disabled }: Props) {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [uploading, setUploading] = useState(false)
    const [uploadedCid, setUploadedCid] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const fileRef = useRef<HTMLInputElement>(null)

    const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        // Reset the input so re-picking the same file still fires onChange.
        e.target.value = ""
        if (!file) return

        setError(null)
        setUploadedCid(null)

        // Client-reject non-images up front (defense-in-depth; the server re-checks).
        if (!isValidImageMime(file.type)) {
            setError("Only JPEG, PNG, WebP, and GIF images are supported")
            setPreviewUrl(null)
            return
        }
        if (file.size > maxInputBytes) {
            setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max: ${(maxInputBytes / 1024 / 1024).toFixed(0)} MB`)
            setPreviewUrl(null)
            return
        }

        const reader = new FileReader()
        reader.onload = () => setPreviewUrl(reader.result as string)
        reader.onerror = () => setPreviewUrl(null)
        reader.readAsDataURL(file)

        setUploading(true)
        try {
            const cid = await uploadImage(file)
            setUploadedCid(cid)
            onUploaded(cid)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed")
        } finally {
            setUploading(false)
        }
    }, [maxInputBytes, onUploaded])

    return (
        <div className="imgup" data-testid={`${testIdPrefix}-root`}>
            <div className="imgup__row">
                <input
                    ref={fileRef}
                    type="file"
                    accept={ACCEPTED_TYPES.join(",")}
                    onChange={handleFile}
                    disabled={disabled || uploading}
                    data-testid={`${testIdPrefix}-input`}
                    style={{ display: "none" }}
                />
                <button
                    type="button"
                    className="appbtn appbtn--ghost imgup__choose"
                    onClick={() => fileRef.current?.click()}
                    disabled={disabled || uploading}
                    data-testid={`${testIdPrefix}-choose`}
                >
                    {uploading ? "Pinning to IPFS…" : uploadedCid ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
                </button>
                {previewUrl && (
                    <img className="imgup__preview" src={previewUrl} alt={`${label} preview`} data-testid={`${testIdPrefix}-preview`} />
                )}
            </div>

            {hint && !error && <p className="imgup__hint appsubmit__hint">{hint}</p>}

            {uploadedCid && (
                <p className="imgup__ok" data-testid={`${testIdPrefix}-cid`}>
                    ✓ Pinned <code className="apppath">{uploadedCid.slice(0, 16)}…</code>
                </p>
            )}

            {error && (
                <p className="imgup__error appsubmit__error" role="alert" data-testid={`${testIdPrefix}-error`}>
                    {error}
                </p>
            )}
        </div>
    )
}
