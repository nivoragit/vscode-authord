import {
  getAiSelectionConfig,
  getCustomProviderConfig,
  getEmbeddingProviderConfig,
  isCustomProviderReady,
  resolveCustomEmbeddingsEndpoint,
} from './aiConfig';
import { createEmbeddingProvider } from './embeddings';
import { requestJson } from './httpClient';

jest.mock('./aiConfig', () => ({
  getAiSelectionConfig: jest.fn(),
  getCustomProviderConfig: jest.fn(),
  getEmbeddingProviderConfig: jest.fn(),
  isCustomProviderReady: jest.fn(),
  resolveCustomEmbeddingsEndpoint: jest.fn(),
}));
jest.mock('./httpClient', () => ({
  requestJson: jest.fn(),
}));

describe('embedding provider selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAiSelectionConfig as jest.Mock).mockReturnValue({ provider: 'copilot' });
    (getCustomProviderConfig as jest.Mock).mockReturnValue({});
    (getEmbeddingProviderConfig as jest.Mock).mockReturnValue({ provider: 'inherit' });
    (isCustomProviderReady as jest.Mock).mockReturnValue(false);
    (resolveCustomEmbeddingsEndpoint as jest.Mock).mockReturnValue('https://api.example.com/v1/embeddings');
  });

  it('uses a custom OpenAI-compatible provider when selected', async () => {
    (getEmbeddingProviderConfig as jest.Mock).mockReturnValue({ provider: 'custom' });
    (getCustomProviderConfig as jest.Mock).mockReturnValue({
      baseUrl: 'https://api.example.com/v1',
      model: 'chat-model',
      embeddingModel: 'embed-model',
      apiKey: 'api-key',
    });
    (isCustomProviderReady as jest.Mock).mockReturnValue(true);
    (resolveCustomEmbeddingsEndpoint as jest.Mock).mockReturnValue('https://api.example.com/v1/embeddings');
    (requestJson as jest.Mock).mockResolvedValue({
      data: [{ embedding: [0.1, 0.2] }],
    });

    const provider = createEmbeddingProvider();
    const embeddings = await provider.embed(['hello']);

    expect(requestJson).toHaveBeenCalledWith({
      url: 'https://api.example.com/v1/embeddings',
      method: 'POST',
      headers: { Authorization: 'Bearer api-key' },
      body: {
        model: 'embed-model',
        input: ['hello'],
      },
    });
    expect(embeddings).toEqual([[0.1, 0.2]]);
    expect(provider.modelLabel()).toBe('embed-model');
  });

  it('falls back to local embeddings when configured', async () => {
    (getEmbeddingProviderConfig as jest.Mock).mockReturnValue({ provider: 'local' });

    const provider = createEmbeddingProvider();
    const embeddings = await provider.embed(['one', 'two']);

    expect(requestJson).not.toHaveBeenCalled();
    expect(embeddings).toHaveLength(2);
    expect(embeddings[0]).toHaveLength(384);
    expect(provider.modelLabel()).toBe('local-hash');
  });

  it('inherits the custom provider when available', async () => {
    (getEmbeddingProviderConfig as jest.Mock).mockReturnValue({ provider: 'inherit' });
    (getAiSelectionConfig as jest.Mock).mockReturnValue({ provider: 'custom' });
    (getCustomProviderConfig as jest.Mock).mockReturnValue({
      baseUrl: 'https://api.example.com/v1',
      model: 'chat-model',
      apiKey: 'api-key',
    });
    (isCustomProviderReady as jest.Mock).mockReturnValue(true);
    (resolveCustomEmbeddingsEndpoint as jest.Mock).mockReturnValue('https://api.example.com/v1/embeddings');
    (requestJson as jest.Mock).mockResolvedValue({
      embeddings: [[0.2, 0.3, 0.4]],
    });

    const provider = createEmbeddingProvider();
    const embeddings = await provider.embed(['hello']);

    expect(requestJson).toHaveBeenCalled();
    expect(embeddings).toEqual([[0.2, 0.3, 0.4]]);
  });

  it('switches embedding providers when configuration changes', async () => {
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

    const localProvider = createEmbeddingProvider();
    const localEmbeddings = await localProvider.embed(['hello']);

    expect(requestJson).not.toHaveBeenCalled();
    expect(localEmbeddings[0]).toHaveLength(384);

    (requestJson as jest.Mock).mockResolvedValue({
      data: [{ embedding: [1, 2, 3] }],
    });

    const customProvider = createEmbeddingProvider();
    const customEmbeddings = await customProvider.embed(['hello']);

    expect(requestJson).toHaveBeenCalledTimes(1);
    expect(customEmbeddings).toEqual([[1, 2, 3]]);
  });
});
