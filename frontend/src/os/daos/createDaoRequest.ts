/**
 * Deploying a DAO as a signing request, on the classic page's pipeline
 * (pages/CreateDAO.tsx deployDAO): the chain checks (the signer may publish
 * under the namespace, the path is free), the code generator, the deposit cap,
 * a gas budget sized for the network's submission policy, a durable pending
 * record saved before the wallet opens, and "live" read from the chain only.
 * On gnoland-1 (policy "inert") a deploy waits for network approval.
 *
 * @module os/daos/createDaoRequest
 */
import { ugnotInCoinsJson } from "../../lib/bankBalance"
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { assertCanDeployTo } from "../../lib/dao/namespace"
import { abciQueryText, assertPathAvailable, codeSubmissionPolicy, PathTakenError, removePendingDAO, savePendingDAO, waitForPackage, type ChainContext, type PendingDAO } from "../../lib/dao/packageStatus"
import { beginSubmission, isSubmissionActive, submissionKey } from "../../lib/dao/submissionActivity"
import { saveDAOForRecovery } from "../../lib/daoSlug"
import { buildDeployDAOMsg, generateDAOCode, type DAOCreationConfig } from "../../lib/daoTemplate"
import { assertFeeStillCovers, doContractBroadcast, feeForGasWanted, networkGasPriceFresh, type AminoMsg, type GasPrice } from "../../lib/grc20"
import { getRpcUrlsInOrder } from "../../lib/rpcFallback"
import { daoDepositCapUgnot, deployGasForPolicy, estimateDAODepositUgnot, formatGnot } from "../../lib/templates/dao/v2/deposit"
import type { SignRequest } from "../sign/signer"
import { verifySendTx } from "../wallet/sendRequest"
import { GUEST_SEAT, ZERO_MEMBER } from "./createDao"

/** Chain checks walk the network's endpoint list (each endpoint must serve this chain). */
export function deployChain(): ChainContext {
    return { rpcUrl: GNO_RPC_URL, chainId: GNO_CHAIN_ID, rpcUrls: getRpcUrlsInOrder() }
}

export interface DeployChecks {
    /** The chain's code_submission_policy; "unknown" sizes the larger full-deploy budget. */
    policy: string
    /** The path holds this wallet's own parked submission, which the deploy replaces. */
    replacesParked: boolean
    /** The deploying wallet's ugnot. */
    balanceUgnot: bigint
}

/**
 * The chain decides: the signer must own the namespace, the path must be unused
 * (live or waiting for approval), and the wallet's balance is read for the costs.
 */
export async function runDeployChecks(wallet: string, realmPath: string): Promise<DeployChecks> {
    const chain = deployChain()
    await assertCanDeployTo(chain, wallet, realmPath)
    const { replacesParked } = await assertPathAvailable(chain, realmPath, wallet).catch((err: unknown) => {
        // The address is made from the DAO name: say what to change.
        throw err instanceof PathTakenError ? new Error("This address is already used on the network. Change the DAO name in step 1: the address is made from the name's Latin letters a–z and digits, up to 20.") : err
    })
    // The policy only sizes the transaction; success is read from the chain.
    const policy = await codeSubmissionPolicy(chain).catch(() => "unknown")
    const balanceUgnot = ugnotInCoinsJson(await abciQueryText(chain, `bank/balances/${wallet}`, ""))
    return { policy, replacesParked, balanceUgnot }
}

/** Deposit and fee for the review, as the classic page computes them. */
export function deployCosts(config: DAOCreationConfig, policy: string, price: GasPrice) {
    const gasWanted = deployGasForPolicy(config, policy)
    return { estimateUgnot: estimateDAODepositUgnot(config), capUgnot: daoDepositCapUgnot(config), gasWanted, feeUgnot: feeForGasWanted(gasWanted, price) }
}

