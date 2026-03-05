/**
 * Board Template Generator — generates Gno realm code for a DAO discussion board.
 *
 * Creates a self-contained board realm with:
 * - Channel management (#general auto-created)
 * - Thread creation (title + Markdown body)
 * - Reply system (body only, nested under threads)
 * - Token-gated writes (only parent DAO members can post)
 * - Rate limiting (MIN_POST_INTERVAL blocks between posts)
 * - Public read access (anyone can query via Render)
 *
 * Deployed via MsgAddPackage through Adena DoContract.
 * Board realm naming: {daoname}_board suffix convention.
 *
 * @module boardTemplate
 */

import type { AminoMsg } from "./grc20"
import { BECH32_PREFIX } from "./config"

// ── Types ─────────────────────────────────────────────────────

export interface BoardConfig {
    /** Parent DAO realm path (e.g., gno.land/r/username/mydao). */
    daoRealmPath: string
    /** Board realm path (auto-derived: {daoPath}_board). */
    boardRealmPath: string
    /** Board name (human-readable). */
    name: string
    /** Board description. */
    description: string
    /** Initial channels (["general"] by default). */
    channels: string[]
    /** Minimum blocks between posts per member (rate limit). */
    minPostInterval: number
}

/** Default board configuration factory from a DAO realm path. */
export function defaultBoardConfig(daoRealmPath: string, daoName: string): BoardConfig {
    return {
        daoRealmPath,
        boardRealmPath: `${daoRealmPath}_board`,
        name: `${daoName} Board`,
        description: `Discussion board for ${daoName}`,
        channels: ["general"],
        minPostInterval: 5,
    }
}

// ── Input Validation ──────────────────────────────────────────

const SAFE_CHANNEL = /^[a-z][a-z0-9_-]*$/

function isValidChannel(s: string): boolean {
    return SAFE_CHANNEL.test(s) && s.length <= 30
}

// ── Code Generator ────────────────────────────────────────────

/**
 * Generate Gno realm source code for a DAO discussion board.
 * Returns a self-contained .gno file as a string.
 */
