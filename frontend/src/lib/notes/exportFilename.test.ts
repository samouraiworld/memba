import { describe, expect, it } from 'vitest'
import { noteExportFilename } from './exportFilename'

describe('Markdown export file names', () => {
    it.each([
        ['Sushi recipe', 'Sushi recipe.md'],
        ['  Sushi   (Onyx canary,\tedited by B)  ', 'Sushi (Onyx canary, edited by B).md'],
        ['Recipes/sushi\\maki', 'Recipes-sushi-maki.md'],
        ['a<b>c:d"e|f?g*h', 'a-b-c-d-e-f-g-h.md'],
        ['Zero​width\u0000and\u001fcontrols', 'Zerowidthandcontrols.md'],
        ['../../etc/passwd', 'etc-passwd.md'],
        ['...hidden.', 'hidden.md'],
        ['Café 😀', 'Café 😀.md'],
        ['CON', 'CON-note.md'],
        ['lpt9.txt', 'lpt9-note.txt.md'],
        ['Aux.Notes', 'Aux-note.Notes.md'],
        ['COM1. Setup', 'COM1-note. Setup.md'],
        ['', 'note.md'],
        [' / \\ ', 'note.md'],
        ['​', 'note.md'],
    ])('names %j as %j', (title, expected) => {
        expect(noteExportFilename(title)).toBe(expected)
    })
    it('bounds the name in UTF-8 bytes without splitting a character', () => {
        const name = noteExportFilename('😀'.repeat(80))
        expect(name.endsWith('.md')).toBe(true)
        expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(103)
        expect(name).toBe('😀'.repeat(25) + '.md')
        expect(noteExportFilename('a'.repeat(99) + ' b')).toBe('a'.repeat(99) + '.md')
    })
})
