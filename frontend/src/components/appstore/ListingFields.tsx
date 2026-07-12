import { useState } from "react"
import {
    MAX_NAME_LEN,
    MAX_TAGLINE_LEN,
    MAX_DESCR_LEN,
    MAX_CATEGORY_LEN,
    MAX_CID_LEN,
    MAX_SCREENSHOTS,
    type AppSubmission,
} from "../../lib/appStoreSubmit"
import { ImageUploader } from "../media/ImageUploader"

/** Parse the screenshots CSV into a bare-CID array (blanks dropped). */
function parseShots(csv: string): string[] {
    return csv.split(",").map((s) => s.trim()).filter(Boolean)
}

/**
 * ListingFields — the shared App Store listing form body (package path, name, tagline, category,
 * app URL, description + icon/screenshot uploaders). Controlled via `form`/`setForm`; `errors` come
 * from `validateSubmission`. Used by both the submit page (`/apps/submit`) and the publisher
 * console's inline edit (`/apps/my-submissions`), so the field set + validation never drift.
 * `pkgPathDisabled` locks the package path (the immutable listing key) in edit mode.
 */
export function ListingFields({ form, setForm, errors, authed, pkgPathDisabled }: {
    form: AppSubmission
    setForm: React.Dispatch<React.SetStateAction<AppSubmission>>
    errors: Partial<Record<keyof AppSubmission, string>>
    authed: boolean
    pkgPathDisabled: boolean
}) {
    return (
        <>
            <Field
                id="appsubmit-pkgpath" label="Package path" required
                hint="The app's on-chain realm — the listing's permanent key, e.g. gno.land/r/you/your_app"
                error={form.pkgPath ? errors.pkgPath : undefined}
            >
                <input
                    id="appsubmit-pkgpath" type="text" value={form.pkgPath}
                    disabled={pkgPathDisabled}
                    placeholder="gno.land/r/you/your_app"
                    onChange={(e) => setForm({ ...form, pkgPath: e.target.value.trim() })}
                />
            </Field>
            <Field
                id="appsubmit-name" label="Name" required
                error={form.name.length > MAX_NAME_LEN ? errors.name : undefined}
            >
                <input
                    id="appsubmit-name" type="text" value={form.name} maxLength={MAX_NAME_LEN + 1}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
            </Field>
            <Field id="appsubmit-tagline" label="Tagline" error={errors.tagline}>
                <input
                    id="appsubmit-tagline" type="text" value={form.tagline} maxLength={MAX_TAGLINE_LEN + 1}
                    placeholder="One line on what it does"
                    onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                />
            </Field>
            <Field id="appsubmit-category" label="Category" error={errors.category}>
                <input
                    id="appsubmit-category" type="text" value={form.category} maxLength={MAX_CATEGORY_LEN + 1}
                    placeholder="e.g. Tools, DeFi, Game"
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
            </Field>
            <Field
                id="appsubmit-url" label="App URL"
                hint="Where “Open app” goes: https://… or an in-app /path. Leave empty if the realm is the app."
                error={form.appURL ? errors.appURL : undefined}
            >
                <input
                    id="appsubmit-url" type="text" value={form.appURL}
                    placeholder="https://your.app"
                    onChange={(e) => setForm({ ...form, appURL: e.target.value.trim() })}
                />
            </Field>
            <Field
                id="appsubmit-descr" label="Description"
                hint="Optional at submission, but curators need it to approve a listing."
                error={errors.descr}
            >
                <textarea
                    id="appsubmit-descr" value={form.descr} rows={5} maxLength={MAX_DESCR_LEN + 1}
                    onChange={(e) => setForm({ ...form, descr: e.target.value })}
                />
            </Field>

            <ArtworkSection form={form} setForm={setForm} authed={authed} />
        </>
    )
}

function Field({ id, label, required, hint, error, children }: {
    id: string
    label: string
    required?: boolean
    hint?: string
    error?: string
    children: React.ReactNode
}) {
    return (
        <div className="appsubmit__field">
            <label htmlFor={id}>
                {label}{required && <span className="appsubmit__req" aria-hidden="true"> *</span>}
            </label>
            {children}
            {error ? (
                <p className="appsubmit__error" role="alert">{error}</p>
            ) : hint ? (
                <p className="appsubmit__hint">{hint}</p>
            ) : null}
        </div>
    )
}