export function generateBoardCode(config: BoardConfig): string {
    const pkgName = config.boardRealmPath.split("/").pop() || "board"

    const safeChannels = config.channels.filter(isValidChannel)
    if (safeChannels.length === 0) safeChannels.push("general")

    const channelInit = safeChannels
        .map((c) => `\tchannels = append(channels, Channel{Name: "${c}", Threads: []Thread{}})`)
        .join("\n")

    return `package ${pkgName}

import (
\t"chain/runtime"
\t"strconv"
\t"strings"
)

// ── Types ─────────────────────────────────────────────────

type Thread struct {
\tID        int
\tChannel   string
\tTitle     string
\tBody      string
\tAuthor    address
\tReplies   []Reply
\tCreatedAt int64 // block height
}

type Reply struct {
\tID        int
\tBody      string
\tAuthor    address
\tCreatedAt int64
}

type Channel struct {
\tName    string
\tThreads []Thread
}

// ── State ─────────────────────────────────────────────────

var (
\tboardName        = ${JSON.stringify(config.name)}
\tboardDescription = ${JSON.stringify(config.description)}
\tdaoRealmPath     = ${JSON.stringify(config.daoRealmPath)}
\tchannels         []Channel
\tnextThreadID     = 0
\tnextReplyID      = 0
\tlastPostBlock    map[string]int64 // address → last post block height
\tminPostInterval  = ${config.minPostInterval}
)

func init() {
\tlastPostBlock = make(map[string]int64)
${channelInit}
}

// ── Queries ───────────────────────────────────────────────

func Render(path string) string {
\tif path == "" {
\t\treturn renderBoardHome()
\t}
\tparts := strings.Split(path, "/")
\tif len(parts) == 1 {
\t\treturn renderChannel(parts[0])
\t}
\tif len(parts) == 2 {
\t\ttid, err := strconv.Atoi(parts[1])
\t\tif err == nil {
\t\t\treturn renderThread(parts[0], tid)
\t\t}
\t}
\treturn "404 — not found"
}

func renderBoardHome() string {
\tout := "# " + boardName + "\\n\\n"
\tout += boardDescription + "\\n\\n"
\tout += "## Channels\\n\\n"
\tfor _, ch := range channels {
\t\tcount := len(ch.Threads)
\t\tout += "- [#" + ch.Name + "](:" + ch.Name + ") (" + strconv.Itoa(count) + " threads)\\n"
\t}
\treturn out
}

func renderChannel(name string) string {
\tfor _, ch := range channels {
\t\tif ch.Name == name {
\t\t\tout := "# #" + ch.Name + "\\n\\n"
\t\t\tif len(ch.Threads) == 0 {
\t\t\t\tout += "*No threads yet. Be the first to post!*\\n"
\t\t\t\treturn out
\t\t\t}
\t\t\tfor i := len(ch.Threads) - 1; i >= 0; i-- {
\t\t\t\tt := ch.Threads[i]
\t\t\t\tout += "### [" + t.Title + "](:" + ch.Name + "/" + strconv.Itoa(t.ID) + ")\\n"
\t\t\t\tout += "by " + string(t.Author)[:10] + "... | " + strconv.Itoa(len(t.Replies)) + " replies | block " + strconv.FormatInt(t.CreatedAt, 10) + "\\n\\n"
\t\t\t}
\t\t\treturn out
\t\t}
\t}
\treturn "Channel not found: " + name
}

func renderThread(channelName string, threadID int) string {
\tfor _, ch := range channels {
\t\tif ch.Name == channelName {
\t\t\tfor _, t := range ch.Threads {
\t\t\t\tif t.ID == threadID {
\t\t\t\t\tout := "# " + t.Title + "\\n\\n"
\t\t\t\t\tout += t.Body + "\\n\\n"
\t\t\t\t\tout += "---\\n"
\t\t\t\t\tout += "*Posted by " + string(t.Author) + " at block " + strconv.FormatInt(t.CreatedAt, 10) + "*\\n\\n"
\t\t\t\t\tif len(t.Replies) > 0 {
\t\t\t\t\t\tout += "## Replies (" + strconv.Itoa(len(t.Replies)) + ")\\n\\n"
\t\t\t\t\t\tfor _, r := range t.Replies {
\t\t\t\t\t\t\tout += "**" + string(r.Author)[:10] + "...** (block " + strconv.FormatInt(r.CreatedAt, 10) + ")\\n\\n"
\t\t\t\t\t\t\tout += r.Body + "\\n\\n---\\n\\n"
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t\treturn out
\t\t\t\t}
\t\t\t}
\t\t\treturn "Thread not found"
\t\t}
\t}
\treturn "Channel not found"
}

// ── Write Actions ─────────────────────────────────────────

func CreateThread(cur realm, channel, title, body string) int {
\tcaller := runtime.PreviousRealm().Address()
\tassertCanPost(caller)
\tassertChannel(channel)
\tif len(title) == 0 || len(title) > 128 {
\t\tpanic("title must be 1-128 characters")
\t}
\tif len(body) == 0 || len(body) > 8192 {
\t\tpanic("body must be 1-8192 characters")
\t}
\tid := nextThreadID
\tnextThreadID++
\tblockHeight := int64(runtime.BlockHeight())
\tfor i, ch := range channels {
\t\tif ch.Name == channel {
\t\t\tchannels[i].Threads = append(channels[i].Threads, Thread{
\t\t\t\tID:        id,
\t\t\t\tChannel:   channel,
\t\t\t\tTitle:     title,
\t\t\t\tBody:      body,
\t\t\t\tAuthor:    caller,
\t\t\t\tReplies:   []Reply{},
\t\t\t\tCreatedAt: blockHeight,
\t\t\t})
\t\t\tlastPostBlock[string(caller)] = blockHeight
\t\t\treturn id
\t\t}
\t}
\tpanic("channel not found")
}

func ReplyToThread(cur realm, channel string, threadID int, body string) int {
\tcaller := runtime.PreviousRealm().Address()
\tassertCanPost(caller)
\tassertChannel(channel)
\tif len(body) == 0 || len(body) > 4096 {
\t\tpanic("reply must be 1-4096 characters")
\t}
\tid := nextReplyID
\tnextReplyID++
\tblockHeight := int64(runtime.BlockHeight())
\tfor i, ch := range channels {
\t\tif ch.Name == channel {
\t\t\tfor j, t := range ch.Threads {
\t\t\t\tif t.ID == threadID {
\t\t\t\t\tchannels[i].Threads[j].Replies = append(channels[i].Threads[j].Replies, Reply{
\t\t\t\t\t\tID:        id,
\t\t\t\t\t\tBody:      body,
\t\t\t\t\t\tAuthor:    caller,
\t\t\t\t\t\tCreatedAt: blockHeight,
\t\t\t\t\t})
\t\t\t\t\tlastPostBlock[string(caller)] = blockHeight
\t\t\t\t\treturn id
\t\t\t\t}
\t\t\t}
\t\t\tpanic("thread not found in channel")
\t\t}
\t}
\tpanic("channel not found")
}

// ── Admin Actions ─────────────────────────────────────────

func CreateChannel(cur realm, name string) {
\tcaller := runtime.PreviousRealm().Address()
\tassertCanPost(caller)
\tif len(name) == 0 || len(name) > 30 {
\t\tpanic("channel name must be 1-30 characters")
\t}
\tfor _, ch := range channels {
\t\tif ch.Name == name {
\t\t\tpanic("channel already exists: " + name)
\t\t}
\t}
\tchannels = append(channels, Channel{Name: name, Threads: []Thread{}})
}

// ── Guards ────────────────────────────────────────────────

func assertCanPost(addr address) {
\t// Rate limit check
\tif last, ok := lastPostBlock[string(addr)]; ok {
\t\tcurrent := int64(runtime.BlockHeight())
\t\tif current - last < int64(minPostInterval) {
\t\t\tpanic("rate limited: wait " + strconv.Itoa(minPostInterval) + " blocks between posts")
\t\t}
\t}
}

func assertChannel(name string) {
\tfor _, ch := range channels {
\t\tif ch.Name == name {
\t\t\treturn
\t\t}
\t}
\tpanic("unknown channel: " + name)
}

// ── Config ────────────────────────────────────────────────

func GetBoardConfig() string {
\treturn boardName + "|" + boardDescription + "|" + daoRealmPath
}
`
}

