import * as fs from 'fs';
import * as path from 'path';
import { VectorMetadata, VectorQuery, VectorRecord, VectorSearchResult, VectorStore } from './types';
import { requestJson } from './httpClient';
import type { VectorConfig } from './vectorConfig';

const DEFAULT_MAX_ELEMENTS = 5000;

export async function createVectorStore(config: VectorConfig, storageDir: string): Promise<VectorStore> {
  if (config.store === 'qdrant') {
    return new QdrantVectorStore(config.qdrant);
  }

  const targetDir = path.join(storageDir, config.store);
  await fs.promises.mkdir(targetDir, { recursive: true });

  if (config.store === 'local-json') {
    const store = new LocalJsonVectorStore(targetDir);
    await store.initialize();
    return store;
  }

  const hnswStore = new LocalHnswVectorStore(targetDir);
  await hnswStore.initialize();
  if (hnswStore.isAvailable()) return hnswStore;

  const fallback = new LocalJsonVectorStore(targetDir);
  await fallback.initialize();
  return fallback;
}

class LocalJsonVectorStore implements VectorStore {
  private dataPath: string;
  private dimension?: number;
  private records = new Map<string, VectorRecord>();

  constructor(private readonly dir: string) {
    this.dataPath = path.join(dir, 'vectors.json');
  }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.dataPath)) return;
    const raw = await fs.promises.readFile(this.dataPath, 'utf8');
    const data = JSON.parse(raw);
    this.dimension = data.dimension;
    const items: VectorRecord[] = data.records || [];
    items.forEach((record) => {
      this.records.set(record.id, {
        ...record,
        vector: normalizeVector(record.vector),
      });
    });
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) {
      if (!this.dimension) this.dimension = record.vector.length;
      if (record.vector.length !== this.dimension) {
        throw new Error('Vector dimension mismatch.');
      }
      this.records.set(record.id, {
        ...record,
        vector: normalizeVector(record.vector),
      });
    }
    await this.persist();
  }

  async delete(ids: string[]): Promise<void> {
    ids.forEach((id) => this.records.delete(id));
    await this.persist();
  }

  async query(query: VectorQuery): Promise<VectorSearchResult[]> {
    if (!this.dimension || this.records.size === 0) return [];
    const queryVector = normalizeVector(query.vector);
    const results: VectorSearchResult[] = [];

    for (const record of this.records.values()) {
      if (!passesFilter(record.metadata, query.filter)) continue;
      const score = dotProduct(queryVector, record.vector);
      if (query.minScore !== undefined && score < query.minScore) continue;
      results.push({
        id: record.id,
        score,
        metadata: record.metadata,
        text: record.text,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, query.k);
  }

  private async persist(): Promise<void> {
    const data = {
      version: 1,
      dimension: this.dimension,
      records: Array.from(this.records.values()),
    };
    await fs.promises.writeFile(this.dataPath, JSON.stringify(data, null, 2), 'utf8');
  }
}

class LocalHnswVectorStore implements VectorStore {
  private indexPath: string;
  private metaPath: string;
  private index: any;
  private dimension?: number;
  private maxElements = DEFAULT_MAX_ELEMENTS;
  private nextLabel = 1;
  private idToLabel = new Map<string, number>();
  private labelToRecord = new Map<number, { id: string; metadata: VectorMetadata; text?: string }>();
  private available = false;

  constructor(private readonly dir: string) {
    this.indexPath = path.join(dir, 'hnsw.index');
    this.metaPath = path.join(dir, 'hnsw-metadata.json');
  }

  isAvailable(): boolean {
    return this.available;
  }

  async initialize(): Promise<void> {
    const hnsw = this.loadLibrary();
    if (!hnsw) {
      this.available = false;
      return;
    }

    if (fs.existsSync(this.metaPath)) {
      const raw = await fs.promises.readFile(this.metaPath, 'utf8');
      const data = JSON.parse(raw);
      this.dimension = data.dimension;
      this.maxElements = data.maxElements || DEFAULT_MAX_ELEMENTS;
      this.nextLabel = data.nextLabel || 1;
      this.idToLabel = new Map(Object.entries(data.idToLabel || {}).map(([id, label]) => [id, Number(label)]));
      this.labelToRecord = new Map(
        Object.entries(data.labelToRecord || {}).map(([label, record]) => [Number(label), record as any])
      );
    }

    if (this.dimension && fs.existsSync(this.indexPath)) {
      this.index = new hnsw.HierarchicalNSW('cosine', this.dimension);
      this.index.readIndexSync(this.indexPath);
    }

    this.available = true;
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (!this.available) return;
    if (records.length === 0) return;

    const dimension = records[0].vector.length;
    await this.ensureIndex(dimension);

    for (const record of records) {
      if (record.vector.length !== this.dimension) {
        throw new Error('Vector dimension mismatch.');
      }
      const existingLabel = this.idToLabel.get(record.id);
      if (existingLabel !== undefined) {
        this.labelToRecord.delete(existingLabel);
        this.idToLabel.delete(record.id);
      }

      const label = this.nextLabel;
      this.nextLabel += 1;

      if (this.index.getCurrentCount && this.index.getCurrentCount() + 1 > this.maxElements) {
        this.maxElements += DEFAULT_MAX_ELEMENTS;
        if (this.index.resizeIndex) {
          this.index.resizeIndex(this.maxElements);
        }
      }

      this.index.addPoint(normalizeVector(record.vector), label);
      this.idToLabel.set(record.id, label);
      this.labelToRecord.set(label, { id: record.id, metadata: record.metadata, text: record.text });
    }

    await this.persist();
  }

  async delete(ids: string[]): Promise<void> {
    if (!this.available) return;
    let changed = false;
    for (const id of ids) {
      const label = this.idToLabel.get(id);
      if (label === undefined) continue;
      this.idToLabel.delete(id);
      this.labelToRecord.delete(label);
      changed = true;
    }
    if (changed) {
      await this.persist();
    }
  }

  async query(query: VectorQuery): Promise<VectorSearchResult[]> {
    if (!this.available || !this.index || !this.dimension) return [];
    const queryVector = normalizeVector(query.vector);
    const requested = Math.max(query.k * 3, query.k);
    const result = this.index.searchKnn(queryVector, requested);
    const labels: number[] = extractLabels(result);
    const distances: number[] = extractDistances(result);

    const results: VectorSearchResult[] = [];
    for (let i = 0; i < labels.length; i += 1) {
      const label = labels[i];
      const record = this.labelToRecord.get(label);
      if (!record) continue;
      if (!passesFilter(record.metadata, query.filter)) continue;
      const distance = distances[i] ?? 0;
      const score = 1 - distance;
      if (query.minScore !== undefined && score < query.minScore) continue;
      results.push({
        id: record.id,
        score,
        metadata: record.metadata,
        text: record.text,
      });
      if (results.length >= query.k) break;
    }

    return results;
  }

  private async ensureIndex(dimension: number): Promise<void> {
    if (!this.dimension) {
      this.dimension = dimension;
    }
    if (this.dimension !== dimension) {
      throw new Error('Embedding dimension mismatch; clear the index and rebuild.');
    }
    if (this.index) return;

    const hnsw = this.loadLibrary();
    if (!hnsw) {
      this.available = false;
      throw new Error('HNSW library not available.');
    }

    this.index = new hnsw.HierarchicalNSW('cosine', this.dimension);
    this.index.initIndex(this.maxElements);
  }

  private async persist(): Promise<void> {
    if (!this.index) return;
    this.index.writeIndexSync(this.indexPath);
    const data = {
      version: 1,
      dimension: this.dimension,
      maxElements: this.maxElements,
      nextLabel: this.nextLabel,
      idToLabel: Object.fromEntries(this.idToLabel),
      labelToRecord: Object.fromEntries(this.labelToRecord),
    };
    await fs.promises.writeFile(this.metaPath, JSON.stringify(data, null, 2), 'utf8');
  }

  private loadLibrary(): any | undefined {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('hnswlib-node');
    } catch {
      return undefined;
    }
  }
}

