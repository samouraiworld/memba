import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { ChainNote } from '../../../lib/notes/chain/schema'
import type { NotesStore } from '../../../lib/notes/drafts'
import { NoteSharePopover } from './NoteSharePopover'

vi.mock('../../sign/signerContext', () => ({ useSigner: () => ({ sign: vi.fn() }) }))
const owner = 'g1jw76lxvzjafw2kyjhdnzwggcftyhnlfjaer2u0'
const note = { id: 'ab'.repeat(16), owner, stateRevision: '6', ownerGeneration: '1', mode: 4, epoch: '0', deleted: false, listed: true, title: new TextEncoder().encode('Sushi') } as ChainNote
const capability = { id: note.id, stateRevision: '6', ownerGeneration: '1', mode: 4 as const, deleted: false, allowPublicWrites: false }
function setup(viewer: string | null = owner, value: ChainNote = note) {
    const client = { chainId: 'gnoland-1', assertCurrent: vi.fn(), publicCapabilities: vi.fn(async () => capability) } as unknown as NotesReadClient
    return render(<><NoteSharePopover note={value} client={client} store={{} as NotesStore} owner={viewer} networkKey="mainnet" onChanged={vi.fn()} /><p>Elsewhere</p></>)
}
const share = () => screen.getByRole('button', { name: 'Share' })
beforeEach(() => { vi.clearAllMocks() })

describe('Share menu', () => {
    it('opens from the header with the link, who can read, edit and comment, and closes with Escape', async () => {
        setup()
        expect(share()).toHaveAttribute('aria-expanded', 'false'); expect(screen.queryByRole('dialog')).toBeNull()
        fireEvent.click(share())
        const dialog = screen.getByRole('dialog', { name: 'Share Sushi' })
        expect(share()).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByText(`${window.location.origin}/mainnet/os/notes/${note.id}`)).toBeVisible()
        expect(screen.getByText(/anyone, with or without a wallet, can read it/)).toBeVisible()
        expect(await screen.findByRole('radio', { name: /Only me/ })).toBeChecked()
        expect(screen.getByText('Everyone with a wallet', { selector: 'p > strong' })).toBeVisible()
        expect(screen.getByText(/restricting comments also stops community editing/)).toBeVisible()
        fireEvent.keyDown(dialog, { key: 'Escape' })
        expect(screen.queryByRole('dialog')).toBeNull(); expect(share()).toHaveFocus()
    })
    it('copies the link, and says so', async () => {
        const writeText = vi.fn(async () => {}); Object.assign(navigator, { clipboard: { writeText } })
        setup(); fireEvent.click(share())
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy link' })) })
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/mainnet/os/notes/${note.id}`)
        expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible()
    })
    it('closes when the focus leaves it', async () => {
        setup(); fireEvent.click(share())
        const outside = document.createElement('button'); document.body.append(outside)
        fireEvent.blur(screen.getByRole('button', { name: 'Copy link' }), { relatedTarget: share() })
        expect(screen.getByRole('dialog')).toBeVisible()
        fireEvent.blur(screen.getByRole('button', { name: 'Copy link' }), { relatedTarget: outside })
        expect(screen.queryByRole('dialog')).toBeNull(); outside.remove()
    })
    it('closes on a click outside, but not on a click inside', async () => {
        setup(); fireEvent.click(share())
        fireEvent.mouseDown(screen.getByRole('dialog')); expect(screen.getByRole('dialog')).toBeVisible()
        fireEvent.mouseDown(screen.getByText('Elsewhere')); expect(screen.queryByRole('dialog')).toBeNull()
    })
    it('shows a guest the same facts read-only, and restricted comments as such', async () => {
        setup(null, { ...note, mode: 3 }); fireEvent.click(share())
        expect(screen.getByText(/^The owner, the writers the owner named, governance members when governance owns the note, and wallets the note's write policy allows/)).toBeVisible()
        expect(screen.getByText(/comment policy allows$/, { selector: 'p > strong' })).toBeVisible()
        expect(screen.queryByRole('radio')).toBeNull()
    })
})
