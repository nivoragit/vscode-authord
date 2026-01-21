import * as vscode from 'vscode';
import {
  getAiSelectionConfig,
  getCustomProviderConfig,
  isCustomChatProviderReady,
  resolveCustomChatEndpoint,
} from './aiConfig';
import { requestJson } from './httpClient';
import { getLogger } from '../LoggerService';

export interface ChatPromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class AiChatService {
  private readonly logger = getLogger();

  async send(
    messages: ChatPromptMessage[],
    token: vscode.CancellationToken,
    fallbackModel?: vscode.LanguageModelChat
  ): Promise<AsyncIterable<string>> {
    const aiConfig = getAiSelectionConfig();
    const customConfig = getCustomProviderConfig();

    if (aiConfig.provider === 'custom' && isCustomChatProviderReady(customConfig)) {
      this.logger.debug('Authord chat using custom provider.', {
        baseUrl: customConfig.baseUrl,
        endpointOverride: customConfig.chatEndpoint,
        model: customConfig.model,
      });
      const response = await this.sendCustom(messages, customConfig);
      return singleChunkStream(response);
    }

    const model = await this.pickModel(aiConfig, fallbackModel);
    if (!model) {
      throw new Error('No VS Code language model is available.');
    }

    const vscodeMessages = messages.map((message) => {
      if (message.role === 'assistant') {
        return vscode.LanguageModelChatMessage.Assistant(message.content);
      }
      return vscode.LanguageModelChatMessage.User(message.content);
    });

    const response = await model.sendRequest(vscodeMessages, {}, token);
    return response.text;
  }

  private async pickModel(
    config: { provider: string; vendor?: string; modelId?: string },
    fallbackModel?: vscode.LanguageModelChat
  ): Promise<vscode.LanguageModelChat | undefined> {
    const allModels = await vscode.lm.selectChatModels();
    if (allModels.length === 0) return fallbackModel;

    if (config.modelId) {
      const match = allModels.find((model) => model.id === config.modelId);
      if (match) return match;
    }

    if (config.provider === 'copilot') {
      const copilot = allModels.find((model) => model.vendor === 'copilot');
      if (copilot) return copilot;
    }

    if (config.vendor) {
      const vendorModel = allModels.find((model) => model.vendor === config.vendor);
      if (vendorModel) return vendorModel;
    }

    return allModels[0] || fallbackModel;
  }

  private async sendCustom(
    messages: ChatPromptMessage[],
    config: { baseUrl?: string; model?: string; apiKey?: string; chatEndpoint?: string; requestTimeoutMs?: number }
  ) {
    const endpoint = config.chatEndpoint?.trim().replace(/\/+$/, '')
      || resolveCustomChatEndpoint(config.baseUrl!);
    const response = await requestJson({
      url: endpoint,
      method: 'POST',
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      timeoutMs: config.requestTimeoutMs,
      body: {
        model: config.model,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      },
    });

    const content = extractCompletionContent(response);
    if (!content) {
      throw new Error('Custom provider returned an empty response.');
    }
    return content;
  }
}

function extractCompletionContent(response: any): string | undefined {
  const choices = response?.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    const messageContent = first?.message?.content;
    if (typeof messageContent === 'string') return messageContent;

    const textContent = first?.text;
    if (typeof textContent === 'string') return textContent;
  }

  if (typeof response?.content === 'string') return response.content;

  return undefined;
}

async function* singleChunkStream(text: string): AsyncIterable<string> {
  yield text;
}
