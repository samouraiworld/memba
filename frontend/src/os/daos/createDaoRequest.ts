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
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { assertCanDeployTo } from "../../lib/dao/namespace"
import { assertPathAvailable, codeSubmissionPolicy, removePendingDAO, savePendingDAO, waitForPackage, type ChainContext, type PendingDAO } from "../../lib/dao/packageStatus"
import { beginSubmission, isSubmissionActive, submissionKey } from "../../lib/dao/submissionActivity"
import { saveDAOForRecovery } from "../../lib/daoSlug"
import { buildDeployDAOMsg, generateDAOCode, type DAOCreationConfig } from "../../lib/daoTemplate"
import { doContractBroadcast, feeForGasWanted, type AminoMsg, type GasPrice } from "../../lib/grc20"
import { getRpcUrlsInOrder } from "../../lib/rpcFallback"
import { daoDepositCapUgnot, deployGasForPolicy, estimateDAODepositUgnot, formatGnot } from "../../lib/templates/dao/v2/deposit"
import type { SignRequest } from "../sign/signer"

/** Chain checks walk the network's endpoint list (each endpoint must serve this chain). */
export function deployChain(): ChainContext {
    return { rpcUrl: GNO_RPC_URL, chainId: GNO_CHAIN_ID, rpcUrls: getRpcUrlsInOrder() }
}

export interface DeployChecks {
    /** The chain's code_submission_policy; "unknown" sizes the larger full-deploy budget. */
    policy: string
    /** The path holds this wallet's own parked submission, which the deploy replaces. */
    replacesParked: boolean
}

/** The chain decides: the signer must own the namespace and the path must be unused (live or waiting for approval). */
export async function runDeployChecks(wallet: string, realmPath: string): Promise<DeployChecks> {
    const chain = deployChain()
    await assertCanDeployTo(chain, wallet, realmPath)
    const { replacesParked } = await assertPathAvailable(chain, realmPath, wallet)
    // The policy only sizes the transaction; success is read from the chain.
    const policy = await codeSubmissionPolicy(chain).catch(() => "unknown")
    return { policy, replacesParked }
}

/** Deposit and fee for the review, as the classic page computes them. */
export function deployCosts(config: DAOCreationConfig, policy: string, price: GasPrice) {
    const gasWanted = deployGasForPolicy(config, policy)
    return { estimateUgnot: estimateDAODepositUgnot(config), capUgnot: daoDepositCapUgnot(config), gasWanted, feeUgnot: feeForGasWanted(gasWanted, price) }
}

export type DeployResult =
    | { kind: "live" }
    /** Stored but not enabled (inert), or `unconfirmed`: the status could not be read. */
    | { kind: "pending"; unconfirmed: boolean; reason: string }
    | { kind: "failed"; error: string }

export interface CreateDaoContext {
    wallet: string
    config: DAOCreationConfig
    checks: DeployChecks
    price: GasPrice
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
    const path = config.realmPath
    const code = generateDAOCode(config)
    const { capUgnot, gasWanted } = deployCosts(config, checks.policy, ctx.price)
    const msg = buildDeployDAOMsg(wallet, path, code, `${capUgnot}ugnot`)
    const msgs: AminoMsg[] = [{ type: "/vm.m_addpkg", value: msg.value }]
    const memo = `Deploy realm ${path} (storage deposit up to ${formatGnot(capUgnot)})${checks.replacesParked ? "; replaces your earlier submission that gno.land has not enabled" : ""}`
    const intent: Omit<PendingDAO, "submittedAt"> = {
        chainId: GNO_CHAIN_ID, path, name: config.name, wallet, orgId: null, txHash: "", phase: "intent",
        reason: "Wallet outcome unknown; check the package before resubmitting.",
    }
    const activity = submissionKey(GNO_CHAIN_ID, path)
    let intentSaved = false
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
            if (fresh.policy !== checks.policy || fresh.replacesParked !== checks.replacesParked) {
                throw new Error("The network's rules for this address changed. Review the deploy again.")
            }
        },
        send: async (_c, beforeSign) => {
            if (isSubmissionActive(activity)) throw new Error("This deploy is already waiting for Adena.")
            const release = beginSubmission(activity)
            try {
                // Durable intent precedes any wallet prompt: a lost response or a reload
                // must leave enough to reconcile without resubmitting.
                savePendingDAO(intent)
                intentSaved = true
                const res = await doContractBroadcast(msgs, memo, { gas: "deploy", gasWanted, beforeSign })
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
                ctx.onResult({ kind: "pending", unconfirmed: outcome.unconfirmed, reason }, hash)
                return false
            }
            ctx.onResult({ kind: "failed", error: outcome.error }, hash)
            return false
        },
    }
}
