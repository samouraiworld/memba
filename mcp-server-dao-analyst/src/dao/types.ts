/**
 * Types for DAO data — normalized from various Gno DAO implementations.
 */

export interface DaoProposal {
  id: string;
  title: string;
  description: string;
  status: ProposalStatus;
  author: string;
  votes: VoteTally;
  raw: string;
}

export type ProposalStatus =
  | "active"
  | "accepted"
  | "rejected"
  | "execution-failed"
  | "executed"
  | "unknown";

export interface VoteTally {
  yea: number;
  nay: number;
  abstain: number;
  total: number;
  quorum: string;
}

export interface DaoOverview {
  realmPath: string;
  name: string;
  memberCount: number;
  proposalCount: number;
  raw: string;
}

export interface TreasuryInfo {
  address: string;
  balanceUgnot: number;
  balanceGnot: number;
  grc20Tokens: GRC20Balance[];
}

export interface GRC20Balance {
  token: string;
  realmPath: string;
  balance: string;
}

/** Describes what capabilities a DAO realm supports. */
export interface DaoCapabilities {
  /** Can query proposals via GetPropStore().ProposalByID(id) */
  hasProposalStore: boolean;
  /** Can query proposal count via GetPropStore().Size() */
  hasProposalCount: boolean;
  /** Has a Render() function (universal) */
  hasRender: boolean;
  /** Detection method used */
  adapter: "propstore" | "render" | "unknown";
}
