import { useEffect } from "react"
import { radioPlayer } from "./player"
import { RadioWidget, type RadioWidgetActions } from "./RadioWidget"

export default function RadioStage({ locked, visible, onHide, onStop }: RadioWidgetActions & { locked: boolean; visible: boolean }) {
    useEffect(() => { radioPlayer.start(); return () => radioPlayer.dispose() }, [])
    useEffect(() => { if (locked) radioPlayer.pause() }, [locked])
    return visible && !locked ? <RadioWidget onHide={onHide} onStop={onStop} /> : null
}
