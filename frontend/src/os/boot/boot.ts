/**
 * The memba.club boot (owner's pick, 09-25: proposal A "POST check" straight into
 * proposal C "CRT warm-up"). A terse power-on self-test in Memba's voice types out,
 * collapses into a bright line, and that line opens into the picture like a warming
 * CRT, revealing the lock screen. First visit only, skippable, never under reduced
 * motion. Pure parts here; the overlay is BootScreen.tsx.
 *
 * @module os/boot/boot
 */
import type { OsEntry } from "../shell/entry"

/** Set once the boot has played in this browser. */
export const BOOTED_KEY = "memba_os_booted"

/** Total length; the overlay removes itself at this point (CSS timeline in boot.css). */
export const BOOT_MS = 2100

export function shouldBoot(opts: { entry: OsEntry; reducedMotion: boolean; booted: boolean }): boolean {
    return opts.entry === "lock" && !opts.reducedMotion && !opts.booted
}

export function readBooted(): boolean {
    try {
        return localStorage.getItem(BOOTED_KEY) === "1"
    } catch {
        // Storage refused: behave as if it played, rather than on every visit.
        return true
    }
}

export function markBooted(): void {
    try {
        localStorage.setItem(BOOTED_KEY, "1")
    } catch {
        // Storage refused: readBooted() already treats this browser as booted.
    }
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
