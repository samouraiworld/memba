/**
 * Pick-one controls: `Segmented` (the mockup's .segm, a few views of the
 * same thing, e.g. Day / Week / Month) and `Chips` (the mockup's .chipset,
 * filters with optional counts, e.g. All / Open 3 / Done 0). Both are a
 * labelled group of toggle buttons, the chosen one `aria-pressed`.
 *
 * @module os/kit/Choice
 */
export interface ChoiceOption<Id extends string> {
    id: Id
    name: string
}

export function Segmented<Id extends string>({ label, options, value, onChange }: {
    label: string
    options: readonly ChoiceOption<Id>[]
    value: Id
    onChange: (id: Id) => void
}) {
    return (
        <div className="os-segm" role="group" aria-label={label}>
            {options.map((o) => (
                <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>{o.name}</button>
            ))}
        </div>
    )
}

export function Chips<Id extends string>({ label, options, value, onChange }: {
    label: string
    options: readonly (ChoiceOption<Id> & { count?: number })[]
    value: Id
    onChange: (id: Id) => void
}) {
    return (
        <div className="os-chipset" role="group" aria-label={label}>
            {options.map((o) => (
                <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
                    {o.name}
                    {o.count != null && <> <span className="os-chip-n">{o.count}</span></>}
                </button>
            ))}
        </div>
    )
}
