import * as vscode from 'vscode';

export type AiProvider = 'copilot' | 'vscode' | 'custom';

export interface AiSelectionConfig {
  provider: AiProvider;
  vendor?: string;
  modelId?: string;
  allowModelPicker: boolean;
}

export interface CustomProviderConfig {
  baseUrl?: string;
  model?: string;
  embeddingModel?: string;
  apiKey?: string;
  chatEndpoint?: string;
  requestTimeoutMs?: number;
}

export type EmbeddingProviderType = 'inherit' | 'custom' | 'local';

export interface EmbeddingProviderConfig {
  provider: EmbeddingProviderType;
}

export function getAiSelectionConfig(): AiSelectionConfig {
  const config = vscode.workspace.getConfiguration('authord');
  const providerRaw = config.get<string>('ai.provider', 'copilot');
  const provider = providerRaw === 'vscode' || providerRaw === 'custom'
    ? (providerRaw as AiProvider)
    : 'copilot';

  const vendor = config.get<string>('ai.vendor', '').trim();
  const modelId = config.get<string>('ai.modelId', '').trim();
  const allowModelPicker = config.get<boolean>('ai.allowModelPicker', true);

  return {
    provider,
    vendor: vendor || undefined,
    modelId: modelId || undefined,
    allowModelPicker,
  };
}

export function getCustomProviderConfig(): CustomProviderConfig {
  const config = vscode.workspace.getConfiguration('authord');
  const baseUrl = config.get<string>('ai.custom.baseUrl', '').trim();
  const model = config.get<string>('ai.custom.model', '').trim();
  const embeddingModel = config.get<string>('ai.custom.embeddingModel', '').trim();
  const chatEndpoint = config.get<string>('ai.custom.chatEndpoint', '').trim();
  const timeoutSetting = config.get<number>('ai.custom.requestTimeoutMs', 60_000);
  const apiKeySetting = config.get<string>('ai.custom.apiKey', '').trim();
  const apiKeyEnv = getCustomApiKeyFromEnv();
  const apiKey = apiKeySetting || apiKeyEnv;

  return {
    baseUrl: baseUrl || undefined,
    model: model || undefined,
    embeddingModel: embeddingModel || undefined,
    apiKey: apiKey || undefined,
    chatEndpoint: chatEndpoint || undefined,
    requestTimeoutMs: normalizeTimeout(timeoutSetting),
  };
}

export function getEmbeddingProviderConfig(): EmbeddingProviderConfig {
  const config = vscode.workspace.getConfiguration('authord');
  const providerRaw = config.get<string>('ai.embeddings.provider', 'inherit').trim();
  const provider: EmbeddingProviderType = providerRaw === 'custom'
    || providerRaw === 'local'
    ? providerRaw
    : 'inherit';

  return {
    provider,
  };
}

export function isCustomProviderReady(config: CustomProviderConfig): boolean {
  return Boolean(config.baseUrl && config.model);
}

export function isCustomChatProviderReady(config: CustomProviderConfig): boolean {
  return Boolean((config.chatEndpoint || config.baseUrl) && config.model);
}

export function resolveCustomChatEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/\/+$/, '');
    if (!path || path === '/') {
      return `${trimmed}/v1/chat/completions`;
    }
  } catch {
    // Ignore URL parsing errors and fall back to default behavior.
  }
  return `${trimmed}/chat/completions`;
}

export function resolveCustomEmbeddingsEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/embeddings')) return trimmed;
  if (trimmed.endsWith('/chat/completions')) return trimmed.replace(/\/chat\/completions$/, '/embeddings');
  if (trimmed.endsWith('/v1')) return `${trimmed}/embeddings`;
  return `${trimmed}/embeddings`;
}

function getCustomApiKeyFromEnv(): string | undefined {
  const candidates = [
    'AUTHORD_AI_API_KEY',
    'DEEPSEEK_API_KEY',
    'OPENAI_API_KEY',
  ];

  for (const key of candidates) {
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
  }

  return undefined;
}

function normalizeTimeout(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const safe = Math.round(value);
  if (safe < 1000) return 1000;
  if (safe > 300000) return 300000;
  return safe;
}
