import '@testing-library/jest-dom'

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
