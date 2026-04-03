/**
 * Types for Gno JSON-RPC and ABCI responses.
 */

export interface AbciResponseBase {
  Data: string;
  Error: string;
}

export interface AbciResponse {
  result?: {
    response?: {
      ResponseBase?: AbciResponseBase;
    };
  };
  error?: {
    message: string;
  };
}

export interface NodeInfo {
  network: string;
  moniker: string;
}

export interface SyncInfo {
  latest_block_height: string;
  latest_block_time: string;
  catching_up: boolean;
}

export interface NetworkStatus {
  node_info: NodeInfo;
  sync_info: SyncInfo;
}

export interface StatusResponse {
  result?: NetworkStatus;
}
