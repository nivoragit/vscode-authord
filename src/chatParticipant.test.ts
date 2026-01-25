import * as vscode from 'vscode';
import { registerAuthordChatParticipant } from './chatParticipant';
import { getVectorConfig } from './services/agentic/vectorConfig';

const sendMock = jest.fn();

jest.mock('vscode');
jest.mock('./services/agentic/vectorConfig', () => ({
  getVectorConfig: jest.fn(),
}));
jest.mock('./services/agentic/aiChatService', () => ({
  AiChatService: jest.fn().mockImplementation(() => ({
    send: sendMock,
  })),
}));

function makeStream(text: string): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]: async function* stream() {
      yield text;
    },
  };
}

describe('Authord chat participant', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendMock.mockResolvedValue(makeStream('answer'));
  });

  it('reports when vector indexing is disabled', async () => {
    (getVectorConfig as jest.Mock).mockReturnValue({
      enabled: false,
      includeConfluenceSnapshots: false,
    });

    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    registerAuthordChatParticipant(context, () => undefined);

    const handler = (vscode.chat.createChatParticipant as jest.Mock).mock.calls[0][1];
    const stream = { progress: jest.fn(), markdown: jest.fn() };

    await handler({ prompt: 'Hello', model: {} }, {}, stream, {} as any);

    expect(stream.markdown).toHaveBeenCalledWith(
      'Vector indexing is disabled. Enable `authord.vector.enabled` to use agentic retrieval.'
    );
  });

  it('reports when index service is missing', async () => {
    (getVectorConfig as jest.Mock).mockReturnValue({
      enabled: true,
      includeConfluenceSnapshots: false,
    });

    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    registerAuthordChatParticipant(context, () => undefined);

    const handler = (vscode.chat.createChatParticipant as jest.Mock).mock.calls[0][1];
    const stream = { progress: jest.fn(), markdown: jest.fn() };

    await handler({ prompt: 'Hello', model: {} }, {}, stream, {} as any);

    expect(stream.markdown).toHaveBeenCalledWith(
      'Index service is not ready. Open a docs workspace or reinitialize Authord.'
    );
  });

  it('queries the index and forwards sources to the AI responder', async () => {
    (getVectorConfig as jest.Mock).mockReturnValue({
      enabled: true,
      autoIndex: true,
      topK: 2,
      includeConfluenceSnapshots: false,
    });

    const indexService = {
      hasIndex: jest.fn().mockReturnValue(false),
      indexAll: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([
        {
          text: 'Chunk content.',
          metadata: { docName: 'Docs', topic: 'intro.md', heading: 'Intro' },
        },
      ]),
    };

    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    registerAuthordChatParticipant(context, () => indexService as any);

    const handler = (vscode.chat.createChatParticipant as jest.Mock).mock.calls[0][1];
    const stream = { progress: jest.fn(), markdown: jest.fn() };

    await handler({ prompt: 'What is Authord?', model: {} }, {}, stream, {} as any);

    expect(indexService.indexAll).toHaveBeenCalledWith(false);
    expect(indexService.query).toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalled();

    const sentMessages = sendMock.mock.calls[0][0];
    expect(sentMessages[1].content).toContain('Sources:');
    expect(sentMessages[1].content).toContain('Chunk content.');
    expect(stream.markdown).toHaveBeenCalledWith('answer');
  });
});
