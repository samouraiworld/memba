/**
 * QuestToast — Toast notification shown when a quest is completed.
 * Displays quest icon, name, XP earned, and optional rank-up.
 */

import { useState, useEffect } from "react"

interface QuestToastProps {
    questTitle: string
    questIcon: string
    xpEarned: number
    rankUp?: string // New rank name if leveled up
    onDismiss: () => void
}

export function QuestToast({ questTitle, questIcon, xpEarned, rankUp, onDismiss }: QuestToastProps) {
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        // Slide in
        requestAnimationFrame(() => setVisible(true))
        // Auto-dismiss after 4s
        const timer = setTimeout(() => {
            setVisible(false)
            setTimeout(onDismiss, 300) // Wait for slide-out animation
        }, 4000)
        return () => clearTimeout(timer)
    }, [onDismiss])

    return (
        <div
            className={`k-quest-toast${visible ? " k-quest-toast--visible" : ""}`}
            role="status"
            aria-live="polite"
        >
            <span className="k-quest-toast-icon">{questIcon}</span>
            <div className="k-quest-toast-body">
                <strong>Quest Complete!</strong>
                <span>{questTitle}</span>
                <span className="k-quest-toast-xp">+{xpEarned} XP</span>
            </div>
            {rankUp && (
                <div className="k-quest-toast-rankup">
                    Rank up: {rankUp}
                </div>
            )}
        </div>
    )
}