/** When the storage deposit leaves the creator's balance under this submission policy. */
export function depositLeaves(policy: string): string {
    return policy === "inert" ? "when gno.land enables the package" : policy === "unknown" ? "when the package is stored or enabled" : "when the package is deployed"
}

/**
 * The balance must hold the fee and the deposit cap: the estimate is a model,
 * and the chain may take up to the cap. Under "inert" the fee leaves at signing
 * and the deposit when the package is enabled: a balance short of it then leaves
 * the package parked, never enabled.
 */
export function balanceShortfall(balanceUgnot: bigint, costs: { feeUgnot: number; estimateUgnot: number; capUgnot: number }, policy: string): string | null {
    const need = BigInt(costs.feeUgnot) + BigInt(costs.capUgnot)
    if (balanceUgnot >= need) return null
    return `Your balance is ${formatGnot(Number(balanceUgnot))}. Deploying can take up to ${formatGnot(Number(need))}: the network fee and a storage deposit of about ${formatGnot(costs.estimateUgnot)} (at most ${formatGnot(costs.capUgnot)}), taken ${depositLeaves(policy)}. Add GNOT to this wallet first.`
}

export type DeployResult =
    | { kind: "live" }
    /** Stored but not enabled (inert), or `unconfirmed`: the status could not be read. */
    | { kind: "pending"; unconfirmed: boolean; reason: string }
    /** The chain ran the deploy and refused it. */
    | { kind: "refused" }
    /** No package at the path, and the chain does not show the transaction as refused. */
    | { kind: "missing" }

/** The tray and the wizard say the same about a deploy that is not live. */
export const PARKED_NOTE = "Waiting for network approval: gno.land enables new packages before they can be used. Nothing else to send."
export const MISSING_NOTE = "The network shows no package at this address yet. Check the transaction in your wallet or an explorer before deploying again."

export interface CreateDaoContext {
    wallet: string
    config: DAOCreationConfig
    checks: DeployChecks
    /** The price the review's fee line was computed with. */
    price: GasPrice
    /** The price read right before the wallet opens, when it makes the fee higher than reviewed: the review shows it. */
    onRisenPrice?: (price: GasPrice) => void
    /** Review lines the wizard already shows (rules, members…). */
    lines: [string, string][]
    warns: string[]
    /** The wallet returned a transaction. */
    onSubmitted: (hash: string) => void
    /** What the chain shows after the submission. */
    onResult: (result: DeployResult, hash: string) => void
}

