/**
 * DAO Adapter — 3-layer capability detection for Gno DAO realms.
 *
 * Layer 1: p/demo/dao interface (GetPropStore, ProposalByID, etc.)
 * Layer 2: Render() parsing (universal fallback)
 * Layer 3: Graceful degradation with partial data
 *
 * Works with any Gno DAO — govdao, basedao, custom implementations.
 */

import {
  GnoRpcClient,
  parseQevalResponse,
  TTL_PROPOSAL,
  TTL_VOTES,
  TTL_DAO_OVERVIEW,
} from "@samouraiworld/gno-rpc";
import type {
  DaoCapabilities,
  DaoOverview,
  DaoProposal,
  ProposalStatus,
  TreasuryInfo,
  VoteTally,
} from "./types.js";

export class DaoAdapter {
  private client: GnoRpcClient;
  private capabilityCache = new Map<string, DaoCapabilities>();

  constructor(client: GnoRpcClient) {
    this.client = client;
  }

  /**
   * Detect what interfaces a DAO realm supports.
   * Probes known function signatures and caches the result.
   */
  async detectCapabilities(realmPath: string): Promise<DaoCapabilities> {
    const cached = this.capabilityCache.get(realmPath);
    if (cached) return cached;

    const caps: DaoCapabilities = {
      hasProposalStore: false,
      hasProposalCount: false,
      hasRender: false,
      adapter: "unknown",
    };

    // Probe in parallel
    const [propStoreSize, renderOutput] = await Promise.all([
      this.client.probeFunction(realmPath, "GetPropStore().Size()"),
      this.client.queryRender(realmPath, "", TTL_DAO_OVERVIEW),
    ]);

    if (propStoreSize !== null) {
      caps.hasProposalStore = true;
      caps.hasProposalCount = true;
      caps.adapter = "propstore";
    }

    if (renderOutput !== null) {
      caps.hasRender = true;
      if (caps.adapter === "unknown") {
        caps.adapter = "render";
      }
    }

    this.capabilityCache.set(realmPath, caps);
    return caps;
  }

  /**
   * Fetch a single proposal by ID.
   * Tries propstore first, falls back to Render() parsing.
   */
  async getProposal(realmPath: string, proposalId: string): Promise<DaoProposal | null> {
    const caps = await this.detectCapabilities(realmPath);

    if (caps.hasProposalStore) {
      return this.getProposalViaPropStore(realmPath, proposalId);
    }

    if (caps.hasRender) {
      return this.getProposalViaRender(realmPath, proposalId);
    }

    return null;
  }

