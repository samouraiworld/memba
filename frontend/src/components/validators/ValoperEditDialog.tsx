/** ValoperEditDialog — the owner "Edit profile" modal for a valoper profile
 *  (ValoperDetail, P1b).
 *
 *  Honest scope: only the Memba-backend editable fields are editable here —
 *  bio, avatar, social links, company, title. The on-chain valoper fields
 *  (operator / signing addresses, pubkey, server type) are NOT editable; they
 *  live on r/gnops/valopers and are immutable from this surface.
 *
 *  It reuses the SAME backend editable-profile path the profile page uses
 *  (`updateBackendProfile` → `api.updateProfile`); there is no new realm and no
 *  on-chain write. Ownership is enforced two ways: the caller only mounts this
 *  for the owner (connected wallet === operator), and the backend authorises the
 *  write against the auth token's address.
 */
import { useEffect, useState } from "react"
import { AccessibleDialog } from "../AccessibleDialog"
import { EditField } from "../profile"
import { AvatarUploader } from "../profile/AvatarUploader"
import { updateBackendProfile, type UserProfile } from "../../lib/profile"
import type { Token } from "../../gen/memba/v1/memba_pb"

interface Props {
    open: boolean
    onClose: () => void
    /** The profile being edited (provides the initial field values). */
    profile: UserProfile
    /** Auth token — its address is the write target authorised server-side. */
    token: Token
    /** Called after a successful save so the page can refresh + close. */
    onSaved: () => void
}

interface EditForm {
    bio: string
    company: string
    title: string
    avatarUrl: string
    twitter: string
    github: string
    website: string
}

function initialForm(profile: UserProfile): EditForm {
    return {
        bio: profile.bio,
        company: profile.company,
        title: profile.title,
        avatarUrl: profile.avatarUrl,
        twitter: profile.socialLinks.twitter,
        github: profile.socialLinks.github,
        website: profile.socialLinks.website,
    }
}

export function ValoperEditDialog({ open, onClose, profile, token, onSaved }: Props) {
    const [form, setForm] = useState<EditForm>(() => initialForm(profile))
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Re-seed the form from the current profile each time the dialog opens, so a
    // reopen always reflects the latest saved values (and clears a stale error).
    useEffect(() => {
        if (open) {
            setForm(initialForm(profile))
            setError(null)
        }
    }, [open, profile])

    const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) =>
        setForm((f) => ({ ...f, [k]: v }))

    const handleSave = async () => {
        setSaving(true)
        setError(null)
        try {
            await updateBackendProfile(token, form)
            onSaved()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to save profile")
        } finally {
            setSaving(false)
        }
    }

    // Guard onClose so a backdrop/Esc dismiss can't interrupt an in-flight save.
    const requestClose = () => {
        if (saving) return
        onClose()
    }

    return (
        <AccessibleDialog
            open={open}
            onClose={requestClose}
            labelledBy="vp-edit-title"
            className="vp-edit-overlay"
        >
            <div className="vp-edit-modal" role="document">
                <div className="vp-edit-modal__head">
                    <h2 id="vp-edit-title" className="vp-edit-modal__title">Edit profile</h2>
                    <button
                        type="button"
                        className="vp-edit-modal__x"
                        aria-label="Close"
                        onClick={requestClose}
                        disabled={saving}
                    >
                        ✕
                    </button>
                </div>

                <p className="vp-edit-modal__note">
                    These details are stored off-chain by Memba. On-chain valoper fields
                    (addresses, signing key) are managed on the valopers realm and can't be edited here.
                </p>

                <div className="vp-edit-grid">
                    <EditField
                        label="Bio"
                        value={form.bio}
                        onChange={(v) => set("bio", v)}
                        multiline
                        maxLen={512}
                        fullWidth
                    />
                    <EditField label="Company" value={form.company} onChange={(v) => set("company", v)} maxLen={128} />
                    <EditField label="Title / Role" value={form.title} onChange={(v) => set("title", v)} maxLen={128} />
                    <div className="vp-edit-fullwidth">
                        <AvatarUploader
                            currentUrl={form.avatarUrl}
                            onUrlChange={(url) => set("avatarUrl", url)}
                        />
                    </div>
                    <EditField label="Twitter / X" value={form.twitter} onChange={(v) => set("twitter", v)} maxLen={256} placeholder="@handle or URL" />
                    <EditField label="GitHub" value={form.github} onChange={(v) => set("github", v)} maxLen={256} placeholder="https://github.com/..." />
                    <EditField label="Website" value={form.website} onChange={(v) => set("website", v)} maxLen={256} placeholder="https://..." />
                </div>

                {error && (
                    <p className="vp-edit-modal__error" role="alert">⚠️ {error}</p>
                )}

                <div className="vp-edit-modal__actions">
                    <button
                        type="button"
                        className="vp-edit-btn"
                        onClick={requestClose}
                        disabled={saving}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="vp-edit-save"
                        onClick={handleSave}
                        disabled={saving}
                    >
                        {saving ? "Saving…" : "Save profile"}
                    </button>
                </div>
            </div>
        </AccessibleDialog>
    )
}
