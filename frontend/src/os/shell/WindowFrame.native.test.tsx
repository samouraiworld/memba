import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import type { OsSession } from "./useOsSession"
import type { OsWindow } from "./windows"
import { WindowBody } from "./WindowFrame"

// A native view that only shows what Body hands it: whatever Body would have drawn
// without a native view. For a guest on a wallet page, that must be the Connect tile.
vi.mock("../native/registry", () => {
    const Native = ({ fallback }: { fallback: ReactNode }) => <div data-testid="native">{fallback}</div>
    return { nativeView: (app: string) => (app === "profile" ? Native : undefined) }
})
vi.mock("../page/ClassicPage", () => ({ ClassicPage: () => <div>classic profile page</div> }))

const session = {
    status: "guest",
    network: { key: "gnoland-1" },
    layout: {},
    openConnect: vi.fn(),
} as unknown as OsSession

const win: OsWindow = {
    id: "w1", key: "app:profile", title: "Profile", app: "profile",
    x: 0, y: 0, width: 600, height: 400, z: 1, min: false, max: false,
    target: { kind: "app", app: "profile", section: null },
}

describe("WindowBody with a native view", () => {
    it("hands a guest the Connect tile, never the wallet-only classic page", async () => {
        render(<WindowBody win={win} session={session} open={vi.fn()} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} />)
        const native = await screen.findByTestId("native")
        expect(native).toHaveTextContent("Connect a wallet to use Profile.")
        expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument()
        expect(screen.queryByText("classic profile page")).not.toBeInTheDocument()
    })

    it("hands a member the classic page", async () => {
        const member = { ...session, status: "member" } as unknown as OsSession
        render(<WindowBody win={win} session={member} open={vi.fn()} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} />)
        expect(await screen.findByText("classic profile page")).toBeInTheDocument()
        expect(screen.getByTestId("native")).toContainElement(screen.getByText("classic profile page"))
        expect(screen.queryByText("Connect a wallet to use Profile.")).not.toBeInTheDocument()
    })
})
