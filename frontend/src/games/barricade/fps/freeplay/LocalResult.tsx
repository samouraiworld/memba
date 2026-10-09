import { useState } from 'react'

export default function LocalResult({ snapshot, connect }: { snapshot: { input: { claimedScore: number }; result?: { receipt?: unknown } }; connect?: () => void | Promise<void> }) {
    const [error, setError] = useState(false)
    return <section aria-label="Résultat FPS local"><p>{snapshot.input.claimedScore} points · Résultat conservé sur cet appareil.</p>
        {!!snapshot.result?.receipt && <p>Saved receipt — une nouvelle vérification sera nécessaire.</p>}
        {connect && <button onClick={() => { setError(false); void Promise.resolve().then(connect).catch(() => setError(true)) }}>Connecter un wallet</button>}
        {error && <p role="alert">Connexion indisponible. Le résultat est conservé.</p>}
    </section>
}