/** Throws (with a user message) when the configuration can't be generated. */
export function createDaoRequest(ctx: CreateDaoContext): SignRequest<string> {
    const { wallet, config, checks } = ctx
    // A guest's stand-in seat, or a pasted zero address, is never deployed as a member.
    if (config.members.some((m) => m.address === GUEST_SEAT) || config.realmPath.includes(GUEST_SEAT)) throw new Error(ZERO_MEMBER)
    const path = config.realmPath
    const code = generateDAOCode(config)
    const { capUgnot, estimateUgnot, gasWanted, feeUgnot } = deployCosts(config, checks.policy, ctx.price)
    const msg = buildDeployDAOMsg(wallet, path, code, `${capUgnot}ugnot`)
    const msgs: AminoMsg[] = [{ type: "/vm.m_addpkg", value: msg.value }]
    const memo = `Deploy realm ${path} (storage deposit up to ${formatGnot(capUgnot)})${checks.replacesParked ? "; replaces your earlier submission that gno.land has not enabled" : ""}`
    const intent: Omit<PendingDAO, "submittedAt"> = {
        chainId: GNO_CHAIN_ID, path, name: config.name, wallet, orgId: null, txHash: "", phase: "intent",
        reason: "Wallet outcome unknown; check the package before resubmitting.",
    }
    const activity = submissionKey(GNO_CHAIN_ID, path)
    let intentSaved = false
    let pendingNote: string | undefined
    return {
        title: "Deploy DAO",
        summary: `Deploy “${config.name.trim()}”`,
        sub: path,
        lines: () => ctx.lines,
        warns: ctx.warns,
        note: "Memba re-checks the address right before you sign.",
        label: () => `Deploy ${config.name.trim()}`,
        prepare: () => ({ msgs }),
        recheck: async () => {
            const fresh = await runDeployChecks(wallet, path)
            // A policy unreadable at review sized the larger budget, which covers either policy.
            if (checks.policy !== "unknown" && fresh.policy === "unknown") throw new Error("Memba couldn't read the network's rules for new packages just now. Nothing was sent: try again.")
            if ((checks.policy !== "unknown" && fresh.policy !== checks.policy) || fresh.replacesParked !== checks.replacesParked) {
                throw new Error("The network's rules for this address changed. Review the deploy again.")
            }
            const short = balanceShortfall(fresh.balanceUgnot, { feeUgnot, estimateUgnot, capUgnot }, fresh.policy)
            if (short) throw new Error(`${short} Nothing was sent.`)
            // The wallet is asked for the reviewed fee: a higher price since then needs a new review.
            await assertFeeStillCovers(feeUgnot, async () => {
                const price = await networkGasPriceFresh()
                const fee = feeForGasWanted(gasWanted, price)
                // Only a rise is shown: a lower price still signs the fee that was reviewed.
                if (fee > feeUgnot) ctx.onRisenPrice?.(price)
                return fee
            })
        },
        send: async (_c, beforeSign) => {
            if (isSubmissionActive(activity)) throw new Error("This deploy is already waiting for Adena.")
            const release = beginSubmission(activity)
            try {
                // Durable intent precedes any wallet prompt: a lost response or a reload
                // must leave enough to reconcile without resubmitting.
                savePendingDAO(intent)
                intentSaved = true
                const res = await doContractBroadcast(msgs, memo, { gas: "deploy", gasWanted, gasFee: feeUgnot, beforeSign })
                try { savePendingDAO({ ...intent, phase: "submitted", txHash: res.hash, reason: "Wallet returned; checking package status" }) } catch { /* the wizard still shows the path and transaction */ }
                ctx.onSubmitted(res.hash)
                return res
            } finally {
                release()
            }
        },
        onNothingSent: () => { if (intentSaved) removePendingDAO(GNO_CHAIN_ID, path) },
        // waitForPackage polls for two minutes by itself.
        verifyAttempts: 1,
        pendingNote: () => pendingNote,
        verify: async (_c, hash) => {
            const outcome = await waitForPackage(deployChain(), path)
            if (outcome.outcome === "live") {
                try { saveDAOForRecovery(null, path, config.name); removePendingDAO(GNO_CHAIN_ID, path) } catch { /* the DAO exists; the record is re-checked from the DAOs list */ }
                ctx.onResult({ kind: "live" }, hash)
                return true
            }
            if (outcome.outcome === "pending") {
                const reason = outcome.unconfirmed ? "the network status could not be read yet" : outcome.meta?.reason ?? "waiting for a package approver to enable it"
                try { savePendingDAO({ ...intent, phase: "submitted", txHash: hash, reason }) } catch { /* the wizard still shows the path and transaction */ }
                // Unread status: the tray's default ("hasn't shown it yet") is the truth.
                pendingNote = outcome.unconfirmed ? undefined : PARKED_NOTE
                ctx.onResult({ kind: "pending", unconfirmed: outcome.unconfirmed, reason }, hash)
                return false
            }
            // No package: only the deploy's own transaction tells a refusal apart from one not shown yet.
            const seen = await verifySendTx(hash).catch(() => false as const)
            if (seen === "failed") {
                try { removePendingDAO(GNO_CHAIN_ID, path) } catch { /* nothing was deployed; the record is re-checked from the DAOs list */ }
                ctx.onResult({ kind: "refused" }, hash)
                return "failed"
            }
            pendingNote = MISSING_NOTE
            ctx.onResult({ kind: "missing" }, hash)
            return false
        },
    }
}
