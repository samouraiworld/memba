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
        expect(status).toHaveTextContent(/not.*deployed|coming soon|isn't on/i)
    })
})
