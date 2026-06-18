import type { ReactElement } from "react"
import { render } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { vi } from "vitest"
import type { LayoutContext } from "../types/layout"

export interface RenderOptions {
    route?: string
}

export function renderWithProviders(ui: ReactElement, opts: RenderOptions = {}) {
    const { route = "/" } = opts
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[route]}>
                {ui}
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

export function mockLayoutContext(overrides?: Partial<LayoutContext>): LayoutContext {
    const base: LayoutContext = {
        adena: {
            connected: false,
            address: "",
            pubkeyJSON: "",
            chainId: "",
            installed: false,
            loading: false,
            connect: vi.fn().mockResolvedValue(false),
            disconnect: vi.fn(),
            signArbitrary: vi.fn().mockResolvedValue(null),
        },
        balance: "0",
        auth: {
            token: null,
            isAuthenticated: false,
            address: "",
            loading: false,
            error: null,
        },
        isLoggingIn: false,
        syncTimedOut: false,
    }

    if (!overrides) return base

    return {
        ...base,
        ...overrides,
        adena: { ...base.adena, ...overrides.adena },
        auth: { ...base.auth, ...overrides.auth },
    }
}
