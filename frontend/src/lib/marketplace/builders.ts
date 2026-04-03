/**
 * marketplace/builders.ts — MsgCall builders for escrow transactions.
 *
 * Matches the on-chain escrow realm at gno.land/r/samcrew/escrow.
 * Each builder generates an Amino-compatible /vm.m_call message for Adena.
 */

/** Amino MsgCall shape for Adena broadcasting. */
interface MsgCall {
    type: "/vm.m_call"
    value: {
        caller: string
        send: string
        pkg_path: string
        func: string
        args: string[]
    }
}

/** Build a MsgCall to create a new escrow contract with milestones. */
export function buildCreateContractMsg(
    caller: string,
    escrowPath: string,
    freelancer: string,
    title: string,
    description: string,
    milestones: string, // "title1:amount1,title2:amount2"
): MsgCall {
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: "",
            pkg_path: escrowPath,
            func: "CreateContract",
            args: [freelancer, title, description, milestones],
        },
    }
}

/** Build a MsgCall to fund a specific milestone. Requires exact ugnot send. */
export function buildFundMilestoneMsg(
    caller: string,
    escrowPath: string,
    contractId: string,
    milestoneIdx: number,
    amountUgnot: number,
): MsgCall {
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: `${amountUgnot}ugnot`,
            pkg_path: escrowPath,
            func: "FundMilestone",
            args: [contractId, String(milestoneIdx)],
        },
    }
}

/** Build a MsgCall to mark a milestone as completed. Freelancer only. */
export function buildCompleteMilestoneMsg(
    caller: string,
    escrowPath: string,
    contractId: string,
    milestoneIdx: number,
): MsgCall {
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: "",
            pkg_path: escrowPath,
            func: "CompleteMilestone",
            args: [contractId, String(milestoneIdx)],
        },
    }
}

/** Build a MsgCall to release funds to the freelancer. Client or Admin. */
export function buildReleaseFundsMsg(
    caller: string,
    escrowPath: string,
    contractId: string,
    milestoneIdx: number,
): MsgCall {
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: "",
            pkg_path: escrowPath,
            func: "ReleaseFunds",
            args: [contractId, String(milestoneIdx)],
        },
    }
}

/** Build a MsgCall to raise a dispute on a milestone. Client or Freelancer. */
export function buildRaiseDisputeMsg(
    caller: string,
    escrowPath: string,
    contractId: string,
    milestoneIdx: number,
): MsgCall {
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: "",
            pkg_path: escrowPath,
            func: "RaiseDispute",
            args: [contractId, String(milestoneIdx)],
        },
    }
}

/** Build a MsgCall to cancel a contract. Client only. */
export function buildCancelContractMsg(
    caller: string,
    escrowPath: string,
    contractId: string,
): MsgCall {
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: "",
            pkg_path: escrowPath,
            func: "CancelContract",
            args: [contractId],
        },
    }
}

/** Build a MsgCall to claim a refund on a timed-out milestone. Anyone. */
export function buildClaimRefundMsg(
    caller: string,
    escrowPath: string,
    contractId: string,
    milestoneIdx: number,
): MsgCall {
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: "",
            pkg_path: escrowPath,
            func: "ClaimRefund",
            args: [contractId, String(milestoneIdx)],
        },
    }
}

/** Build a MsgCall to claim a dispute timeout. Anyone. */
export function buildClaimDisputeTimeoutMsg(
    caller: string,
    escrowPath: string,
    contractId: string,
    milestoneIdx: number,
): MsgCall {
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: "",
            pkg_path: escrowPath,
            func: "ClaimDisputeTimeout",
            args: [contractId, String(milestoneIdx)],
        },
    }
}
