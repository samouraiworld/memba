import { useEffect, useRef, useState } from 'react'
import type { NotesIdentityController } from '../../../../lib/notes/identity/controller'
import { identityIntentScope, prepareIdentitySetupRequest } from '../../../../lib/notes/identity/request'
import { IDENTITY_CAPS, IDENTITY_ESTIMATE_UGNOT, IDENTITY_GAS_WANTED, IDENTITY_MAX_DEPOSIT_UGNOT, identityQuote } from '../../../../lib/notes/identity/quote'
import type { NotesReadClient } from '../../../../lib/notes/chain/client'
import { NotesChainError } from '../../../../lib/notes/chain/schema'
import { gnotAmount } from '../../../../lib/notes/chain/quote'
import { NotesCryptoError } from '../../../../lib/notes/crypto/bytes'
import type { DraftSession, NotesStore } from '../../../../lib/notes/drafts'
import { NotesIntents } from '../../../../lib/notes/intents'
import { notesDeployment } from '../../../../lib/notes/config'
import { withTimeout } from '../../../../lib/notes/freshness'
import { freshFeeForGasWanted } from '../../../../lib/grc20'
import { abciQueryText } from '../../../../lib/dao/packageStatus'
import { ugnotInCoinsJson } from '../../../../lib/bankBalance'
import { getRpcUrlsInOrder } from '../../../../lib/rpcFallback'
import type { SettledOutcome } from '../../../sign/signer'
import { useSigner } from '../../../sign/signerContext'
import { NoteSheet } from '../NoteHeader'
import { holdSetup } from './setupInFlight'

type Step = 'intro' | 'checking' | 'signing' | 'phrase' | 'confirm' | 'review' | 'sending' | 'done'
export interface PrivateKeySetupProps {
    controller: NotesIdentityController; client: NotesReadClient; store: NotesStore; owner: string; requestSession: DraftSession
    wallet(): unknown; walletProblem: string; onClose(): void
}
const SECRET_STEPS: readonly Step[] = ['phrase', 'confirm', 'review']
function setupProblem(error: unknown, chainId: string): string {
    if (error instanceof NotesCryptoError && error.code === 'mismatch') return 'Adena gave two different signatures, so it cannot unlock a key reliably. Nothing was registered and nothing was charged.'
    if (error instanceof NotesCryptoError && error.code === 'signature') return `Adena's signature could not be checked. Make sure Adena is on ${chainId} with this account, then try again. Nothing was registered.`
    if (error instanceof NotesCryptoError && error.code === 'wallet') return 'Adena did not sign. Nothing was registered and nothing was charged.'
    return 'The key could not be prepared. Nothing was registered and nothing was charged. Try again.'
}
function requestProblem(error: unknown): string {
    if (error instanceof NotesChainError && error.code === 'disabled') return 'Private notes are not available on this network right now. Nothing was sent.'
    return 'The setup could not be prepared. Nothing was sent. Try again.'
}
const NOTHING_SENT: Partial<Record<SettledOutcome, string>> = {
    cancelled: 'Cancelled. Nothing was sent.', failed: 'Stopped before Adena opened. Nothing was sent; the reason is in Notifications. Try again.',
}

