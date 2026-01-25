import * as vscode from 'vscode';
import ConfluencePublishService from './services/ConfluencePublishService';
import { getVectorConfig } from './services/agentic/vectorConfig';

jest.mock('vscode');
jest.mock('./services/RenderService', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    invalidateDocset: jest.fn(),
    renderDocument: jest.fn(),
  })),
}));
jest.mock('./services/agentic/vectorConfig', () => ({
  getVectorConfig: jest.fn(),
}));

const Authord = require('./authordExtension').default as typeof import('./authordExtension').default;

describe('Authord AI configuration', () => {
  let context: vscode.ExtensionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    (getVectorConfig as jest.Mock).mockReturnValue({
      enabled: true,
      autoIndex: true,
      includeConfluenceSnapshots: false,
    });
  });

  it('configures Copilot as the AI provider', async () => {
    const updateMock = jest.fn();
    const getMock = jest.fn((_key: string, defaultValue: unknown) => defaultValue);

    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: getMock,
      update: updateMock,
    });

    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({
      provider: 'copilot',
    });
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce('Not now');

    const authord = new Authord(context, '/repo');
    await (authord as any).configureAiProvider();

    expect(updateMock).toHaveBeenCalledWith(
      'ai.provider',
      'copilot',
      vscode.ConfigurationTarget.Global
    );
    expect(updateMock).toHaveBeenCalledWith(
      'ai.vendor',
      '',
      vscode.ConfigurationTarget.Global
    );
    expect(updateMock).toHaveBeenCalledWith(
      'ai.modelId',
      '',
      vscode.ConfigurationTarget.Global
    );
  });

  it('configures a VS Code model provider from selection', async () => {
    const updateMock = jest.fn();
    const getMock = jest.fn((_key: string, defaultValue: unknown) => defaultValue);

    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: getMock,
      update: updateMock,
    });

    const model = {
      name: 'Codex',
      vendor: 'openai',
      family: 'codex',
      version: '1',
      id: 'codex-1',
    };

    (vscode.lm.selectChatModels as jest.Mock).mockResolvedValue([model]);
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce({ provider: 'vscode' })
      .mockResolvedValueOnce({ label: model.name, model });
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce('Not now');

    const authord = new Authord(context, '/repo');
    await (authord as any).configureAiProvider();

    expect(updateMock).toHaveBeenCalledWith(
      'ai.provider',
      'vscode',
      vscode.ConfigurationTarget.Global
    );
    expect(updateMock).toHaveBeenCalledWith(
      'ai.vendor',
      'openai',
      vscode.ConfigurationTarget.Global
    );
    expect(updateMock).toHaveBeenCalledWith(
      'ai.modelId',
      'codex-1',
      vscode.ConfigurationTarget.Global
    );
  });

  it('configures a custom provider using the DeepSeek preset', async () => {
    const updateMock = jest.fn();
    const getMock = jest.fn((_key: string, defaultValue: unknown) => defaultValue);

    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: getMock,
      update: updateMock,
    });

    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce({ provider: 'custom' })
      .mockResolvedValueOnce({
        label: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-reasoner',
      });

    (vscode.window.showInputBox as jest.Mock).mockResolvedValue('');
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce('Not now');

    const authord = new Authord(context, '/repo');
    await (authord as any).configureAiProvider();

    expect(updateMock).toHaveBeenCalledWith(
      'ai.provider',
      'custom',
      vscode.ConfigurationTarget.Global
    );
    expect(updateMock).toHaveBeenCalledWith(
      'ai.custom.baseUrl',
      'https://api.deepseek.com',
      vscode.ConfigurationTarget.Global
    );
    expect(updateMock).toHaveBeenCalledWith(
      'ai.custom.model',
      'deepseek-reasoner',
      vscode.ConfigurationTarget.Global
    );
  });

  it('installs the Codex skill to the resolved CODEX_HOME path', async () => {
    const mockFs = {
      access: jest.fn().mockResolvedValue(undefined),
      mkdir: jest.fn().mockResolvedValue(undefined),
      copyFile: jest.fn().mockResolvedValue(undefined),
    };

    process.env.CODEX_HOME = '/codex-home';

    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce('Install');

    const contextWithUri = {
      ...context,
      extensionUri: vscode.Uri.file('/extension'),
    } as vscode.ExtensionContext;

    const authord = new Authord(
      contextWithUri,
      '/repo',
      mockFs as unknown as typeof import('fs').promises
    );

    await (authord as any).installCodexSkill();

    expect(mockFs.access).toHaveBeenCalledWith('/extension/skills/authord-docs/SKILL.md');
    expect(mockFs.mkdir).toHaveBeenCalledWith('/codex-home/skills/authord-docs', { recursive: true });
    expect(mockFs.copyFile).toHaveBeenCalledWith(
      '/extension/skills/authord-docs/SKILL.md',
      '/codex-home/skills/authord-docs/SKILL.md'
    );
  });

  it('publishes docs to Confluence and updates the vector index', async () => {
    const updateMock = jest.fn();
    const getMock = jest.fn((_key: string, defaultValue: unknown) => defaultValue);

    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: getMock,
      update: updateMock,
    });

    (vscode.window as any).withProgress = jest.fn((_opts, task) => task());

    const publishSpy = jest
      .spyOn(ConfluencePublishService.prototype, 'publish')
      .mockResolvedValue({ stdout: '', stderr: '', command: 'authord', args: [] });

    const authord = new Authord(context, '/repo');
    (authord as any).documentManager = {} as any;

    const indexService = {
      indexAll: jest.fn().mockResolvedValue(undefined),
      updateDocumentManager: jest.fn(),
    };
    (authord as any).indexService = indexService;

    await (authord as any).publishDocs();

    expect(indexService.indexAll).toHaveBeenCalledWith(true);
    expect(publishSpy).toHaveBeenCalled();

    publishSpy.mockRestore();
  });

  it('skips publish when Confluence is disabled', async () => {
    const updateMock = jest.fn();
    const getMock = jest.fn((key: string, defaultValue: unknown) => {
      if (key === 'confluence.enabled') return false;
      return defaultValue;
    });

    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: getMock,
      update: updateMock,
    });

    const publishSpy = jest
      .spyOn(ConfluencePublishService.prototype, 'publish')
      .mockResolvedValue({ stdout: '', stderr: '', command: 'authord', args: [] });

    const authord = new Authord(context, '/repo');
    (authord as any).documentManager = {} as any;
    (authord as any).indexService = { indexAll: jest.fn().mockResolvedValue(undefined) };

    await (authord as any).publishDocs();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Confluence publishing is disabled in settings.');
    expect(publishSpy).not.toHaveBeenCalled();

    publishSpy.mockRestore();
  });

  it('indexes docs when the index command is invoked', async () => {
    const commands: Record<string, () => Promise<void>> = {};
    const commandExecutor = {
      registerCommand: jest.fn((name: string, handler: () => Promise<void>) => {
        commands[name] = handler;
        return { dispose: jest.fn() };
      }),
      executeCommand: jest.fn(),
    };

    const authord = new Authord(context, '/repo');
    (authord as any).commandExecutor = commandExecutor;
    (authord as any).topicsProvider = {};
    (authord as any).documentationProvider = {};
    (authord as any).documentManager = {} as any;
    (authord as any).ensureIndexService = jest.fn().mockResolvedValue(undefined);
    (vscode.window as any).withProgress = jest.fn((_opts, task) => task());

    const indexService = {
      indexAll: jest.fn().mockResolvedValue(undefined),
    };
    (authord as any).indexService = indexService;

    (authord as any).registerCommands();

    await commands['authordExtension.indexDocs']();

    expect(indexService.indexAll).toHaveBeenCalledWith(true);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Documentation index updated.');
  });

  it('warns when indexing is disabled', async () => {
    (getVectorConfig as jest.Mock).mockReturnValue({
      enabled: false,
      autoIndex: true,
      includeConfluenceSnapshots: false,
    });

    const commands: Record<string, () => Promise<void>> = {};
    const commandExecutor = {
      registerCommand: jest.fn((name: string, handler: () => Promise<void>) => {
        commands[name] = handler;
        return { dispose: jest.fn() };
      }),
      executeCommand: jest.fn(),
    };

    const authord = new Authord(context, '/repo');
    (authord as any).commandExecutor = commandExecutor;
    (authord as any).topicsProvider = {};
    (authord as any).documentationProvider = {};
    (authord as any).documentManager = {} as any;
    (authord as any).ensureIndexService = jest.fn().mockResolvedValue(undefined);

    const indexService = {
      indexAll: jest.fn().mockResolvedValue(undefined),
    };
    (authord as any).indexService = indexService;

    (authord as any).registerCommands();

    await commands['authordExtension.indexDocs']();

    expect(indexService.indexAll).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Vector indexing is disabled in settings.');
  });

  it('clears the index when the clear command is invoked', async () => {
    const commands: Record<string, () => Promise<void>> = {};
    const commandExecutor = {
      registerCommand: jest.fn((name: string, handler: () => Promise<void>) => {
        commands[name] = handler;
        return { dispose: jest.fn() };
      }),
      executeCommand: jest.fn(),
    };

    const authord = new Authord(context, '/repo');
    (authord as any).commandExecutor = commandExecutor;
    (authord as any).topicsProvider = {};
    (authord as any).documentationProvider = {};
    (authord as any).documentManager = {} as any;
    (authord as any).ensureIndexService = jest.fn().mockResolvedValue(undefined);

    const indexService = {
      clearIndex: jest.fn().mockResolvedValue(undefined),
    };
    (authord as any).indexService = indexService;

    (authord as any).registerCommands();

    await commands['authordExtension.clearIndex']();

    expect(indexService.clearIndex).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Vector index cleared.');
  });

  it('auto-indexes on markdown save when enabled', async () => {
    (getVectorConfig as jest.Mock).mockReturnValue({
      enabled: true,
      autoIndex: true,
      includeConfluenceSnapshots: false,
    });

    let saveHandler: ((doc: any) => Promise<void>) | undefined;
    (vscode.workspace.onDidSaveTextDocument as jest.Mock).mockImplementation((handler: any) => {
      saveHandler = handler;
      return { dispose: jest.fn() };
    });
    (vscode.window.onDidChangeVisibleTextEditors as jest.Mock).mockReturnValue({ dispose: jest.fn() });
    (vscode.window.onDidChangeActiveTextEditor as jest.Mock).mockReturnValue({ dispose: jest.fn() });
    (vscode.workspace.onDidChangeTextDocument as jest.Mock).mockReturnValue({ dispose: jest.fn() });
    (vscode.window.onDidChangeTextEditorSelection as jest.Mock).mockReturnValue({ dispose: jest.fn() });

    const authord = new Authord(context, '/repo');
    const indexService = {
      indexDocument: jest.fn().mockResolvedValue(undefined),
    };
    (authord as any).indexService = indexService;
    (authord as any).subscribeListeners();

    const doc = {
      languageId: 'markdown',
      uri: { fsPath: '/repo/docs/topics/example.md' },
      getText: () => '# Title',
    };

    await saveHandler?.(doc);

    expect(indexService.indexDocument).toHaveBeenCalledWith('/repo/docs/topics/example.md', '# Title');
  });

  it('skips auto-index when disabled', async () => {
    (getVectorConfig as jest.Mock).mockReturnValue({
      enabled: true,
      autoIndex: false,
      includeConfluenceSnapshots: false,
    });

    let saveHandler: ((doc: any) => Promise<void>) | undefined;
    (vscode.workspace.onDidSaveTextDocument as jest.Mock).mockImplementation((handler: any) => {
      saveHandler = handler;
      return { dispose: jest.fn() };
    });
    (vscode.window.onDidChangeVisibleTextEditors as jest.Mock).mockReturnValue({ dispose: jest.fn() });
    (vscode.window.onDidChangeActiveTextEditor as jest.Mock).mockReturnValue({ dispose: jest.fn() });
    (vscode.workspace.onDidChangeTextDocument as jest.Mock).mockReturnValue({ dispose: jest.fn() });
    (vscode.window.onDidChangeTextEditorSelection as jest.Mock).mockReturnValue({ dispose: jest.fn() });

    const authord = new Authord(context, '/repo');
    const indexService = {
      indexDocument: jest.fn().mockResolvedValue(undefined),
    };
    (authord as any).indexService = indexService;
    (authord as any).subscribeListeners();

    const doc = {
      languageId: 'markdown',
      uri: { fsPath: '/repo/docs/topics/example.md' },
      getText: () => '# Title',
    };

    await saveHandler?.(doc);

    expect(indexService.indexDocument).not.toHaveBeenCalled();
  });
});
