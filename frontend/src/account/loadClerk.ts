/**
 * Loads Clerk from the instance's own domain (the publishable key names it,
 * e.g. clerk.memba.club), as Clerk's JavaScript quickstart does: its client
 * and its sign-in UI are browser bundles fetched only when someone signs in,
 * so nothing of Clerk is in Memba's bundle or its offline precache. The CSP
 * allows that host in script-src.
 *
 * @module account/loadClerk
 */
import type { AccountUser } from "./accountContext"

/** Clerk's major versions this code is written against. */
const CLERK_JS = "@clerk/clerk-js@6/dist/clerk.browser.js"
const CLERK_UI = "@clerk/ui@1/dist/ui.browser.js"

/** Clerk's dark theme (@clerk/ui/themes `dark`), whose variables are all it sets for these forms. */
const DARK = {
    colorBackground: "#212126",
    colorNeutral: "white",
    colorPrimary: "#ffffff",
    colorPrimaryForeground: "black",
    colorForeground: "white",
    colorInputForeground: "white",
    colorInput: "#26262B",
}

/** The part of Clerk Memba uses. */
export interface ClerkClient {
    user: AccountUser | null
    onChange: (listener: (user: AccountUser | null) => void) => () => void
    openSignIn: () => void
    getToken: () => Promise<string | null>
    signOut: () => Promise<void>
}

type ClerkUserResource = { id: string; fullName: string | null; primaryEmailAddress?: { emailAddress: string } | null; publicMetadata?: Record<string, unknown> }
interface ClerkGlobal {
    load: (options: object) => Promise<void>
    user?: ClerkUserResource | null
    session?: { getToken: () => Promise<string | null> } | null
    addListener: (listener: (state: { user?: ClerkUserResource | null }) => void) => () => void
    openSignIn: () => void
    signOut: () => Promise<void>
}
declare global {
    interface Window { Clerk?: ClerkGlobal; __internal_ClerkUICtor?: unknown }
}

function toUser(u: ClerkUserResource | null | undefined): AccountUser | null {
    return u ? { id: u.id, email: u.primaryEmailAddress?.emailAddress ?? null, fullName: u.fullName, isAdmin: u.publicMetadata?.role === "admin" } : null
}

/** pk_live_<base64("clerk.memba.club$")> → "clerk.memba.club". */
export function frontendApiHost(publishableKey: string): string {
    const host = atob(publishableKey.split("_")[2] ?? "").replace(/\$$/, "")
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) throw new Error("The Clerk publishable key names no host")
    return host
}

function script(src: string, attrs: Record<string, string> = {}): Promise<void> {
    return new Promise((resolve, reject) => {
        const el = document.createElement("script")
        el.src = src
        el.async = true
        el.crossOrigin = "anonymous"
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
        el.onload = () => resolve()
        el.onerror = () => reject(new Error(`${src} did not load`))
        document.head.appendChild(el)
    })
}

export async function loadClerk(publishableKey: string): Promise<ClerkClient> {
    const host = frontendApiHost(publishableKey)
    await Promise.all([
        script(`https://${host}/npm/${CLERK_UI}`),
        script(`https://${host}/npm/${CLERK_JS}`, { "data-clerk-publishable-key": publishableKey }),
    ])
    const clerk = window.Clerk
    if (!clerk || !window.__internal_ClerkUICtor) throw new Error("Clerk's scripts loaded without defining Clerk")
    await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor }, appearance: { variables: DARK } })
    return {
        get user() { return toUser(clerk.user) },
        onChange: (listener) => clerk.addListener(({ user }) => listener(toUser(user))),
        openSignIn: () => clerk.openSignIn(),
        getToken: async () => (await clerk.session?.getToken()) ?? null,
        signOut: () => clerk.signOut(),
    }
}