/**
 * B6 — icon + multi-screenshot uploaders. Each emits a BARE CID into form.iconCID /
 * screenshotsCSV, which flow UNCHANGED through wireArgs → RegisterApp/EditListing.
 * Enforces MAX_SCREENSHOTS + MAX_CID_LEN, and surfaces the backend-auth prerequisite:
 * the upload proxy is auth-gated, so with no session token the uploaders are disabled
 * and a sign-in note shows (auth itself is never weakened — the token is attached
 * server-side at upload time).
 */
function ArtworkSection({ form, setForm, authed }: {
    form: AppSubmission
    setForm: React.Dispatch<React.SetStateAction<AppSubmission>>
    authed: boolean
}) {
    const [artError, setArtError] = useState<string | null>(null)
    const shots = parseShots(form.screenshotsCSV)

    const setIcon = (cid: string) => {
        if (cid.length > MAX_CID_LEN) {
            setArtError(`That icon CID is too long (max ${MAX_CID_LEN} chars).`)
            return
        }
        setArtError(null)
        setForm((f) => ({ ...f, iconCID: cid }))
    }
    const clearIcon = () => { setArtError(null); setForm((f) => ({ ...f, iconCID: "" })) }

    const addShot = (cid: string) => {
        if (cid.length > MAX_CID_LEN) {
            setArtError(`That screenshot CID is too long (max ${MAX_CID_LEN} chars).`)
            return
        }
        const current = parseShots(form.screenshotsCSV)
        if (current.length >= MAX_SCREENSHOTS) {
            setArtError(`At most ${MAX_SCREENSHOTS} screenshots.`)
            return
        }
        if (current.includes(cid)) {
            setArtError("That screenshot is already added.")
            return
        }
        setArtError(null)
        setForm((f) => ({ ...f, screenshotsCSV: [...parseShots(f.screenshotsCSV), cid].join(",") }))
    }
    const removeShot = (cid: string) => {
        setArtError(null)
        setForm((f) => ({ ...f, screenshotsCSV: parseShots(f.screenshotsCSV).filter((c) => c !== cid).join(",") }))
    }

    return (
        <section className="appsubmit__artwork" data-testid="appsubmit-artwork">
            <h2 className="appsubmit__artwork-title">
                Artwork <span className="appsubmit__hint">— optional; images pin to IPFS</span>
            </h2>

            {!authed && (
                <p className="appsubmit__art-authnote" role="note" data-testid="appsubmit-art-authnote">
                    Sign in with your wallet to upload artwork. You can still submit the listing without images.
                </p>
            )}

            <div className="appsubmit__field">
                <label>Icon</label>
                {form.iconCID ? (
                    <div className="appsubmit__art-current" data-testid="appsubmit-icon-current">
                        <code className="apppath">{form.iconCID.slice(0, 16)}…</code>
                        <button type="button" className="appsubmit__linkbtn" onClick={clearIcon}>Remove</button>
                    </div>
                ) : (
                    <ImageUploader
                        label="Icon" testIdPrefix="appsubmit-icon" onUploaded={setIcon} disabled={!authed}
                        hint="A square icon reads best (PNG/WebP/JPEG/GIF, ≤5MB)."
                    />
                )}
            </div>

            <div className="appsubmit__field">
                <label>Screenshots <span className="appsubmit__hint">({shots.length}/{MAX_SCREENSHOTS})</span></label>
                {shots.length > 0 && (
                    <ul className="appsubmit__shots" data-testid="appsubmit-shots">
                        {shots.map((cid) => (
                            <li key={cid} className="appsubmit__shot">
                                <code className="apppath">{cid.slice(0, 14)}…</code>
                                <button type="button" className="appsubmit__linkbtn" onClick={() => removeShot(cid)}>Remove</button>
                            </li>
                        ))}
                    </ul>
                )}
                {shots.length < MAX_SCREENSHOTS ? (
                    <ImageUploader
                        // Remount after each add so the picker resets for the next screenshot.
                        key={`shot-adder-${shots.length}`}
                        label="Screenshot" testIdPrefix="appsubmit-shot" onUploaded={addShot} disabled={!authed}
                        hint={`Add up to ${MAX_SCREENSHOTS} screenshots.`}
                    />
                ) : (
                    <p className="appsubmit__hint" data-testid="appsubmit-shots-full">
                        Maximum {MAX_SCREENSHOTS} screenshots reached.
                    </p>
                )}
            </div>

            {artError && <p className="appsubmit__error" role="alert" data-testid="appsubmit-art-error">{artError}</p>}
        </section>
    )
}