/** One guided sheet: what it costs, two unlock signatures, the recovery phrase and file, then one transaction. */
export function PrivateKeySetup({ controller, client, store, owner, requestSession, wallet, walletProblem, onClose }: PrivateKeySetupProps) {
    const signer = useSigner(), live = useRef(true), heading = useRef<HTMLHeadingElement>(null)
    const [step, setStep] = useState<Step>(() => controller.getSnapshot().recoveryConfirmed ? 'review' : 'intro')
    const [secret, setSecret] = useState<{ phrase: string; file: string; name: string } | null>(null)
    const [downloaded, setDownloaded] = useState(false), [typed, setTyped] = useState(''), [error, setError] = useState(''), [fee, setFee] = useState<number | null>(null)
    const shown = useRef(step)
    useEffect(() => { shown.current = step }, [step])
    useEffect(() => { live.current = true; return () => { live.current = false } }, [])
    useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [step])
    useEffect(() => { void freshFeeForGasWanted(IDENTITY_GAS_WANTED).then(value => { if (live.current) setFee(value) }, () => {}) }, [])
    // The phrase leaves this sheet the moment the controller drops the prepared key (lock, account or network switch).
    useEffect(() => controller.subscribe(() => {
        const state = controller.getSnapshot()
        if (state.phase === 'prepared' || state.busy) return
        setSecret(null); setTyped('')
        if (SECRET_STEPS.includes(shown.current)) { setStep('intro'); setError('Setup stopped before anything was sent. Nothing was registered.') }
    }), [controller])
    /** Refuses before any signature when the account cannot pay the written maximum plus the network fee. */
    async function balanceProblem(): Promise<string> {
        const urls = getRpcUrlsInOrder()
        const [balance, networkFee] = await Promise.all([
            withTimeout(abciQueryText({ chainId: client.chainId, rpcUrl: urls[0], rpcUrls: urls }, `bank/balances/${owner}`, '').then(ugnotInCoinsJson)).catch(() => null),
            fee === null ? freshFeeForGasWanted(IDENTITY_GAS_WANTED).catch(() => null) : Promise.resolve(fee),
        ])
        if (balance === null || networkFee === null) return 'Memba could not read your balance or the network fee. Nothing was signed. Try again in a moment.'
        const needed = BigInt(IDENTITY_MAX_DEPOSIT_UGNOT) + BigInt(networkFee)
        return balance < needed ? `Setting up needs up to ${gnotAmount(needed.toString())} (deposit and network fee); your balance is ${gnotAmount(balance.toString())}. Nothing was signed.` : ''
    }
    async function begin() {
        setError(''); setStep('checking')
        const short = await balanceProblem()
        if (!live.current) return
        if (short) { setStep('intro'); setError(short); return }
        setStep('signing')
        try {
            // A key prepared earlier whose phrase this sheet no longer holds is discarded: it was never registered.
            if (controller.getSnapshot().phase === 'prepared') controller.lock()
            const generation = BigInt(controller.getSnapshot().generation ?? '0') + 1n
            const output = await controller.prepareSetup('standard', wallet())
            if (!live.current) return
            // One file name per attempt: account, date and the key generation it registers.
            const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
            setSecret({ phrase: output.phrase, file: output.exportText, name: `memba-notes-recovery-${client.chainId}-${owner.slice(0, 10)}${owner.slice(-4)}-${stamp}-gen${generation}.json` })
            setDownloaded(false); setStep('phrase')
        } catch (problem) { if (live.current && shown.current === 'signing') { setStep('intro'); setError(setupProblem(problem, client.chainId)) } }
    }
    // Adena never answered the unlock signatures: drop the prepared work. Nothing was registered.
    function stopWaiting() { controller.lock(); setStep('intro'); setError('Stopped waiting. Nothing was registered. If Adena still shows a request, reject it there.') }
    function download() {
        if (!secret) return
        const url = URL.createObjectURL(new Blob([secret.file], { type: 'application/json' })), anchor = document.createElement('a')
        anchor.href = url; anchor.download = secret.name; anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000); setDownloaded(true)
    }
    function confirm() {
        try { controller.confirmRecovery(typed); setTyped(''); setSecret(null); setError(''); setStep('review') }
        catch { setError('These words do not match your recovery phrase. Check their order and spelling, or go back to see them again.') }
    }
    async function register() {
        setError(''); setStep('checking')
        const short = await balanceProblem()
        if (!live.current) return
        if (short) { setStep('review'); setError(short); return }
        setStep('sending')
        try {
            const request = await prepareIdentitySetupRequest({ controller, client, owner, caps: { ...IDENTITY_CAPS }, quote: identityQuote(client),
                intents: new NotesIntents(store), session: requestSession, isWriteEnabled: () => notesDeployment(client.chainId) !== null })
            if (!live.current) { request.onDismissed?.(); return }
            const operationId = controller.preparedPlan().operationId
            request.title = 'Set up private notes'
            const { onSettled, onDismissed } = request
            // In flight from here until the driver settles or dismisses it, even after this sheet is hidden.
            const release = holdSetup(operationId)
            request.onSettled = (outcome, choice) => {
                onSettled?.(outcome, choice); release()
                if (!live.current) return
                if (outcome === 'confirmed') { setStep('done'); return }
                // What the saved receipt says decides: only "not sent" may be tried again from here. Anything Adena may
                // have sent is explained by the panel, which checks the network and never signs it again.
                void new NotesIntents(store).get(identityIntentScope(client.chainId, owner), operationId).catch(() => undefined).then(saved => {
                    if (!live.current) return
                    if (saved === null || saved?.phase === 'not-sent') { setStep('review'); setError(NOTHING_SENT[outcome] ?? 'Nothing was sent.') }
                    else onClose()
                })
            }
            request.onDismissed = () => { onDismissed?.(); release(); if (live.current) { setStep('review'); setError('Nothing was sent.') } }
            if (!signer.sign(request)) { request.onDismissed(); setError('The signature window could not open. Close any other signature request, then try again.') }
        } catch (problem) {
            if (!live.current) return
            // The registry or backup moved since this key was prepared (an earlier setup may have landed): it can never
            // apply, so it is discarded. Nothing was sent.
            if (problem instanceof NotesChainError && problem.code === 'stale') { controller.lock(); setStep('intro'); setError('Your key changed on the network while this was prepared, so this new key was discarded. Nothing was sent. Close this sheet to see your key.'); return }
            setStep('review'); setError(requestProblem(problem))
        }
    }
    // Cancelling discards a prepared key: it was never registered. An unlocked key is left as it is.
    const cancel = () => { if (controller.getSnapshot().phase === 'prepared') controller.lock(); onClose() }
    const words = secret?.phrase.split(' ') ?? []
    const title = (text: string) => <h2 ref={heading} tabIndex={-1}>{text}</h2>
    const waiting = step === 'checking' || step === 'signing' || step === 'sending'
    const cost = <div><dt>Cost</dt><dd><strong className="os-notes-cost">≈ {gnotAmount(IDENTITY_ESTIMATE_UGNOT)}</strong> storage deposit, locked in the key registry and in Notes. It is not returned in normal use.
        <small>At most {gnotAmount(IDENTITY_MAX_DEPOSIT_UGNOT)}, written in the transaction. Network fee {fee === null ? 'shown before you sign' : `at most ${gnotAmount(fee)} (Adena usually charges less), shown again before you sign`}.</small></dd></div>
    // Hiding while the signature sheet is open keeps the request and its receipt: the panel shows how it ends.
    return <NoteSheet label="Set up private notes" onClose={step === 'sending' ? onClose : waiting ? undefined : cancel}>
        <div className="os-notes-private-sheet" aria-busy={waiting}>
            {step === 'intro' && <>
                {title('Set up private notes')}
                <dl className="os-notes-facts">
                    <div><dt>What happens</dt><dd>Memba creates a private key in this browser. Its public half and an encrypted backup of it are stored on {client.chainId}. Notes are encrypted before they leave this device.</dd></div>
                    <div><dt>How you unlock</dt><dd>Standard mode: Adena signs a fixed message, and that signature opens your key. Memba asks for it twice now, to check that Adena always gives the same signature. Neither is a transaction.</dd></div>
                    <div><dt>If Adena fails</dt><dd>You get a 24-word recovery phrase and a recovery file. Together they open your key on any device.</dd></div>
                    {cost}
                </dl>
                {walletProblem && <p className="os-notes-field-error" role="alert">{walletProblem}</p>}
            </>}
            {step === 'checking' && <>{title('Checking your balance')}<div className="os-notes-sheet-wait" role="status"><span className="os-spin" aria-hidden="true" />Checking that your account can pay the deposit and the network fee…</div></>}
            {step === 'signing' && <>{title('Approve in Adena')}<div className="os-notes-sheet-wait" role="status"><span className="os-spin" aria-hidden="true" />Approve the two signature requests in Adena. They are not transactions.</div></>}
            {step === 'phrase' && <>
                {title('Your recovery phrase')}
                <p>Write these 24 words down on paper and keep them offline. They are not your wallet&rsquo;s phrase. Anyone with them and your recovery file can open your private notes.</p>
                <ol className="os-notes-private-words" aria-label="Recovery phrase">{words.map((word, i) => <li key={i}>{word}</li>)}</ol>
                <button type="button" className="os-btn os-quiet" onClick={download}>{downloaded ? 'Download the recovery file again' : 'Download recovery file'}</button>
                <p className="os-notes-hint">{downloaded ? 'If the download did not start, download it again. ' : ''}The file holds only encrypted data. Keep it apart from the phrase.</p>
            </>}
            {step === 'confirm' && <>
                {title('Enter your recovery phrase')}
                <label className="os-notes-private-field">The 24 words, in order (you can paste them)
                    <textarea value={typed} rows={4} maxLength={512} autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={event => setTyped(event.target.value)} /></label>
            </>}
            {step === 'review' && <>
                {title('Register your key')}
                <dl className="os-notes-facts">
                    <div><dt>What is sent</dt><dd>One transaction on {client.chainId}: your public key, and the encrypted backup that Adena&rsquo;s signature opens. Your recovery phrase is never sent.</dd></div>
                    {cost}
                </dl>
                {walletProblem && <p className="os-notes-field-error" role="alert">{walletProblem}</p>}
            </>}
            {step === 'sending' && <>{title('Approve in Adena')}<div className="os-notes-sheet-wait" role="status"><span className="os-spin" aria-hidden="true" />Check the request in the signature sheet, then approve it in Adena. Nothing is registered until you approve.</div></>}
            {step === 'done' && <div className="os-notes-done">
                <svg className="os-notes-check" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45" /><path d="M30 52 l13 13 l27 -28" /></svg>
                {title('Private notes are ready')}<p>Your key is registered and unlocked in this window.</p>
            </div>}
            {error && <p className="os-notes-field-error" role="alert">{error}</p>}
            <div className="os-notes-sheet-actions">
                {step === 'intro' && <><button type="button" className="os-btn os-quiet" onClick={cancel}>Not now</button><button type="button" className="os-btn" disabled={!!walletProblem} onClick={() => void begin()}>Continue in Adena</button></>}
                {step === 'signing' && <button type="button" className="os-btn os-quiet" onClick={stopWaiting}>Stop waiting</button>}
                {step === 'phrase' && <>{!downloaded && <span className="os-notes-hint">Download the recovery file first.</span>}<button type="button" className="os-btn os-quiet" onClick={cancel}>Cancel setup</button><button type="button" className="os-btn" disabled={!downloaded} onClick={() => { setError(''); setStep('confirm') }}>I wrote it down</button></>}
                {step === 'confirm' && <><button type="button" className="os-btn os-quiet" onClick={() => { setError(''); setStep('phrase') }}>Back</button><button type="button" className="os-btn" disabled={!typed.trim()} onClick={confirm}>Confirm</button></>}
                {step === 'review' && <><button type="button" className="os-btn os-quiet" onClick={cancel}>Cancel setup</button><button type="button" className="os-btn" disabled={!!walletProblem} onClick={() => void register()}>Set up with Adena</button></>}
                {step === 'sending' && <><span className="os-notes-hint">Hiding keeps the request; this page shows how it ends.</span><button type="button" className="os-btn os-quiet" onClick={onClose}>Hide</button></>}
                {step === 'done' && <button type="button" className="os-btn" onClick={onClose}>Done</button>}
            </div>
        </div>
    </NoteSheet>
}
