import '@testing-library/jest-dom'
import { configure } from '@testing-library/react'

// CI-hardening: `npm test` runs the whole suite (400+ files) as one `vitest run`,
// which loads the runner heavily — and testing-library's default 1000ms async
// timeout occasionally starves under that load, so a correct `waitFor`/`findBy`
// times out and fails an unrelated PR at random (observed: AppCurator "approve",
// Node-20 leg). Raise the default globally so a loaded runner has headroom; a real
// hang still fails at 5s. Individual tests can still pass a shorter/longer timeout.
configure({ asyncUtilTimeout: 5000 })

// Mock localStorage for tests that need it
const localStorageMock = (() => {
    let store: Record<string, string> = {}
    return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value },
        removeItem: (key: string) => { delete store[key] },
        clear: () => { store = {} },
        get length() { return Object.keys(store).length },
        key: (i: number) => Object.keys(store)[i] ?? null,
    }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

// Reset localStorage between tests
beforeEach(() => {
    localStorage.clear()
})
