/**
 * RealmsNotDeployedBanner.test.tsx — the honest "Memba isn't on this network yet"
 * notice. Shown when the active network is reachable/official but Memba's own
 * realms are not deployed there (e.g. test13 at cutover), so DAO/channel features
 * would otherwise 404 silently.
 */

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { RealmsNotDeployedBanner } from "./RealmsNotDeployedBanner"

describe("RealmsNotDeployedBanner", () => {
    it("renders nothing when realms are deployed on the active network", () => {
        const { container } = render(
            <RealmsNotDeployedBanner deployed={true} networkLabel="Testnet 12" />,
        )
        expect(container).toBeEmptyDOMElement()
    })

    it("shows a notice naming the network when realms are not deployed", () => {
        render(<RealmsNotDeployedBanner deployed={false} networkLabel="Testnet 13" />)
        const status = screen.getByRole("status")
        expect(status).toHaveTextContent(/Testnet 13/)
        expect(status).toHaveTextContent(/community realms .* are not on Testnet 13 yet/i)
        expect(status).toHaveTextContent(/You can read GovDAO and DAOs deployed by their members/)
    })

    it("names only the features that are missing on a partial rollout", () => {
        render(<RealmsNotDeployedBanner deployed={false} networkLabel="gno.land" missing={["channels", "candidature"]} />)
        const status = screen.getByRole("status")
        expect(status).toHaveTextContent(/community realms for channels and candidature are not on gno\.land yet/i)
        expect(status).not.toHaveTextContent(/feed|quests/)
    })

    it("uses the singular for a single missing feature", () => {
        render(<RealmsNotDeployedBanner deployed={false} networkLabel="gno.land" missing={["channels"]} />)
        expect(screen.getByRole("status")).toHaveTextContent(/community realm for channels is not on gno\.land yet/i)
    })

    it("renders nothing when no community feature is missing", () => {
        const { container } = render(<RealmsNotDeployedBanner deployed={false} networkLabel="gno.land" missing={[]} />)
        expect(container).toBeEmptyDOMElement()
    })
})
