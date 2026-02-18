// Address types
export enum AddressType {
  BASIC = 'BASIC',
  HTLC = 'HTLC',
  VESTING = 'VESTING',
  STAKING = 'STAKING',
  UNKNOWN = 'UNKNOWN',
}

export enum IndexStatus {
  PENDING = 'PENDING',
  INDEXING = 'INDEXING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR',
}

// Direction for graph expansion
export type Direction = 'incoming' | 'outgoing' | 'both';

// Filter state for queries
export interface FilterState {
  minTimestamp?: number;
  maxTimestamp?: number;
  minValue?: bigint;
  maxValue?: bigint;
  limit?: number;
}

// Expand request for graph API
export interface ExpandRequest {
  addresses: string[];
  direction: Direction;
  filters?: FilterState;
}

// Node data for Cytoscape
export interface NodeData {
  id: string;
  label?: string;
  icon?: string;
  type: AddressType;
  balance: string;
  indexStatus: IndexStatus;
  txCount?: number;
}

// Edge data for Cytoscape
export interface EdgeData {
  id: string;
  source: string;
  target: string;
  txCount: number;
  totalValue: string;
  firstTxAt: string;
  lastTxAt: string;
}

// Cytoscape node format
export interface CytoscapeNode {
  data: NodeData;
}

// Cytoscape edge format
export interface CytoscapeEdge {
  data: EdgeData;
}

// Graph response (Cytoscape format)
export interface GraphResponse {
  nodes: CytoscapeNode[];
  edges: CytoscapeEdge[];
}

// Path response
export interface PathResponse {
  found: boolean;
  path?: {
    nodes: CytoscapeNode[];
    edges: CytoscapeEdge[];
  };
  depth?: number;
}

// Address metadata response
export interface AddressResponse {
  id: string;
  type: AddressType;
  label?: string;
  icon?: string;
  balance: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  indexStatus: IndexStatus;
  indexedAt?: string;
  txCount?: number;
}

// Transaction response
export interface TransactionResponse {
  hash: string;
  from: string;
  to: string;
  value: string;
  fee: string;
  blockNumber: number;
  timestamp: string;
  data?: string;
}

// Paginated response
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// Subgraph response (all paths within max hops)
export interface SubgraphResponse {
  found: boolean;
  subgraph?: {
    nodes: CytoscapeNode[];
    edges: CytoscapeEdge[];
  };
  stats?: {
    nodeCount: number;
    edgeCount: number;
    maxHops: number;
    shortestPath: number;
    directed: boolean;
  };
}
