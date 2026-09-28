import { useContext, useState, type FormEvent } from "react"
import type { NativeViewProps } from "../../native/types"
import { appSpec } from "../../shell/windows"
import { Icon } from "../../shell/icons"
import { newRoomId, normaliseRoomId, roomUrl } from "./rooms"
import { MeetStageContext } from "./stageContext"
import "./meet.css"

export default function MeetWindow({ section, open, toast }: NativeViewProps) {
    const [invite, setInvite] = useState("")
    const [error, setError] = useState("")
    const setStage = useContext(MeetStageContext)
    const room = section ? normaliseRoomId(section) : null

    const join = (event: FormEvent) => {
        event.preventDefault()
        const id = normaliseRoomId(invite)
        if (!id) { setError("Enter a 10-character meeting code or a visio.samourai.app invite link."); return }
        setError("")
        open(appSpec("meet", id))
    }
    const copy = async () => {
        if (!room) return
        try { await navigator.clipboard.writeText(roomUrl(room)); toast("Invite link copied") }
        catch { toast("Clipboard unavailable. Open Visio to copy the link there.") }
    }

    if (section && !room) return (
        <div className="meet-invalid">
            <h3>Meeting code not found</h3>
            <p>Check the code in your invitation, then open Meet to try again.</p>
            <button className="os-btn" type="button" onClick={() => open(appSpec("meet"))}>Open Meet</button>
        </div>
    )

    if (room) return (
        <div className="meet-room">
            <div className="meet-toolbar">
                <div className="meet-room-name"><Icon name="meet" /><span><b>Meeting in progress</b><small>{room}</small></span></div>
                <div className="meet-toolbar-actions">
                    <button type="button" className="os-btn os-quiet" onClick={() => { void copy() }}>Copy invite</button>
                    <a className="os-btn" href={roomUrl(room)} target="_blank" rel="noopener noreferrer">Open in Visio ↗</a>
                </div>
            </div>
            <p className="meet-help">If the meeting stays blank or your browser blocks the camera, use Open in Visio. Your invite link works without a Memba account.</p>
            <div className="meet-viewport" ref={setStage} aria-label={`Visio meeting ${room}`} />
        </div>
    )

    return (
        <div className="meet-home">
            <div className="meet-intro">
                <span className="meet-mark"><Icon name="meet" /></span>
                <h3>Meet here, in your space.</h3>
                <p>Open a shareable link for your conversation. Anyone with the link can join as a guest.</p>
                <button type="button" className="os-btn meet-start" onClick={() => open(appSpec("meet", newRoomId()))}>New meeting</button>
            </div>
            <form className="meet-join" onSubmit={join}>
                <label htmlFor="meet-invite">Have an invitation?</label>
                <p>Paste a meeting code or a Visio link.</p>
                <div className="meet-join-row">
                    <input id="meet-invite" value={invite} onChange={(event) => { setInvite(event.target.value); setError("") }} autoComplete="off" spellCheck={false} placeholder="abc-defg-hij" />
                    <button className="os-btn os-quiet" type="submit">Join meeting</button>
                </div>
                {error && <p className="meet-error" role="alert">{error}</p>}
            </form>
        </div>
    )
}
