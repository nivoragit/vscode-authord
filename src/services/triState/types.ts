export type TriStateStatus = 'SYNCED' | 'DRIFTED' | 'DRAFT' | 'MISSING';

export interface TriStateRegistry {
  schema_version: 1;
  updated_at: string;
  topics: Record<string, TriStateTopic>;
}

export interface TriStateTopic {
  id: string;
  name: string;
  tri_state?: TriStateStatus;
  code_contract?: CodeContract | null;
  local_state: LocalState;
  remote_state?: RemoteState | null;
  policy_tags?: string[];
}

export interface CodeContract {
  symbols: string[];
  last_known_hash: string;
  hash_algo: 'ts_signature_v1' | 'text_nocomments_v1';
}

export interface LocalState {
  path: string;
  content_hash: string;
  updated_at: string;
}

export interface RemoteState {
  confluence_page_id: string;
  confluence_version: number;
  confluence_anchor?: string | null;
  last_synced_hash: string;
  synced_at: string;
}
