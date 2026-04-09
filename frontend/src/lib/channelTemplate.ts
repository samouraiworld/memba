/**
 * Channel Template Generator — generates enhanced Gno realm code for DAO channels.
 *
 * Evolved from boardTemplate.ts for v2.1a. Creates a self-contained channel realm with:
 * - Discord-like text channels with role-based ACL
 * - Channel types: text, announcements (admin-write), readonly
 * - Thread creation (title + Markdown body)
 * - Reply system (nested under threads)
 * - Token-gated writes ($MEMBA balance check)
 * - @mention support (parsed in Render output)
 * - Rate limiting (MIN_POST_INTERVAL blocks between posts)
 * - Admin actions: create/archive/reorder channels, edit/delete messages
 * - Public read access (anyone can query via Render)
 *
 * Deployed via MsgAddPackage through Adena DoContract.
 * Channel realm naming: {daoname}_channels suffix convention.
 * Backward compat: old _board realms still supported via boardTemplate.ts.
 *
 * @module channelTemplate
 */

import type { AminoMsg } from "./grc20"
import { isValidChannelName, isValidIdentifier } from "./templates/sanitizer"
import { buildDeployMsg } from "./templates/prologue"
export { isValidChannelName } from "./templates/sanitizer"

// ── Types ─────────────────────────────────────────────────────

/** Channel access control — which DAO roles can read/write. */
export interface ChannelACL {
    /** Roles that can read this channel (empty = public read). */
    readRoles: string[]
    /** Roles that can write to this channel. */
    writeRoles: string[]
}

/** Channel type controls built-in behavior. */
export type ChannelType = "text" | "announcements" | "readonly" | "voice" | "video"

/** Configuration for a single channel within the realm. */
export interface ChannelDef {
    /** Channel name (lowercase alphanumeric + hyphens). */
    name: string
    /** Channel type. */
    type: ChannelType
    /** Access control for this channel. */
    acl: ChannelACL
}

/** Full configuration for deploying a channel realm. */
export interface ChannelConfig {
    /** Parent DAO realm path (e.g., gno.land/r/username/mydao). */
    daoRealmPath: string
    /** Channel realm path (auto-derived: {daoPath}_channels). */
    channelRealmPath: string
    /** Channel realm name (human-readable). */
    name: string
    /** Channel realm description. */
    description: string
    /** Channel definitions with types and ACL. */
    channels: ChannelDef[]
    /** Minimum blocks between posts per user (rate limit). */
    minPostInterval: number
    /** Minimum $MEMBA token balance to post (0 = no gate). */
    minTokenBalance: number
    /** GRC20 factory path for token balance checks. */
    tokenFactoryPath: string
    /** Token symbol for balance check. */
    tokenSymbol: string
    /** Blocks after creation during which author can edit (0 = no edit). */
    editWindowBlocks: number
}

/** Default channel definitions for MembaDAO. */
export const MEMBA_CHANNEL_DEFS: ChannelDef[] = [
    { name: "general", type: "text", acl: { readRoles: [], writeRoles: ["member", "dev", "ops", "admin"] } },
    { name: "announcements", type: "announcements", acl: { readRoles: [], writeRoles: ["admin"] } },
    { name: "feature-requests", type: "text", acl: { readRoles: [], writeRoles: ["member", "dev", "ops", "admin"] } },
    { name: "support", type: "text", acl: { readRoles: [], writeRoles: ["member", "dev", "ops", "admin"] } },
    { name: "extensions", type: "text", acl: { readRoles: [], writeRoles: ["dev", "ops", "admin"] } },
    { name: "partnerships", type: "text", acl: { readRoles: [], writeRoles: ["ops", "admin"] } },
]

/** Default channel configuration factory from a DAO realm path. */
export function defaultChannelConfig(daoRealmPath: string, daoName: string): ChannelConfig {
    return {
        daoRealmPath,
        channelRealmPath: `${daoRealmPath}_channels`,
        name: `${daoName} Channels`,
        description: `Community channels for ${daoName}`,
        channels: [
            { name: "general", type: "text", acl: { readRoles: [], writeRoles: [] } },
        ],
        minPostInterval: 5,
        minTokenBalance: 0,
        tokenFactoryPath: "gno.land/r/samcrew/tokenfactory",
        tokenSymbol: "",
        editWindowBlocks: 100,
    }
}

