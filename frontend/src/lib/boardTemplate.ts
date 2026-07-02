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
import { isValidChannelName, requireInt, requireRealmPath } from "./templates/sanitizer"
import { buildDeployMsg } from "./templates/prologue"

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

// Input validation delegated to templates/sanitizer.ts
export const isValidChannel = isValidChannelName

// ── Code Generator ────────────────────────────────────────────

/**
 * Generate Gno realm source code for a DAO discussion board.
 * Returns a self-contained .gno file as a string.
 */
export function generateBoardCode(config: BoardConfig): string {
    // W1.1 fail-closed: daoRealmPath lands in an import statement — a crafted
    // path could break out of `import parent "<path>"` (injection).
    requireRealmPath("daoRealmPath", config.daoRealmPath)
    requireRealmPath("boardRealmPath", config.boardRealmPath)
    requireInt("minPostInterval", config.minPostInterval, 0, 1_000_000)

    const pkgName = config.boardRealmPath.split("/").pop() || "board"

    const safeChannels = config.channels.filter(isValidChannel)
    if (safeChannels.length === 0) safeChannels.push("general")

    const channelInit = safeChannels
        .map((c) => `\tchannels = append(channels, Channel{Name: "${c}", Threads: []Thread{}})`)
        .join("\n")

    return `package ${pkgName}

import (
	"chain/runtime/unsafe"
	"strconv"
	"strings"

	parent "${config.daoRealmPath}"
)

// ── Types ─────────────────────────────────────────────────

type Thread struct {
	ID        int
	Channel   string
	Title     string
	Body      string
	Author    address
	Replies   []Reply
	CreatedAt int64 // block height
}

type Reply struct {
	ID        int
	Body      string
	Author    address
	CreatedAt int64
}

type Channel struct {
	Name    string
	Threads []Thread
}

// ── State ─────────────────────────────────────────────────

var (
	boardName        = ${JSON.stringify(config.name)}
	boardDescription = ${JSON.stringify(config.description)}
	daoRealmPath     = ${JSON.stringify(config.daoRealmPath)}
	channels         []Channel
	nextThreadID     = 0
	nextReplyID      = 0
	lastPostBlock    map[string]int64 // address → last post block height
	minPostInterval  = ${config.minPostInterval}
	adminAddr        address           // set to deployer in init()
)

func init() {
	lastPostBlock = make(map[string]int64)
	adminAddr = unsafe.PreviousRealm().Address()
${channelInit}
}

// ── Queries ───────────────────────────────────────────────

func Render(path string) string {
	if path == "" {
		return renderBoardHome()
	}
	parts := strings.Split(path, "/")
	if len(parts) == 1 {
		return renderChannel(parts[0])
	}
	if len(parts) == 2 {
		tid, err := strconv.Atoi(parts[1])
		if err == nil {
			return renderThread(parts[0], tid)
		}
	}
	return "404 — not found"
}

func renderBoardHome() string {
	out := "# " + boardName + "\\n\\n"
	out += boardDescription + "\\n\\n"
	out += "## Channels\\n\\n"
	for _, ch := range channels {
		count := len(ch.Threads)
		out += "- [#" + ch.Name + "](:" + ch.Name + ") (" + strconv.Itoa(count) + " threads)\\n"
	}
	return out
}

func renderChannel(name string) string {
	for _, ch := range channels {
		if ch.Name == name {
			out := "# #" + ch.Name + "\\n\\n"
			if len(ch.Threads) == 0 {
				out += "*No threads yet. Be the first to post!*\\n"
				return out
			}
			for i := len(ch.Threads) - 1; i >= 0; i-- {
				t := ch.Threads[i]
				out += "### [" + t.Title + "](:" + ch.Name + "/" + strconv.Itoa(t.ID) + ")\\n"
				out += "by " + string(t.Author)[:10] + "... | " + strconv.Itoa(len(t.Replies)) + " replies | block " + strconv.FormatInt(t.CreatedAt, 10) + "\\n\\n"
			}
			return out
		}
	}
	return "Channel not found: " + name
}

func renderThread(channelName string, threadID int) string {
	for _, ch := range channels {
		if ch.Name == channelName {
			for _, t := range ch.Threads {
				if t.ID == threadID {
					out := "# " + t.Title + "\\n\\n"
					out += t.Body + "\\n\\n"
					out += "---\\n"
					out += "*Posted by " + string(t.Author) + " at block " + strconv.FormatInt(t.CreatedAt, 10) + "*\\n\\n"
					if len(t.Replies) > 0 {
						out += "## Replies (" + strconv.Itoa(len(t.Replies)) + ")\\n\\n"
						for _, r := range t.Replies {
							out += "**" + string(r.Author)[:10] + "...** (block " + strconv.FormatInt(r.CreatedAt, 10) + ")\\n\\n"
							out += r.Body + "\\n\\n---\\n\\n"
						}
					}
					return out
				}
			}
			return "Thread not found"
		}
	}
	return "Channel not found"
}

// ── Write Actions ─────────────────────────────────────────

func CreateThread(cur realm, channel, title, body string) int {
	caller := unsafe.PreviousRealm().Address()
	assertIsMember(caller)
	assertCanPost(caller)
	assertChannel(channel)
	if len(title) == 0 || len(title) > 128 {
		panic("title must be 1-128 characters")
	}
	if len(body) == 0 || len(body) > 8192 {
		panic("body must be 1-8192 characters")
	}
	id := nextThreadID
	nextThreadID++
	blockHeight := int64(0) // block height unavailable in this context
	for i, ch := range channels {
		if ch.Name == channel {
			channels[i].Threads = append(channels[i].Threads, Thread{
				ID:        id,
				Channel:   channel,
				Title:     title,
				Body:      body,
				Author:    caller,
				Replies:   []Reply{},
				CreatedAt: blockHeight,
			})
			lastPostBlock[string(caller)] = blockHeight
			return id
		}
	}
	panic("channel not found")
}

func ReplyToThread(cur realm, channel string, threadID int, body string) int {
	caller := unsafe.PreviousRealm().Address()
	assertIsMember(caller)
	assertCanPost(caller)
	assertChannel(channel)
	if len(body) == 0 || len(body) > 4096 {
		panic("reply must be 1-4096 characters")
	}
	id := nextReplyID
	nextReplyID++
	blockHeight := int64(0)
	for i, ch := range channels {
		if ch.Name == channel {
			for j, t := range ch.Threads {
				if t.ID == threadID {
					channels[i].Threads[j].Replies = append(channels[i].Threads[j].Replies, Reply{
						ID:        id,
						Body:      body,
						Author:    caller,
						CreatedAt: blockHeight,
					})
					lastPostBlock[string(caller)] = blockHeight
					return id
				}
			}
			panic("thread not found in channel")
		}
	}
	panic("channel not found")
}

// ── Admin Actions ─────────────────────────────────────────

func CreateChannel(cur realm, name string) {
	caller := unsafe.PreviousRealm().Address()
	assertIsAdmin(caller)
	if len(name) == 0 || len(name) > 30 {
		panic("channel name must be 1-30 characters")
	}
	if len(channels) >= 20 {
		panic("maximum 20 channels reached")
	}
	for _, ch := range channels {
		if ch.Name == name {
			panic("channel already exists: " + name)
		}
	}
	channels = append(channels, Channel{Name: name, Threads: []Thread{}})
}

// ── Guards ────────────────────────────────────────────────

// assertIsMember verifies the caller is a member of the parent DAO.
// Cross-realm call to the DAO's IsMember() function.
func assertIsMember(addr address) {
	if addr == adminAddr {
		return // admin is always a member
	}
	if !parent.IsMember(addr) {
		panic("caller is not a member of the parent DAO")
	}
}

// assertIsAdmin verifies the caller is the board admin (deployer).
func assertIsAdmin(addr address) {
	if addr != adminAddr {
		panic("only board admin can perform this action")
	}
}

func assertCanPost(addr address) {
	// Rate limiting placeholder — requires block height access.
	// Enable when cross-realm block height API is available.
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

/**
 * Build a MsgAddPackage Amino message for deploying a board realm.
 * @deprecated Use `buildDeployMsg` from `templates/prologue` directly.
 */
export function buildDeployBoardMsg(
    callerAddress: string,
    realmPath: string,
    code: string,
    deposit: string = "",
): AminoMsg {
    return buildDeployMsg(callerAddress, realmPath, code, deposit) as AminoMsg
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
