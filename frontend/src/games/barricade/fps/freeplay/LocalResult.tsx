import type { ReactNode } from 'react'

/** Persistence/Connect state belongs to A's shared panel. No direct connect callback. */
export default function LocalResult({ snapshot, recoveryReady, connection }: {
    snapshot: { input: { claimedScore: number }; result?: { receipt?: unknown } }
    recoveryReady: boolean
    connection?: ReactNode
}) {
    return <section aria-label="Résultat FPS local"><p>{snapshot.input.claimedScore} points · Résultat terminé.</p>
        {!!snapshot.result?.receipt && <p>Saved receipt — une nouvelle vérification sera nécessaire.</p>}
        {connection ?? (recoveryReady ? <p>Résultat sauvegardé sur cet appareil.</p> : <>
            <p role="alert">La sauvegarde pour récupération n’a pas pu être confirmée. Exportez le résultat avant de quitter.</p>
            <details><summary>Exporter le résultat terminé</summary><textarea aria-label="Export du résultat terminé" readOnly value={JSON.stringify(snapshot, null, 2)} /></details>
        </>)}
    </section>
}
