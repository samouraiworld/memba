/**
 * The mockup's switch (.toggle): a labelled on/off control.
 *
 * @module os/kit/Toggle
 */
export function Toggle({ checked, onChange, label }: {
    checked: boolean
    onChange: (next: boolean) => void
    label: string
}) {
    return (
        <button type="button" role="switch" aria-checked={checked} aria-label={label} className="os-toggle" onClick={() => onChange(!checked)}>
            <span />
        </button>
    )
}
