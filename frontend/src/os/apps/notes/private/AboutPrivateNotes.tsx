import { gnotAmount } from '../../../../lib/notes/chain/quote'
import { IDENTITY_ESTIMATE_UGNOT } from '../../../../lib/notes/identity/quote'
import { NoteSheet } from '../NoteHeader'

/** What private notes protect and what they do not: short, and honest about what stays public, costs and limits. */
export function AboutPrivateNotes({ onClose }: { onClose(): void }) {
    return <NoteSheet label="About private notes" onClose={onClose}>
        <div className="os-notes-private-sheet os-notes-private-about">
            <h2>About private notes</h2>
            <dl>
                <dt>Encrypted</dt>
                <dd>The title, the text, encrypted comments and their quotes. They are encrypted in this browser before anything is sent, for your key and the keys of the people you share the note with.</dd>
                <dt>Public on the network</dt>
                <dd>Your address as the owner, the addresses of readers and writers, the encrypted sizes, when the note changes, and for each comment its author and time (so how many there are).</dd>
                <dt>Before you sign</dt>
                <dd>To price a private note, Memba simulates its transaction on a network node first: that node sees the encrypted transaction a few seconds early, even if you then cancel. It sees nothing the transaction would not publish.</dd>
                <dt>Costs</dt>
                <dd>Setting up your key locks about {gnotAmount(IDENTITY_ESTIMATE_UGNOT)}, which is not returned. Each private note, reader, edit and comment locks a storage deposit, shown before you sign; deleting a note returns about half of what it locked, the rest stays locked. Network fees are never returned.</dd>
                <dt>Recovery phrase and file</dt>
                <dd>With your Adena signature they are the only ways to open your key, for example in another browser or after changing wallets. Keep both offline. Anyone who gets both, or your unlock signature, can read your private notes.</dd>
                <dt>This browser</dt>
                <dd>Drafts of private notes are stored encrypted. The browser&rsquo;s storage may still keep bytes of earlier drafts, including the unencrypted draft of a note you published privately, until it compacts its files; clearing this site&rsquo;s data removes them.</dd>
                <dt>Readers and writers</dt>
                <dd>Someone you remove keeps what they already read. Someone you let edit can publish text that no one can decrypt (as the owner you can then replace it, or delete the note) and can delay a reader&rsquo;s removal by publishing edits at the same time.</dd>
            </dl>
            <div className="os-notes-sheet-actions"><button type="button" className="os-btn" onClick={onClose}>Close</button></div>
        </div>
    </NoteSheet>
}
