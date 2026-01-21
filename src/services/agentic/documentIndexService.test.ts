import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import DocumentIndexService from './documentIndexService';
import { chunkMarkdown } from './chunker';
import { createVectorStore } from './vectorStores';
import { getVectorConfig } from './vectorConfig';
import { requestJson } from './httpClient';
import {
  getAiSelectionConfig,
  getCustomProviderConfig,
  getEmbeddingProviderConfig,
  isCustomProviderReady,
  resolveCustomEmbeddingsEndpoint,
} from './aiConfig';

jest.mock('vscode');
jest.mock('./chunker', () => ({
  chunkMarkdown: jest.fn(),
}));
jest.mock('./vectorStores', () => ({
  createVectorStore: jest.fn(),
}));
jest.mock('./vectorConfig', () => ({
  getVectorConfig: jest.fn(),
}));
jest.mock('./httpClient', () => ({
  requestJson: jest.fn(),
}));
jest.mock('./aiConfig', () => ({
  getAiSelectionConfig: jest.fn(),
  getCustomProviderConfig: jest.fn(),
  getEmbeddingProviderConfig: jest.fn(),
  isCustomProviderReady: jest.fn(),
  resolveCustomEmbeddingsEndpoint: jest.fn(),
}));

describe('DocumentIndexService embedding provider switching', () => {
  let tempDir: string;
  let topicsDir: string;
  let storageDir: string;
  let filePath: string;
  let vectorStore: { upsert: jest.Mock; delete: jest.Mock; query: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'authord-index-'));
    topicsDir = path.join(tempDir, 'topics');
    storageDir = path.join(tempDir, 'storage');
    await fs.promises.mkdir(topicsDir, { recursive: true });
    filePath = path.join(topicsDir, 'intro.md');
    await fs.promises.writeFile(filePath, '# Intro\nHello world', 'utf8');

    (getVectorConfig as jest.Mock).mockReturnValue({
      enabled: true,
      autoIndex: false,
      store: 'local-hnsw',
      topK: 5,
      maxChunkChars: 2000,
      overlapChars: 200,
      embeddingBatchSize: 8,
      storagePath: undefined,
      qdrant: {
        baseUrl: undefined,
        apiKey: undefined,
        collection: 'authord_docs',
      },
    });

    (chunkMarkdown as jest.Mock).mockReturnValue([
      {
        headingPath: 'Intro',
        text: 'Chunk content.',
      },
    ]);

    vectorStore = {
      upsert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
    };
    (createVectorStore as jest.Mock).mockResolvedValue(vectorStore);

    (getAiSelectionConfig as jest.Mock).mockReturnValue({ provider: 'copilot' });
    (getCustomProviderConfig as jest.Mock).mockReturnValue({});
    (isCustomProviderReady as jest.Mock).mockReturnValue(false);
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('uses the latest embedding provider configuration on each index run', async () => {
    (getEmbeddingProviderConfig as jest.Mock)
      .mockReturnValueOnce({ provider: 'local' })
      .mockReturnValueOnce({ provider: 'custom' });

    (getCustomProviderConfig as jest.Mock).mockReturnValue({
      baseUrl: 'https://api.example.com/v1',
      model: 'chat-model',
      embeddingModel: 'embed-model',
      apiKey: 'api-key',
    });
    (isCustomProviderReady as jest.Mock).mockReturnValue(true);
    (resolveCustomEmbeddingsEndpoint as jest.Mock).mockReturnValue('https://api.example.com/v1/embeddings');
    (requestJson as jest.Mock).mockResolvedValue({ data: [{ embedding: [1, 2, 3] }] });

    const documentManager = {
      getInstances: () => [
        {
          id: 'doc-1',
          name: 'Docs',
          'toc-elements': [{ topic: 'intro.md', title: 'Intro', children: [] }],
        },
      ],
      getTopicsDirectory: () => topicsDir,
    } as any;

    const context = {
      storageUri: { fsPath: storageDir },
    } as any;

    const service = await DocumentIndexService.create(context, documentManager, tempDir);

    await service.indexAll(true);
    await service.indexAll(true);

    expect(requestJson).toHaveBeenCalledTimes(1);

    const upsertCalls = vectorStore.upsert.mock.calls;
    expect(upsertCalls).toHaveLength(2);

    const firstVectors = upsertCalls[0][0].map((record: any) => record.vector);
    const secondVectors = upsertCalls[1][0].map((record: any) => record.vector);

    expect(firstVectors[0]).toHaveLength(384);
    expect(secondVectors).toEqual([[1, 2, 3]]);
  });
});
