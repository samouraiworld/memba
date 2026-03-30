/**
 * Gnolove API helpers — contributor data for the MCP server.
 */

const DEFAULT_API = "https://backend.gnolove.world";
const TIMEOUT_MS = 8_000;

function getApiUrl(): string {
  return process.env.GNOLOVE_API_URL || DEFAULT_API;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  const url = `${getApiUrl()}${path}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[gnolove] fetch failed for ${path}:`, err);
    return null;
  }
}

export interface ContributorStats {
  login: string;
  name: string;
  avatarUrl: string;
  score: number;
  TotalPrs: number;
  TotalCommits: number;
  TotalIssues: number;
  TotalReviewedPullRequests: number;
}

interface StatsResponse {
  lastSyncedAt: string;
  users: ContributorStats[];
}

export async function getContributors(
  timeFilter: string = "all"
): Promise<ContributorStats[]> {
  const data = await fetchJson<StatsResponse>(
    `/stats?time_filter=${timeFilter}`
  );
  return data?.users ?? [];
}

export async function getContributor(
  login: string
): Promise<ContributorStats | null> {
  const data = await fetchJson<{ user: ContributorStats }>(`/users/${login}`);
  return data?.user ?? null;
}

export interface Repository {
  id: number;
  name: string;
  owner: string;
  baseBranch: string;
}

export async function getRepositories(): Promise<Repository[]> {
  const data = await fetchJson<Repository[]>("/repositories");
  return data ?? [];
}
