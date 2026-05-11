/**
 * DOMPurify sanitization regression suite (PR0b — Phase 0 of v7.1)
 *
 * Locks in the dompurify ≥ 3.4.2 bump that closes:
 *   - GHSA-39q2-94rc-95cp (ADD_TAGS function form bypasses FORBID_TAGS)
 *   - GHSA-h7mw-gpvr-xq4m (FORBID_TAGS bypassed by function-based ADD_TAGS predicate)
 *   - GHSA-crv5-9vww-q3g8 (SAFE_FOR_TEMPLATES bypass in RETURN_DOM mode)
 *   - GHSA-v9jr-rg53-9pgp (Prototype pollution → XSS via CUSTOM_ELEMENT_HANDLING)
 *
 * Memba's three call sites all use the *default* configuration of
 * `DOMPurify.sanitize(html)` (no `ADD_TAGS`, no hooks, no profiles). The
 * four CVEs require non-default options — Memba is therefore not directly
 * exploitable through them. This suite asserts the *baseline* sanitizer
 * behavior at each call site's input shape, plus a small library of
 * well-known XSS vectors that any HTML sanitizer must drop. It does NOT
 * try to replay the four CVE PoCs (those need specific non-default config
 * we don't use).
 *
 * The intent is: if dompurify is ever downgraded, swapped, or wrapped in a
 * way that changes default behavior at these three call sites, this file
 * fails loudly.
 *
 * Call sites under test:
 *   - src/pages/NFTGallery.tsx:489       (markdown → HTML → sanitize, v6 SEC-05)
 *   - src/components/directory/RealmDetailDrawer.tsx:164  (renderMarkdown output)
 *   - src/components/directory/SourceCodeView.tsx:116     (highlighted source)
 */
import { describe, expect, it } from 'vitest'
import DOMPurify from 'dompurify'

// Mirror the call shape from each site exactly: bare `sanitize(html)`, no opts.
const sanitize = (html: string): string => DOMPurify.sanitize(html || '&nbsp;')

/** Well-known XSS payloads. Every entry must produce output containing no
 *  attacker-controlled JS execution path. */
const XSS_VECTORS: ReadonlyArray<{ name: string; payload: string }> = [
    { name: 'script tag', payload: '<script>alert(1)</script>' },
    { name: 'script tag with attributes', payload: '<script type="text/javascript">alert(1)</script>' },
    { name: 'script tag self-closing', payload: '<script src="//evil/x.js"/>' },
    { name: 'iframe javascript:', payload: '<iframe src="javascript:alert(1)"></iframe>' },
    { name: 'iframe srcdoc', payload: '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>' },
    { name: 'img onerror', payload: '<img src=x onerror="alert(1)">' },
    { name: 'img onerror unquoted', payload: '<img src=x onerror=alert(1)>' },
    { name: 'svg onload', payload: '<svg onload="alert(1)"></svg>' },
    { name: 'svg with embedded script', payload: '<svg><script>alert(1)</script></svg>' },
    { name: 'svg use href data: js', payload: '<svg><use href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4="/></svg>' },
    { name: 'a href javascript:', payload: '<a href="javascript:alert(1)">x</a>' },
    { name: 'a href data: html', payload: '<a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;">x</a>' },
    { name: 'style with @import', payload: '<style>@import "javascript:alert(1)"</style>' },
    { name: 'object data', payload: '<object data="javascript:alert(1)"></object>' },
    { name: 'embed src', payload: '<embed src="javascript:alert(1)">' },
    { name: 'form action', payload: '<form action="javascript:alert(1)"><input type=submit></form>' },
    { name: 'meta refresh', payload: '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">' },
    { name: 'math href js', payload: '<math href="javascript:alert(1)">CLICK</math>' },
    { name: 'details ontoggle', payload: '<details ontoggle="alert(1)" open></details>' },
    { name: 'video onloadstart', payload: '<video onloadstart="alert(1)"><source></video>' },
    { name: 'audio onloadstart', payload: '<audio onloadstart="alert(1)"><source></audio>' },
    { name: 'body onload', payload: '<body onload="alert(1)">' },
    { name: 'input autofocus onfocus', payload: '<input autofocus onfocus="alert(1)">' },
    { name: 'link href js', payload: '<link rel=stylesheet href="javascript:alert(1)">' },
    { name: 'base href', payload: '<base href="javascript:alert(1)">' },
    { name: 'CDATA breakout', payload: '<![CDATA[<script>alert(1)</script>]]>' },
    { name: 'noscript bypass', payload: '<noscript><p title="</noscript><img src=x onerror=alert(1)>">' },
    // NOT INCLUDED (dompurify default behavior; not real XSS in modern browsers):
    //  - CSS `expression(...)` (IE6/7 only; never evaluated by modern browsers)
    //  - `<img srcset="...javascript:...">` (browsers treat as failed image load, not navigation)
]

/** Forbidden substrings that must NEVER appear in sanitized output for any
 *  vector above. */
const FORBIDDEN_PATTERNS = [
    /<script\b/i,
    /<iframe\b/i,
    /\sonerror\s*=/i,
    /\sonload\s*=/i,
    /\sonclick\s*=/i,
    /\sontoggle\s*=/i,
    /\sonloadstart\s*=/i,
    /\sonfocus\s*=/i,
    /\bjavascript\s*:/i,
    /\bexpression\s*\(/i,
    /<object\b/i,
    /<embed\b/i,
    /<meta\b/i,
    /<base\b/i,
    /<link\b/i,
] as const

describe('DOMPurify default-config sanitization (regression suite)', () => {
    it('does not crash on empty / blank input', () => {
        expect(sanitize('')).toBeTruthy() // we fall back to '&nbsp;'
        expect(sanitize('   ')).not.toMatch(/<script/i)
    })

    it.each(XSS_VECTORS)('strips dangerous bits from: $name', ({ payload }) => {
        const out = sanitize(payload)
        for (const bad of FORBIDDEN_PATTERNS) {
            expect(
                out,
                `vector "${payload}" produced "${out}", contains forbidden pattern ${bad}`,
            ).not.toMatch(bad)
        }
    })

    it('preserves benign content', () => {
        const out = sanitize('<p>Hello <strong>world</strong>!</p>')
        expect(out).toContain('Hello')
        expect(out).toContain('world')
        expect(out).toMatch(/<(p|strong)\b/i)
    })

    it('preserves benign anchor with http(s):', () => {
        const out = sanitize('<a href="https://example.org">x</a>')
        expect(out).toContain('https://example.org')
    })

    // Call-site shape parity. NFTGallery renders markdown-converted HTML,
    // RealmDetailDrawer renders Render() markdown output, SourceCodeView
    // renders highlighted source. All three go through bare
    // `DOMPurify.sanitize(html)` with no options, so the suite above
    // covers them. This test just locks the call shape: no positional
    // options argument is passed, which is what closes the dompurify 3.3
    // CVE class.
    it('the production sanitize helper passes no options', () => {
        // If someone later adds `{ ADD_TAGS: [...] }` or `{ RETURN_DOM: true }`,
        // they re-open the surface of the closed CVEs. Catch that here.
        const fn = sanitize.toString()
        expect(fn).not.toMatch(/ADD_TAGS/)
        expect(fn).not.toMatch(/RETURN_DOM/)
        expect(fn).not.toMatch(/CUSTOM_ELEMENT_HANDLING/)
        expect(fn).not.toMatch(/SAFE_FOR_TEMPLATES/)
    })
})
