/**
 * Gas limit and storage-deposit cap for each call into the weighted host v12
 * (the mainnet governing DAO `gno.land/r/samcrew/memba_dao`).
 *
 * Every value comes from measurements of the generated realm, recorded in
 * `testdata/weighted-v12/budget.json` with their provenance: an in-process
 * gno.land node at the gnoland-1 runtime pin (e75fef82) with the mainnet VM
 * parameters (storage_price 100 ugnot per byte), on 2026-09-24. Two runs:
 * the exact candidate bytes (acceptances, role, recovery, every ballot
 * variant) and a full lifecycle (every Propose entry point, its votes and its
 * execution).
 *
 * Headroom, applied per entry point (per operation for Execute):
 * - gas_wanted = 1.5 × the highest measured gas_used, rounded up to 100,000;
 * - max_deposit = 1.5 × the highest measured positive deposit, rounded up to
 *   10,000 ugnot, never below 10,000 ugnot.
 *
 * `weightedBudget.test.ts` recomputes every row from the measurements. The
 * cap is a ceiling, not a price: the chain locks only the bytes a call adds.
 * Vote gas grows slowly with the number of proposals (15.2M at #1, 16.2M at
 * #71, one stored proposal list); the margin covers several hundred proposals.
 */
import { depositNeedsOverride } from "./v2Budget"

export interface WeightedCallBudget {
    gasWanted: number
    /** Storage deposit cap in ugnot, carried in the signed message as `max_deposit`. */
    maxDepositUgnot: number
}

/** Margin applied to the measured gas and deposit. */
export const V12_BUDGET_MARGIN = 1.5