  /**
   * Fetch DAO overview (name, member count, proposal count).
   */
  async getOverview(realmPath: string): Promise<DaoOverview | null> {
    const raw = await this.client.queryRender(realmPath, "", TTL_DAO_OVERVIEW);
    if (!raw) return null;

    // Parse member count from common patterns
    const memberMatch = raw.match(/(\d+)\s*member/i);
    const proposalMatch = raw.match(/(\d+)\s*proposal/i);

    // Extract DAO name from first heading
    const nameMatch = raw.match(/^#\s+(.+)$/m);

    return {
      realmPath,
      name: nameMatch?.[1]?.trim() || realmPath.split("/").pop() || realmPath,
      memberCount: memberMatch ? parseInt(memberMatch[1], 10) : 0,
      proposalCount: proposalMatch ? parseInt(proposalMatch[1], 10) : 0,
      raw,
    };
  }

  /**
   * Fetch treasury info — native GNOT + optional GRC20 tokens.
   */
  async getTreasury(realmPath: string): Promise<TreasuryInfo> {
    // Derive realm address from path
    // In Gno, realm addresses are deterministic from the package path
    const balanceUgnot = await this.client.getBalanceUgnot(realmPath);

    return {
      address: realmPath,
      balanceUgnot,
      balanceGnot: balanceUgnot / 1_000_000,
      grc20Tokens: [], // TODO: probe known GRC20 tokens in Sprint 2
    };
  }

  /**
   * Get proposal count for a DAO.
   */
  async getProposalCount(realmPath: string): Promise<number | null> {
    const caps = await this.detectCapabilities(realmPath);

    if (caps.hasProposalCount) {
      const result = await this.client.queryEval(realmPath, "GetPropStore().Size()");
      if (result) {
        const parsed = parseQevalResponse(result);
        if (parsed.value !== null) {
          return parseInt(parsed.value, 10);
        }
      }
    }

    // Fallback: count proposals from Render() output
    const raw = await this.client.queryRender(realmPath);
    if (!raw) return null;

    const proposalMatches = raw.match(/proposal/gi);
    return proposalMatches?.length ?? 0;
  }

  // ── Private: PropStore adapter ──────────────────────────────

  private async getProposalViaPropStore(
    realmPath: string,
    proposalId: string
  ): Promise<DaoProposal | null> {
    // Try qeval for structured data
    const result = await this.client.queryEval(
      realmPath,
      `GetPropStore().ProposalByID(${proposalId})`
    );

    if (!result) {
      // Fallback to render even if propstore was detected
      return this.getProposalViaRender(realmPath, proposalId);
    }

    // Also get the rendered version for full context
    const rendered = await this.client.queryRender(realmPath, proposalId, TTL_PROPOSAL);

    return {
      id: proposalId,
      ...this.parseProposalText(rendered || result),
      raw: rendered || result,
    };
  }

  // ── Private: Render() adapter ───────────────────────────────

  private async getProposalViaRender(
    realmPath: string,
    proposalId: string
  ): Promise<DaoProposal | null> {
    // Try multiple render path formats
    let raw = await this.client.queryRender(realmPath, proposalId, TTL_PROPOSAL);
    if (!raw) {
      raw = await this.client.queryRender(realmPath, `proposal/${proposalId}`, TTL_PROPOSAL);
    }
    if (!raw) {
      raw = await this.client.queryRender(realmPath, `${proposalId}`, TTL_PROPOSAL);
    }
    if (!raw) return null;

    return {
      id: proposalId,
      ...this.parseProposalText(raw),
      raw,
    };
  }

  // ── Private: Text parsing helpers ───────────────────────────

  private parseProposalText(text: string): Omit<DaoProposal, "id" | "raw"> {
    const title = this.extractTitle(text);
    const description = this.extractDescription(text);
    const status = this.extractStatus(text);
    const votes = this.extractVotes(text);
    const author = this.extractAuthor(text);

    return { title, description, status, votes, author };
  }

  private extractTitle(text: string): string {
    // Match first heading
    const match = text.match(/^#\s+(.+)$/m);
    if (match) return match[1].trim();

    // Match "Title: ..." pattern
    const titleMatch = text.match(/title[:\s]+(.+)/i);
    if (titleMatch) return titleMatch[1].trim();

    // First non-empty line
    const firstLine = text.split("\n").find((l) => l.trim().length > 0);
    return firstLine?.trim().slice(0, 200) || "Untitled Proposal";
  }

  private extractDescription(text: string): string {
    // Remove title line, return rest (truncated)
    const lines = text.split("\n");
    const titleIdx = lines.findIndex((l) => l.match(/^#\s+/));
    const rest = titleIdx >= 0 ? lines.slice(titleIdx + 1).join("\n") : text;
    return rest.trim().slice(0, 2000);
  }

  private extractStatus(text: string): ProposalStatus {
    const lower = text.toLowerCase();
    if (lower.includes("status: active") || lower.includes("active")) return "active";
    if (lower.includes("status: accepted") || lower.includes("passed")) return "accepted";
    if (lower.includes("status: rejected") || lower.includes("rejected")) return "rejected";
    if (lower.includes("execution failed")) return "execution-failed";
    if (lower.includes("executed")) return "executed";
    return "unknown";
  }

  private extractVotes(text: string): VoteTally {
    const yea = this.extractNumber(text, /yea[s]?[:\s]+(\d+)/i) ?? 0;
    const nay = this.extractNumber(text, /nay[s]?[:\s]+(\d+)/i) ?? 0;
    const abstain = this.extractNumber(text, /abstain[:\s]+(\d+)/i) ?? 0;

    // Also try YES/NO patterns
    const yes = this.extractNumber(text, /yes[:\s]+(\d+)/i);
    const no = this.extractNumber(text, /no[:\s]+(\d+)/i);

    const finalYea = yea || yes || 0;
    const finalNay = nay || no || 0;

    // Quorum
    const quorumMatch = text.match(/quorum[:\s]+([^\n]+)/i);

    return {
      yea: finalYea,
      nay: finalNay,
      abstain,
      total: finalYea + finalNay + abstain,
      quorum: quorumMatch?.[1]?.trim() || "unknown",
    };
  }

  private extractAuthor(text: string): string {
    const match =
      text.match(/author[:\s]+(g1[a-z0-9]+)/i) ||
      text.match(/proposed by[:\s]+(g1[a-z0-9]+)/i) ||
      text.match(/creator[:\s]+(g1[a-z0-9]+)/i) ||
      text.match(/(g1[a-z0-9]{38})/);

    return match?.[1] || "unknown";
  }

  private extractNumber(text: string, pattern: RegExp): number | null {
    const match = text.match(pattern);
    return match ? parseInt(match[1], 10) : null;
  }
}
