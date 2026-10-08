import { useEffect } from "react"
import { radioPlayer } from "./player"

export default function RadioStage({ locked }: { locked: boolean }) {
    useEffect(() => { radioPlayer.start(); return () => radioPlayer.dispose() }, [])
    useEffect(() => { if (locked) radioPlayer.pause() }, [locked])
    return null
}
