import { useState } from "react"
import type { NativeViewProps } from "../../native/types"
import "./learn.css"

const PLAYLIST = "PLJZrQikyfMc-kBojXgAojOz4UQPuq4DiY"
const REPO = "https://github.com/samouraiworld/peerdev/tree/main/gno-tutorials"
const CHAPTERS = [
    { title: "Set up a Gno workspace", detail: "Install the tools and make your first project.", path: "tutorials/1-initialisation" },
    { title: "Write a hello world realm", detail: "Package structure, source and a first function.", path: "tutorials/2-hello-world" },
    { title: "Deploy a package", detail: "Understand paths, fees and the signed addpkg message.", path: "short-tutorials/6-deploy-pkg" },
    { title: "Secure a transaction", detail: "Review arguments, permissions and the wallet step.", path: "tutorials/8-secure-tx" },
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
                    {play ? <iframe title="PeerDev Gno tutorials" loading="lazy" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share"
                        referrerPolicy="strict-origin-when-cross-origin" allowFullScreen src={`https://www.youtube-nocookie.com/embed/videoseries?list=${PLAYLIST}`} /> :
                        <div className="os-learn-video-poster">
                            <div className="os-learn-play-mark" aria-hidden="true">▶</div>
                            <b>PeerDev Gno tutorials</b>
                            <p>Play the learning series here. YouTube loads when you choose to play.</p>
                            <button type="button" onClick={() => setPlay(true)}>Play playlist</button>
                        </div>}
                    <a href={`https://www.youtube.com/playlist?list=${PLAYLIST}`} target="_blank" rel="noopener noreferrer">Open playlist on YouTube ↗</a>
                </section>
                <section className="os-learn-chapters" aria-label="Learning chapters">
                    <h3>Start here</h3>
                    <ol>{CHAPTERS.map((chapter) => <li key={chapter.path}>
                        <a href={`${REPO}/${chapter.path}`} target="_blank" rel="noopener noreferrer">
                            <b>{chapter.title}</b><span>{chapter.detail}</span><small>Read lesson and source ↗</small>
                        </a>
                    </li>)}</ol>
                </section>
            </div>
        </div>
    )
}