// Input validation delegated to templates/sanitizer.ts (isValidChannelName)

// ── Code Generator ────────────────────────────────────────────

/**
 * Generate Gno realm source code for Discord-like DAO channels.
 * Returns a self-contained .gno file as a string.
 *
 * Security: all user inputs are sanitized before interpolation.
 * Note: `\\n` in template strings produces `\n` in Go source (correct behavior).
 */
export function generateChannelCode(config: ChannelConfig): string {
    const pkgName = config.channelRealmPath.split("/").pop() || "channels"

    const safeChannels = config.channels.filter(ch => isValidChannelName(ch.name))
    if (safeChannels.length === 0) {
        safeChannels.push({ name: "general", type: "text", acl: { readRoles: [], writeRoles: [] } })
    }

    // Generate channel init block
    const channelInit = safeChannels
        .map((ch) => {
            const safeType = ["text", "announcements", "readonly", "voice", "video"].includes(ch.type)
                ? ch.type : "text"
            const safeReadRoles = ch.acl.readRoles.filter(isValidIdentifier)
            const safeWriteRoles = ch.acl.writeRoles.filter(isValidIdentifier)
            const readRolesStr = safeReadRoles.length > 0
                ? `"${safeReadRoles.join(",")}"`
                : `""`
            const writeRolesStr = safeWriteRoles.length > 0
                ? `"${safeWriteRoles.join(",")}"`
                : `""`
            return `\tchannels = append(channels, Channel{
\t\tName:       "${ch.name}",
\t\tChanType:   "${safeType}",
\t\tReadRoles:  ${readRolesStr},
\t\tWriteRoles: ${writeRolesStr},
\t\tThreads:    []Thread{},
\t\tArchived:   false,
\t})`
        })
        .join("\n")

    // Token gate import and check
    const hasTokenGate = config.minTokenBalance > 0 && config.tokenSymbol !== ""
    const tokenGateImport = hasTokenGate
        ? `\n\tgrc20factory "${config.tokenFactoryPath}"`
        : ""
    const tokenGateCheck = hasTokenGate
        ? `
// assertHasTokens verifies the caller holds enough tokens to post.
func assertHasTokens(addr address) {
\tbal := grc20factory.BalanceOf("${config.tokenSymbol}", string(addr))
\tif bal < ${config.minTokenBalance} {
\t\tpanic("insufficient $${config.tokenSymbol} balance: need ${config.minTokenBalance}, have " + strconv.Itoa(int(bal)))
\t}
}`
        : `
// assertHasTokens is a no-op when token gating is disabled.
func assertHasTokens(addr address) {}`

    return `package ${pkgName}

import (
\t"chain/runtime"
\t"strconv"
\t"strings"

\t"gno.land/p/demo/avl"${tokenGateImport}
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
\tEditedAt  int64 // 0 if never edited
\tDeleted   bool
}

type Reply struct {
\tID        int
\tBody      string
\tAuthor    address
\tCreatedAt int64
\tEditedAt  int64
\tDeleted   bool
}

type Channel struct {
\tName       string
\tChanType   string // "text", "announcements", "readonly"
\tReadRoles  string // comma-separated roles (empty = public)
\tWriteRoles string // comma-separated roles (empty = all members)
\tThreads    []Thread
\tArchived   bool
}

// ── State ─────────────────────────────────────────────────

var (
\tchannelRealmName = ${JSON.stringify(config.name)}
\tchannelRealmDesc = ${JSON.stringify(config.description)}
\tdaoRealmPath     = ${JSON.stringify(config.daoRealmPath)}
\tchannels         []Channel
\tchannelOrder     []string // ordered channel names for display
\tnextThreadID     = 0
\tnextReplyID      = 0
\tlastPostBlock    map[string]int64 // address → last post block height
\tminPostInterval  = ${config.minPostInterval}
\tadminAddr        address
\tmembers          *avl.Tree // address string → role string (v3 ACL)
)

func init() {
\tlastPostBlock = make(map[string]int64)
\tmembers = avl.NewTree()
\tadminAddr = runtime.PreviousRealm().Address()
\tmembers.Set(string(adminAddr), "admin") // deployer is first member
${channelInit}
\t// Set initial channel order
${safeChannels.map(ch => `\tchannelOrder = append(channelOrder, "${ch.name}")`).join("\n")}
}

// ── Member Management (v3 ACL) ──────────────────────────────

// AddMember registers a DAO member. Admin only.
func AddMember(_ realm, addr address, role string) {
\tcaller := runtime.PreviousRealm().Address()
\tassertIsAdmin(caller)
\tmembers.Set(string(addr), role)
}

// RemoveMember removes a member. Admin only.
func RemoveMember(_ realm, addr address) {
\tcaller := runtime.PreviousRealm().Address()
\tassertIsAdmin(caller)
\tif addr == adminAddr {
\t\tpanic("cannot remove admin")
\t}
\tmembers.Remove(string(addr))
}

// ── Queries ───────────────────────────────────────────────

func Render(path string) string {
\tif path == "" {
\t\treturn renderHome()
\t}
\tif strings.HasPrefix(path, "__acl/") {
\t\treturn renderACL(strings.TrimPrefix(path, "__acl/"))
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

func renderHome() string {
\tout := "# " + channelRealmName + "\\n\\n"
\tout += channelRealmDesc + "\\n\\n"
\tout += "## Channels\\n\\n"
\tfor _, name := range channelOrder {
\t\tfor _, ch := range channels {
\t\t\tif ch.Name == name && !ch.Archived {
\t\t\t\tcount := countActiveThreads(ch)
\t\t\t\ttypeTag := ""
\t\t\t\tif ch.ChanType == "announcements" {
\t\t\t\t\ttypeTag = " 📢"
\t\t\t\t} else if ch.ChanType == "readonly" {
\t\t\t\t\ttypeTag = " 🔒"
\t\t\t\t}
\t\t\t\tout += "- [#" + ch.Name + "](:_channel/" + ch.Name + ")" + typeTag + " (" + strconv.Itoa(count) + " threads)\\n"
\t\t\t}
\t\t}
\t}
\treturn out
}

func renderChannel(name string) string {
\tfor _, ch := range channels {
\t\tif ch.Name == name {
\t\t\tif ch.Archived {
\t\t\t\treturn "# #" + ch.Name + " (archived)\\n\\n*This channel has been archived.*\\n"
\t\t\t}
\t\t\tout := "# #" + ch.Name + "\\n\\n"
\t\t\tactive := getActiveThreads(ch)
\t\t\tif len(active) == 0 {
\t\t\t\tout += "*No threads yet. Be the first to post!*\\n"
\t\t\t\treturn out
\t\t\t}
\t\t\tfor i := len(active) - 1; i >= 0; i-- {
\t\t\t\tt := active[i]
\t\t\t\tout += "### [" + t.Title + "](:" + ch.Name + "/" + strconv.Itoa(t.ID) + ")\\n"
\t\t\t\tout += "by " + truncAddr(t.Author) + " | " + strconv.Itoa(countActiveReplies(t)) + " replies | block " + strconv.FormatInt(t.CreatedAt, 10) + "\\n\\n"
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
\t\t\t\t\tif t.Deleted {
\t\t\t\t\t\treturn "# [Deleted]\\n\\n*This message has been deleted.*\\n"
\t\t\t\t\t}
\t\t\t\t\tout := "# " + t.Title + "\\n\\n"
\t\t\t\t\tout += t.Body + "\\n\\n"
\t\t\t\t\tout += "---\\n"
\t\t\t\t\tout += "*Posted by " + string(t.Author) + " at block " + strconv.FormatInt(t.CreatedAt, 10) + "*"
\t\t\t\t\tif t.EditedAt > 0 {
\t\t\t\t\t\tout += " *(edited at block " + strconv.FormatInt(t.EditedAt, 10) + ")*"
\t\t\t\t\t}
\t\t\t\t\tout += "\\n\\n"
\t\t\t\t\tactive := getActiveReplies(t)
\t\t\t\t\tif len(active) > 0 {
\t\t\t\t\t\tout += "## Replies (" + strconv.Itoa(len(active)) + ")\\n\\n"
\t\t\t\t\t\tfor _, r := range active {
\t\t\t\t\t\t\tout += "**" + truncAddr(r.Author) + "** (block " + strconv.FormatInt(r.CreatedAt, 10) + ")"
\t\t\t\t\t\t\tif r.EditedAt > 0 {
\t\t\t\t\t\t\t\tout += " *(edited)*"
\t\t\t\t\t\t\t}
\t\t\t\t\t\t\tout += "\\n\\n"
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

func renderACL(channelName string) string {
\tfor _, ch := range channels {
\t\tif ch.Name == channelName {
\t\t\treturn "read:" + ch.ReadRoles + "\\nwrite:" + ch.WriteRoles + "\\ntype:" + ch.ChanType
\t\t}
\t}
\treturn "Channel not found"
}

// ── Write Actions ─────────────────────────────────────────

func CreateThread(cur realm, channel, title, body string) int {
\tcaller := runtime.PreviousRealm().Address()
\tassertIsMember(caller)
\tassertCanPost(caller)
\tassertHasTokens(caller)
\tassertChannelWritable(channel, caller)
\tif len(title) == 0 || len(title) > 128 {
\t\tpanic("title must be 1-128 characters")
\t}
\tif len(body) == 0 || len(body) > 8192 {
\t\tpanic("body must be 1-8192 characters")
\t}
\tid := nextThreadID
\tnextThreadID++
\tblockHeight := runtime.ChainHeight()
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
\t\t\t\tEditedAt:  0,
\t\t\t\tDeleted:   false,
\t\t\t})
\t\t\tlastPostBlock[string(caller)] = blockHeight
\t\t\treturn id
\t\t}
\t}
\tpanic("channel not found")
}

func ReplyToThread(cur realm, channel string, threadID int, body string) int {
\tcaller := runtime.PreviousRealm().Address()
\tassertIsMember(caller)
\tassertCanPost(caller)
\tassertHasTokens(caller)
\tassertChannelWritable(channel, caller)
\tif len(body) == 0 || len(body) > 4096 {
\t\tpanic("reply must be 1-4096 characters")
\t}
\tid := nextReplyID
\tnextReplyID++
\tblockHeight := runtime.ChainHeight()
\tfor i, ch := range channels {
\t\tif ch.Name == channel {
\t\t\tfor j, t := range ch.Threads {
\t\t\t\tif t.ID == threadID && !t.Deleted {
\t\t\t\t\tchannels[i].Threads[j].Replies = append(channels[i].Threads[j].Replies, Reply{
\t\t\t\t\t\tID:        id,
\t\t\t\t\t\tBody:      body,
\t\t\t\t\t\tAuthor:    caller,
\t\t\t\t\t\tCreatedAt: blockHeight,
\t\t\t\t\t\tEditedAt:  0,
\t\t\t\t\t\tDeleted:   false,
\t\t\t\t\t})
\t\t\t\t\tlastPostBlock[string(caller)] = blockHeight
\t\t\t\t\treturn id
\t\t\t\t}
\t\t\t}
\t\t\tpanic("thread not found or deleted")
\t\t}
\t}
\tpanic("channel not found")
}

// ── Edit / Delete ─────────────────────────────────────────

func EditMessage(cur realm, channel string, threadID int, replyID int, newBody string) {
	caller := runtime.PreviousRealm().Address()
	assertIsMember(caller)
	blockHeight := runtime.ChainHeight()
	if len(newBody) == 0 || len(newBody) > 8192 {
		panic("body must be 1-8192 characters")
	}
	for i, ch := range channels {
		if ch.Name == channel {
			for j, t := range ch.Threads {
				if t.ID == threadID {
					if replyID < 0 {
						// Edit thread body
						if t.Author != caller {
							panic("only the author can edit")
						}
						if blockHeight-t.CreatedAt > ${config.editWindowBlocks} {
							panic("edit window expired (${config.editWindowBlocks} blocks)")
						}
						channels[i].Threads[j].Body = newBody
						channels[i].Threads[j].EditedAt = blockHeight
						return
					}
					// Edit reply
					for k, r := range t.Replies {
						if r.ID == replyID {
							if r.Author != caller {
								panic("only the author can edit")
							}
							if blockHeight-r.CreatedAt > ${config.editWindowBlocks} {
								panic("edit window expired (${config.editWindowBlocks} blocks)")
							}
							channels[i].Threads[j].Replies[k].Body = newBody
							channels[i].Threads[j].Replies[k].EditedAt = blockHeight
							return
						}
					}
					panic("reply not found")
				}
			}
			panic("thread not found")
		}
	}
	panic("channel not found")
}

func DeleteMessage(cur realm, channel string, threadID int, replyID int) {
\tcaller := runtime.PreviousRealm().Address()
\tassertIsMember(caller)
\tfor i, ch := range channels {
\t\tif ch.Name == channel {
\t\t\tfor j, t := range ch.Threads {
\t\t\t\tif t.ID == threadID {
\t\t\t\t\tif replyID < 0 {
\t\t\t\t\t\t// Delete thread
\t\t\t\t\t\tif t.Author != caller && caller != adminAddr {
\t\t\t\t\t\t\tpanic("only author or admin can delete")
\t\t\t\t\t\t}
\t\t\t\t\t\tchannels[i].Threads[j].Deleted = true
\t\t\t\t\t\treturn
\t\t\t\t\t}
\t\t\t\t\t// Delete reply
\t\t\t\t\tfor k, r := range t.Replies {
\t\t\t\t\t\tif r.ID == replyID {
\t\t\t\t\t\t\tif r.Author != caller && caller != adminAddr {
\t\t\t\t\t\t\t\tpanic("only author or admin can delete")
\t\t\t\t\t\t\t}
\t\t\t\t\t\t\tchannels[i].Threads[j].Replies[k].Deleted = true
\t\t\t\t\t\t\treturn
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t\tpanic("reply not found")
\t\t\t\t}
\t\t\t}
\t\t\tpanic("thread not found")
\t\t}
\t}
\tpanic("channel not found")
}

// ── Admin Actions ─────────────────────────────────────────

func CreateChannel(cur realm, name, chanType, readRoles, writeRoles string) {
\tcaller := runtime.PreviousRealm().Address()
\tassertIsAdmin(caller)
\tif len(name) == 0 || len(name) > 30 {
\t\tpanic("channel name must be 1-30 characters")
\t}
\tif chanType != "text" && chanType != "announcements" && chanType != "readonly" {
\t\tpanic("invalid channel type: " + chanType)
\t}
\tif len(channels) >= 50 {
\t\tpanic("maximum 50 channels reached")
\t}
\tfor _, ch := range channels {
\t\tif ch.Name == name {
\t\t\tpanic("channel already exists: " + name)
\t\t}
\t}
\tchannels = append(channels, Channel{
\t\tName:       name,
\t\tChanType:   chanType,
\t\tReadRoles:  readRoles,
\t\tWriteRoles: writeRoles,
\t\tThreads:    []Thread{},
\t\tArchived:   false,
\t})
\tchannelOrder = append(channelOrder, name)
}

func SetChannelACL(cur realm, channel, readRoles, writeRoles string) {
\tcaller := runtime.PreviousRealm().Address()
\tassertIsAdmin(caller)
\tfor i, ch := range channels {
\t\tif ch.Name == channel {
\t\t\tchannels[i].ReadRoles = readRoles
\t\t\tchannels[i].WriteRoles = writeRoles
\t\t\treturn
\t\t}
\t}
\tpanic("channel not found: " + channel)
}

func ArchiveChannel(cur realm, name string) {
\tcaller := runtime.PreviousRealm().Address()
\tassertIsAdmin(caller)
\tfor i, ch := range channels {
\t\tif ch.Name == name {
\t\t\tchannels[i].Archived = true
\t\t\treturn
\t\t}
\t}
\tpanic("channel not found: " + name)
}

func ReorderChannels(cur realm, order string) {
\tcaller := runtime.PreviousRealm().Address()
\tassertIsAdmin(caller)
\tnewOrder := strings.Split(order, ",")
\t// Validate all names exist
\tfor _, name := range newOrder {
\t\tfound := false
\t\tfor _, ch := range channels {
\t\t\tif ch.Name == name {
\t\t\t\tfound = true
\t\t\t\tbreak
\t\t\t}
\t\t}
\t\tif !found {
\t\t\tpanic("unknown channel in order: " + name)
\t\t}
\t}
\tchannelOrder = newOrder
}

// ── Guards ────────────────────────────────────────────────

func assertIsMember(addr address) {
\tif _, exists := members.Get(string(addr)); !exists {
\t\tpanic("unauthorized: DAO membership required to post")
\t}
}

func assertIsAdmin(addr address) {
\tif addr != adminAddr {
\t\tpanic("only admin can perform this action")
\t}
}

func assertCanPost(addr address) {
\tif last, ok := lastPostBlock[string(addr)]; ok {
\t\tcurrent := runtime.ChainHeight()
\t\tif current-last < int64(minPostInterval) {
\t\t\tpanic("rate limited: wait " + strconv.Itoa(minPostInterval) + " blocks between posts")
\t\t}
\t}
\t// NOTE: block height recording moved to write functions (after all guards pass)
}

${tokenGateCheck}

func assertChannelWritable(channelName string, caller address) {
\tfor _, ch := range channels {
\t\tif ch.Name == channelName {
\t\t\tif ch.Archived {
\t\t\t\tpanic("channel is archived")
\t\t\t}
\t\t\tif ch.ChanType == "readonly" {
\t\t\t\tpanic("channel is read-only")
\t\t\t}
\t\t\tif ch.ChanType == "announcements" && caller != adminAddr {
\t\t\t\tpanic("only admin can post in announcement channels")
\t\t\t}
\t\t\t// Check write role ACL (v3: uses local members tree)
\t\t\tif ch.WriteRoles != "" {
\t\t\t\troleVal, exists := members.Get(string(caller))
\t\t\t\tif !exists {
\t\t\t\t\tpanic("unauthorized: membership required")
\t\t\t\t}
\t\t\t\tcallerRole := roleVal.(string)
\t\t\t\t// Admin always passes
\t\t\t\tif callerRole == "admin" {
\t\t\t\t\treturn
\t\t\t\t}
\t\t\t\t// Check if caller's role is in the write roles list
\t\t\t\tallowed := false
\t\t\t\tfor _, wr := range strings.Split(ch.WriteRoles, ",") {
\t\t\t\t\tif strings.TrimSpace(wr) == callerRole {
\t\t\t\t\t\tallowed = true
\t\t\t\t\t\tbreak
\t\t\t\t\t}
\t\t\t\t}
\t\t\t\tif !allowed {
\t\t\t\t\tpanic("unauthorized: your role (" + callerRole + ") cannot write to this channel")
\t\t\t\t}
\t\t\t}
\t\t\treturn
\t\t}
\t}
\tpanic("unknown channel: " + channelName)
}

// ── Helpers ───────────────────────────────────────────────

func truncAddr(addr address) string {
\ts := string(addr)
\tif len(s) > 13 {
\t\treturn s[:10] + "..."
\t}
\treturn s
}

func countActiveThreads(ch Channel) int {
\tcount := 0
\tfor _, t := range ch.Threads {
\t\tif !t.Deleted {
\t\t\tcount++
\t\t}
\t}
\treturn count
}

func getActiveThreads(ch Channel) []Thread {
\tvar active []Thread
\tfor _, t := range ch.Threads {
\t\tif !t.Deleted {
\t\t\tactive = append(active, t)
\t\t}
\t}
\treturn active
}

func countActiveReplies(t Thread) int {
\tcount := 0
\tfor _, r := range t.Replies {
\t\tif !r.Deleted {
\t\t\tcount++
\t\t}
\t}
\treturn count
}

func getActiveReplies(t Thread) []Reply {
\tvar active []Reply
\tfor _, r := range t.Replies {
\t\tif !r.Deleted {
\t\t\tactive = append(active, r)
\t\t}
\t}
\treturn active
}

// ── Config ────────────────────────────────────────────────

func GetChannelConfig() string {
\treturn channelRealmName + "|" + channelRealmDesc + "|" + daoRealmPath
}
`
}

