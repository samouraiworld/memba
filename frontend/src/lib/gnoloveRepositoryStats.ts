import { z } from "zod"
import { GNOLOVE_API_URL } from "./config"
import { fetchJson } from "./gnoloveApi"
import type { TimeFilter } from "./gnoloveConstants"

const Count = z.number().int().nonnegative()
export const RepositoryStatsSchema = z.object({
    time: z.string(),
    repositories: z.array(z.object({
        repositoryId: z.string(), mergedPRs: Count, openPRs: Count, contributors: Count,
    })),
})

export async function getRepositoryStats(time: TimeFilter, signal?: AbortSignal) {
    const url = new URL("/repositories/stats", GNOLOVE_API_URL)
    url.searchParams.set("time", time)
    return RepositoryStatsSchema.parse(await fetchJson(url.toString(), signal))
}
