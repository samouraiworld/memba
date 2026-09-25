/**
 * The mockup's switch (.toggle): a labelled on/off control. Name it with
 * `label` (becomes aria-label) or, when a visible label sits next to it, with
 * `labelledBy` (that label's id, becomes aria-labelledby).
 *
 * @module os/kit/Toggle
 */
type ToggleName = { label: string; labelledBy?: undefined } | { labelledBy: string; label?: undefined }

export function Toggle({ checked, onChange, label, labelledBy }: {
    checked: boolean
    onChange: (next: boolean) => void
} & ToggleName) {
    return (
        <button type="button" role="switch" aria-checked={checked} aria-label={label} aria-labelledby={labelledBy} className="os-toggle" onClick={() => onChange(!checked)}>
            <span />
        </button>
    )
}