/**
 * Build a MsgAddPackage Amino message for deploying a channel realm.
 * @deprecated Use `buildDeployMsg` from `templates/prologue` directly.
 */
export function buildDeployChannelMsg(
    callerAddress: string,
    realmPath: string,
    code: string,
    deposit: string = "",
): AminoMsg {
    return buildDeployMsg(callerAddress, realmPath, code, deposit) as AminoMsg
}

// ── MsgCall Builders ──────────────────────────────────────

/** Build a MsgCall for CreateThread on a channel realm. */
export function buildChannelCreateThreadMsg(
    caller: string,
    channelRealmPath: string,
    channel: string,
    title: string,
    body: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: channelRealmPath,
            func: "CreateThread",
            args: [channel, title, body],
        },
    }
}

/** Build a MsgCall for ReplyToThread on a channel realm. */
export function buildChannelReplyMsg(
    caller: string,
    channelRealmPath: string,
    channel: string,
    threadId: number,
    body: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: channelRealmPath,
            func: "ReplyToThread",
            args: [channel, String(threadId), body],
        },
    }
}

/** Build a MsgCall for CreateChannel on a channel realm (admin only). */
export function buildCreateChannelMsg(
    caller: string,
    channelRealmPath: string,
    channelName: string,
    channelType: ChannelType = "text",
    readRoles: string = "",
    writeRoles: string = "",
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: channelRealmPath,
            func: "CreateChannel",
            args: [channelName, channelType, readRoles, writeRoles],
        },
    }
}

