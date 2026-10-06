/**
 * memba_gov actions as signing requests: vote, execute (a roster action on the
 * core, an app action through the bridge), join, and a member's emergency
 * pause. Right before the wallet opens each re-reads what the realm will
 * check; an app action also asks the bridge whether the app's state still
 * matches the vote. Receipts lock an unknown outcome until it is checked.
 *
 * @module os/daos/govRequests
 */
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { broadcastDaoTx } from "../../lib/dao/daoTx"
import type { GovernanceScope } from "../../lib/dao/governanceRecovery"
import { BRIDGE_APPS, GOV_PATH } from "../../lib/dao/govActions"
import { approvalMatches, bridgeExecution, planGovCall, type GovCall, type GovVote } from "../../lib/dao/govTx"
import { govProposalTitle } from "../../lib/dao/govView"
import { readBridgeApproval, readBridgePauses, readGovProposal, readGovSnapshot, type GovProposal } from "../../lib/dao/membaGov"
import { formatUgnot } from "../../lib/dao/v2Budget"
import type { GasPrice } from "../../lib/grc20"
import { withFeeCheck } from "../sign/recheck"
import type { SignRequest } from "../sign/signer"
import { sheetFee } from "./sheetFee"

const ctx = () => ({ rpcUrl: GNO_RPC_URL, chainId: GNO_CHAIN_ID })
const now = () => Math.floor(Date.now() / 1000)

export const govScope = (caller: string, operation: string): GovernanceScope => ({ chainId: GNO_CHAIN_ID, realmPath: GOV_PATH, caller, operation })

export interface GovSigner { caller: string; gasPrice: GasPrice }

interface Spec {
    title: string; summary: string; lines: [string, string][]; acks?: string[]; warns?: string[]
    operation: string; recheck: () => Promise<void>; verify: () => Promise<boolean | "failed">
}

function request(s: GovSigner, call: GovCall, spec: Spec): SignRequest {
    const plan = planGovCall(s.caller, call)
    const fee = sheetFee(plan, s.gasPrice)
    return {
        title: spec.title, summary: spec.summary, sub: "Memba DAO",
        lines: () => [...spec.lines, ["Storage deposit", `up to ${formatUgnot(plan.maxDepositUgnot!)}`], fee.line, ["Network", GNO_CHAIN_ID]],
        acks: spec.acks ?? [], warns: spec.warns, label: () => spec.summary, receipt: govScope(s.caller, spec.operation),
        prepare: () => ({ msgs: [plan.msg] }),
        recheck: async () => { await withFeeCheck(spec.recheck(), fee.assertStillCovers()) },
        send: (_choice, beforeSign) => broadcastDaoTx(plan, spec.summary, beforeSign, { fee: fee.fee }),
        verify: () => spec.verify(),
    }
}

/** The caller's seat now, or a refusal. */
async function seated(caller: string) {
    const me = (await readGovSnapshot(ctx())).roster.members.find((m) => m.address === caller)
    if (!me) throw new Error("This address no longer holds a seat. Nothing was sent.")
    return me
}

const OPEN = new Set(["voting", "timelocked", "ready"])

/** `raw`: Memba cannot decode the action, so a YES needs the member's own acknowledgement. */
export function govVoteRequest(s: GovSigner, p: GovProposal, vote: GovVote, raw: boolean): SignRequest {
    const title = govProposalTitle(p)
    return request(s, { type: "vote", id: p.id, vote }, {
        title: "Vote", summary: `Vote ${vote.toUpperCase()} on #${p.id}`,
        lines: [["Proposal", `#${p.id} ${title}`], ["Your vote", vote.toUpperCase()]],
        acks: raw && vote === "yes" ? [`I have read the code of ${p.target}. Memba cannot read this action; if it passes, it runs exactly as shown.`] : [],
        operation: `vote:${p.id}`,
        recheck: async () => {
            const [fresh] = await Promise.all([readGovProposal(ctx(), p.id), seated(s.caller)])
            if (!OPEN.has(fresh.status)) throw new Error(`This proposal is now ${fresh.status}. Nothing was sent.`)
            if (fresh.action !== p.action || fresh.args !== p.args || fresh.target !== p.target) throw new Error("This proposal reads differently now. Review it again.")
        },
        verify: async () => {
            const me = await seated(s.caller)
            return (await readGovProposal(ctx(), p.id)).ballots.some((b) => b.person === me.id && b.vote === vote)
        },
    })
}

export function govExecuteRequest(s: GovSigner, p: GovProposal): SignRequest {
    const core = p.target === GOV_PATH
    const bridge = core ? null : bridgeExecution(p)
    return request(s, { type: "execute", proposal: p }, {
        title: "Execute", summary: `Execute #${p.id}`,
        lines: [["Proposal", `#${p.id} ${govProposalTitle(p)}`], ["Runs", core ? "Memba DAO's roster change" : `${bridge!.func} on the bridge, which calls the app`]],
        warns: core ? ["A roster change ends every other open proposal."] : undefined,
        operation: `execute:${p.id}`,
        recheck: async () => {
            const [fresh] = await Promise.all([readGovProposal(ctx(), p.id), seated(s.caller)])
            if (fresh.status !== "ready") throw new Error(`This proposal is ${fresh.status}, not ready. Nothing was sent.`)
            if (bridge && !approvalMatches(p, await readBridgeApproval(ctx(), bridge.approval))) {
                throw new Error("The app changed since the vote: this approval no longer matches it and cannot run. Nothing was sent.")
            }
        },
        verify: async () => (await readGovProposal(ctx(), p.id)).status === "executed",
    })
}

export function govJoinRequest(s: GovSigner, personId: string): SignRequest {
    return request(s, { type: "join" }, {
        title: "Join Memba DAO", summary: `Join Memba DAO as ${personId}`,
        lines: [["Seat", personId], ["Key", s.caller]],
        warns: ["Joining ends every open proposal: members vote again on the new roster."],
        operation: "join",
        recheck: async () => {
            const { roster } = await readGovSnapshot(ctx())
            if (!roster.invitations.some((i) => i.address === s.caller && i.id === personId)) throw new Error("This address has no open invitation now. Nothing was sent.")
        },
        verify: async () => (await readGovSnapshot(ctx())).roster.members.some((m) => m.address === s.caller),
    })
}

/** `expire`: anyone ends a bridge pause that is over; otherwise a seated member pauses the app for 7 days. */
export function govPauseRequest(s: GovSigner, app: string, expire: boolean): SignRequest {
    const label = BRIDGE_APPS[app].label
    return request(s, { type: expire ? "expire-pause" : "pause", app }, {
        title: expire ? "End a pause" : "Emergency pause",
        summary: expire ? `End ${label}'s expired pause` : `Pause ${label} for 7 days`,
        lines: [["App", label]],
        warns: expire ? undefined : ["Each member may pause once every 30 days, across all apps. A vote can end or extend it."],
        operation: `${expire ? "expire" : "pause"}:${app}`,
        recheck: async () => {
            const [until] = await Promise.all([readBridgePauses(ctx()).then((p) => p[app]), expire ? null : seated(s.caller)])
            if (expire ? until === 0 || until > now() : until > now()) throw new Error(expire ? "This pause is not over. Nothing was sent." : "This app is already paused. Nothing was sent.")
        },
        verify: async () => {
            const until = (await readBridgePauses(ctx()))[app]
            return expire ? until === 0 : until > now()
        },
    })
}
