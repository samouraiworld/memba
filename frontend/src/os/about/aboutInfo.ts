import { APP_VERSION } from "../../lib/config"

const SOURCE = "https://github.com/samouraiworld/memba"

export const ABOUT_LINKS = [
    { label: "Samouraï Coop", href: "https://samourai.world" },
    { label: "X", href: "https://x.com/samouraicoop" },
    { label: "Telegram", href: "https://t.me/samouraicoop" },
    { label: "Videos", href: "https://samourai.tv/" },
    { label: "Source on GitHub", href: SOURCE },
] as const

export const LICENSE_URL = `${SOURCE}/blob/main/LICENSE`

/** The document's entry is the bundle this tab actually booted, even if a service worker holds an older build. */
export function bootEntryPath(): string | null {
    return document.querySelector<HTMLScriptElement>('script[type="module"][src^="/assets/index-"]')?.getAttribute("src") ?? null
}

/** Only metadata for this version and this tab's entry bundle can identify its commit. */
export function buildCommit(value: unknown, bootEntry: string | null): string | null {
    if (!value || typeof value !== "object") return null
    const info = value as { version?: unknown; commit?: unknown; entry?: unknown }
    return info.version === APP_VERSION
        && typeof info.entry === "string" && /^assets\/index-[A-Za-z0-9_-]+\.js$/.test(info.entry)
        && bootEntry === `/${info.entry}`
        && typeof info.commit === "string" && /^[a-f0-9]{40}$/i.test(info.commit)
        ? info.commit.slice(0, 8)
        : null
}
