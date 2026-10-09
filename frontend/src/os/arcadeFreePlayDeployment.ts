import { validateArcadeFreePlayConfiguration, type ArcadeFreePlayConfiguration } from "../games/arcade/freeplay/runtimeConfiguration"
import type { SnapshotStorage } from "../games/arcade/freeplay/snapshot"

/** Reviewed public build input only. Storage and session authority belong to the host. */
export type ArcadeFreePlayDeployment = Omit<ArcadeFreePlayConfiguration, "storage">

/** Deliberately disabled. Activation requires a separately reviewed manifest and rebuild.
 * Never populate this from an environment variable, URL, saved run or remote response. */
export const ARCADE_FREE_PLAY_DEPLOYMENT: ArcadeFreePlayDeployment | null = null

// The existing validator only inspects these methods. This object is never
// returned or used as fallback storage: invalid manifests need no browser access.
const validationStorage: SnapshotStorage = {
    getItem: () => { throw new Error("validation_only_storage") },
    setItem: () => { throw new Error("validation_only_storage") },
}

/** Fail closed without reading/writing snapshots or constructing auth/clients.
 * The lazy accessor is not called at all when disabled or the manifest is invalid.
 * OsRoot retains the returned configuration for its mounted lifetime. */
export function resolveArcadeFreePlayDeployment(
    deployment: ArcadeFreePlayDeployment | null,
    getStorage: () => SnapshotStorage,
): ArcadeFreePlayConfiguration | null {
    if (deployment === null) return null
    try {
        validateArcadeFreePlayConfiguration({ ...deployment, storage: validationStorage })
        const configuration: ArcadeFreePlayConfiguration = { ...deployment, storage: getStorage() }
        validateArcadeFreePlayConfiguration(configuration)
        return configuration
    } catch {
        // Refused storage or invalid build input does not acquire another authority.
        return null
    }
}
