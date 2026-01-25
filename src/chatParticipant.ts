import * as vscode from 'vscode';
import DocumentIndexService from './services/agentic/documentIndexService';
import { AiChatService, ChatPromptMessage } from './services/agentic/aiChatService';
import { getVectorConfig } from './services/agentic/vectorConfig';

const MAX_SOURCE_CHARS = 1200;
const MAX_TOTAL_SOURCE_CHARS = 8000;

export function registerAuthordChatParticipant(
  context: vscode.ExtensionContext,
  getIndexService?: () => DocumentIndexService | undefined
) {
  const aiChat = new AiChatService();

  const participant = vscode.chat.createChatParticipant(
    'authord.chat',
    async (request, _chatContext, stream, token) => {
      const vectorConfig = getVectorConfig();
      if (!vectorConfig.enabled) {
        stream.markdown('Vector indexing is disabled. Enable `authord.vector.enabled` to use agentic retrieval.');
        return;
      }

      const indexService = getIndexService?.();
      if (!indexService) {
        stream.markdown('Index service is not ready. Open a docs workspace or reinitialize Authord.');
        return;
      }

      if (!indexService.hasIndex() && vectorConfig.autoIndex) {
        stream.progress('Indexing documentation for the first time...');
        await indexService.indexAll(false);
      }

      stream.progress('Searching documentation...');
      const editor = vscode.window.activeTextEditor;
      let selectionText = '';
      if (editor && !editor.selection.isEmpty) {
        selectionText = editor.document.getText(editor.selection);
      }

      const queryText = selectionText
        ? `${request.prompt}\n\nContext:\n${selectionText}`
        : request.prompt;

      let sources = await indexService.query(queryText, vectorConfig.topK);
      if (sources.length === 0) {
        stream.markdown('No indexed context found. Run `Authord: Index Documentation` and try again.');
        return;
      }

      const sourcesBlock = formatSources(sources);
      const systemPrompt = [
        'You are Authord, an agent that answers using indexed documentation.',
        'Use the provided sources to answer the question and cite sources like [1], [2].',
        'If the sources do not contain the answer, say so and suggest where to look.',
        'Never claim you updated external systems such as Confluence.',
      ].join('\n');

      const userPrompt = [
        'Sources:',
        sourcesBlock,
        '',
        `User question: ${request.prompt}`,
      ].join('\n');

      const messages: ChatPromptMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      try {
        const responseStream = await aiChat.send(messages, token, request.model);
        for await (const fragment of responseStream) {
          stream.markdown(fragment);
        }
      } catch (err: any) {
        stream.markdown(`I ran into an error while answering: ${String(err?.message || err)}`);
      }
    }
  );

  context.subscriptions.push(participant);
}

function formatSources(results: Array<{ text?: string; metadata: Record<string, any> }>): string {
  const config = vscode.workspace.getConfiguration('authord');
  const confluenceBaseUrl = config.get<string>('confluence.baseUrl', '').trim();
  let totalChars = 0;
  const blocks: string[] = [];
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const sourceType = result.metadata.sourceType;
    const heading = result.metadata.heading || 'root';
    let header = '';

    if (sourceType === 'confluence') {
      const title = result.metadata.title || 'Confluence';
      const version = result.metadata.confluenceVersion ?? result.metadata.confluence_version ?? 'unknown';
      header = `[${i + 1}] ${title} (v${version})`;
      if (heading && heading !== 'root') {
        header += ` / ${heading}`;
      }
      const url = buildConfluenceUrl(
        confluenceBaseUrl,
        String(result.metadata.confluencePageId || result.metadata.pageId || ''),
        String(result.metadata.spaceKey || ''),
        String(result.metadata.anchor || '')
      );
      if (url) {
        header += `\nConfluence: ${url}`;
      }
    } else {
      const topic = result.metadata.topic || 'unknown';
      const docName = result.metadata.docName || result.metadata.docId || 'doc';
      header = `[${i + 1}] ${docName} / ${topic} / ${heading}`;
    }

    const snippet = clampText(result.text || '', MAX_SOURCE_CHARS);
    totalChars += header.length + snippet.length;
    if (totalChars > MAX_TOTAL_SOURCE_CHARS && blocks.length > 0) {
      blocks.push('...');
      break;
    }
    blocks.push(`${header}\n${snippet}`);
  }
  return blocks.join('\n\n');
}

function clampText(text: string, maxChars: number): string {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function buildConfluenceUrl(baseUrl: string, pageId: string, spaceKey?: string, anchor?: string): string | undefined {
  if (!baseUrl || !pageId) return undefined;
  const trimmed = baseUrl.replace(/\/+$/, '');
  const wikiBase = trimmed.endsWith('/wiki') ? trimmed : `${trimmed}/wiki`;
  const path =
    spaceKey
      ? `/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(pageId)}`
      : `/pages/${encodeURIComponent(pageId)}`;
  const anchorSuffix = anchor ? `#${anchor}` : '';
  return `${wikiBase}${path}${anchorSuffix}`;
}