// Generated from testdata/weighted-v12/budget.json (see the header).
export const V12_CALL_BUDGETS = {
    EmergencyPauseAppstore: { gasWanted: 54_800_000, maxDepositUgnot: 190_000 },
    EmergencyPauseArcade: { gasWanted: 48_600_000, maxDepositUgnot: 190_000 },
    EmergencyPauseBadges: { gasWanted: 49_500_000, maxDepositUgnot: 190_000 },
    EmergencyPauseChannels: { gasWanted: 53_800_000, maxDepositUgnot: 190_000 },
    EmergencyPauseEscrow: { gasWanted: 54_400_000, maxDepositUgnot: 190_000 },
    EmergencyPauseFeed: { gasWanted: 50_700_000, maxDepositUgnot: 190_000 },
    EmergencyPauseFeedback: { gasWanted: 55_000_000, maxDepositUgnot: 190_000 },
    ProposeAppstoreAbortReturn: { gasWanted: 52_700_000, maxDepositUgnot: 2_280_000 },
    ProposeAppstoreAccept: { gasWanted: 35_000_000, maxDepositUgnot: 2_260_000 },
    ProposeAppstoreApprove: { gasWanted: 53_300_000, maxDepositUgnot: 2_290_000 },
    ProposeAppstoreClearFlags: { gasWanted: 55_500_000, maxDepositUgnot: 2_310_000 },
    ProposeAppstoreCurator: { gasWanted: 45_500_000, maxDepositUgnot: 2_270_000 },
    ProposeAppstoreDelist: { gasWanted: 53_900_000, maxDepositUgnot: 2_290_000 },
    ProposeAppstoreFee: { gasWanted: 41_700_000, maxDepositUgnot: 2_250_000 },
    ProposeAppstoreReject: { gasWanted: 54_900_000, maxDepositUgnot: 2_300_000 },
    ProposeAppstoreRestore: { gasWanted: 54_300_000, maxDepositUgnot: 2_290_000 },
    ProposeAppstoreReturn: { gasWanted: 51_600_000, maxDepositUgnot: 2_270_000 },
    ProposeAppstoreSeal: { gasWanted: 42_400_000, maxDepositUgnot: 2_250_000 },
    ProposeAppstoreTreasury: { gasWanted: 44_000_000, maxDepositUgnot: 2_270_000 },
    ProposeAppstoreUnpause: { gasWanted: 44_400_000, maxDepositUgnot: 2_250_000 },
    ProposeArcadeAbortReturn: { gasWanted: 43_400_000, maxDepositUgnot: 2_120_000 },
    ProposeArcadeAccept: { gasWanted: 30_500_000, maxDepositUgnot: 2_090_000 },
    ProposeArcadeAddAttester: { gasWanted: 32_800_000, maxDepositUgnot: 2_100_000 },
    ProposeArcadeRemoveAttester: { gasWanted: 33_300_000, maxDepositUgnot: 2_100_000 },
    ProposeArcadeReturn: { gasWanted: 42_300_000, maxDepositUgnot: 2_100_000 },
    ProposeArcadeUnpause: { gasWanted: 39_200_000, maxDepositUgnot: 2_090_000 },
    ProposeBadgesAbortReturn: { gasWanted: 44_200_000, maxDepositUgnot: 2_120_000 },
    ProposeBadgesAccept: { gasWanted: 29_600_000, maxDepositUgnot: 2_100_000 },
    ProposeBadgesAddAdmin: { gasWanted: 33_700_000, maxDepositUgnot: 2_110_000 },
    ProposeBadgesRemoveAdmin: { gasWanted: 34_400_000, maxDepositUgnot: 2_110_000 },
    ProposeBadgesReturn: { gasWanted: 43_200_000, maxDepositUgnot: 2_110_000 },
    ProposeBadgesUnpause: { gasWanted: 39_800_000, maxDepositUgnot: 2_090_000 },
    ProposeChannelsAbortReturn: { gasWanted: 48_100_000, maxDepositUgnot: 2_270_000 },
    ProposeChannelsAccept: { gasWanted: 33_200_000, maxDepositUgnot: 2_240_000 },
    ProposeChannelsAddMember: { gasWanted: 38_200_000, maxDepositUgnot: 2_260_000 },
    ProposeChannelsCreateText: { gasWanted: 38_700_000, maxDepositUgnot: 2_250_000 },
    ProposeChannelsRemoveMember: { gasWanted: 38_800_000, maxDepositUgnot: 2_260_000 },
    ProposeChannelsReturn: { gasWanted: 47_100_000, maxDepositUgnot: 2_250_000 },
    ProposeChannelsSetRoles: { gasWanted: 39_400_000, maxDepositUgnot: 2_260_000 },
    ProposeChannelsUnpause: { gasWanted: 43_200_000, maxDepositUgnot: 2_240_000 },
    ProposeEscrowAbortReturn: { gasWanted: 50_500_000, maxDepositUgnot: 4_390_000 },
    ProposeEscrowAccept: { gasWanted: 34_200_000, maxDepositUgnot: 4_340_000 },
    ProposeEscrowFeeRecipient: { gasWanted: 41_900_000, maxDepositUgnot: 4_360_000 },
    ProposeEscrowPayFreelancer: { gasWanted: 55_700_000, maxDepositUgnot: 4_520_000 },
    ProposeEscrowRefund: { gasWanted: 50_800_000, maxDepositUgnot: 4_470_000 },
    ProposeEscrowReturn: { gasWanted: 49_500_000, maxDepositUgnot: 4_380_000 },
    ProposeEscrowUnpause: { gasWanted: 44_600_000, maxDepositUgnot: 4_360_000 },
    ProposeFeedAbortReturn: { gasWanted: 44_700_000, maxDepositUgnot: 2_120_000 },
    ProposeFeedAccept: { gasWanted: 29_900_000, maxDepositUgnot: 2_100_000 },
    ProposeFeedAddModerator: { gasWanted: 34_200_000, maxDepositUgnot: 2_110_000 },
    ProposeFeedRemoveModerator: { gasWanted: 34_700_000, maxDepositUgnot: 2_110_000 },
    ProposeFeedReturn: { gasWanted: 43_700_000, maxDepositUgnot: 2_110_000 },
    ProposeFeedUnpause: { gasWanted: 40_100_000, maxDepositUgnot: 2_090_000 },
    ProposeFeedbackAbortReturn: { gasWanted: 48_600_000, maxDepositUgnot: 2_270_000 },
    ProposeFeedbackAccept: { gasWanted: 32_700_000, maxDepositUgnot: 2_250_000 },
    ProposeFeedbackAddMember: { gasWanted: 39_500_000, maxDepositUgnot: 2_270_000 },
    ProposeFeedbackCreateText: { gasWanted: 40_200_000, maxDepositUgnot: 2_260_000 },
    ProposeFeedbackRemoveMember: { gasWanted: 48_200_000, maxDepositUgnot: 2_270_000 },
    ProposeFeedbackReturn: { gasWanted: 47_600_000, maxDepositUgnot: 2_260_000 },
    ProposeFeedbackSetRoles: { gasWanted: 40_700_000, maxDepositUgnot: 2_270_000 },
    ProposeFeedbackUnpause: { gasWanted: 43_800_000, maxDepositUgnot: 2_240_000 },
    ProposeMarketAbortReturn: { gasWanted: 37_100_000, maxDepositUgnot: 2_110_000 },
    ProposeMarketAccept: { gasWanted: 24_000_000, maxDepositUgnot: 2_130_000 },
    ProposeMarketFee: { gasWanted: 29_900_000, maxDepositUgnot: 2_080_000 },
    ProposeMarketReturn: { gasWanted: 36_800_000, maxDepositUgnot: 2_090_000 },
    ProposeMarketTreasury: { gasWanted: 27_400_000, maxDepositUgnot: 2_090_000 },
    ProposeQuestAbortReturn: { gasWanted: 42_800_000, maxDepositUgnot: 2_100_000 },
    ProposeQuestAccept: { gasWanted: 28_100_000, maxDepositUgnot: 2_060_000 },
    ProposeQuestReturn: { gasWanted: 41_700_000, maxDepositUgnot: 2_090_000 },
    ProposeQuestSigner: { gasWanted: 33_300_000, maxDepositUgnot: 2_070_000 },
    ProposeRecovery: { gasWanted: 25_600_000, maxDepositUgnot: 1_780_000 },
    ProposeReviewsAbortReturn: { gasWanted: 41_900_000, maxDepositUgnot: 2_240_000 },
    ProposeReviewsAccept: { gasWanted: 29_700_000, maxDepositUgnot: 2_220_000 },
    ProposeReviewsHideComment: { gasWanted: 36_800_000, maxDepositUgnot: 2_240_000 },
    ProposeReviewsHideReview: { gasWanted: 36_200_000, maxDepositUgnot: 2_250_000 },
    ProposeReviewsReturn: { gasWanted: 40_800_000, maxDepositUgnot: 2_230_000 },
    ProposeReviewsUnhide: { gasWanted: 36_700_000, maxDepositUgnot: 2_250_000 },
    ProposeRole: { gasWanted: 24_300_000, maxDepositUgnot: 1_760_000 },
    Vote: { gasWanted: 24_800_000, maxDepositUgnot: 40_000 },
} as const satisfies Record<string, WeightedCallBudget>

