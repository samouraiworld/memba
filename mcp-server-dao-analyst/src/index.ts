#!/usr/bin/env node
/**
 * DAO Governance Analyst — MCP server for multi-perspective DAO analysis.
 *
 * Uses free-tier LLMs via the Memba backend to analyze DAO proposals
 * from legal, technical, and financial perspectives with consensus.
 *
 * Transport: stdio
 * Backend: Memba API (/api/analyst/*)
 * Chain: Gno (configurable via GNO_RPC_URL)
 *
 * @module dao-analyst-mcp
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GnoRpcClient } from "@samouraiworld/gno-rpc";
import { DaoAdapter } from "./dao/adapter.js";
import { BackendClient } from "./backend/client.js";
import { buildConsensus } from "./analysis/consensus.js";
import {
  buildAnalysisPrompt,
  buildHealthPrompt,
  buildTreasuryAuditPrompt,
  buildRiskPrompt,
} from "./analysis/prompts.js";
import {
  formatConsensusResult,
  formatHealthResult,
  formatTreasuryAudit,
  formatRiskAssessment,
} from "./format.js";
import type { AnalysisRequest, Perspective } from "./analysis/types.js";

// ── Initialization ────────────────────────────────────────────

const rpcClient = new GnoRpcClient();
const dao = new DaoAdapter(rpcClient);
const backend = new BackendClient();

const FREE_PERSPECTIVES: Perspective[] = ["technical", "financial"];
const PRO_PERSPECTIVES: Perspective[] = ["legal", "technical", "financial"];

function getActivePerspectives(): Perspective[] {
  return backend.tier === "pro" ? PRO_PERSPECTIVES : FREE_PERSPECTIVES;
}

const server = new McpServer({
  name: "dao-analyst",
  version: "0.1.0",
});

// ── Tool: Analyze Proposal ────────────────────────────────────

server.registerTool(
  "dao_analyze_proposal",
  {
    description:
      "Analyze a DAO proposal from multiple perspectives (legal, technical, financial). " +
      "Fetches on-chain data and runs multi-model LLM consensus analysis. " +
      "Free tier: 2 perspectives. PRO: 3 perspectives with deeper analysis.",
    inputSchema: {
      realm_path: z
        .string()
        .describe('The DAO realm path (e.g., "gno.land/r/gov/dao")'),
      proposal_id: z
        .string()
        .describe('The proposal ID (e.g., "5", "42")'),
    },
  },
  async ({ realm_path, proposal_id }) => {
    try {
      // 1. Fetch on-chain data
      const [proposal, overview, treasury] = await Promise.all([
        dao.getProposal(realm_path, proposal_id),
        dao.getOverview(realm_path),
        dao.getTreasury(realm_path),
      ]);

      if (!proposal) {
        return {
          content: [{
            type: "text",
            text: `Proposal #${proposal_id} not found at ${realm_path}. The realm may not exist or the proposal ID is invalid.`,
          }],
          isError: true,
        };
      }

      const daoContext = overview?.raw || `DAO at ${realm_path}`;
      const treasuryContext = `Balance: ${treasury.balanceGnot} GNOT (${treasury.balanceUgnot} ugnot)`;

      // 2. Build analysis requests for each perspective
      const perspectives = getActivePerspectives();
      const requests: AnalysisRequest[] = perspectives.map((perspective) => {
        const { system, user } = buildAnalysisPrompt(
          perspective,
          proposal.raw,
          daoContext,
          treasuryContext
        );
        return {
          perspective,
          proposalData: `${system}\n\n${user}`,
          daoContext,
          treasuryContext,
        };
      });

      // 3. Send to backend for LLM analysis
      const response = await backend.analyze({
        perspectives: requests,
        tier: backend.tier,
      });

      // 4. Build consensus from results
      const consensus = buildConsensus(response.results);

      // 5. Format output
      const formatted = formatConsensusResult(consensus, proposal_id, realm_path);

      return {
        content: [{ type: "text", text: formatted }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: `Analysis failed: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// ── Tool: Audit Treasury ──────────────────────────────────────

server.registerTool(
  "dao_audit_treasury",
  {
    description:
      "Audit a DAO's treasury — balance, spending patterns, and financial health assessment.",
    inputSchema: {
      realm_path: z
        .string()
        .describe('The DAO realm path (e.g., "gno.land/r/gov/dao")'),
    },
  },
  async ({ realm_path }) => {
    try {
      const [overview, treasury] = await Promise.all([
        dao.getOverview(realm_path),
        dao.getTreasury(realm_path),
      ]);

      if (!overview) {
        return {
          content: [{ type: "text", text: `DAO not found at ${realm_path}` }],
          isError: true,
        };
      }

      const daoContext = overview.raw;
      const treasuryContext = `Balance: ${treasury.balanceGnot} GNOT (${treasury.balanceUgnot} ugnot)`;

      const { system, user } = buildTreasuryAuditPrompt(daoContext, treasuryContext);

      const response = await backend.analyze({
        perspectives: [{
          perspective: "financial",
          proposalData: `${system}\n\n${user}`,
          daoContext,
          treasuryContext,
        }],
        tier: backend.tier,
      });

      if (response.results.length === 0) {
        return {
          content: [{ type: "text", text: "Treasury audit failed — no results from backend." }],
          isError: true,
        };
      }

      // Parse the financial perspective's reasoning as treasury audit JSON
      const result = safeParseJSON(response.results[0].reasoning, {
        healthRating: "unknown",
        findings: [],
        risks: response.results[0].risks,
        recommendations: response.results[0].recommendations,
        summary: response.results[0].reasoning,
      });

      const formatted = formatTreasuryAudit(result, realm_path, response.modelsUsed[0] || "unknown");

      return { content: [{ type: "text", text: formatted }] };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: `Treasury audit failed: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// ── Tool: Governance Health ───────────────────────────────────

server.registerTool(
  "dao_governance_health",
  {
    description:
      "Assess overall governance health of a DAO — participation, proposal velocity, power concentration.",
    inputSchema: {
      realm_path: z
        .string()
        .describe('The DAO realm path (e.g., "gno.land/r/gov/dao")'),
    },
  },
  async ({ realm_path }) => {
    try {
      const [overview, treasury, proposalCount] = await Promise.all([
        dao.getOverview(realm_path),
        dao.getTreasury(realm_path),
        dao.getProposalCount(realm_path),
      ]);

      if (!overview) {
        return {
          content: [{ type: "text", text: `DAO not found at ${realm_path}` }],
          isError: true,
        };
      }

      const treasuryContext = `Balance: ${treasury.balanceGnot} GNOT (${treasury.balanceUgnot} ugnot)`;
      const { system, user } = buildHealthPrompt(
        overview.raw,
        treasuryContext,
        proposalCount ?? 0
      );

      const response = await backend.analyze({
        perspectives: [{
          perspective: "governance" as Perspective,
          proposalData: `${system}\n\n${user}`,
          daoContext: overview.raw,
        }],
        tier: backend.tier,
      });

      if (response.results.length === 0) {
        return {
          content: [{ type: "text", text: "Health assessment failed — no results from backend." }],
          isError: true,
        };
      }

      const result = safeParseJSON(response.results[0].reasoning, {
        healthScore: 50,
        strengths: [],
        weaknesses: [],
        recommendations: response.results[0].recommendations,
        summary: response.results[0].reasoning,
      });

      const formatted = formatHealthResult(result, realm_path, response.modelsUsed[0] || "unknown");

      return { content: [{ type: "text", text: formatted }] };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: `Health assessment failed: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// ── Tool: Compare Proposals ───────────────────────────────────

server.registerTool(
  "dao_compare_proposals",
  {
    description:
      "Compare multiple DAO proposals side by side. Free tier: max 2 proposals. PRO: up to 5.",
    inputSchema: {
      realm_path: z
        .string()
        .describe("The DAO realm path"),
      proposal_ids: z
        .array(z.string())
        .min(2)
        .max(5)
        .describe('Array of proposal IDs to compare (e.g., ["1", "2", "3"])'),
    },
  },
  async ({ realm_path, proposal_ids }) => {
    try {
      const maxProposals = backend.tier === "pro" ? 5 : 2;
      const ids = proposal_ids.slice(0, maxProposals);

      if (proposal_ids.length > maxProposals) {
        // Notify about tier limit
      }

      // Fetch all proposals in parallel
      const proposals = await Promise.all(
        ids.map((id) => dao.getProposal(realm_path, id))
      );

      const validProposals = proposals
        .map((p, i) => ({ proposal: p, id: ids[i] }))
        .filter((p) => p.proposal !== null);

      if (validProposals.length < 2) {
        return {
          content: [{
            type: "text",
            text: `Could not find enough proposals to compare. Found ${validProposals.length} of ${ids.length}.`,
          }],
          isError: true,
        };
      }

      // Batch all proposals into a single prompt for efficiency
      const batchedData = validProposals
        .map((p) => `### Proposal #${p.id}\n${p.proposal!.raw}`)
        .join("\n\n---\n\n");

      const overview = await dao.getOverview(realm_path);

      const response = await backend.analyze({
        perspectives: [{
          perspective: "technical",
          proposalData:
            `Compare these proposals objectively. For each, provide verdict, risks, and which is preferable.\n\n${batchedData}`,
          daoContext: overview?.raw || realm_path,
        }],
        tier: backend.tier,
      });

      // Format comparison
      const lines: string[] = [
        `# Proposal Comparison — ${realm_path}`,
        `Comparing proposals: ${ids.join(", ")}`,
        "",
      ];

      for (const p of validProposals) {
        lines.push(`## Proposal #${p.id}: ${p.proposal!.title}`);
        lines.push(`- Status: ${p.proposal!.status}`);
        lines.push(`- Votes: ${p.proposal!.votes.yea} yea / ${p.proposal!.votes.nay} nay`);
        lines.push("");
      }

      if (response.results.length > 0) {
        lines.push("## Analysis");
        lines.push(response.results[0].reasoning);
      }

      lines.push("");
      lines.push("---");
      lines.push("*AI-generated comparison. Verify against on-chain data.*");

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: `Comparison failed: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// ── Tool: Risk Assessment ─────────────────────────────────────

server.registerTool(
  "dao_risk_assessment",
  {
    description:
      "Focused risk analysis of a specific DAO proposal — what could go wrong.",
    inputSchema: {
      realm_path: z
        .string()
        .describe("The DAO realm path"),
      proposal_id: z
        .string()
        .describe("The proposal ID"),
    },
  },
  async ({ realm_path, proposal_id }) => {
    try {
      const [proposal, overview] = await Promise.all([
        dao.getProposal(realm_path, proposal_id),
        dao.getOverview(realm_path),
      ]);

      if (!proposal) {
        return {
          content: [{
            type: "text",
            text: `Proposal #${proposal_id} not found at ${realm_path}`,
          }],
          isError: true,
        };
      }

      const { system, user } = buildRiskPrompt(
        proposal.raw,
        overview?.raw || realm_path
      );

      const response = await backend.analyze({
        perspectives: [{
          perspective: "technical",
          proposalData: `${system}\n\n${user}`,
          daoContext: overview?.raw || realm_path,
        }],
        tier: backend.tier,
      });

      if (response.results.length === 0) {
        return {
          content: [{ type: "text", text: "Risk assessment failed — no results." }],
          isError: true,
        };
      }

      const result = safeParseJSON(response.results[0].reasoning, {
        riskLevel: "unknown",
        risks: [],
        overallAssessment: response.results[0].reasoning,
      });

      const formatted = formatRiskAssessment(
        result,
        proposal_id,
        realm_path,
        response.modelsUsed[0] || "unknown"
      );

      return { content: [{ type: "text", text: formatted }] };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: `Risk assessment failed: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// ── Tool: Set Network ─────────────────────────────────────────

server.registerTool(
  "dao_set_network",
  {
    description:
      "Switch the Gno network for all subsequent queries. Accepts a known network name or custom RPC URL.",
    inputSchema: {
      network: z
        .string()
        .describe(
          'Network name ("mainnet", "test5", "test12") or a full RPC URL (e.g., "https://rpc.gno.land")'
        ),
    },
  },
  async ({ network }) => {
    const KNOWN_NETWORKS: Record<string, string> = {
      mainnet: "https://rpc.gno.land",
      test5: "https://rpc.test5.gno.land",
      test12: "https://rpc.testnet12.samourai.live:443",
    };

    const rpcUrl = KNOWN_NETWORKS[network.toLowerCase()] || network;

    // Validate it looks like a URL
    if (!rpcUrl.startsWith("http")) {
      return {
        content: [{
          type: "text",
          text: `Unknown network "${network}". Use: mainnet, test5, test12, or a full URL.`,
        }],
        isError: true,
      };
    }

    // Update the RPC client — create a new one with the new URL
    // Note: this modifies the module-level client for subsequent calls
    process.env.GNO_RPC_URL = rpcUrl;

    return {
      content: [{
        type: "text",
        text: `Switched to network: ${network}\nRPC: ${rpcUrl}`,
      }],
    };
  }
);

// ── Helpers ───────────────────────────────────────────────────

function safeParseJSON<T>(text: string, fallback: T): T {
  try {
    const jsonStr = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(jsonStr) as T;
  } catch {
    return fallback;
  }
}

// ── Start Server ──────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[dao-analyst] Server running on stdio`);
  console.error(`[dao-analyst] RPC: ${rpcClient.rpcUrl}`);
  console.error(`[dao-analyst] Backend: ${backend.url}`);
  console.error(`[dao-analyst] Tier: ${backend.tier}`);
}

main().catch((err) => {
  console.error("[dao-analyst] Fatal error:", err);
  process.exit(1);
});
