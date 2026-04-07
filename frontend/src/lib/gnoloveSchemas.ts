/**
 * Gnolove Zod schemas — runtime validation at the API boundary.
 *
 * Ported from gnolove/src/utils/schemas.ts, pruned of:
 *  - YouTube schemas (carousel removed)
 *  - Validator/monitoring schemas (already in gnomonitoring.ts)
 *  - MonitoringWebhook/ReportHour schemas (already in monitoringAuth.ts)
 *
 * Preprocessors normalize camelCase/PascalCase field inconsistencies
 * from the Gnolove Go backend (external API we don't control).
 *
 * @module lib/gnoloveSchemas
 */

import { z } from "zod"

// ── Preprocessors ────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
const preprocessUser = (data: unknown) => {
    if (!data || typeof data !== "object") return data
    const d = data as any
    return {
        ...d,
        name: d.name ?? d.Name,
        login: d.login ?? d.Login,
        id: d.id ?? d.ID,
        avatarUrl: d.avatarUrl ?? d.AvatarURL ?? d.AvatarUrl ?? d.avatarURL,
        url: d.url ?? d.URL,
    }
}

const preprocessIssue = (data: unknown) => {
    if (!data || typeof data !== "object") return data
    const d = data as any
    const author = preprocessUser(d.author ?? d.Author)
    return {
        ...d,
        createdAt: d.createdAt ?? d.CreatedAt,
        updatedAt: d.updatedAt ?? d.UpdatedAt,
        id: d.id ?? d.ID,
        number: d.number ?? d.Number,
        state: d.state ?? d.State,
        title: d.title ?? d.Title,
        url: d.url ?? d.URL,
        authorID: d.authorID ?? d.AuthorID,
        author: author?.id === "" ? undefined : author,
        labels: d.labels ?? d.Labels,
        milestoneID: d.milestoneID ?? d.MilestoneId,
    }
}

const preprocessPullRequest = (data: unknown) => {
    if (!data || typeof data !== "object") return data
    const d = data as any
    return {
        ...d,
        createdAt: d.createdAt ?? d.CreatedAt,
        updatedAt: d.updatedAt ?? d.UpdatedAt,
        id: d.id ?? d.ID,
        number: d.number ?? d.Number,
        state: d.state ?? d.State,
        title: d.title ?? d.Title,
        url: d.url ?? d.URL,
        authorID: d.authorID ?? d.AuthorID,
    }
}

const preprocessCommit = (data: unknown) => {
    if (!data || typeof data !== "object") return data
    const d = data as any
    return {
        ...d,
        createdAt: d.createdAt ?? d.CreatedAt,
        updatedAt: d.updatedAt ?? d.UpdatedAt,
        id: d.id ?? d.ID,
        authorID: d.authorID ?? d.AuthorID,
        url: d.url ?? d.URL,
    }
}

