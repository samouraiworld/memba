import { decimal } from './schema'

/** An expected cost at a glance: at most two decimals ("≈ 1.15 GNOT"); the signed cap keeps every digit (gnotAmount). */
export function approxGnot(ugnot: string): string {
    const centi = (BigInt(decimal(ugnot, 63)) + 5_000n) / 10_000n
    const whole = centi / 100n, fraction = (centi % 100n).toString().padStart(2, '0').replace(/0+$/, '')
    return `${whole}${fraction ? `.${fraction}` : ''} GNOT`
}
