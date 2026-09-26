/** Token window availability state until the native token app is built. */
import { GNO_CHAIN_ID, GRC20_FACTORY_PATH, NETWORKS, isRealmValidOn } from "../../../lib/config"
import { Pill } from "../../kit"
import type { NativeViewProps } from "../../native/types"

export default function TokensWindow({ session, fallback }: NativeViewProps) {
    if (isRealmValidOn(session.network.key, GRC20_FACTORY_PATH)) return <>{fallback}</>
    const chainId = NETWORKS[session.network.key]?.chainId ?? GNO_CHAIN_ID

    return (
        <div className="os-stack">
            <div className="os-note os-warn" role="note">
                <Pill tone="neutral">Token creation unavailable here</Pill>{" "}
                Memba&rsquo;s token factory and creation screens are implemented, but the factory is {session.network.key === "mainnet" ? "not deployed" : "not available"} on {chainId}. Creation and Memba factory-token listings are unavailable here.
            </div>
        </div>
    )
}
