import type { ComponentProps } from "react"
import { act, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { subscribeTheme } from "../lib/themeStore"
import OsRoot from "./OsRoot"
import { OS_THEME_KEY } from "./theme"
import { Shell } from "./shell/Shell"
import type { ArcadeFreePlayDeployment } from "./arcadeFreePlayDeployment"
import * as freePlayClient from "../lib/arcadeFreePlay"
import * as freePlayAuth from "../games/arcade/freeplay/osAuth"

const deploymentFixture = vi.hoisted(() => ({ deployment: null as ArcadeFreePlayDeployment | null, probe: false }))
vi.mock("./arcadeFreePlayDeployment", async original => ({
    ...(await original<typeof import("./arcadeFreePlayDeployment")>()),
    get ARCADE_FREE_PLAY_DEPLOYMENT() { return deploymentFixture.deployment },
}))
vi.mock("./shell/Shell", async original => {
    const actual = await original<typeof import("./shell/Shell")>()
    return { ...actual, Shell: vi.fn((props: ComponentProps<typeof actual.Shell>) => deploymentFixture.probe
        ? <div data-testid="shell-probe" /> : <actual.Shell {...props} />) }
})

function mockSystemDark(dark: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
        matches: dark && query.includes("dark"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
    }))
}

function renderOs() {
    // main.tsx supplies this in the app; the shell's Live polling uses it.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={["/os"]}><OsRoot /></MemoryRouter></QueryClientProvider>
    const view = render(tree())
    return { ...view, rerenderOs: () => view.rerender(tree()) }
}

afterEach(() => {
    deploymentFixture.deployment = null
    deploymentFixture.probe = false
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
})

describe("OsRoot", () => {
    it("renders the empty desktop in light when the system is light", () => {
        mockSystemDark(false)
        renderOs()
        expect(screen.getByTestId("memba-os")).toHaveAttribute("data-os-theme", "light")
        expect(screen.getByRole("dialog", { name: "Welcome to Memba" })).toBeInTheDocument()
        expect(screen.getByRole("banner", { hidden: true })).toHaveAttribute("inert")
        expect(screen.getByRole("main", { hidden: true })).toHaveAttribute("inert")
    })

    it("renders dark when the system is dark", () => {
        mockSystemDark(true)
        renderOs()
        expect(screen.getByTestId("memba-os")).toHaveAttribute("data-os-theme", "dark")
    })

    it("lets the stored per-device choice win over the system", () => {
        mockSystemDark(true)
        localStorage.setItem(OS_THEME_KEY, "light")
        renderOs()
        expect(screen.getByTestId("memba-os")).toHaveAttribute("data-os-theme", "light")
    })

    it("paints the classic pages in the OS theme and restores the page theme on unmount", () => {
        document.documentElement.setAttribute("data-theme", "dark")
        mockSystemDark(false)
        const { unmount } = renderOs()
        expect(document.documentElement).toHaveAttribute("data-theme", "light")
        unmount()
        expect(document.documentElement).toHaveAttribute("data-theme", "dark")
    })

    it("keeps the OS theme when a classic control changes the page theme", () => {
        mockSystemDark(false)
        renderOs()
        act(() => {
            document.documentElement.setAttribute("data-theme", "dark")
            window.dispatchEvent(new Event("memba:theme-change"))
        })
        expect(document.documentElement).toHaveAttribute("data-theme", "light")
    })

    it("notifies a themeStore subscriber when the OS overrides the theme, and again on unmount", () => {
        document.documentElement.setAttribute("data-theme", "dark")
        mockSystemDark(false)
        const listener = vi.fn()
        const unsubscribe = subscribeTheme(listener)
        const { unmount } = renderOs()
        expect(listener).toHaveBeenCalledTimes(1)
        expect(document.documentElement).toHaveAttribute("data-theme", "light")

        unmount()
        expect(listener).toHaveBeenCalledTimes(2)
        expect(document.documentElement).toHaveAttribute("data-theme", "dark")
        unsubscribe()
    })

    it("removes data-theme on unmount when there was none before mount", () => {
        document.documentElement.removeAttribute("data-theme")
        mockSystemDark(false)
        const { unmount } = renderOs()
        expect(document.documentElement).toHaveAttribute("data-theme", "light")

        unmount()
        expect(document.documentElement).not.toHaveAttribute("data-theme")
    })

    it("syncs a stored theme change from another tab and restores the page theme on unmount", () => {
        document.documentElement.setAttribute("data-theme", "sepia")
        mockSystemDark(false)
        const { unmount } = renderOs()
        expect(document.documentElement).toHaveAttribute("data-theme", "light")

        act(() => {
            localStorage.setItem(OS_THEME_KEY, "dark")
            window.dispatchEvent(new StorageEvent("storage", { key: OS_THEME_KEY }))
        })
        expect(document.documentElement).toHaveAttribute("data-theme", "dark")

        unmount()
        expect(document.documentElement).toHaveAttribute("data-theme", "sepia")
    })
})


describe("OsRoot reviewed Free play deployment wiring", () => {
    it("passes null without constructing a second auth/client owner", () => {
        deploymentFixture.probe = true
        mockSystemDark(false)
        const createClient = vi.spyOn(freePlayClient, "createFreePlayClient")
        const createAuth = vi.spyOn(freePlayAuth, "createOsFreePlayAuth")
        const view = renderOs()
        view.rerenderOs()
        expect(screen.getAllByTestId("shell-probe")).toHaveLength(1)
        for (const [props] of vi.mocked(Shell).mock.calls) expect(props?.freePlayConfiguration).toBeNull()
        expect(createClient).not.toHaveBeenCalled()
        expect(createAuth).not.toHaveBeenCalled()
    })

    it("injects validated host storage with a stable configuration across appearance rerenders", () => {
        deploymentFixture.probe = true
        deploymentFixture.deployment = { chainId: "test-chain", games: {
            "block-party": { rules: "bp-free-standard-undo-v1", simVersion: 1 },
        } }
        mockSystemDark(false)
        const createClient = vi.spyOn(freePlayClient, "createFreePlayClient")
        const createAuth = vi.spyOn(freePlayAuth, "createOsFreePlayAuth")
        const view = renderOs()
        const configuration = vi.mocked(Shell).mock.calls[0][0]?.freePlayConfiguration
        expect(configuration).toEqual({ ...deploymentFixture.deployment, storage: localStorage })
        act(() => {
            localStorage.setItem(OS_THEME_KEY, "dark")
            window.dispatchEvent(new StorageEvent("storage", { key: OS_THEME_KEY }))
        })
        view.rerenderOs()
        expect(screen.getByTestId("memba-os")).toHaveAttribute("data-os-theme", "dark")
        expect(vi.mocked(Shell).mock.calls.length).toBeGreaterThan(1)
        for (const [props] of vi.mocked(Shell).mock.calls) expect(props?.freePlayConfiguration).toBe(configuration)
        expect(createClient).not.toHaveBeenCalled()
        expect(createAuth).not.toHaveBeenCalled()
    })
})
