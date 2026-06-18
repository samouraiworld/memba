import { useOutletContext } from "react-router-dom"
import type { LayoutContext } from "../../types/layout"

export function StudioHome() {
    const { adena } = useOutletContext<LayoutContext>()
    const me = adena?.address || ""
    if (me === "") {
        return (
            <div className="studio-page">
                <p>Connect your wallet to open the Studio.</p>
            </div>
        )
    }
    return (
        <div className="studio-page">
            <h1>Studio</h1>
        </div>
    )
}
