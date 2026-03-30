#!/usr/bin/env node
/**
 * Memba MCP Server — Model Context Protocol server for Gno blockchain queries.
 *
 * Exposes tools for querying DAOs, proposals, validators, contributors,
 * and on-chain data. Designed for use with Claude Desktop, Cursor, and
 * other MCP-compatible agents.
 *
 * Transport: stdio (standard input/output)
 * Config: GNO_RPC_URL env var (defaults to testnet12)
 *
 * @module memba-mcp
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { queryRender, queryEval, getBalance, getRpcUrl } from "./gno.js";
import { getContributors, getContributor, getRepositories } from "./gnolove.js";

const server = new McpServer({
  name: "memba",
  version: "0.1.0",
});

// ── Tool: Query Render ──────────────────────────────────────

server.registerTool(
  "memba_query_render",
  {
    description:
      "Query a Gno realm's Render() output via ABCI. Returns the markdown/text output " +
      "from the realm's Render function. Use this to read DAO configs, proposal lists, " +
      "member lists, board threads, and any on-chain realm state.",
    inputSchema: {
      realm_path: z
        .string()
        .describe('The realm path (e.g., "gno.land/r/gov/dao", "gno.land/r/samcrew/memba_dao")'),
      path: z
        .string()
        .default("")
        .describe('Optional render path argument (e.g., "42" for proposal #42, "members" for member list)'),
    },
  },
  async ({ realm_path, path }) => {
    const result = await queryRender(realm_path, path || "");
    if (!result) {
      return {
        content: [{ type: "text", text: `No response from realm ${realm_path}. It may not exist or the RPC may be down.` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: result }],
    };
  }
);

// ── Tool: Query Eval ────────────────────────────────────────

server.registerTool(
  "memba_query_eval",
  {
    description:
      "Evaluate a Gno realm function via ABCI vm/qeval. Returns the function result. " +
      'Use for checking specific state (e.g., IsArchived(), BalanceOf("TOKEN","g1addr")).',
    inputSchema: {
      realm_path: z
        .string()
        .describe("The realm path"),
      expression: z
        .string()
        .describe('The function call expression (e.g., "IsArchived()", "BalanceOf(\\"MEMBA\\",\\"g1addr\\")")'),
    },
  },
  async ({ realm_path, expression }) => {
    const result = await queryEval(realm_path, expression);
    if (!result) {
      return {
        content: [{ type: "text", text: `Eval failed for ${realm_path}: ${expression}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: result }],
    };
  }
);

// ── Tool: Get Balance ───────────────────────────────────────

server.registerTool(
  "memba_get_balance",
  {
    description:
      "Get the GNOT balance of a Gno address. Returns the balance in ugnot (1 GNOT = 1,000,000 ugnot).",
    inputSchema: {
      address: z
        .string()
        .describe('A Gno address (e.g., "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")'),
    },
  },
  async ({ address }) => {
    const result = await getBalance(address);
    if (!result) {
      return {
        content: [{ type: "text", text: `Failed to get balance for ${address}` }],
        isError: true,
      };
    }
    // Parse ugnot amount
    const match = result.match(/(\d+)ugnot/);
    const ugnot = match ? parseInt(match[1], 10) : 0;
    const gnot = ugnot / 1_000_000;

    return {
      content: [{
        type: "text",
        text: `Balance for ${address}:\n${gnot} GNOT (${ugnot} ugnot)`,
      }],
    };
  }
);

// ── Tool: Get DAO Info ──────────────────────────────────────

server.registerTool(
  "memba_get_dao",
  {
    description:
      "Get a DAO's overview including name, description, members, proposals, and config. " +
      "Fetches the Render() output and presents it in a structured format.",
    inputSchema: {
      realm_path: z
        .string()
        .default("gno.land/r/gov/dao")
        .describe('The DAO realm path (e.g., "gno.land/r/gov/dao", "gno.land/r/samcrew/memba_dao")'),
    },
  },
  async ({ realm_path }) => {
    const result = await queryRender(realm_path);
    if (!result) {
      return {
        content: [{ type: "text", text: `DAO not found at ${realm_path}` }],
        isError: true,
      };
    }
    return {
      content: [{
        type: "text",
        text: `# DAO: ${realm_path}\n\nRPC: ${getRpcUrl()}\n\n${result}`,
      }],
    };
  }
);

// ── Tool: Get Proposal ──────────────────────────────────────

server.registerTool(
  "memba_get_proposal",
  {
    description:
      "Get details of a specific DAO proposal by ID. Returns title, status, votes, " +
      "and description from the on-chain Render() output.",
    inputSchema: {
      realm_path: z
        .string()
        .default("gno.land/r/gov/dao")
        .describe("The DAO realm path"),
      proposal_id: z
        .number()
        .describe("The proposal ID number"),
    },
  },
  async ({ realm_path, proposal_id }) => {
    // Try multiple path formats (GovDAO uses numeric, basedao uses proposal/N)
    let result = await queryRender(realm_path, String(proposal_id));
    if (!result) {
      result = await queryRender(realm_path, `proposal/${proposal_id}`);
    }
    if (!result) {
      return {
        content: [{ type: "text", text: `Proposal #${proposal_id} not found at ${realm_path}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: result }],
    };
  }
);

// ── Tool: Get Contributors ──────────────────────────────────

server.registerTool(
  "memba_get_contributors",
  {
    description:
      "Get the Gno ecosystem contributor leaderboard from Gnolove. " +
      "Returns ranked contributors with scores, PRs, commits, issues, and reviews.",
    inputSchema: {
      time_filter: z
        .enum(["all", "yearly", "monthly", "weekly"])
        .default("all")
        .describe("Time filter for the leaderboard"),
      limit: z
        .number()
        .default(20)
        .describe("Maximum number of contributors to return"),
    },
  },
  async ({ time_filter, limit }) => {
    const contributors = await getContributors(time_filter);
    if (!contributors.length) {
      return {
        content: [{ type: "text", text: "No contributors found. The Gnolove API may be unavailable." }],
        isError: true,
      };
    }

    const top = contributors.slice(0, limit);
    const lines = top.map((c, i) =>
      `${i + 1}. **${c.name || c.login}** (@${c.login}) — ` +
      `Score: ${c.score} | PRs: ${c.TotalPrs} | Commits: ${c.TotalCommits} | ` +
      `Issues: ${c.TotalIssues} | Reviews: ${c.TotalReviewedPullRequests}`
    );

    return {
      content: [{
        type: "text",
        text: `# Contributor Leaderboard (${time_filter})\n\n${lines.join("\n")}`,
      }],
    };
  }
);

// ── Tool: Get Contributor Profile ────────────────────────────

server.registerTool(
  "memba_get_contributor",
  {
    description:
      "Get a specific contributor's profile and stats from Gnolove.",
    inputSchema: {
      login: z
        .string()
        .describe('GitHub login (e.g., "moul", "zxxma", "thehowl")'),
    },
  },
  async ({ login }) => {
    const contributor = await getContributor(login);
    if (!contributor) {
      return {
        content: [{ type: "text", text: `Contributor "${login}" not found in Gnolove.` }],
        isError: true,
      };
    }
    return {
      content: [{
        type: "text",
        text:
          `# ${contributor.name || contributor.login} (@${contributor.login})\n\n` +
          `- Score: ${contributor.score}\n` +
          `- Pull Requests: ${contributor.TotalPrs}\n` +
          `- Commits: ${contributor.TotalCommits}\n` +
          `- Issues: ${contributor.TotalIssues}\n` +
          `- Reviews: ${contributor.TotalReviewedPullRequests}`,
      }],
    };
  }
);

// ── Tool: Get Tracked Repositories ──────────────────────────

server.registerTool(
  "memba_get_repositories",
  {
    description:
      "Get the list of repositories tracked by Gnolove for contribution scoring.",
    inputSchema: {},
  },
  async () => {
    const repos = await getRepositories();
    if (!repos.length) {
      return {
        content: [{ type: "text", text: "No repositories found." }],
        isError: true,
      };
    }
    const lines = repos.map(r => `- ${r.owner}/${r.name} (branch: ${r.baseBranch})`);
    return {
      content: [{
        type: "text",
        text: `# Tracked Repositories (${repos.length})\n\n${lines.join("\n")}`,
      }],
    };
  }
);

// ── Tool: Get Network Status ────────────────────────────────

server.registerTool(
  "memba_get_network",
  {
    description:
      "Get the current Gno network status including latest block height, chain ID, and RPC endpoint.",
    inputSchema: {},
  },
  async () => {
    const url = getRpcUrl();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "status",
          params: {},
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const json = await res.json();
      const nodeInfo = json?.result?.node_info;
      const syncInfo = json?.result?.sync_info;

      return {
        content: [{
          type: "text",
          text:
            `# Network Status\n\n` +
            `- RPC: ${url}\n` +
            `- Chain ID: ${nodeInfo?.network || "unknown"}\n` +
            `- Moniker: ${nodeInfo?.moniker || "unknown"}\n` +
            `- Latest Block: ${syncInfo?.latest_block_height || "unknown"}\n` +
            `- Latest Block Time: ${syncInfo?.latest_block_time || "unknown"}\n` +
            `- Catching Up: ${syncInfo?.catching_up ?? "unknown"}`,
        }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Failed to reach RPC at ${url}: ${err}` }],
        isError: true,
      };
    }
  }
);

// ── Start Server ────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[memba-mcp] Server running on stdio (RPC: ${getRpcUrl()})`);
}

main().catch((err) => {
  console.error("[memba-mcp] Fatal error:", err);
  process.exit(1);
});
