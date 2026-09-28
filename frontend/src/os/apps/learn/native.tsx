import { useState } from "react"
import type { NativeViewProps } from "../../native/types"
import "./learn.css"

const PLAYLIST = "PLJZrQikyfMc-kBojXgAojOz4UQPuq4DiY"
const REPO = "https://github.com/samouraiworld/peerdev/tree/main/gno-tutorials"
const CHAPTERS = [
    { title: "Run a local counter realm", detail: "PeerDev setup notes. After cloning, use gno-tutorials/tutorials/1-initialisation (the guide shows an older path).", path: "tutorials/1-initialisation", link: "Read setup notes" },
    { title: "Build a hello world blog realm", detail: "Follow the blog realm example and its tests.", path: "tutorials/2-hello-world", link: "Read lesson and source" },
    { title: "Understand package deployment", detail: "Slides on package paths, namespace rights and a staging-chain deployment example.", path: "short-tutorials/6-deploy-pkg/slides.md", link: "Read lesson slides" },
    { title: "Protect keys and review transactions", detail: "Slides on key custody and transaction safety, including local development examples.", path: "tutorials/8-secure-tx/slides.md", link: "Read lesson slides" },
] as const

export default function LearnWindow({ section, openApp, fallback }: NativeViewProps) {
    const [play, setPlay] = useState(false)
    if (section !== null) return <>{fallback}</>
    return (
        <div className="os-learn">
            <header className="os-learn-header">
                <div><h2>Learn to build on Gno</h2><p>PeerDev lessons, source code and a place to draft your own realm.</p></div>
                <button type="button" className="os-btn" onClick={() => openApp("terminal")}>Open Terminal</button>
            </header>
            <div className="os-learn-body">
                <section className="os-learn-video" aria-label="PeerDev video playlist">
                    <div id="os-learn-player" className="os-learn-player">{play ? <iframe title="PeerDev Gno tutorials" loading="lazy" allow="encrypted-media; picture-in-picture"
                        referrerPolicy="strict-origin-when-cross-origin" allowFullScreen src={`https://www.youtube-nocookie.com/embed/videoseries?list=${PLAYLIST}`} /> :
                        <div className="os-learn-video-poster">
                            <div className="os-learn-play-mark" aria-hidden="true">▶</div>
                            <b>PeerDev Gno tutorials</b>
                            <p>Load the player here. YouTube connects when you choose to load it.</p>
                        </div>}</div>
                    <div className="os-learn-video-actions">
                        <button type="button" aria-controls="os-learn-player" aria-expanded={play} onClick={() => setPlay(value => !value)}>{play ? "Unload player" : "Load playlist"}</button>
                        <a href={`https://www.youtube.com/playlist?list=${PLAYLIST}`} target="_blank" rel="noopener noreferrer">Open playlist on YouTube ↗</a>
                    </div>
                    {play && <p className="os-learn-player-help">If the player is unavailable, open the playlist on YouTube. Unload it to stop playback.</p>}
                </section>
                <section className="os-learn-chapters" aria-label="Learning chapters">
                    <h3>Start here</h3>
                    <p className="os-learn-chapters-note">PeerDev is a community resource. Some examples use local or staging chains; check the network, fees and current Gno tooling before running commands.</p>
                    <ol>{CHAPTERS.map((chapter) => <li key={chapter.path}>
                        <a href={`${REPO}/${chapter.path}`} target="_blank" rel="noopener noreferrer">
                            <b>{chapter.title}</b><span>{chapter.detail}</span><small>{chapter.link} ↗</small>
                        </a>
                    </li>)}</ol>
                </section>
            </div>
        </div>
    )
}
