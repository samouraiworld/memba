import { afterEach, describe, expect, it, vi } from 'vitest'
const id = 'ab'.repeat(16)
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
async function modules(enabled: boolean) {
    vi.resetModules(); vi.stubEnv('VITE_ENABLE_NOTES', String(enabled))
    const [apps, registry, paths, windows, urls] = await Promise.all([import('../apps'), import('../native/registry'), import('./osPath'), import('./windows'), import('./urlSync')])
    return { apps, registry, paths, windows, urls }
}
describe('Notes registration, paths and saved windows', () => {
    it('keeps the folder registered while the disabled app and links remain unavailable', async () => {
        const { apps, registry, paths, urls } = await modules(false)
        expect(apps.OS_APPS.some(app => app.id === 'notes')).toBe(false)
        expect(registry.unknownNativeFolders(['../apps/notes/native.tsx'])).toEqual([])
        expect(paths.parseOsPath('/os/notes')).toMatchObject({ kind: 'unknown' })
        expect(paths.parseOsPath(`/os/notes/${id}`)).toMatchObject({ kind: 'unknown' })
        expect(urls.tokenToTarget('app.notes')).toBeNull(); expect(urls.tokenToTarget(`notes.${id}`)).toBeNull()
    })
    it('round-trips the public library and validated note IDs without changing other app families', async () => {
        const { apps, registry, paths, windows, urls } = await modules(true)
        expect(apps.OS_APPS.some(app => app.id === 'notes')).toBe(true)
        expect(apps.appsOn(apps.OS_APPS, 'evm').some(app => app.id === 'notes')).toBe(false)
        expect(registry.nativeModuleKeys()).toContain('../apps/notes/native.tsx')
        for (const section of [null, id]) {
            const path = `/os/notes${section ? `/${section}` : ''}`, target = paths.parseOsPath(path)
            expect(target).toEqual({ kind: 'app', app: 'notes', section })
            const token = urls.windowToken(target); expect(token).toBe(section ? `notes.${id}` : 'app.notes')
            expect(urls.tokenToTarget(token!)).toEqual(target)
            expect(windows.appSpec('notes', section)).toMatchObject({ key: section ? `notes:${id}` : 'app:notes', target })
        }
        for (const path of ['/os/radio', '/os/meet', '/os/news']) expect(paths.parseOsPath(path).kind).toBe('app')
    })
    it('rejects malformed/traversal note paths and saved tokens', async () => {
        const { paths, urls } = await modules(true)
        for (const suffix of ['abc', id.toUpperCase(), `${id}/extra`, '../wallet', '%2e%2e', '0'.repeat(31)]) expect(paths.parseOsPath(`/os/notes/${suffix}`).kind).toBe('unknown')
        for (const token of ['notes.', `notes.${id}/extra`, `notes.${id.toUpperCase()}`, 'notes...wallet']) expect(urls.tokenToTarget(token)).toBeNull()
        expect(urls.windowToken({ kind: 'app', app: 'notes', section: '../wallet' })).toBeNull()
    })
})