const preprocessMilestone = (data: unknown) => {
    if (!data || typeof data !== "object") return data
    const d = data as any
    return { ...d, user: d.user, url: d.url ?? d.URL }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Base Schemas ─────────────────────────────────────────────

export const LabelSchema = z.object({
    id: z.coerce.string(),
    name: z.string(),
    color: z.string(),
})
export type TLabel = z.infer<typeof LabelSchema>

export const UserBaseSchema = z.object({
    login: z.string(),
    id: z.coerce.string(),
    avatarUrl: z.string().url(),
    url: z.string().url(),
    name: z.string(),
})
export const UserSchema = z.preprocess(preprocessUser, UserBaseSchema)
export type TUser = z.infer<typeof UserSchema>

// ── Issue ────────────────────────────────────────────────────

export const IssueBaseSchema = z.object({
    createdAt: z.string(),
    updatedAt: z.string(),
    id: z.coerce.string(),
    number: z.number(),
    state: z.string(),
    title: z.string(),
    authorID: z.string().nullish(),
    url: z.string().url(),
    author: UserSchema.nullish(),
    labels: z.array(LabelSchema).default([]),
    assignees: z.preprocess(
        (obj: unknown) => (Array.isArray(obj) ? obj.filter((el) => "user" in el && el.user !== null) : []),
        z.array(z.object({ id: z.coerce.string(), user: UserSchema })).default([]),
    ),
})
export const IssueSchema = z.preprocess(preprocessIssue, IssueBaseSchema)
export type TIssue = z.infer<typeof IssueSchema>

// ── Pull Request ─────────────────────────────────────────────

export const ReviewSchema: z.ZodType = z.lazy(() =>
    z.object({
        id: z.coerce.string(),
        authorID: z.string(),
        pullRequestID: z.string(),
        createdAt: z.string(),
        pullRequest: z.lazy(() => PullRequestSchema).nullable(),
        author: UserSchema.nullish(),
    }),
)
export type TReview = z.infer<typeof ReviewSchema>

export const PullRequestBaseSchema = z.object({
    createdAt: z.string(),
    updatedAt: z.string(),
    id: z.coerce.string(),
    number: z.number(),
    state: z.string(),
    title: z.string(),
    url: z.string().url(),
    authorID: z.string().optional(),
    author: UserSchema.nullish(),
    reviews: z.array(ReviewSchema).nullish(),
    milestoneID: z.string().optional(),
    reviewDecision: z.string().optional(),
    mergeable: z.string().optional(),
    mergeStateStatus: z.string().optional(),
    mergedAt: z.string().nullable(),
    authorLogin: z.string().optional(),
    authorAvatarUrl: z.string().optional(),
    isDraft: z.boolean().optional(),
})
export const PullRequestSchema = z.preprocess(preprocessPullRequest, PullRequestBaseSchema)
export type TPullRequest = z.infer<typeof PullRequestSchema>

export const PullRequestReportSchema = z.object({
    merged: z.array(PullRequestSchema).nullable(),
    in_progress: z.array(PullRequestSchema).nullable(),
    reviewed: z.array(PullRequestSchema).nullable(),
    waiting_for_review: z.array(PullRequestSchema).nullable(),
    blocked: z.array(PullRequestSchema).nullable(),
})
export type TPullRequestReport = z.infer<typeof PullRequestReportSchema>

// ── Commit ───────────────────────────────────────────────────

export const CommitBaseSchema = z.object({
    id: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    authorID: z.string(),
    url: z.string().url(),
    author: UserSchema.nullish(),
    title: z.string(),
})
export const CommitSchema = z.preprocess(preprocessCommit, CommitBaseSchema)
export type TCommit = z.infer<typeof CommitSchema>

// ── Enhanced User (Leaderboard) ──────────────────────────────

export const EnhancedBaseUserSchema = UserBaseSchema.extend({
    commits: z.array(CommitSchema).nullish(),
    issues: z.array(IssueSchema).nullish(),
    pullRequests: z.array(PullRequestSchema).nullish(),
    reviews: z.array(ReviewSchema).nullish(),
    LastContribution: IssueSchema.or(PullRequestSchema).or(CommitSchema).nullish(),
})

export const EnhancedUserWithStatsSchema = z.preprocess(
    preprocessUser,
    EnhancedBaseUserSchema.extend({
        TotalCommits: z.number().default(0),
        TotalPrs: z.number().default(0),
        TotalIssues: z.number().default(0),
        TotalReviewedPullRequests: z.number().default(0),
        score: z.number().default(0),
    }),
)
export type TEnhancedUserWithStats = z.infer<typeof EnhancedUserWithStatsSchema>

// ── Milestone ────────────────────────────────────────────────

export const MilestoneSchema = z.preprocess(
    preprocessMilestone,
    z.object({
        id: z.coerce.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
        number: z.number(),
        title: z.string(),
        state: z.string(),
        authorID: z.string(),
        author: UserSchema.nullish(),
        description: z.string(),
        url: z.string(),
        issues: z.array(IssueSchema),
    }),
)
export type TMilestone = z.infer<typeof MilestoneSchema>

// ── Repository ───────────────────────────────────────────────

export const RepositorySchema = z.object({
    id: z.string(),
    name: z.string(),
    owner: z.string(),
    baseBranch: z.string(),
})
export type TRepository = z.infer<typeof RepositorySchema>

// ── Contributor Profile ──────────────────────────────────────

export const ContributorActivitySchema = z.object({
    title: z.string(),
    url: z.string().url(),
    createdAt: z.string(),
    repository: z.string(),
    type: z.enum(["pull_request", "issue"]),
})

export const ContributorRepositorySchema = z.object({
    nameWithOwner: z.string(),
    description: z.string(),
    url: z.string().url(),
    stargazerCount: z.number(),
    primaryLanguage: z.string(),
})

export const TimeCountSchema = z.object({
    period: z.string(),
    count: z.number(),
})

export const TopContributedRepo = z.object({
    id: z.string(),
    contributions: z.number(),
})

export const ContributorSchema = z.object({
    id: z.string(),
    login: z.string(),
    avatarUrl: z.string().url(),
    url: z.string().url(),
    name: z.string(),
    bio: z.string(),
    location: z.string(),
    joinDate: z.string(),
    websiteUrl: z.string().optional(),
    twitterUsername: z.string().optional(),
    totalStars: z.number(),
    totalRepos: z.number(),
    followers: z.number(),
    following: z.number(),
    totalCommits: z.number(),
    totalPullRequests: z.number(),
    totalIssues: z.number(),
    recentIssues: z.array(ContributorActivitySchema),
    recentPullRequests: z.array(ContributorActivitySchema),
    topRepositories: z.array(ContributorRepositorySchema),
    gnoBalance: z.string(),
    wallet: z.string(),
    commitsPerMonth: z.array(TimeCountSchema),
    pullRequestsPerMonth: z.array(TimeCountSchema),
    issuesPerMonth: z.array(TimeCountSchema),
    contributionsPerDay: z.array(TimeCountSchema),
    topContributedRepositories: z.array(TopContributedRepo),
})
export type TContributor = z.infer<typeof ContributorSchema>

// ── On-Chain ─────────────────────────────────────────────────

export const PackageSchema = z.object({
    address: z.string(),
    path: z.string(),
    namespace: z.string(),
    blockHeight: z.number(),
})
export const PackagesSchema = z.array(PackageSchema)
export type TPackage = z.infer<typeof PackageSchema>

export const NamespaceSchema = z.object({
    hash: z.string(),
    namespace: z.string(),
    address: z.string(),
    blockHeight: z.number(),
})
export const NamespacesSchema = z.array(NamespaceSchema)
export type TNamespace = z.infer<typeof NamespaceSchema>

export const ProposalFileSchema = z.object({
    id: z.string(),
    name: z.string(),
    body: z.string(),
    proposalID: z.string(),
})

export const VoteSchema = z.object({
    proposalID: z.string(),
    address: z.string(),
    blockHeight: z.number(),
    vote: z.enum(["YES", "NO", "ABSTAIN"]),
    hash: z.string(),
})

export const ProposalSchema = z.object({
    id: z.string(),
    address: z.string(),
    path: z.string(),
    blockHeight: z.number(),
    files: z.array(ProposalFileSchema).default([]),
    votes: z.array(VoteSchema).default([]),
    executionHeight: z.number().default(0),
    status: z.string().default(""),
    title: z.string().default(""),
    description: z.string().default(""),
})
export const ProposalsSchema = z.array(ProposalSchema)
export type TProposal = z.infer<typeof ProposalSchema>

export const GovdaoMemberSchema = z.object({
    address: z.string(),
    tier: z.string(),
})
export const GovdaoMembersSchema = z.array(GovdaoMemberSchema)
export type TGovdaoMember = z.infer<typeof GovdaoMemberSchema>

// ── Score Factors ────────────────────────────────────────────

export const ScoreFactorsSchema = z.object({
    prFactor: z.number(),
    issueFactor: z.number(),
    commitFactor: z.number(),
    reviewedPrFactor: z.number(),
})
export type TScoreFactors = z.infer<typeof ScoreFactorsSchema>

// ── AI Reports ─────────────────────────────────────────────────

export const AIReportProjectSchema = z.object({
    project_name: z.string(),
    summary: z.string(),
})

export const AIReportDataSchema = z.object({
    projects: z.array(AIReportProjectSchema).default([]),
}).passthrough()

export const AIReportSchema = z.object({
    id: z.string(),
    createdAt: z.string(),
    data: AIReportDataSchema,
})
export type TAIReport = z.infer<typeof AIReportSchema>

export const AIReportsSchema = z.array(AIReportSchema)

// ── Composite Schemas (API responses) ────────────────────────

export const ContributorsResponseSchema = z.object({
    users: z.array(EnhancedUserWithStatsSchema),
    lastSyncedAt: z.string().nullable().optional(),
})
export type TContributorsResponse = z.infer<typeof ContributorsResponseSchema>