export const V12_EXECUTE_BUDGETS: Readonly<Record<string, WeightedCallBudget>> = {
    "appstore:abort-return": { gasWanted: 81_900_000, maxDepositUgnot: 190_000 },
    "appstore:accept-owner": { gasWanted: 51_400_000, maxDepositUgnot: 180_000 },
    "appstore:add-curator": { gasWanted: 64_600_000, maxDepositUgnot: 500_000 },
    "appstore:approve": { gasWanted: 75_200_000, maxDepositUgnot: 190_000 },
    "appstore:clear-flags": { gasWanted: 75_800_000, maxDepositUgnot: 30_000 },
    "appstore:delist": { gasWanted: 76_300_000, maxDepositUgnot: 190_000 },
    "appstore:restore": { gasWanted: 76_900_000, maxDepositUgnot: 190_000 },
    "appstore:return-owner": { gasWanted: 80_300_000, maxDepositUgnot: 200_000 },
    "appstore:seal-import": { gasWanted: 63_800_000, maxDepositUgnot: 190_000 },
    "appstore:set-fee": { gasWanted: 55_800_000, maxDepositUgnot: 190_000 },
    "appstore:set-treasury": { gasWanted: 56_500_000, maxDepositUgnot: 190_000 },
    "appstore:unpause": { gasWanted: 62_300_000, maxDepositUgnot: 190_000 },
    "arcade:abort-return": { gasWanted: 71_800_000, maxDepositUgnot: 190_000 },
    "arcade:accept-owner": { gasWanted: 46_200_000, maxDepositUgnot: 190_000 },
    "arcade:add-attester": { gasWanted: 50_600_000, maxDepositUgnot: 350_000 },
    "arcade:remove-attester": { gasWanted: 52_200_000, maxDepositUgnot: 40_000 },
    "arcade:return-owner": { gasWanted: 71_800_000, maxDepositUgnot: 200_000 },
    "arcade:unpause": { gasWanted: 54_100_000, maxDepositUgnot: 190_000 },
    "badges:abort-return": { gasWanted: 70_200_000, maxDepositUgnot: 190_000 },
    "badges:accept-owner": { gasWanted: 41_900_000, maxDepositUgnot: 190_000 },
    "badges:add-admin": { gasWanted: 49_100_000, maxDepositUgnot: 500_000 },
    "badges:remove-admin": { gasWanted: 50_100_000, maxDepositUgnot: 10_000 },
    "badges:return-owner": { gasWanted: 69_000_000, maxDepositUgnot: 200_000 },
    "badges:unpause": { gasWanted: 54_600_000, maxDepositUgnot: 190_000 },
    "channels:abort-return": { gasWanted: 73_600_000, maxDepositUgnot: 190_000 },
    "channels:accept-owner": { gasWanted: 45_900_000, maxDepositUgnot: 190_000 },
    "channels:add-member": { gasWanted: 53_500_000, maxDepositUgnot: 510_000 },
    "channels:create-text-channel": { gasWanted: 61_700_000, maxDepositUgnot: 1_460_000 },
    "channels:remove-member": { gasWanted: 54_500_000, maxDepositUgnot: 10_000 },
    "channels:return-owner": { gasWanted: 72_200_000, maxDepositUgnot: 200_000 },
    "channels:set-roles": { gasWanted: 54_400_000, maxDepositUgnot: 190_000 },
    "channels:unpause": { gasWanted: 59_300_000, maxDepositUgnot: 190_000 },
    "escrow:abort-return": { gasWanted: 78_800_000, maxDepositUgnot: 180_000 },
    "escrow:accept-owner": { gasWanted: 49_600_000, maxDepositUgnot: 180_000 },
    "escrow:pay-freelancer": { gasWanted: 76_200_000, maxDepositUgnot: 190_000 },
    "escrow:refund-client": { gasWanted: 67_100_000, maxDepositUgnot: 190_000 },
    "escrow:return-owner": { gasWanted: 77_400_000, maxDepositUgnot: 200_000 },
    "escrow:set-fee-recipient": { gasWanted: 55_200_000, maxDepositUgnot: 200_000 },
    "escrow:unpause": { gasWanted: 62_800_000, maxDepositUgnot: 190_000 },
    "feed:abort-return": { gasWanted: 71_100_000, maxDepositUgnot: 180_000 },
    "feed:accept-owner": { gasWanted: 41_200_000, maxDepositUgnot: 180_000 },
    "feed:add-moderator": { gasWanted: 49_800_000, maxDepositUgnot: 350_000 },
    "feed:remove-moderator": { gasWanted: 50_300_000, maxDepositUgnot: 40_000 },
    "feed:return-owner": { gasWanted: 69_400_000, maxDepositUgnot: 200_000 },
    "feed:unpause": { gasWanted: 55_600_000, maxDepositUgnot: 190_000 },
    "feedback:abort-return": { gasWanted: 73_600_000, maxDepositUgnot: 190_000 },
    "feedback:accept-owner": { gasWanted: 43_500_000, maxDepositUgnot: 500_000 },
    "feedback:add-member": { gasWanted: 54_600_000, maxDepositUgnot: 510_000 },
    "feedback:create-text-channel": { gasWanted: 63_000_000, maxDepositUgnot: 1_460_000 },
    "feedback:remove-member": { gasWanted: 73_400_000, maxDepositUgnot: 10_000 },
    "feedback:return-owner": { gasWanted: 72_400_000, maxDepositUgnot: 200_000 },
    "feedback:set-roles": { gasWanted: 56_000_000, maxDepositUgnot: 190_000 },
    "feedback:unpause": { gasWanted: 60_500_000, maxDepositUgnot: 190_000 },
    "market-config:abort-return": { gasWanted: 70_100_000, maxDepositUgnot: 190_000 },
    "market-config:accept-admin": { gasWanted: 44_700_000, maxDepositUgnot: 230_000 },
    "market-config:return-admin": { gasWanted: 68_200_000, maxDepositUgnot: 200_000 },
    "market-config:set-fee": { gasWanted: 41_000_000, maxDepositUgnot: 190_000 },
    "market-config:set-treasury": { gasWanted: 36_800_000, maxDepositUgnot: 190_000 },
    "quest:abort-return": { gasWanted: 71_100_000, maxDepositUgnot: 190_000 },
    "quest:accept-owner": { gasWanted: 44_000_000, maxDepositUgnot: 190_000 },
    "quest:return-owner": { gasWanted: 69_400_000, maxDepositUgnot: 200_000 },
    "quest:set-signer": { gasWanted: 51_700_000, maxDepositUgnot: 260_000 },
    "reviews:abort-return": { gasWanted: 71_400_000, maxDepositUgnot: 190_000 },
    "reviews:accept-moderator": { gasWanted: 50_300_000, maxDepositUgnot: 180_000 },
    "reviews:hide-review": { gasWanted: 48_500_000, maxDepositUgnot: 190_000 },
    "reviews:return-moderator": { gasWanted: 70_200_000, maxDepositUgnot: 200_000 },
    "reviews:unhide": { gasWanted: 49_300_000, maxDepositUgnot: 200_000 },
    "set-role:grant": { gasWanted: 41_200_000, maxDepositUgnot: 190_000 },
}

