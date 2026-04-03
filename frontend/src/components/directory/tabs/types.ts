/**
 * Shared types for Directory tab components.
 * @module components/directory/tabs/types
 */

import type { useNetworkNav } from "../../../hooks/useNetworkNav"

export type NavigateFn = ReturnType<typeof useNetworkNav>

export interface TabProps {
    navigate: NavigateFn
}
