/**
 * YourWorldsDoor.test.tsx
 *
 * Card rendering for one saved world:
 *   - name + member count + open-proposal chip
 *   - honest "no open proposals" when there are none
 *   - role eyebrow when known, "dao" fallback otherwise
 *   - members omitted (never "0") when absent
 *   - degraded world keeps its name + a "couldn't reach chain" note
 */

import { describe, it, expect } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../../../test/test-utils"
import { YourWorldsDoor } from "./YourWorldsDoor"
import type { YourWorld } from "../../../hooks/home/useYourWorlds"

const base: YourWorld = { name: "GovDAO", href: "/test13/dao/gno.land/r/gov/dao" }

describe("YourWorldsDoor", () => {
    it("renders the DAO name", () => {
        renderWithProviders(<YourWorldsDoor world={base} />)
        expect(screen.getByText("GovDAO")).toBeInTheDocument()
    })

    it("renders member count and the open-proposal chip", () => {
        renderWithProviders(<YourWorldsDoor world={{ ...base, members: 128, openCount: 3 }} />)
        expect(screen.getByText(/128 members/)).toBeInTheDocument()
        expect(screen.getByText("3 open")).toBeInTheDocument()
    })

    it("uses the singular 'member' for a count of 1", () => {
        renderWithProviders(<YourWorldsDoor world={{ ...base, members: 1 }} />)
        expect(screen.getByText(/1 member$/)).toBeInTheDocument()
    })

    it("shows 'no open proposals' when openCount is absent", () => {
        renderWithProviders(<YourWorldsDoor world={{ ...base, members: 42 }} />)
        expect(screen.getByText("no open proposals")).toBeInTheDocument()
    })

    it("omits the member line entirely when members is absent (never '0')", () => {
        renderWithProviders(<YourWorldsDoor world={base} />)
        expect(screen.queryByText(/members?$/)).not.toBeInTheDocument()
    })

    it("shows the role as the eyebrow when known", () => {
        renderWithProviders(<YourWorldsDoor world={{ ...base, role: "admin" }} />)
        expect(screen.getByText("admin")).toBeInTheDocument()
    })

    it("falls back to a 'dao' eyebrow when role is unknown", () => {
        renderWithProviders(<YourWorldsDoor world={base} />)
        expect(screen.getByText("dao")).toBeInTheDocument()
    })

    it("degraded world keeps its name and shows a reach note", () => {
        renderWithProviders(<YourWorldsDoor world={{ ...base, degraded: true }} />)
        expect(screen.getByText("GovDAO")).toBeInTheDocument()
        expect(screen.getByText(/couldn't reach chain/)).toBeInTheDocument()
    })
})
