import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DocumentationManager } from '../../managers/DocumentationManager';
import TopicsService from '../TopicsService';
import { chunkMarkdown } from './chunker';
import { createEmbeddingProvider, stableTextHash } from './embeddings';
import { createVectorStore } from './vectorStores';
import { VectorStore, VectorSearchResult } from './types';
import { getVectorConfig } from './vectorConfig';
import type { VectorConfig } from './vectorConfig';
import LoggerService, { getLogger } from '../LoggerService';

interface DocTarget {
  docId: string;
  docName: string;
  topicFile: string;
  filePath: string;
}

interface IndexManifest {
  version: number;
  docHashes: Record<string, string>;
  docChunks: Record<string, string[]>;
}

export default class DocumentIndexService {
  private vectorStore: VectorStore | undefined;
  private manifestPath: string;
  private manifest: IndexManifest = { version: 1, docHashes: {}, docChunks: {} };
  private vectorConfig: VectorConfig;
  private indexQueue: Promise<void> = Promise.resolve();
  private logger: LoggerService;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private documentManager: DocumentationManager,
    private readonly workspaceRoot: string
  ) {
    this.vectorConfig = getVectorConfig();
    const storageDir = this.resolveStorageDir();
    this.manifestPath = path.join(storageDir, 'index-manifest.json');
    this.logger = getLogger();
  }

  static async create(
    context: vscode.ExtensionContext,
    documentManager: DocumentationManager,
    workspaceRoot: string
  ): Promise<DocumentIndexService> {
    const service = new DocumentIndexService(context, documentManager, workspaceRoot);
    await service.initialize();
    return service;
  }

  updateDocumentManager(manager: DocumentationManager): void {
    // Allows reuse after config reload.
    this.documentManager = manager;
  }

  isEnabled(): boolean {
    this.vectorConfig = getVectorConfig();
    return this.vectorConfig.enabled;
  }

  hasIndex(): boolean {
    return Object.keys(this.manifest.docHashes).length > 0;
  }

  async indexAll(force = false): Promise<void> {
    if (!this.isEnabled()) return;
    await this.enqueue(async () => {
      const targets = this.buildDocTargets();
      this.logger.info('Indexing documentation.', {
        force,
        targets: targets.length,
        store: this.vectorConfig.store,
      });
      const currentKeys = new Set<string>();

      for (const target of targets) {
        const key = this.docKey(target);
        currentKeys.add(key);
        await this.indexTarget(target, force);
      }

      await this.pruneMissingDocs(currentKeys);
      await this.saveManifest();
    });
  }

  async indexDocument(filePath: string, content?: string): Promise<void> {
    if (!this.isEnabled()) return;
    await this.enqueue(async () => {
      const targets = this.buildDocTargets().filter((target) => target.filePath === filePath);
      if (targets.length === 0) return;
      for (const target of targets) {
        await this.indexTarget(target, false, content);
      }
      await this.saveManifest();
    });
  }

  async query(text: string, topK?: number): Promise<VectorSearchResult[]> {
    if (!this.isEnabled()) return [];
    const vectorStore = await this.ensureVectorStore();
    if (!vectorStore) return [];
    const embedder = createEmbeddingProvider();
    const [vector] = await embedder.embed([text]);
    const limit = topK ?? this.vectorConfig.topK;
    return vectorStore.query({ vector, k: limit });
  }

  async clearIndex(): Promise<void> {
    await this.enqueue(async () => {
      const storageDir = this.resolveStorageDir();
      await fs.promises.rm(storageDir, { recursive: true, force: true });
      this.manifest = { version: 1, docHashes: {}, docChunks: {} };
      this.vectorStore = undefined;
    });
  }

  private async initialize(): Promise<void> {
    await fs.promises.mkdir(this.resolveStorageDir(), { recursive: true });
    await this.loadManifest();
    this.vectorStore = await this.ensureVectorStore();
  }

  private async ensureVectorStore(): Promise<VectorStore | undefined> {
    if (this.vectorStore) return this.vectorStore;
    const storageDir = this.resolveStorageDir();
    await fs.promises.mkdir(storageDir, { recursive: true });
    this.vectorConfig = getVectorConfig();
    this.vectorStore = await createVectorStore(this.vectorConfig, storageDir);
    return this.vectorStore;
  }

  private resolveStorageDir(): string {
    this.vectorConfig = getVectorConfig();
    const configuredPath = this.vectorConfig.storagePath;
    if (configuredPath) return configuredPath;
    const storageUri = this.context.storageUri ?? this.context.globalStorageUri;
    return path.join(storageUri.fsPath, 'vector-index');
  }

  private async loadManifest(): Promise<void> {
    if (!fs.existsSync(this.manifestPath)) return;
    const raw = await fs.promises.readFile(this.manifestPath, 'utf8');
    this.manifest = JSON.parse(raw);
    if (!this.manifest.docHashes) this.manifest.docHashes = {};
    if (!this.manifest.docChunks) this.manifest.docChunks = {};
  }

  private async saveManifest(): Promise<void> {
    await fs.promises.writeFile(this.manifestPath, JSON.stringify(this.manifest, null, 2), 'utf8');
  }

  private async indexTarget(target: DocTarget, force: boolean, content?: string): Promise<void> {
    if (!fs.existsSync(target.filePath)) return;
    const raw = content ?? await fs.promises.readFile(target.filePath, 'utf8');
    const docHash = stableTextHash(raw);
    const key = this.docKey(target);

    if (!force && this.manifest.docHashes[key] === docHash) {
      return;
    }

    const chunks = this.buildChunks(target, raw, docHash);
    this.logger.debug('Indexing document.', {
      docId: target.docId,
      topic: target.topicFile,
      chunks: chunks.length,
    });
    const vectorStore = await this.ensureVectorStore();
    if (!vectorStore) return;
    const embedder = createEmbeddingProvider();

    if (chunks.length === 0) {
      const oldChunkIds = this.manifest.docChunks[key] || [];
      if (oldChunkIds.length > 0) {
        await vectorStore.delete(oldChunkIds);
      }
      this.manifest.docHashes[key] = docHash;
      this.manifest.docChunks[key] = [];
      return;
    }

    const batchSize = this.vectorConfig.embeddingBatchSize;
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += batchSize) {
      const slice = chunks.slice(i, i + batchSize);
      const embeddings = await embedder.embed(slice.map((chunk) => chunk.text));
      vectors.push(...embeddings);
    }

    const records = chunks.map((chunk, index) => ({
      id: chunk.id,
      vector: vectors[index],
      metadata: chunk.metadata,
      text: chunk.text,
    }));

    const oldChunkIds = this.manifest.docChunks[key] || [];
    if (oldChunkIds.length > 0) {
      await vectorStore.delete(oldChunkIds);
    }

    await vectorStore.upsert(records);

    this.manifest.docHashes[key] = docHash;
    this.manifest.docChunks[key] = chunks.map((chunk) => chunk.id);
  }

  private buildChunks(target: DocTarget, content: string, docHash: string) {
    const options = {
      maxChunkChars: this.vectorConfig.maxChunkChars,
      overlapChars: this.vectorConfig.overlapChars,
    };
    const chunks = chunkMarkdown(content, options);
    const relPath = path.relative(this.workspaceRoot, target.filePath);

    return chunks.map((chunk, index) => {
      const chunkHash = stableTextHash(`${docHash}:${index}:${chunk.text}`);
      return {
        id: `${target.docId}:${target.topicFile}:${index}:${chunkHash}`,
        text: chunk.text,
        metadata: {
          docId: target.docId,
          docName: target.docName,
          topic: target.topicFile,
          path: relPath,
          heading: chunk.headingPath,
          chunkIndex: index + 1,
        },
      };
    });
  }

  private buildDocTargets(): DocTarget[] {
    const instances = this.documentManager.getInstances();
    if (!instances || instances.length === 0) return [];
    const topicsDir = this.documentManager.getTopicsDirectory();
    const targets: DocTarget[] = [];

    instances.forEach((instance) => {
      const topics = TopicsService.getAllTopicsFromTocElement(instance['toc-elements']);
      topics.forEach((topic) => {
        targets.push({
          docId: instance.id,
          docName: instance.name,
          topicFile: topic,
          filePath: path.join(topicsDir, topic),
        });
      });
    });

    return targets;
  }

  private async pruneMissingDocs(currentKeys: Set<string>): Promise<void> {
    const vectorStore = await this.ensureVectorStore();
    if (!vectorStore) return;
    const knownKeys = Object.keys(this.manifest.docHashes);

    for (const key of knownKeys) {
      if (currentKeys.has(key)) continue;
      const chunkIds = this.manifest.docChunks[key];
      if (chunkIds?.length) {
        await vectorStore.delete(chunkIds);
      }
      delete this.manifest.docHashes[key];
      delete this.manifest.docChunks[key];
    }
  }

  private docKey(target: DocTarget): string {
    return `${target.docId}:${target.topicFile}`;
  }

  private async enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.indexQueue.then(task, task);
    this.indexQueue = run.then(() => undefined, () => undefined);
    await run;
  }
}