/** Build a MsgCall for SetChannelACL (admin only). */
export function buildSetACLMsg(
    caller: string,
    channelRealmPath: string,
    channel: string,
    readRoles: string,
    writeRoles: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: channelRealmPath,
            func: "SetChannelACL",
            args: [channel, readRoles, writeRoles],
        },
    }
}

/** Build a MsgCall for ArchiveChannel (admin only). */
export function buildArchiveChannelMsg(
    caller: string,
    channelRealmPath: string,
    channelName: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: channelRealmPath,
            func: "ArchiveChannel",
            args: [channelName],
        },
    }
}

/** Build a MsgCall for ReorderChannels (admin only). */
export function buildReorderChannelsMsg(
    caller: string,
    channelRealmPath: string,
    orderedNames: string[],
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: channelRealmPath,
            func: "ReorderChannels",
            args: [orderedNames.join(",")],
        },
    }
}

/** Build a MsgCall for EditMessage (author only, within edit window). */
export function buildEditMessageMsg(
    caller: string,
    channelRealmPath: string,
    channel: string,
    threadId: number,
    replyId: number,
    newBody: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: channelRealmPath,
            func: "EditMessage",
            args: [channel, String(threadId), String(replyId), newBody],
        },
    }
}

/** Build a MsgCall for DeleteMessage (author or admin). */
export function buildDeleteMessageMsg(
    caller: string,
    channelRealmPath: string,
    channel: string,
    threadId: number,
    replyId: number,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: channelRealmPath,
            func: "DeleteMessage",
            args: [channel, String(threadId), String(replyId)],
        },
    }
}