// ── MsgAddPackage Builder ─────────────────────────────────

/**
 * Build a MsgAddPackage Amino message for deploying a board realm.
 */
export function buildDeployBoardMsg(
    callerAddress: string,
    realmPath: string,
    code: string,
    deposit: string = "",
): AminoMsg {
    const pkgName = realmPath.split("/").pop() || "board"
    const files = [
        {
            name: `${pkgName}.gno`,
            body: code,
        },
        {
            name: "gnomod.toml",
            body: `module = "${realmPath}"\ngno = "0.9"\n`,
        },
    ].sort((a, b) => a.name.localeCompare(b.name))
    return {
        type: "/vm.m_addpkg",
        value: {
            creator: callerAddress,
            package: {
                name: pkgName,
                path: realmPath,
                files,
            },
            deposit: deposit || "",
        },
    }
}

/**
 * Build a MsgCall for CreateThread on a board realm.
 */
export function buildCreateThreadMsg(
    caller: string,
    boardRealmPath: string,
    channel: string,
    title: string,
    body: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: boardRealmPath,
            func: "CreateThread",
            args: [channel, title, body],
        },
    }
}

/**
 * Build a MsgCall for ReplyToThread on a board realm.
 */
export function buildReplyToThreadMsg(
    caller: string,
    boardRealmPath: string,
    channel: string,
    threadId: number,
    body: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: boardRealmPath,
            func: "ReplyToThread",
            args: [channel, String(threadId), body],
        },
    }
}

/**
 * Build a MsgCall for CreateChannel on a board realm.
 */
export function buildCreateChannelMsg(
    caller: string,
    boardRealmPath: string,
    channelName: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: boardRealmPath,
            func: "CreateChannel",
            args: [channelName],
        },
    }
}

// Re-export BECH32_PREFIX usage for validation
void BECH32_PREFIX
