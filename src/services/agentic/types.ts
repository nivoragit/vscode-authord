export type VectorMetadata = Record<string, string | number | boolean | null>;

export interface VectorRecord {
  id: string;
  vector: number[];
  metadata: VectorMetadata;
  text?: string;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: VectorMetadata;
  text?: string;
}

export interface VectorQuery {
  vector: number[];
  k: number;
  filter?: VectorMetadata;
  minScore?: number;
}

export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void>;
  delete(ids: string[]): Promise<void>;
  query(query: VectorQuery): Promise<VectorSearchResult[]>;
  close?(): Promise<void>;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  dimension(): number | undefined;
  modelLabel(): string;
}

export interface Chunk {
  id: string;
  text: string;
  metadata: VectorMetadata;
}
