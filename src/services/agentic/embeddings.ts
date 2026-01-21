import { createHash } from 'crypto';
import { EmbeddingProvider } from './types';
import {
  getAiSelectionConfig,
  getCustomProviderConfig,
  getEmbeddingProviderConfig,
  isCustomProviderReady,
  resolveCustomEmbeddingsEndpoint,
} from './aiConfig';
import { requestJson } from './httpClient';

const LOCAL_EMBED_DIM = 384;
const MAX_TEXT_CHARS = 8000;

export function createEmbeddingProvider(): EmbeddingProvider {
  const aiConfig = getAiSelectionConfig();
  const customConfig = getCustomProviderConfig();
  const embeddingConfig = getEmbeddingProviderConfig();

  if (embeddingConfig.provider === 'custom' && isCustomProviderReady(customConfig)) {
    return new OpenAiCompatibleEmbeddingProvider(customConfig);
  }

  if (embeddingConfig.provider === 'local') {
    return new LocalHashEmbeddingProvider();
  }

  if (embeddingConfig.provider === 'inherit' && aiConfig.provider === 'custom' && isCustomProviderReady(customConfig)) {
    return new OpenAiCompatibleEmbeddingProvider(customConfig);
  }

  return new LocalHashEmbeddingProvider();
}

class LocalHashEmbeddingProvider implements EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]> {
    const embeddings = texts.map((text) => hashEmbedding(text));
    return Promise.resolve(embeddings);
  }

  dimension(): number | undefined {
    return LOCAL_EMBED_DIM;
  }

  modelLabel(): string {
    return 'local-hash';
  }
}

class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  private lastDimension?: number;

  constructor(private readonly config: { baseUrl?: string; model?: string; embeddingModel?: string; apiKey?: string }) {}

  async embed(texts: string[]): Promise<number[][]> {
    const baseUrl = this.config.baseUrl!;
    const model = this.config.embeddingModel || this.config.model!;
    const endpoint = resolveCustomEmbeddingsEndpoint(baseUrl);
    const inputs = texts.map((text) => clampText(text));

    const response = await requestJson({
      url: endpoint,
      method: 'POST',
      headers: this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {},
      body: {
        model,
        input: inputs,
      },
    });

    const embeddings = extractEmbeddings(response);
    if (embeddings.length === 0) {
      throw new Error('Custom provider returned no embeddings.');
    }
    this.lastDimension = embeddings[0].length;
    return embeddings;
  }

  dimension(): number | undefined {
    return this.lastDimension;
  }

  modelLabel(): string {
    return this.config.embeddingModel || this.config.model || 'custom-embedding';
  }
}

function clampText(text: string): string {
  if (!text) return '';
  if (text.length <= MAX_TEXT_CHARS) return text;
  return text.slice(0, MAX_TEXT_CHARS);
}

function extractEmbeddings(response: any): number[][] {
  if (Array.isArray(response?.data)) {
    return response.data
      .map((item: any) => item?.embedding)
      .filter((embedding: any) => Array.isArray(embedding));
  }

  if (Array.isArray(response?.embeddings)) {
    return response.embeddings.filter((embedding: any) => Array.isArray(embedding));
  }

  return [];
}

function hashEmbedding(text: string): number[] {
  const vector = new Array(LOCAL_EMBED_DIM).fill(0);
  if (!text) return vector;

  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) || [];
  for (const token of tokens) {
    const index = fnv1a32(token) % LOCAL_EMBED_DIM;
    vector[index] += 1;
  }

  return normalizeVector(vector);
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalizeVector(vector: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vector.length; i += 1) {
    sumSq += vector[i] * vector[i];
  }
  if (sumSq === 0) return vector;
  const norm = Math.sqrt(sumSq);
  return vector.map((value) => value / norm);
}

export function stableTextHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
