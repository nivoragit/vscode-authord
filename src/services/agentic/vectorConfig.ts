import * as vscode from 'vscode';

export interface VectorConfig {
  enabled: boolean;
  autoIndex: boolean;
  store: 'local-hnsw' | 'local-json' | 'qdrant';
  topK: number;
  maxChunkChars: number;
  overlapChars: number;
  embeddingBatchSize: number;
  storagePath?: string;
  qdrant: {
    baseUrl?: string;
    apiKey?: string;
    collection: string;
  };
}

export function getVectorConfig(): VectorConfig {
  const config = vscode.workspace.getConfiguration('authord');
  const storeRaw = config.get<string>('vector.store', 'local-hnsw');
  const store = storeRaw === 'qdrant' || storeRaw === 'local-json' ? storeRaw : 'local-hnsw';

  return {
    enabled: config.get<boolean>('vector.enabled', true),
    autoIndex: config.get<boolean>('vector.autoIndex', true),
    store,
    topK: clampNumber(config.get<number>('vector.topK', 6), 1, 50),
    maxChunkChars: clampNumber(config.get<number>('vector.chunk.maxChars', 2000), 200, 20_000),
    overlapChars: clampNumber(config.get<number>('vector.chunk.overlapChars', 200), 0, 5000),
    embeddingBatchSize: clampNumber(config.get<number>('vector.embedding.batchSize', 16), 1, 200),
    storagePath: normalizePath(config.get<string>('vector.storagePath', '').trim()),
    qdrant: {
      baseUrl: normalizePath(config.get<string>('vector.qdrant.baseUrl', '').trim()),
      apiKey: config.get<string>('vector.qdrant.apiKey', '').trim() || undefined,
      collection: config.get<string>('vector.qdrant.collection', 'authord_docs').trim() || 'authord_docs',
    },
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizePath(value?: string): string | undefined {
  if (!value) return undefined;
  return value;
}