/**
 * Execute of an operation with no measured execution (for example a remove
 * role or a member-key recovery): the largest measured gas and deposit of any
 * execution, with the same margin.
 */
export const V12_EXECUTE_FALLBACK: WeightedCallBudget = { gasWanted: 81_900_000, maxDepositUgnot: 1_460_000 }

export type V12CallName = keyof typeof V12_CALL_BUDGETS

export function v12CallBudget(func: string): WeightedCallBudget {
    if (!Object.hasOwn(V12_CALL_BUDGETS, func)) throw new Error(`No measured budget for ${func}`)
    return V12_CALL_BUDGETS[func as V12CallName]
}

/** The Execute budget key of a stored action: `<type>:<operation>`, `set-role:<grant|remove>` or `recover-member`. */
export function v12ExecuteKey(action: { type: string; operation?: string; grant?: boolean }): string {
    if (action.type === "set-role") return `set-role:${action.grant ? "grant" : "remove"}`
    if (action.type === "recover-member") return "recover-member"
    return `${action.type}:${action.operation ?? ""}`
}

/** Execute's cost depends on the action it runs. */
export function v12ExecuteBudget(action: { type: string; operation?: string; grant?: boolean }): WeightedCallBudget {
    const key = v12ExecuteKey(action)
    return Object.hasOwn(V12_EXECUTE_BUDGETS, key) ? V12_EXECUTE_BUDGETS[key] : V12_EXECUTE_FALLBACK
}

/** Every v12 budget stays under the 10 GNOT deposit ceiling; this is re-checked before signing. */
export function v12BudgetWithinCeiling(budget: WeightedCallBudget): boolean {
    return Number.isSafeInteger(budget.maxDepositUgnot) && budget.maxDepositUgnot > 0 && !depositNeedsOverride(budget.maxDepositUgnot)
}
