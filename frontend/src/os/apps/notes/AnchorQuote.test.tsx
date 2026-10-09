import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnchorQuote } from './AnchorQuote'
const previews: HTMLElement[] = []
function preview(html: string, rendered = 'html') { const root = document.createElement('article'); root.dataset.rendered = rendered; root.innerHTML = html; document.body.append(root); previews.push(root); return root }
afterEach(() => { previews.splice(0).forEach(root => root.remove()); window.getSelection()?.removeAllRanges() })
describe('accessible quote location', () => {
    it('shows the quote as text, reports old revisions and selects a unique rendered match', async () => {
        const root = preview('<p>A <strong>private quote</strong> here</p>')
        render(<AnchorQuote quote="private quote" bodyRevision="1" currentBodyRevision="2" previewRoot={root} />)
        const button = await screen.findByRole('button', { name: 'Show quoted text' })
        expect(screen.getByRole('status')).toHaveTextContent('earlier body revision'); fireEvent.click(button)
        expect(window.getSelection()?.toString()).toBe('private quote')
        expect(root.querySelector('strong')).toHaveFocus()
        button.focus(); expect(root.querySelector('strong')).not.toHaveAttribute('tabindex')
        expect(document.querySelector('[data-quote]')).toBeNull()
    })
    it('reacts to loading, rendered, changed and raw fallback DOM updates', async () => {
        const root = preview('<pre>quote</pre>', 'loading')
        render(<AnchorQuote quote="quote" bodyRevision="1" currentBodyRevision="1" previewRoot={root} />)
        expect(screen.getByRole('status')).toHaveTextContent('has not been checked')
        await act(async () => { root.innerHTML = '<p>quote</p>'; root.dataset.rendered = 'html' })
        await screen.findByRole('button', { name: 'Show quoted text' })
        await act(async () => { root.innerHTML = '<p>removed</p>' })
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('not found'))
        await act(async () => { root.innerHTML = '<pre>quote</pre>'; root.dataset.rendered = 'text' })
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('has not been checked'))
        expect(screen.queryByRole('button')).toBeNull()
    })
    it('rechecks synchronously at click so stale match ranges never select replacement text', async () => {
        const root = preview('<p>quote</p>')
        render(<AnchorQuote quote="quote" bodyRevision="1" currentBodyRevision="1" previewRoot={root} />)
        const button = await screen.findByRole('button', { name: 'Show quoted text' })
        root.innerHTML = '<p>replacement</p>'; fireEvent.click(button)
        expect(window.getSelection()?.toString()).toBe(''); expect(screen.getByRole('status')).toHaveTextContent('not found')
    })
    it('keeps ambiguous quotes navigationally inactive and never injects quote markup', async () => {
        const root = preview('<p>quote quote</p>')
        const view = render(<AnchorQuote quote="quote" bodyRevision="1" currentBodyRevision="1" previewRoot={root} />)
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('ambiguous'))
        expect(screen.queryByRole('button')).toBeNull()
        view.rerender(<AnchorQuote quote={'<img src=x onerror=alert(1)>'} bodyRevision="1" currentBodyRevision="1" />)
        expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible(); expect(document.querySelector('img')).toBeNull()
    })
    it('disconnects observers when unmounted so private preview updates are no longer inspected', async () => {
        const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect'), root = preview('<p>quote</p>')
        const view = render(<AnchorQuote quote="quote" bodyRevision="1" currentBodyRevision="1" previewRoot={root} />)
        await screen.findByRole('button', { name: 'Show quoted text' }); view.unmount()
        expect(disconnect).toHaveBeenCalled(); disconnect.mockRestore()
    })
})
