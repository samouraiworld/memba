import { describe, expect, it } from 'vitest'
import { professionalPage } from './proApp'
import { professionalBrandHtml } from './proBrand'
describe('professional route layout policy', () => {
    it.each([
        ['/mainnet/validators', 'network', 'workspace'], ['/onyx/dao/gno.land/r/gov/dao', 'governance', 'workspace'],
        ['/onyx/dao/gno.land/r/gov/dao/treasury/propose', 'creation', 'form'], ['/onyx/create', 'creation', 'form'],
        ['/onyx/dao/gno.land/r/gov/dao/channels', 'governance', 'social'], ['/onyx/game/barricade', 'games', 'immersive'],
        ['/onyx/blog/mainnet', 'editorial', 'reading'], ['/onyx/nft/create/advanced', 'creation', 'form'],
        ['/onyx/services', 'commerce', 'workspace'], ['/unknown/validators', 'system', 'reading'],
        // A retired network (pearl) is no network: like an unknown key, it gets the system page.
        ['/pearl/validators', 'system', 'reading'],
    ])('%s has an intentional reading measure', (path, family, layout) => expect(professionalPage(path)).toEqual({ family, layout }))
    it('substitutes only approved brand asset URLs', () => {
        const html = '<meta content="/og-image.jpg"><meta content="image/jpeg"><link href="/memba-icon.png"><link href="/apple-touch-icon.png"><script src="/app.js"></script>'
        const result = professionalBrandHtml(html)
        expect(result).toContain('/brand/folded-m/share.png')
        expect(result).toContain('/brand/folded-m/favicon-32.png')
        expect(result).toContain('/brand/folded-m/apple-touch-icon.png')
        expect(result).toContain('<script src="/app.js"></script>')
    })
})
