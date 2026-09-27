/**
 * The memba.club boot (owner's pick, 09-25: proposal A "POST check" straight into
 * proposal C "CRT warm-up"). A terse power-on self-test in Memba's voice types out,
 * collapses into a bright line, and that line opens into the picture like a warming
 * CRT, revealing the lock screen. Plays for each plain visit, skippable, never under reduced
 * motion. Pure parts here; the overlay is BootScreen.tsx.
 *
 * @module os/boot/boot
 */
import type { OsEntry } from "../shell/entry"

/** Total length; the overlay removes itself at this point (CSS timeline in boot.css). */
export const BOOT_MS = 2100

export function shouldBoot(opts: { entry: OsEntry; reducedMotion: boolean }): boolean {
    return opts.entry === "lock" && !opts.reducedMotion
}

export interface BootLine { label: string; value: string; status?: string }

/** The self-test lines: only facts this browser knows right now, no invented numbers. */
export function bootLines(f: { chainId: string; isTestnet: boolean; wallet: boolean; deskCount: number; appCount: number }): BootLine[] {
    return [
        { label: "MEMBA OS", value: "gno.land" },
        { label: "network", value: f.chainId, status: f.isTestnet ? "testnet" : "ok" },
        f.wallet ? { label: "wallet", value: "adena", status: "found" } : { label: "wallet", value: "none yet" },
        { label: "desk", value: `${f.deskCount} ${f.deskCount === 1 ? "item" : "items"}` },
        { label: "apps", value: `${f.appCount} ready` },
    ]
}