class QdrantVectorStore implements VectorStore {
  private baseUrl: string;
  private apiKey?: string;
  private collection: string;
  private dimension?: number;

  constructor(config: { baseUrl?: string; apiKey?: string; collection: string }) {
    if (!config.baseUrl) {
      throw new Error('Qdrant base URL is required.');
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.collection = config.collection;
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.ensureCollection(records[0].vector.length);

    await requestJson({
      url: `${this.baseUrl}/collections/${this.collection}/points?wait=true`,
      method: 'PUT',
      headers: this.apiKey ? { 'api-key': this.apiKey } : {},
      body: {
        points: records.map((record) => ({
          id: record.id,
          vector: record.vector,
          payload: {
            ...record.metadata,
            text: record.text,
          },
        })),
      },
    });
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await requestJson({
      url: `${this.baseUrl}/collections/${this.collection}/points/delete?wait=true`,
      method: 'POST',
      headers: this.apiKey ? { 'api-key': this.apiKey } : {},
      body: {
        points: ids,
      },
    });
  }

  async query(query: VectorQuery): Promise<VectorSearchResult[]> {
    await this.ensureCollection(query.vector.length);
    const response = await requestJson({
      url: `${this.baseUrl}/collections/${this.collection}/points/search`,
      method: 'POST',
      headers: this.apiKey ? { 'api-key': this.apiKey } : {},
      body: {
        vector: query.vector,
        limit: query.k,
        with_payload: true,
        filter: buildQdrantFilter(query.filter),
      },
    });

    const hits = Array.isArray(response?.result) ? response.result : [];
    return hits.map((hit: any) => {
      const payload = hit.payload || {};
      const { text, ...metadata } = payload;
      return {
        id: String(hit.id),
        score: hit.score ?? 0,
        metadata,
        text,
      };
    }).filter((result: VectorSearchResult) => {
      if (query.minScore === undefined) return true;
      return result.score >= query.minScore;
    });
  }

  private async ensureCollection(dimension: number): Promise<void> {
    if (this.dimension) return;
    this.dimension = dimension;

    try {
      await requestJson({
        url: `${this.baseUrl}/collections/${this.collection}`,
        method: 'GET',
        headers: this.apiKey ? { 'api-key': this.apiKey } : {},
      });
      return;
    } catch {
      // Fall through to create.
    }

    await requestJson({
      url: `${this.baseUrl}/collections/${this.collection}`,
      method: 'PUT',
      headers: this.apiKey ? { 'api-key': this.apiKey } : {},
      body: {
        vectors: {
          size: dimension,
          distance: 'Cosine',
        },
      },
    });
  }
}

function extractLabels(result: any): number[] {
  if (!result) return [];
  if (Array.isArray(result?.neighbors)) return result.neighbors;
  if (Array.isArray(result?.labels)) return result.labels;
  if (Array.isArray(result?.ids)) return result.ids;
  if (Array.isArray(result?.[0])) return result[0];
  return [];
}

function extractDistances(result: any): number[] {
  if (!result) return [];
  if (Array.isArray(result?.distances)) return result.distances;
  if (Array.isArray(result?.[1])) return result[1];
  return [];
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

function dotProduct(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i += 1) {
    sum += a[i] * b[i];
  }
  return sum;
}

function passesFilter(metadata: VectorMetadata, filter?: VectorMetadata): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(([key, value]) => metadata[key] === value);
}

function buildQdrantFilter(filter?: VectorMetadata): any | undefined {
  if (!filter) return undefined;
  const must = Object.entries(filter).map(([key, value]) => ({
    key,
    match: { value },
  }));
  return { must };
}
